// A Reimbursement Request's page at /reimbursements/:id, as the Property Manager uses it:
// where it stands, the receipts, the timeline and the messages, and Forward to Property
// Owner then Mark reimbursed.

import { describe, expect, test } from 'vitest';
import { HOUR } from '../support/harness.ts';
import { visible, webWorld } from '../support/web.ts';
import { KING_ST, OLIVIA_EMAIL, TOM } from '../support/world.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;

/** Tom reports water through the ceiling, an Urgent Repair; returns its receipt link and id. */
async function tomsBurstPipe(w: Web) {
  w.h.classifier.when('Water is pouring through the ceiling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });
  await w.h.receive(TOM, 'Water is pouring through the ceiling');
  const link = w.h.messenger.last(TOM)!.data.receiptLink as string;
  return { link, id: (await w.alice.dashboard()).urgentRepairs[0]!.urgentRepairId };
}

async function page(w: Web, path: string, cookie: string) {
  const res = await w.get(path, cookie);
  expect(res.status, path).toBe(200);
  return res.text();
}

/** Follows a POST's redirect and returns the page it lands on. */
async function follow(w: Web, res: Response, cookie: string) {
  expect(res.status).toBe(303);
  return page(w, res.headers.get('location')!, cookie);
}

/** How many steps are ticked. */
const ticks = (html: string) => html.match(/data-content="✓"/g)?.length ?? 0;

describe('the Reimbursement Request page', () => {
  test('waiting for the receipt: only Reported is ticked, and the link can be sent again', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const { id } = await tomsBurstPipe(w);

    const html = await page(w, `/reimbursements/${id}`, cookie);
    const readable = visible(html);
    for (const expected of [`Reimbursement Request #${id}`, 'Water is pouring through the ceiling', KING_ST, 'Tenant Tom Tran', 'Awaiting receipt', 'No amount yet', 'Waiting for the receipt', 'No receipt yet']) {
      expect(readable).toContain(expected);
    }
    expect(html).toContain(`href="/properties/${w.ids.kingSt}"`);
    for (const step of ['Reported', 'Receipt received', 'Forwarded to Property Owner', 'Reimbursed']) expect(readable).toContain(step);
    expect(ticks(html)).toBe(1);
    // The message source: Tom's report and what he was sent.
    expect(readable).toContain('From +61400000001 by SMS');
    expect(readable).toContain('Urgent repair: what to do now');
    expect(readable).toContain('Tenant told to arrange the Urgent Repair and send the receipt');

    const after = await follow(w, await w.post(`/reimbursements/${id}/resend`, {}, cookie), cookie);
    expect(visible(after)).toContain('Receipt link sent to Tom Tran again');
    expect(visible(after)).toContain('Receipt link sent to the Tenant again');
    expect(w.h.messenger.to(TOM).filter((m) => m.template === 'tenant.urgent_repair_reminder')).toHaveLength(2);
  });

  test('with the receipt in, shows it, forwards it to the Property Owner, then marks it reimbursed', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const { link, id } = await tomsBurstPipe(w);
    await w.h.advance(2 * HOUR);
    await w.h.upload(link, [
      { filename: 'receipt.jpg', contentType: 'image/jpeg', content: new Uint8Array([1]) },
      { filename: 'invoice.pdf', contentType: 'application/pdf', content: new Uint8Array([1, 2]) },
    ], { amountCents: 450_00 });
    const receipts = (await w.alice.reimbursement(id)).receipts;

    const html = await page(w, `/reimbursements/${id}`, cookie);
    const readable = visible(html);
    for (const expected of ['Awaiting your review', 'Amount $450.00 of the $1,000.00 limit', 'Check the receipt and forward it', 'Receipts (2)', '2 receipt files received through the receipt link', 'Claimed $450.00']) {
      expect(readable).toContain(expected);
    }
    expect(ticks(html)).toBe(2);
    expect(html).toContain(`<img src="/files/${receipts[0]!.fileId}"`);
    expect(html).toMatch(new RegExp(`<a class="link" href="/files/${receipts[1]!.fileId}"[^>]*>invoice.pdf</a>`));
    expect(html).toContain('value="450.00"');
    expect((await w.get(`/files/${receipts[1]!.fileId}`, cookie)).headers.get('content-type')).toBe('application/pdf');

    const forwarded = await follow(w, await w.post(`/reimbursements/${id}/forward`, { amount: '$430' }, cookie), cookie);
    expect(visible(forwarded)).toContain('Forwarded to Olivia Owens, the Property Owner, with you copied in.');
    expect(visible(forwarded)).toContain('With Property Owner');
    expect(visible(forwarded)).toContain('Forwarded to Olivia Owens');
    expect(ticks(forwarded)).toBe(3);
    expect(w.h.messenger.to(OLIVIA_EMAIL)).toMatchObject([{ template: 'owner.urgent_repair_receipt', cc: ['alice@harbour.example'], attachments: ['receipt.jpg', 'invoice.pdf'], data: { amountCents: 430_00 } }]);

    const done = await follow(w, await w.post(`/reimbursements/${id}/reimbursed`, {}, cookie), cookie);
    expect(visible(done)).toContain('Marked reimbursed. Tom Tran has been told.');
    expect(visible(done)).toContain('Olivia Owens reimbursed Tom Tran $430.00');
    expect(ticks(done)).toBe(4);
    expect(done).not.toContain(`action="/reimbursements/${id}/forward"`);
    expect(w.h.messenger.last(TOM)!.template).toBe('tenant.reimbursed');
  });

  test('opens a receipt file in the same tab, and its photo in the viewer', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const { link, id } = await tomsBurstPipe(w);
    await w.h.upload(link, [
      { filename: 'receipt.jpg', contentType: 'image/jpeg', content: new Uint8Array([1]) },
      { filename: 'invoice.pdf', contentType: 'application/pdf', content: new Uint8Array([1, 2]) },
    ], { amountCents: 450_00 });
    const receipts = (await w.alice.reimbursement(id)).receipts;

    const html = await page(w, `/reimbursements/${id}`, cookie);

    expect(html).toContain(`<a class="link" href="/files/${receipts[1]!.fileId}">invoice.pdf</a>`);
    expect(visible(html)).toContain('invoice.pdf (PDF)');
    expect(visible(html)).not.toContain('new tab');
    expect(html).toMatch(new RegExp(`<ul role="list" data-photo-grid [^>]*>\\s*<li>\\s*<figure[^>]*>\\s*<a href="/files/${receipts[0]!.fileId}" class=`));
    expect(html).not.toContain('target=');
  });

  test('warns, without refusing, about an amount over the limit, and says why a refused action failed', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const { link, id } = await tomsBurstPipe(w);

    const early = await follow(w, await w.post(`/reimbursements/${id}/reimbursed`, {}, cookie), cookie);
    expect(visible(early)).toContain('Forward the receipt to the Property Owner before marking it reimbursed');

    await w.h.upload(link, [{ filename: 'receipt.jpg', contentType: 'image/jpeg', content: new Uint8Array([1]) }]);
    const blank = await follow(w, await w.post(`/reimbursements/${id}/forward`, { amount: '' }, cookie), cookie);
    expect(visible(blank)).toContain('Enter the amount on the receipt');

    const over = await follow(w, await w.post(`/reimbursements/${id}/forward`, { amount: '1,250' }, cookie), cookie);
    expect(visible(over)).toContain('The amount is over the $1,000.00 limit for an Urgent Repair.');
    expect(visible(over)).toContain('Over the limit');
    expect(visible(over)).toContain('$1,250.00 is over the $1,000.00 a Tenant can claim');
    expect(w.h.messenger.to(OLIVIA_EMAIL)).toHaveLength(1);
  });

  test('is not found outside its Agency, or with no such number', async () => {
    const w = await webWorld();
    const { id } = await tomsBurstPipe(w);
    const stranger = await w.signUp();

    const res = await w.get(`/reimbursements/${id}`, stranger);
    expect(res.status).toBe(404);
    expect(visible(await res.text())).toContain('There is no such Reimbursement Request in your Agency.');
    expect((await w.get('/reimbursements/nope', await w.signIn())).status).toBe(404);
    const refused = await w.post(`/reimbursements/${id}/resend`, {}, stranger);
    expect(decodeURIComponent(refused.headers.get('location') ?? '')).toContain('Reimbursement Request');
    expect(w.h.messenger.to(TOM).filter((m) => m.template === 'tenant.urgent_repair_reminder')).toHaveLength(1);
  });

  test("the dashboard's Urgent Repairs open their Reimbursement Requests", async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const { id } = await tomsBurstPipe(w);

    expect(await page(w, '/', cookie)).toContain(`href="/reimbursements/${id}"`);
  });
});
