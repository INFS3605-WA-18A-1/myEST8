// Reimbursement Requests: a Tenant who arranged an Urgent Repair sends the receipt,
// the Property Manager checks it and forwards it to the Property Owner, then marks
// it reimbursed once the Owner has paid the Tenant back.

import { describe, expect, test } from 'vitest';
import { HOUR } from './support/harness.ts';
import { KING_ST, OLIVIA_EMAIL, TOM, world } from './support/world.ts';

type World = Awaited<ReturnType<typeof world>>;

const pdf = (filename = 'receipt.pdf') => ({ filename, contentType: 'application/pdf', content: new Uint8Array([1, 2]) });
const jpeg = (filename = 'receipt.jpg') => ({ filename, contentType: 'image/jpeg', content: new Uint8Array([1]) });

/** Tom reports water through the ceiling: an Urgent Repair, with its receipt link. */
async function tomsBurstPipe({ h, alice }: World) {
  h.classifier.when('Water is pouring through the ceiling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });
  await h.receive(TOM, 'Water is pouring through the ceiling');
  const link = h.messenger.last(TOM)!.data.receiptLink as string;
  const [repair] = (await alice.dashboard()).urgentRepairs;
  return { link, id: repair!.urgentRepairId };
}

const kinds = (timeline: { kind: string }[]) => timeline.map((e) => e.kind);

describe('a Reimbursement Request', () => {
  test("waits for the Property Manager's review once the receipt arrives, instead of going straight to the Property Owner", async () => {
    const w = await world();
    const { h, alice } = w;
    const { link, id } = await tomsBurstPipe(w);
    expect(await alice.reimbursement(id)).toMatchObject({ status: 'reminder_sent', receipts: [], amountCents: null });
    expect((await alice.navCounts()).approvals).toBe(0);

    await h.advance(3 * HOUR);
    await h.upload(link, [pdf()], { amountCents: 450_00 });

    expect(h.messenger.to(OLIVIA_EMAIL)).toEqual([]);
    const request = await alice.reimbursement(id);
    expect(request).toMatchObject({
      status: 'receipt_received',
      amountCents: 450_00,
      limitCents: 1000_00,
      propertyAddress: KING_ST,
      tenant: { name: 'Tom Tran' },
      owner: { name: 'Olivia Owens' },
      receipts: [{ filename: 'receipt.pdf', contentType: 'application/pdf' }],
      forwardedAt: null,
      reimbursedAt: null,
    });
    expect(request.receivedAt).toBe(h.clock.now().toISOString());
    expect(kinds(request.timeline)).toEqual(['reported', 'reminder_sent', 'receipt_received']);
    expect(request.timeline.at(-1)).toMatchObject({ kind: 'receipt_received', files: 1, amountCents: 450_00 });
    // The Tenant's report and the reminder are the Reimbursement Request's message source.
    expect(request.messages.map((m) => m.template)).toEqual([null, 'tenant.urgent_repair_reminder']);
    expect(request.messages[0]).toMatchObject({ direction: 'in', text: 'Water is pouring through the ceiling' });

    expect((await alice.navCounts()).approvals).toBe(1);
    expect((await alice.approvals()).reimbursements).toMatchObject([{ urgentRepairId: id, status: 'receipt_received', amountCents: 450_00, receipts: 1 }]);
  });

  test('forwarded by the Property Manager, it reaches the Property Owner by email with the receipt and the Property Manager copied in; marked reimbursed, the Tenant is told', async () => {
    const w = await world();
    const { h, alice } = w;
    const { link, id } = await tomsBurstPipe(w);
    await h.upload(link, [pdf(), jpeg()], { amountCents: 450_00 });

    await alice.forwardReimbursement(id, { amountCents: 420_00 });

    expect(h.messenger.to(OLIVIA_EMAIL)).toMatchObject([
      {
        channel: 'email',
        template: 'owner.urgent_repair_receipt',
        cc: ['alice@harbour.example'],
        attachments: ['receipt.pdf', 'receipt.jpg'],
        data: { propertyAddress: KING_ST, tenantName: 'Tom Tran', amountCents: 420_00, limitCents: 1000_00 },
      },
    ]);
    expect(h.messenger.last(OLIVIA_EMAIL)!.text).toContain('$420.00');
    const forwarded = await alice.reimbursement(id);
    expect(forwarded).toMatchObject({ status: 'receipt_forwarded', amountCents: 420_00, forwardedAt: h.clock.now().toISOString() });
    expect(forwarded.timeline.at(-1)).toMatchObject({ kind: 'forwarded', amountCents: 420_00, ownerName: 'Olivia Owens' });
    expect((await alice.navCounts()).approvals).toBe(0);
    expect((await alice.approvals()).reimbursements).toMatchObject([{ status: 'receipt_forwarded' }]);

    await h.advance(24 * HOUR);
    await alice.markReimbursed(id);

    const done = await alice.reimbursement(id);
    expect(done).toMatchObject({ status: 'reimbursed', reimbursedAt: h.clock.now().toISOString() });
    expect(kinds(done.timeline).slice(-2)).toEqual(['forwarded', 'reimbursed']);
    expect(h.messenger.last(TOM)).toMatchObject({ template: 'tenant.reimbursed', data: { propertyAddress: KING_ST, amountCents: 420_00 } });
    expect(h.messenger.last(TOM)!.text).toContain('$420.00');
    // Reimbursed, it leaves Approvals.
    expect((await alice.approvals()).reimbursements).toEqual([]);
  });

  test('needs the receipt as a photo or PDF, and a sensible amount', async () => {
    const w = await world();
    const { h, alice } = w;
    const { link, id } = await tomsBurstPipe(w);

    await expect(h.upload(link, [])).rejects.toThrow(/photo or PDF of the receipt/);
    await expect(h.upload(link, [{ filename: 'notes.txt', contentType: 'text/plain', content: new Uint8Array([1]) }])).rejects.toThrow(/photo or PDF/);
    await expect(h.upload(link, [{ filename: 'receipt.svg', contentType: 'image/svg+xml', content: new Uint8Array([1]) }])).rejects.toThrow(/photo or PDF/);
    await expect(h.upload(link, [pdf()], { amountCents: 0 })).rejects.toThrow(/amount/);

    expect(await alice.reimbursement(id)).toMatchObject({ status: 'reminder_sent', receipts: [] });
  });

  test('takes an amount over the $1,000 limit, which the page warns about, and asks for an amount before forwarding when the Tenant gave none', async () => {
    const w = await world();
    const { h, alice } = w;
    const { link, id } = await tomsBurstPipe(w);
    await h.upload(link, [jpeg()]);
    expect(await alice.reimbursement(id)).toMatchObject({ status: 'receipt_received', amountCents: null });

    await expect(alice.forwardReimbursement(id, {})).rejects.toThrow(/amount/);
    await expect(alice.forwardReimbursement(id, { amountCents: -5 })).rejects.toThrow(/amount/);
    await alice.forwardReimbursement(id, { amountCents: 1250_00 });

    expect(await alice.reimbursement(id)).toMatchObject({ status: 'receipt_forwarded', amountCents: 1250_00, overLimit: true });
  });

  test('moves only forward: no forwarding before a receipt, no marking reimbursed before forwarding, nothing once reimbursed', async () => {
    const w = await world();
    const { h, alice } = w;
    const { link, id } = await tomsBurstPipe(w);

    await expect(alice.forwardReimbursement(id, { amountCents: 100_00 })).rejects.toThrow(/receipt/);
    await expect(alice.markReimbursed(id)).rejects.toThrow(/forward/i);

    await h.upload(link, [pdf()], { amountCents: 300_00 });
    await expect(alice.markReimbursed(id)).rejects.toThrow(/forward/i);
    await expect(alice.resendReceiptLink(id)).rejects.toThrow(/receipt/);

    await alice.forwardReimbursement(id, {});
    // Forwarding again sends the Property Owner another copy.
    await alice.forwardReimbursement(id, { amountCents: 310_00 });
    expect(h.messenger.to(OLIVIA_EMAIL).map((m) => m.data.amountCents)).toEqual([300_00, 310_00]);

    await alice.markReimbursed(id);
    await expect(alice.markReimbursed(id)).rejects.toThrow(/already/);
    await expect(alice.forwardReimbursement(id, {})).rejects.toThrow(/already/);
    await expect(h.upload(link, [pdf('another.pdf')])).rejects.toThrow(/expired|already/);
  });

  test('a receipt sent after forwarding comes back for review', async () => {
    const w = await world();
    const { h, alice } = w;
    const { link, id } = await tomsBurstPipe(w);
    await h.upload(link, [pdf()], { amountCents: 300_00 });
    await alice.forwardReimbursement(id, {});

    await h.upload(link, [jpeg('page-2.jpg')]);

    expect(await alice.reimbursement(id)).toMatchObject({ status: 'receipt_received', amountCents: 300_00, receipts: [{ filename: 'receipt.pdf' }, { filename: 'page-2.jpg' }] });
  });

  test('can send the Tenant the receipt link again while it waits for the receipt', async () => {
    const w = await world();
    const { h, alice } = w;
    const { id } = await tomsBurstPipe(w);

    await alice.resendReceiptLink(id);

    expect(h.messenger.to(TOM).map((m) => m.template)).toEqual(['tenant.urgent_repair_reminder', 'tenant.urgent_repair_reminder']);
    expect(kinds((await alice.reimbursement(id)).timeline).at(-1)).toBe('link_resent');
  });

  test('a receipt sent by WhatsApp counts only when it carries a photo or PDF', async () => {
    const w = await world();
    const { h, alice } = w;
    const { id } = await tomsBurstPipe(w);
    h.classifier.when('Here is the plumber invoice', { messageClass: 'update', relatedItem: `urgent_repair:${id}`, updateType: 'receipt' });

    await h.receive(TOM, 'Here is the plumber invoice', {
      channel: 'whatsapp',
      attachments: [{ filename: 'invoice.txt', contentType: 'text/plain', content: new Uint8Array([1]) }],
    });
    expect(await alice.reimbursement(id)).toMatchObject({ status: 'reminder_sent', receipts: [] });
    expect((await alice.reimbursement(id)).messages.at(-1)).toMatchObject({ direction: 'in', unread: true });

    await h.receive(TOM, 'Here is the plumber invoice', {
      channel: 'whatsapp',
      attachments: [jpeg(), { filename: 'invoice.txt', contentType: 'text/plain', content: new Uint8Array([1]) }],
    });
    const request = await alice.reimbursement(id);
    expect(request).toMatchObject({ status: 'receipt_received', receipts: [{ filename: 'receipt.jpg' }] });
    expect(request.timeline.at(-1)).toMatchObject({ kind: 'receipt_received', via: 'whatsapp' });
    expect(h.messenger.to(OLIVIA_EMAIL)).toEqual([]);

    await alice.markReimbursementRead(id);
    expect((await alice.reimbursement(id)).messages.some((m) => m.unread)).toBe(false);
  });

  test("is only seen and changed inside the Tenant's Agency", async () => {
    const w = await world();
    const { h } = w;
    const { link, id } = await tomsBurstPipe(w);
    await h.upload(link, [pdf()], { amountCents: 300_00 });
    const otherAgency = await h.app.setup.createAgency({ name: 'Elsewhere Realty', timeZone: 'Australia/Sydney' });
    const eve = h.as(await h.app.setup.addPropertyManager(otherAgency, { name: 'Eve Else', email: 'eve@elsewhere.example', password: 'correct horse battery' }));

    await expect(eve.reimbursement(id)).rejects.toThrow(/Reimbursement Request/);
    await expect(eve.forwardReimbursement(id, { amountCents: 300_00 })).rejects.toThrow(/Reimbursement Request/);
    await expect(eve.markReimbursed(id)).rejects.toThrow(/Reimbursement Request/);
    await expect(eve.resendReceiptLink(id)).rejects.toThrow(/Reimbursement Request/);
    expect((await eve.approvals({ filter: 'all' })).reimbursements).toEqual([]);
    expect(h.messenger.to(OLIVIA_EMAIL)).toEqual([]);
  });
});
