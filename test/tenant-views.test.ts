import { describe, expect, test } from 'vitest';
import { HANA, KING_ST, OCEAN_AVE, TOM, tomsTapTicket, world, type World } from './support/world.ts';

/** Hana reports a leaking shower and it waits as a Maintenance Request. */
async function hanasShowerRequest(w: World) {
  w.h.classifier.when('The shower is leaking', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
  await w.h.receive(HANA, 'The shower is leaking');
  await w.h.answer(HANA, 'Bathroom');
  await w.h.answer(HANA, 'Yesterday');
  await w.h.answer(HANA, 'No', 'no');
  await w.h.answer(HANA, 'Saturdays', 'saturdays');
  await w.h.advance(48 * 3_600_000); // no photos
  return (await w.alice.requests()).find((r) => r.tenantName === 'Hana Ho')!.issueId;
}

/** Tom reports an Urgent issue: an Urgent Repair waiting on his receipt. */
async function tomsUrgentRepair(w: World) {
  w.h.classifier.when('Water is pouring through the ceiling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });
  await w.h.receive(TOM, 'Water is pouring through the ceiling');
  return (await w.alice.dashboard()).urgentRepairs[0]!.urgentRepairId;
}

describe('the Tenants view', () => {
  test('lists every Tenant by name with their Property, tenancy start, contact and open Tickets', async () => {
    const w = await world();
    const { ticketId } = await tomsTapTicket(w);

    const all = await w.alice.tenants({ filter: 'all' });
    expect(all.map((t) => t.name)).toEqual(['Bella Bui', 'Hana Ho', 'Tom Tran']);
    expect(all.find((t) => t.tenantId === w.ids.tom)).toEqual({
      tenantId: w.ids.tom,
      name: 'Tom Tran',
      property: { propertyId: w.ids.kingSt, address: KING_ST },
      propertyManager: 'Alice Archer',
      tenancyStart: '2025-01-01',
      mobile: TOM,
      email: null,
      openTickets: 1,
    });
    expect(all.find((t) => t.tenantId === w.ids.bella)).toMatchObject({ property: { address: OCEAN_AVE }, propertyManager: 'Bob Baker', openTickets: 0 });

    await w.alice.cancelJob((await w.alice.ticket(ticketId)).jobs[0]!.jobId);
    await w.alice.closeTicket(ticketId);
    expect((await w.alice.tenants({ filter: 'all' })).find((t) => t.tenantId === w.ids.tom)!.openTickets).toBe(0);
  });

  test("Mine is the Tenants of the Property Manager's own Properties, and is the default", async () => {
    const w = await world();
    expect((await w.alice.tenants()).map((t) => t.name)).toEqual(['Hana Ho', 'Tom Tran']);
    expect((await w.bob.tenants({ filter: 'mine' })).map((t) => t.name)).toEqual(['Bella Bui']);
  });
});

describe('a Tenant profile', () => {
  test('has their Property, contact details and when they are usually home', async () => {
    const w = await world();
    await hanasShowerRequest(w);

    const hana = await w.alice.tenant(w.ids.hana);
    expect(hana).toMatchObject({
      tenantId: w.ids.hana,
      name: 'Hana Ho',
      property: { propertyId: w.ids.kingSt, address: KING_ST },
      propertyManager: 'Alice Archer',
      tenancyStart: '2025-01-01',
      mobile: HANA,
      email: 'hana@example.com',
      availability: 'saturdays',
    });
  });

  test('lists the Tickets they raised open first, then closed, and their Maintenance Requests still waiting', async () => {
    const w = await world();
    const first = await tomsTapTicket(w);
    await w.alice.cancelJob(first.jobId);
    await w.alice.closeTicket(first.ticketId);
    w.h.classifier.when('The oven will not heat', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'appliances' });
    await w.h.receive(TOM, 'The oven will not heat');
    await w.h.answer(TOM, 'Kitchen');
    await w.h.answer(TOM, 'Today');
    await w.h.answer(TOM, 'No', 'no');
    await w.h.answer(TOM, 'Mornings', 'weekday_mornings');
    await w.h.advance(48 * 3_600_000);
    const oven = (await w.alice.requests()).find((r) => r.description === 'The oven will not heat')!;
    const second = await w.alice.confirmMaintenanceRequest(oven.issueId);
    const hanas = await hanasShowerRequest(w);

    const tom = await w.alice.tenant(w.ids.tom);
    expect(tom.tickets.map((t) => [t.ticketId, t.status])).toEqual([
      [second, 'open'],
      [first.ticketId, 'closed'],
    ]);
    expect(tom.tickets[1]).toMatchObject({ description: 'The kitchen tap is dripping', propertyAddress: KING_ST, closedAt: expect.any(String), reportedAt: expect.any(String) });
    expect(tom.maintenanceRequests).toEqual([]);

    const hana = await w.alice.tenant(w.ids.hana);
    expect(hana.tickets).toEqual([]);
    expect(hana.maintenanceRequests).toMatchObject([{ issueId: hanas, description: 'The shower is leaking', urgency: 'routine', propertyAddress: KING_ST }]);
  });

  test('lists their Reimbursement Requests', async () => {
    const w = await world();
    const urgentRepairId = await tomsUrgentRepair(w);

    const tom = await w.alice.tenant(w.ids.tom);
    expect(tom.reimbursementRequests).toMatchObject([
      { urgentRepairId, description: 'Water is pouring through the ceiling', status: 'reminder_sent', receipts: 0, propertyAddress: KING_ST },
    ]);
    expect((await w.alice.tenant(w.ids.hana)).reimbursementRequests).toEqual([]);
  });

  test('is limited to the Agency, and to Tenants', async () => {
    const w = await world();
    const otherAgency = await w.h.app.setup.createAgency({ name: 'Sunrise Realty', timeZone: 'Australia/Brisbane' });
    const sam = w.h.as(await w.h.app.setup.addPropertyManager(otherAgency, { name: 'Sam Sun', email: 'sam@sunrise.example' }));

    await expect(sam.tenant(w.ids.tom)).rejects.toMatchObject({ code: 'not_found' });
    expect(await sam.tenants({ filter: 'all' })).toEqual([]);
    await expect(w.alice.tenant(w.ids.olivia)).rejects.toMatchObject({ code: 'not_found' });
  });
});
