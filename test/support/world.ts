import { one } from '../../src/db.ts';
import { wallClock } from '../../src/zoned-time.ts';
import { AGENCY_INBOX, AGENCY_NUMBER, createHarness } from './harness.ts';

// The standard Agency every scenario starts from.

export const TOM = '+61400000001'; // Tenant at King St
export const HANA = '+61400000002'; // Tom's housemate
export const HANA_EMAIL = 'hana@example.com';
export const BELLA = 'bella@example.com'; // Tenant at Ocean Ave, email only
export const OLIVIA = '+61400000100'; // Property Owner of King St
export const OLIVIA_EMAIL = 'olivia@example.com';
export const OSCAR = '+61400000101'; // Property Owner of Ocean Ave, no email
export const BARRY = 'barry@strata.example'; // Building Manager at Ocean Ave
export const PETE = '+61400000200';
export const QUICK_PIPES = 'quotes@quickpipes.example'; // email only
export const DANA = '+61400000202';
export const FINN = '+61400000203';
export const NINA = '+61400000204';
export const SAM = '+61400000205';
export const STRANGER = '+61499999999';

export const KING_ST = '12 King St, Newtown NSW 2042';
/** Every Property Manager's password in tests. */
export const PASSWORD = 'correct horse battery';
export const KING_ST_LOCATION = { lat: -33.897, lng: 151.179 };
export const OCEAN_AVE = '5/40 Ocean Ave, Bondi NSW 2026';

export async function world(options: Parameters<typeof createHarness>[0] = {}) {
  const h = await createHarness(options);
  const agencyId = await h.app.setup.createAgency({ name: 'Harbour Realty', timeZone: 'Australia/Sydney' });
  const aliceId = await h.app.setup.addPropertyManager(agencyId, { name: 'Alice Archer', email: 'alice@harbour.example', password: PASSWORD });
  const bobId = await h.app.setup.addPropertyManager(agencyId, { name: 'Bob Baker', email: 'bob@harbour.example', password: PASSWORD });
  const alice = h.as(aliceId);
  const bob = h.as(bobId);

  await alice.connectChannel('sms', AGENCY_NUMBER);
  await alice.connectChannel('whatsapp', AGENCY_NUMBER);
  await alice.connectChannel('email', AGENCY_INBOX);

  h.places.locations.set(KING_ST, KING_ST_LOCATION);
  h.places.locations.set(OCEAN_AVE, { lat: -33.8908, lng: 151.2743 });
  h.places.listings.set('place-pete', { name: "Pete's Plumbing", address: 'Marrickville', rating: 4.8, reviewCount: 120 });
  h.places.listings.set('place-quick', { name: 'Quick Pipes', address: 'Redfern', rating: 4.2, reviewCount: 40 });
  h.places.listings.set('place-finn', { name: 'Flow Bros', address: 'Petersham', rating: 4.9, reviewCount: 15 });
  h.places.listings.set('place-nina', { name: "Nina's Plumbing", address: 'Enmore', rating: 4.2, reviewCount: 33 });
  h.places.listings.set('place-sam', { name: 'Sparky Sam', address: 'Glebe', rating: 4.5, reviewCount: 60 });

  const plumbing = ['plumbing' as const];
  const pete = await alice.addTradie({ name: 'Pete Park', businessName: "Pete's Plumbing", mobile: PETE, trades: plumbing, startingRating: 4, googlePlaceId: 'place-pete' });
  const quick = await alice.addTradie({ name: 'Quinn Quick', businessName: 'Quick Pipes', email: QUICK_PIPES, trades: plumbing, startingRating: 4, googlePlaceId: 'place-quick' });
  const dana = await alice.addTradie({ name: 'Dana Drip', businessName: 'Drip Doctors', mobile: DANA, trades: plumbing, startingRating: 5, notOnGoogle: true });
  const finn = await alice.addTradie({ name: 'Finn Flow', businessName: 'Flow Bros', mobile: FINN, trades: plumbing, startingRating: 3, googlePlaceId: 'place-finn' });
  const nina = await alice.addTradie({ name: 'Nina Nguyen', businessName: "Nina's Plumbing", mobile: NINA, trades: plumbing, startingRating: 4, googlePlaceId: 'place-nina' });
  const sam = await alice.addTradie({ name: 'Sam Spark', businessName: 'Sparky Sam', mobile: SAM, trades: ['electrical'], startingRating: 4, googlePlaceId: 'place-sam' });

  const olivia = await alice.addOwner({ name: 'Olivia Owens', mobile: OLIVIA, email: OLIVIA_EMAIL });
  const oscar = await bob.addOwner({ name: 'Oscar Ortiz', mobile: OSCAR });
  const barry = await bob.addBuildingManager({ name: 'Barry Strata', email: BARRY });

  const kingSt = await alice.addProperty({
    address: KING_ST,
    suburb: 'Newtown',
    ownerId: olivia,
    propertyManagerId: aliceId,
    maxRepairCostCents: 500_00,
    nominatedTradieIds: [nina, sam],
  });
  const oceanAve = await bob.addProperty({
    address: OCEAN_AVE,
    suburb: 'Bondi',
    ownerId: oscar,
    propertyManagerId: bobId,
    maxRepairCostCents: 800_00,
    nominatedTradieIds: [],
    buildingManagerId: barry,
  });

  const tom = await alice.addTenant({ name: 'Tom Tran', mobile: TOM, propertyId: kingSt, tenancyStart: '2025-01-01' });
  const hana = await alice.addTenant({ name: 'Hana Ho', mobile: HANA, email: HANA_EMAIL, propertyId: kingSt, tenancyStart: '2025-01-01' });
  const bella = await bob.addTenant({ name: 'Bella Bui', email: BELLA, propertyId: oceanAve, tenancyStart: '2026-03-01' });

  h.messenger.clear();
  return {
    h,
    alice,
    bob,
    tradies: {
      pete: { id: pete, address: PETE },
      quick: { id: quick, address: QUICK_PIPES },
      dana: { id: dana, address: DANA },
      finn: { id: finn, address: FINN },
      nina: { id: nina, address: NINA },
      sam: { id: sam, address: SAM },
    },
    ids: { agencyId, aliceId, bobId, pete, quick, dana, finn, nina, sam, olivia, oscar, barry, kingSt, oceanAve, tom, hana, bella },
  };
}

