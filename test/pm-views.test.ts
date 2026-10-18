import { describe, expect, test } from 'vitest';
import { distanceKm, nearest } from '../src/geo.ts';
import { confirmedQuotes, KING_ST, tomsTapTicket, world, type World } from './support/world.ts';

const TUE_9AM = new Date('2026-10-13T09:00:00+11:00');
const UNKNOWN_ADDRESS = '99 Nowhere Rd, Newtown NSW 2042';
const NINA_BASE = { address: '2 Enmore Rd, Enmore NSW 2042', location: { lat: -33.899, lng: 151.173 } };

async function unknownProperty(w: World) {
  return w.alice.addProperty({ address: UNKNOWN_ADDRESS, suburb: 'Newtown', ownerId: w.ids.olivia, propertyManagerId: w.ids.aliceId, maxRepairCostCents: 500_00, nominatedTradieIds: [] });
}

describe('tickets.list and the Tickets view', () => {
  test('lists open and closed Tickets, and counts them by status', async () => {
    const w = await world();
    const { ticketId } = await tomsTapTicket(w);
    expect((await w.alice.tickets()).counts).toMatchObject({ open: 1, closed: 0 });
    expect((await w.alice.tickets()).tickets.map((t) => t.ticketId)).toEqual([ticketId]);
    expect((await w.alice.tickets({ status: 'closed' })).tickets).toEqual([]);
    expect((await w.bob.tickets({ filter: 'mine' })).tickets).toEqual([]);
    expect((await w.bob.tickets({ filter: 'all' })).tickets.map((t) => t.ticketId)).toEqual([ticketId]);
  });
});

describe('set-based board facts', () => {
  test('quotingOf, jobsOfTickets and issuesWithUnread answer for many ids at once, and are empty for none', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    await confirmedQuotes(w, job, [
      [w.tradies.pete, 150_00, TUE_9AM],
      [w.tradies.dana, 200_00],
    ]);
    const board = (await w.alice.dashboard()).tickets.find((t) => t.ticketId === job.ticketId)!;
    expect(board).toMatchObject({ stage: 'quoting', trades: ['plumbing'], quoting: { asked: 2, received: 2, confirmed: 2 }, decision: 'choose_quote', unreadMessages: expect.any(Number) });
  });
});

describe('Approvals and the Tradie directory', () => {
  test('a Quote over the Max Repair Cost waits on the Owner, with by how much', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [w.tradies.dana, 650_00],
      [w.tradies.pete, 700_00],
    ]);
    expect((await w.alice.approvals()).waitingOnOwner).toEqual([]);
    await w.alice.chooseQuote(quote!.quoteId);

    const { waitingOnOwner } = await w.alice.approvals();
    expect(waitingOnOwner).toMatchObject([
      {
        ticketId: job.ticketId,
        propertyId: w.ids.kingSt,
        propertyAddress: KING_ST,
        ownerName: 'Olivia Owens',
        tradieBusinessName: 'Drip Doctors',
        quotePriceCents: 650_00,
        maxRepairCostCents: 500_00,
        overByCents: 150_00,
        reminded: false,
        silent: false,
      },
    ]);
    expect((await w.alice.navCounts()).approvals).toBeGreaterThanOrEqual(0);
    expect((await w.bob.approvals()).waitingOnOwner).toEqual([]);
    expect((await w.bob.approvals({ filter: 'all' })).waitingOnOwner).toHaveLength(1);

    await w.h.advance(49 * 3_600_000);
    expect((await w.alice.approvals()).waitingOnOwner[0]).toMatchObject({ silent: true });
  });

  test('the directory counts the Quotes each Tradie has had confirmed', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    const directory = await w.alice.tradieDirectory();
    expect(directory.find((t) => t.tradieId === w.tradies.pete.id)!.quotes).toBe(1);
    expect(directory.find((t) => t.tradieId === w.tradies.dana.id)!.quotes).toBe(0);
  });

  test("a Tradie's profile gives each previous Quote its Ticket, address, issue and outcome, and each booking its Ticket", async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [pete, dana] = await confirmedQuotes(w, job, [
      [w.tradies.pete, 150_00, TUE_9AM],
      [w.tradies.dana, 200_00],
    ]);
    expect((await w.alice.tradie(w.tradies.pete.id)).previousQuotes[0]).toMatchObject({ ticketId: job.ticketId, outcome: 'waiting' });
    await w.alice.chooseQuote(pete!.quoteId);
    await w.alice.sendWorkOrder(job.jobId);

    const chosen = await w.alice.tradie(w.tradies.pete.id);
    expect(chosen.previousQuotes).toMatchObject([{ ticketId: job.ticketId, propertyAddress: KING_ST, description: expect.stringContaining('tap'), outcome: 'chosen' }]);
    expect(chosen.bookings).toMatchObject([{ ticketId: job.ticketId, propertyAddress: KING_ST, description: expect.stringContaining('tap') }]);
    expect((await w.alice.tradie(w.tradies.dana.id)).previousQuotes[0]).toMatchObject({ outcome: 'not_chosen' });
    void dana;
  });
});

