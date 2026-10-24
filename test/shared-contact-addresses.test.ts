import { describe, expect, test } from 'vitest';
import { ActionError } from '../src/shared.ts';
import { HOUR } from './support/harness.ts';
import { confirmedQuotes, HANA, HANA_EMAIL, jobView, KING_ST, OLIVIA, OLIVIA_EMAIL, PETE, TOM, tomsTapTicket, world } from './support/world.ts';

/** The refusal an action throws, to check its code and the field it names. */
async function refusal(action: Promise<unknown>) {
  const error = await action.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ActionError);
  return error as ActionError;
}

describe('a shared contact address', () => {
  test("adding an Owner with a Tenant's email succeeds and both keep it", async () => {
    const w = await world();

    const kevin = await w.alice.addOwner({ name: 'Kevin He', email: HANA_EMAIL });

    expect((await w.alice.people('tenant')).find((p) => p.id === w.ids.hana)).toMatchObject({ name: 'Hana Ho', email: 'hana@example.com' });
    expect((await w.alice.people('owner')).find((p) => p.id === kevin)).toMatchObject({ name: 'Kevin He', email: 'hana@example.com' });
  });

  test("editing a Tradie to an Owner's mobile succeeds and both keep it", async () => {
    const w = await world();

    await w.alice.editTradie(w.ids.pete, { name: 'Pete Park', businessName: "Pete's Plumbing", mobile: OLIVIA, trades: ['plumbing'] });

    expect(await w.alice.tradie(w.ids.pete)).toMatchObject({ name: 'Pete Park', mobile: '+61400000100' });
    expect((await w.alice.people('owner')).find((p) => p.id === w.ids.olivia)).toMatchObject({ name: 'Olivia Owens', mobile: '+61400000100' });
  });

  test('a sign-in email the Agency already has is still refused', async () => {
    const w = await world();

    expect((await refusal(w.alice.addColleague({ name: 'Ada Archer', email: 'Alice@Harbour.example' }))).fields).toEqual({
      email: 'An account with that email already exists',
    });
  });

  test('an Owner who shares an inbox with a Tenant approves by replying YES from it', async () => {
    const w = await world();
    // The address row stays Tom's: Olivia already held it, gives it up, Tom takes it, then Olivia takes it back.
    await w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owens', mobile: OLIVIA, email: 'olive@example.com' });
    await w.alice.editTenant(w.ids.tom, { name: 'Tom Tran', mobile: TOM, email: OLIVIA_EMAIL });
    await w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owens', mobile: OLIVIA, email: OLIVIA_EMAIL });
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [w.tradies.dana, 650_00],
      [w.tradies.pete, 700_00],
    ]);
    await w.alice.chooseQuote(quote!.quoteId);
    const { approval } = await jobView(w, job);
    w.h.classifier.when('YES', { replyType: 'approval_answer', answer: 'yes', relatedItem: `approval:${approval!.approvalId}` });

    await w.h.receive(OLIVIA_EMAIL, 'YES');

    expect(await jobView(w, job)).toMatchObject({ status: 'approved', approval: { status: 'approved' } });
    expect((await w.alice.ticket(job.ticketId)).repairCostCents).toBe(650_00);
    expect((await w.alice.ticket(job.ticketId)).messages.filter((m) => m.direction === 'in').at(-1)).toMatchObject({
      personId: w.ids.olivia,
      address: 'olivia@example.com',
      text: 'YES',
    });
  });

  test('with nothing pending, a repair report from that shared inbox starts a Maintenance Request for the Tenant', async () => {
    const w = await world();
    await w.alice.editTenant(w.ids.tom, { name: 'Tom Tran', mobile: TOM, email: OLIVIA_EMAIL });
    w.h.classifier.when('The oven is not heating', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });

    await w.h.receive(OLIVIA_EMAIL, 'The oven is not heating');
    await w.h.answerAll(OLIVIA_EMAIL, { location: 'Kitchen', started: 'Today', worsening: 'no', availability: 'weekday_mornings' });
    await w.h.advance(48 * HOUR);

    expect((await w.alice.dashboard()).maintenanceRequests).toMatchObject([
      { tenantName: 'Tom Tran', description: 'The oven is not heating', noPhotos: true },
    ]);
    expect((await w.alice.dashboard()).inbox).toEqual([]);
  });

  test('two non-Tenants sharing an address, with nothing pending, go to the Inbox naming both', async () => {
    const w = await world();
    await w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owens', mobile: PETE, email: OLIVIA_EMAIL });

    await w.h.receive(PETE, 'Hello from the shared phone');

    expect((await w.alice.dashboard()).inbox).toEqual([
      expect.objectContaining({
        reason: 'shared_address',
        from: '+61400000200',
        personName: null,
        text: 'Hello from the shared phone',
        candidates: [
          { personId: w.ids.olivia, name: 'Olivia Owens', role: 'owner' },
          { personId: w.ids.pete, name: 'Pete Park', role: 'tradie' },
        ],
      }),
    ]);
  });

  test('a message from an address only one person has is handled as that person', async () => {
    const w = await world();
    w.h.classifier.when('The oven is not heating', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });

    await w.h.receive(TOM, 'The oven is not heating');

    expect(w.h.messenger.templatesTo(TOM)).toEqual(['tenant.acknowledgement', 'tenant.missing_details']);
    expect((await w.alice.dashboard()).inbox).toEqual([]);
  });

  test("a removed person's address doesn't match, and neither does a Tenant who has left", async () => {
    const w = await world();
    await w.alice.editProperty(w.ids.kingSt, {
      address: KING_ST,
      suburb: 'Newtown',
      ownerId: w.ids.oscar,
      propertyManagerId: w.ids.aliceId,
      maxRepairCostCents: 500_00,
      nominatedTradieIds: [w.ids.nina, w.ids.sam],
    });
    await w.alice.removeOwner(w.ids.olivia);
    await w.alice.removeTenant(w.ids.hana);

    await w.h.receive(OLIVIA, 'Did you get my approval?');
    await w.h.receive(OLIVIA_EMAIL, 'Checking my old email');
    await w.h.receive(HANA, 'The fan is still rattling');

    expect((await w.alice.dashboard()).inbox).toMatchObject([
      { reason: 'unknown_sender', from: '+61400000100', personName: null },
      { reason: 'unknown_sender', from: 'olivia@example.com', personName: null },
      { reason: 'unknown_sender', from: '+61400000002', personName: null },
    ]);
  });
});