/** Takes Tom's dripping tap from first message to a confirmed Ticket and returns its first Job. */
export async function tomsTapTicket(w: Awaited<ReturnType<typeof world>>) {
  const { h, alice } = w;
  h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
  await h.receive(TOM, 'The kitchen tap is dripping');
  await h.answer(TOM, 'Kitchen sink');
  await h.answer(TOM, 'Since Monday');
  await h.answer(TOM, 'No', 'no');
  await h.answer(TOM, 'Mornings', 'weekday_mornings');
  await h.advance(48 * 3_600_000); // no photos
  const [request] = (await alice.dashboard()).maintenanceRequests;
  const ticketId = await alice.confirmMaintenanceRequest(request!.issueId);
  const ticket = await alice.ticket(ticketId);
  return { ticketId, jobId: ticket.jobs[0]!.jobId };
}

export type World = Awaited<ReturnType<typeof world>>;
export type JobRef = { ticketId: number; jobId: number };
export type TradieRef = { id: number; address: string };

export async function jobView({ alice }: World, job: JobRef) {
  return (await alice.ticket(job.ticketId)).jobs.find((j) => j.jobId === job.jobId)!;
}

export async function quoteRequestFor(w: World, job: JobRef, tradie: TradieRef) {
  return (await jobView(w, job)).quoteRequests.find((r) => r.tradieId === tradie.id)!;
}

/** A Tradie replies to their Quote Request, and the quote reader reads `read` from the reply. */
export async function tradieQuotes(
  w: World,
  job: JobRef,
  tradie: TradieRef,
  text: string,
  read: { priceCents?: number; proposedTime?: Date },
) {
  const request = await quoteRequestFor(w, job, tradie);
  w.h.classifier.when(text, { replyType: 'quote', relatedItem: `quote_request:${request.quoteRequestId}` });
  w.h.quoteReader.when(text, read);
  await w.h.receive(tradie.address, text);
}

/** The token of the Tradie's quote page for this Job: the one in the link their Quote Request carried. */
export async function quoteToken(w: World, job: JobRef, tradie: TradieRef) {
  const request = await quoteRequestFor(w, job, tradie);
  const row = await one<{ token: string }>(w.h.db, 'SELECT token FROM quote_requests WHERE id = ?', request.quoteRequestId);
  if (!row) throw new Error(`No Quote Request to ${tradie.address} for Job ${job.jobId}`);
  return row.token;
}