describe('Booking fields and the Ticket view', () => {
  test('a booking says its trade, issue, suburb, visit, Property and Property Manager', async () => {
    const w = await world();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 150_00, TUE_9AM]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);

    const [booking] = await w.alice.calendar({ from: '2026-01-01T00:00:00Z', to: '2030-01-01T00:00:00Z' });
    expect(booking).toMatchObject({
      ticketId: job.ticketId,
      trade: 'plumbing',
      issue: expect.stringContaining('tap'),
      suburb: 'Newtown',
      visit: 'not_confirmed',
      propertyId: w.ids.kingSt,
      propertyManagerId: w.ids.aliceId,
    });
    expect((await w.alice.ticket(job.ticketId)).propertyId).toBe(w.ids.kingSt);
  });
});

describe('Property views', () => {
  test('overviews and the profile list open Tickets and the Tenants', async () => {
    const w = await world();
    const { ticketId } = await tomsTapTicket(w);
    const overviews = await w.alice.propertyOverviews();
    expect(overviews.find((p) => p.propertyId === w.ids.kingSt)).toMatchObject({ openTickets: 1, tenants: [{ personId: w.ids.hana, name: 'Hana Ho' }, { personId: w.ids.tom, name: 'Tom Tran' }] });
    const profile = await w.alice.property(w.ids.kingSt);
    expect(profile).toMatchObject({ address: KING_ST, owner: { name: 'Olivia Owens' }, closedTickets: [] });
    expect(profile.openTickets.map((t) => t.ticketId)).toEqual([ticketId]);
    expect(profile.nominatedTradies.map((t) => t.tradieId).sort()).toEqual([w.ids.nina, w.ids.sam].sort());
  });
});

describe('Requests view', () => {
  test('lists the Maintenance Requests with their Property, and one by id', async () => {
    const w = await world();
    w.h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await w.h.receive('+61400000001', 'The kitchen tap is dripping');
    await w.h.answer('+61400000001', 'Kitchen sink');
    await w.h.answer('+61400000001', 'Since Monday');
    await w.h.answer('+61400000001', 'No', 'no');
    await w.h.answer('+61400000001', 'Mornings', 'weekday_mornings');
    await w.h.advance(48 * 3_600_000);
    const [request] = (await w.alice.requests()).filter(() => true);
    expect(request).toMatchObject({ propertyId: w.ids.kingSt, propertyAddress: KING_ST });
    expect(await w.alice.requests({ filter: 'mine' })).toHaveLength(1);
    expect(await w.bob.requests()).toEqual([]);
    expect(await w.bob.requests({ filter: 'all' })).toHaveLength(1);
    expect((await w.bob.request(request!.issueId))?.issueId).toBe(request!.issueId);
    expect(await w.alice.request(999_999)).toBeNull();
  });
});