/** An ISO date `days` after the harness clock's day in Sydney. */
export function dateAhead(w: World, days: number) {
  const { year, month, day } = wallClock(new Date(w.h.clock.now().getTime() + days * 86_400_000), 'Australia/Sydney');
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Moves the clock to a minute after `start` (without running the worker), so a visit booked then has begun and can be marked done. */
export function visitStarted(w: World, start: Date | string) {
  const ms = new Date(start).getTime() + 60_000 - w.h.clock.now().getTime();
  if (ms > 0) w.h.clock.advance(ms);
}

/** The Tradie gives a Firm Quote on their quote page (after their Estimate, and their Site Inspection if they needed one). */
export async function firmQuote(
  w: World,
  job: JobRef,
  tradie: TradieRef,
  input: { priceCents: number; proposedTime?: Date; scopeOfWork?: string; durationDays?: number; availableDates?: string[] },
) {
  await w.h.app.submitFirmQuote(await quoteToken(w, job, tradie), {
    priceCents: input.priceCents,
    scopeOfWork: input.scopeOfWork ?? 'Replace the washer and reseat the tap',
    durationDays: input.durationDays ?? 1,
    availableDates: input.availableDates ?? [dateAhead(w, 5)],
    proposedTime: input.proposedTime?.toISOString() ?? null,
  });
  await w.h.drain();
  return (await jobView(w, job)).quotes.find((q) => q.tradieId === tradie.id && q.stage === 'firm')!;
}

/**
 * Quote Requests go to each Tradie, every one replies with an Estimate by SMS or email,
 * the Property Manager confirms each, and each Tradie then gives a Firm Quote at the
 * same price on their quote page. Returns the Firm Quotes, which are what is chosen.
 */
export async function confirmedQuotes(w: World, job: JobRef, quotes: [TradieRef, number, Date?][]) {
  await confirmedEstimates(w, job, quotes);
  for (const [tradie, priceCents, proposedTime] of quotes) await firmQuote(w, job, tradie, { priceCents, ...(proposedTime ? { proposedTime } : {}) });
  return (await jobView(w, job)).quotes.filter((q) => q.stage === 'firm');
}

/** Quote Requests go to each Tradie, every one replies with an Estimate, and the Property Manager confirms every Estimate. */
export async function confirmedEstimates(w: World, job: JobRef, quotes: [TradieRef, number, Date?][]) {
  const asked = quotes.map(([tradie]) => tradie.id);
  // Quote Requests go to at least two Tradies (one only when the Agency has no other for the Trade),
  // so a lone quoting Tradie is asked alongside another who stays silent.
  const rule = (await jobView(w, job)).requestRule;
  if (rule && asked.length < rule.minimum) {
    const others = (await w.alice.ticket(job.ticketId)).jobs.find((j) => j.jobId === job.jobId)!.recommendations.filter((r) => !r.requested && !asked.includes(r.tradieId));
    asked.push(...others.slice(0, rule.minimum - asked.length).map((r) => r.tradieId));
  }
  await w.alice.sendQuoteRequests(job.jobId, asked);
  for (const [tradie, priceCents, proposedTime] of quotes) {
    await tradieQuotes(w, job, tradie, `Quote from ${tradie.address} for job ${job.jobId}`, { priceCents, proposedTime });
  }
  const view = await jobView(w, job);
  for (const quote of view.quotes.filter((q) => !q.confirmed)) await w.alice.confirmQuote(quote.quoteId);
  return (await jobView(w, job)).quotes.filter((q) => q.stage === 'estimate');
}

/**
 * The Tradie (already sent a Quote Request) gives an Estimate on their quote page saying they
 * need a Site Inspection, and the Property Manager books it at `start`. Returns its Work Order id.
 */
export async function inspectionBooked(w: World, job: JobRef, tradie: TradieRef, start: Date, estimateCents = 300_00) {
  await w.h.app.submitEstimate(await quoteToken(w, job, tradie), { priceCents: estimateCents, needsInspection: true });
  await w.h.drain();
  return w.alice.bookInspection((await quoteRequestFor(w, job, tradie)).quoteRequestId, { start: start.toISOString() });
}