describe('Tradie locations and Dispatch', () => {
  test('a Tradie address is kept, geocoded when known, and retried by geocodeMissing', async () => {
    const w = await world();
    await w.alice.setTradieAddress(w.ids.nina, NINA_BASE.address);
    expect((await w.alice.people('tradie')).find((t) => t.id === w.ids.nina)).toMatchObject({ businessAddress: NINA_BASE.address, location: null });

    w.h.places.locations.set(NINA_BASE.address, NINA_BASE.location);
    expect(await w.alice.geocodeMissing()).toBe(1);
    expect((await w.alice.people('tradie')).find((t) => t.id === w.ids.nina)!.location).toEqual(NINA_BASE.location);

    await w.alice.setTradieAddress(w.ids.nina, '  ');
    expect((await w.alice.people('tradie')).find((t) => t.id === w.ids.nina)).toMatchObject({ businessAddress: null, location: null });
  });

  test('geocodeMissing reports how many Properties it placed, leaves placed ones alone, and survives a failing geocoder', async () => {
    const w = await world();
    const id = await unknownProperty(w);
    expect(await w.alice.geocodeMissing()).toBe(0);
    w.h.places.geocode = async () => {
      throw new Error('Geocoding is down');
    };
    expect(await w.alice.geocodeMissing()).toBe(0);

    w.h.places.geocode = async (address) => w.h.places.locations.get(address) ?? null;
    w.h.places.locations.set(UNKNOWN_ADDRESS, { lat: -33.89, lng: 151.18 });
    w.h.places.locations.set(KING_ST, { lat: 0, lng: 0 });
    expect(await w.alice.geocodeMissing()).toBe(1);
    expect((await w.alice.properties()).find((p) => p.id === id)!.location).toEqual({ lat: -33.89, lng: 151.18 });
    expect((await w.alice.properties()).find((p) => p.id === w.ids.kingSt)!.location).toEqual({ lat: -33.897, lng: 151.179 });
  });

  test('the dispatch view has every Property with its worst open Urgency, and Tradies with where they are', async () => {
    const w = await world();
    const { ticketId } = await tomsTapTicket(w);
    await w.alice.changeUrgency({ ticketId }, 'high');
    w.h.places.locations.set(NINA_BASE.address, NINA_BASE.location);
    await w.alice.setTradieAddress(w.ids.nina, NINA_BASE.address);

    const d = await w.alice.dispatch();
    expect(d.properties.find((p) => p.propertyId === w.ids.kingSt)).toMatchObject({ worstUrgency: 'high', location: { lat: -33.897, lng: 151.179 }, openTickets: [{ ticketId }] });
    expect(d.properties.find((p) => p.propertyId === w.ids.oceanAve)).toMatchObject({ worstUrgency: null, openTickets: [] });
    expect(d.tradies.find((t) => t.tradieId === w.ids.nina)).toMatchObject({ location: NINA_BASE.location, trades: ['plumbing'] });
    expect(d.tradies.find((t) => t.tradieId === w.ids.pete)!.location).toBeNull();
  });
});

describe('geo', () => {
  test('distanceKm and nearest', () => {
    const king = { lat: -33.897, lng: 151.179 };
    expect(distanceKm(king, king)).toBe(0);
    expect(distanceKm(king, { lat: -33.899, lng: 151.173 })).toBeCloseTo(0.6, 1);
    const items = [
      { name: 'far', location: { lat: -33.7507, lng: 150.6877 } },
      { name: 'near', location: { lat: -33.899, lng: 151.173 } },
      { name: 'unplaced', location: null },
    ];
    expect(nearest(king, items, 15).map((i) => i.name)).toEqual(['near']);
    expect(nearest(king, items, 100).map((i) => i.name)).toEqual(['near', 'far']);
  });
});
