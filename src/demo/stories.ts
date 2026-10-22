// The demo's stories: Harbour Realty's last ten days of maintenance work,
// played through the app's real inputs so every screen has work in flight when
// the demo starts. Tenants, Tradies and Property Owners send messages through
// the phone simulator, photos and receipts go up through the upload links, the
// Property Managers use their own actions, and the demo clock runs from ten
// days ago to now, so reminders, prompts and alerts all fire for real.
//
// Every step checks it did what the story says (the mock classifier read the
// message as intended, the Quote arrived, the Job moved on), and throws if not.
//
// Tom Tran and 12 King St are left with nothing open, and Pete, Finn and Nina
// with no Quote Requests waiting, so the walkthrough in docs/demo.md still
// plays exactly as written.

import { readFileSync } from 'node:fs';
import type { App, PropertyManagerActions, Upload } from '../app.ts';
import type { ChannelType } from '../ports.ts';
import { AVAILABILITY, type Trade } from '../shared.ts';
import { AVAILABILITY_LABELS } from '../templates.ts';
import { wallClock, zonedInstant } from '../zoned-time.ts';
import type { OffsetClock } from './clock.ts';
import type { DemoControls, DemoOutboundMessage } from './controls.ts';
import { exifTime, withExif, type PhotoMetadata } from './photo-exif.ts';
import { DEMO_TIME_ZONE, type DemoSeed } from './seed.ts';

/** How many days back the stories start. */
const STORY_DAYS = 10;

const MINUTE_MS = 60_000;
/**
 * The clock moves in steps no longer than this, so every reminder fires close
 * to its due time. Steps that wait on one (48 hours without photos, a 24-hour
 * reminder) leave well over an hour's slack: a daylight-saving change inside
 * the ten days moves the wall clock an hour against the timers.
 */
const STEP_MS = 15 * MINUTE_MS;
/** Somewhere well over 1 km from any demo Property: Penrith. */
const FAR_AWAY = { lat: -33.7507, lng: 150.6877 };

/** What the stories leave in flight, for the start-up banner. */
export interface StoriesSummary {
  maintenanceRequests: number;
  openTickets: number;
  closedTickets: number;
  urgentRepairs: number;
  inbox: number;
  alerts: number;
  upcomingVisits: number;
}

/** Where the demo clock starts so the stories can end at `end`: local midnight, STORY_DAYS days before. */
export function storiesStart(end: Date): Date {
  return localTime(end, -STORY_DAYS, '00:00');
}

/** One line for the start-up banner. */
export function describeStories(s: StoriesSummary): string {
  return (
    `Demo stories: ${s.maintenanceRequests} Maintenance Requests, ${s.openTickets} open Tickets (${s.closedTickets} closed), ` +
    `${s.urgentRepairs} Urgent Repairs, ${s.inbox} inbox messages, ${s.alerts} alerts, ${s.upcomingVisits} upcoming visits`
  );
}

/**
 * Plays the stories on the seeded Agency. The clock must stand at
 * `storiesStart(end)`; it is moved forward through every story to `end` (or to
 * the real time when `end` is left out), so it reads "now" when this returns.
 */
export async function seedStories(input: {
  app: App;
  simulator: Pick<DemoControls, 'sendAs' | 'outbox'>;
  seed: DemoSeed;
  clock: OffsetClock;
  end?: Date;
}): Promise<StoriesSummary> {
  const end = input.end ?? new Date();
  const kit = await createKit({ ...input, end });
  for (const story of STORIES) story(kit);
  await kit.play();
  await kit.advanceTo(input.end ?? new Date());
  return kit.summary();
}

// --- The stories ---

/** Closed: Hana's blocked shower at King St. Pete cleared it; both rated him 5. */
function hanasBlockedShower(k: Kit) {
  const { ids, alice } = k;
  const s = k.story("Hana's blocked shower");
  const text = "The shower drain is blocked and the water won't go down";
  let job: JobRef;
  s.on(0, '08:10', 'Hana reports it with a photo', async () => {
    const token = await k.report(ids.hana, text, ['Main bathroom', 'Yesterday', 'No', '4']);
    await k.upload(token, [k.photo('basin-drain', await k.takenAt(ids.kingSt, 6))]);
  });
  s.on(0, '11:00', 'Alice confirms it and asks Pete and Dana to quote', async () => {
    job = k.job(alice, await k.confirm(alice, text), 'plumbing');
    await k.requestQuotes(job, [ids.pete, ids.dana]);
  });
  s.on(0, '14:30', 'Pete quotes', () => k.quote(ids.pete, job, 'Hi, $220 to clear it, can do tomorrow 10am', 220_00));
  s.on(0, '16:00', 'Dana quotes', () => k.quote(ids.dana, job, '$260 inc GST, could do Thursday 1pm', 260_00));
  s.on(0, '17:30', 'Pete and Dana give Firm Quotes on their quote pages', async () => {
    await k.firmQuote(ids.pete, job, { priceCents: 220_00, scopeOfWork: 'Clear the shower drain with an electric eel and flush the trap', durationDays: 1 });
    await k.firmQuote(ids.dana, job, { priceCents: 255_00, scopeOfWork: 'Clear the drain, camera-check the waste pipe', durationDays: 1 });
  });
  s.on(1, '08:30', "Alice chooses Pete's Firm Quote and books him", async () => {
    await k.choose(job, ids.pete);
    await k.book(job, k.at(1, '10:00'), 90);
  });
  s.on(1, '08:45', 'Hana confirms the visit', () => k.confirmVisit(ids.hana, job, 'Yes that works'));
  s.on(1, '11:45', 'Pete finishes', () => k.done(ids.pete, job, 'All done at King St, drain cleared'));
  s.on(1, '18:00', 'Hana rates the repair', () => k.tenantRates(ids.hana, job, '5'));
  s.on(2, '09:00', 'Alice rates Pete and closes the Ticket', () => k.rateAndClose(job, 5));
}

/** Closed yesterday: Hana's hallway light at King St. Sam replaced the fitting two days ago. */
function hanasHallwayLight(k: Kit) {
  const { ids, alice } = k;
  const s = k.story("Hana's hallway light");
  const text = 'The hallway light has stopped working';
  let job: JobRef;
  s.on(6, '10:00', 'Hana reports it with a photo', async () => {
    const token = await k.report(ids.hana, text, ['Hallway', 'Two days ago', 'No', '2']);
    await k.upload(token, [k.photo('light-switch', await k.takenAt(ids.kingSt, 4))]);
  });
  s.on(6, '13:00', 'Alice confirms it and asks Sam and Erin to quote', async () => {
    job = k.job(alice, await k.confirm(alice, text), 'electrical');
    await k.requestQuotes(job, [ids.sam, ids.erin]);
  });
  s.on(6, '15:30', 'Sam quotes', () => k.quote(ids.sam, job, '$140 to replace the fitting, tomorrow 2pm', 140_00));
  s.on(6, '17:30', 'Erin quotes', () => k.quote(ids.erin, job, '$185 incl GST, Friday 9am', 185_00));
  s.on(7, '08:30', "Alice proceeds on Sam's Estimate, capped at $160, and books him", async () => {
    await k.proceed(job, ids.sam, 160_00);
    await k.book(job, k.at(8, '14:00'), 60);
  });
  s.on(7, '09:00', 'Hana confirms the visit', () => k.confirmVisit(ids.hana, job, 'Sounds good, thanks'));
  s.on(8, '15:30', 'Sam finishes', () => k.done(ids.sam, job, 'All done at King St, new light fitting installed'));
  s.on(8, '19:00', 'Hana rates the repair', () => k.tenantRates(ids.hana, job, '4'));
  s.on(9, '09:00', 'Alice rates Sam and closes the Ticket', () => k.rateAndClose(job, 5));
}

/** Closed: Wei's leaking kitchen tap at Wilson St. Nina fixed it, to middling reviews. */
function weisLeakingTap(k: Kit) {
  const { ids, alice } = k;
  const s = k.story("Wei's leaking tap");
  const text = 'The kitchen tap is leaking under the sink';
  let job: JobRef;
  s.on(0, '19:30', 'Wei reports it with a photo', async () => {
    const token = await k.report(ids.wei, text, ['Kitchen', 'This morning', "Yes, it's getting worse", '4']);
    await k.upload(token, [k.photo('dripping-tap', await k.takenAt(ids.wilsonSt, 5))]);
  });
  s.on(1, '09:30', 'Alice confirms it and asks Nina and Finn to quote', async () => {
    job = k.job(alice, await k.confirm(alice, text), 'plumbing');
    await k.requestQuotes(job, [ids.nina, ids.finn]);
  });
  s.on(1, '13:00', 'Nina quotes', () => k.quote(ids.nina, job, '$260 for the Newtown job, Wednesday 8am', 260_00));
  // Finn is also quoting in Glebe by now, so he names the suburb.
  s.on(1, '15:00', 'Finn quotes', () => k.quote(ids.finn, job, '$310 inc GST for the Newtown job, Tuesday 3pm', 310_00));
  s.on(1, '17:00', 'Nina and Finn give Firm Quotes, as the Ticket is High', async () => {
    await k.firmQuote(ids.nina, job, { priceCents: 260_00, scopeOfWork: 'Replace the tap washer and cartridge', durationDays: 1 });
    await k.firmQuote(ids.finn, job, { priceCents: 300_00, scopeOfWork: 'Replace the mixer tap', durationDays: 1 });
  });
  s.on(2, '08:30', "Alice chooses Nina's Firm Quote and books her", async () => {
    await k.choose(job, ids.nina);
    await k.book(job, k.at(2, '15:00'), 90);
  });
  s.on(2, '09:00', 'Wei confirms the visit', () => k.confirmVisit(ids.wei, job, 'Yes that works'));
  s.on(2, '17:00', 'Nina finishes', () => k.done(ids.nina, job, 'All done at Wilson St, new washer and cartridge fitted'));
  s.on(2, '20:00', 'Wei rates the repair', () => k.tenantRates(ids.wei, job, '3'));
  s.on(3, '09:30', 'Alice rates Nina and closes the Ticket', () => k.rateAndClose(job, 3));
}

/** Closed: Priya's blocked toilet at Glebe Point Rd. Finn cleared it. */
function priyasBlockedToilet(k: Kit) {
  const { ids, bob } = k;
  const s = k.story("Priya's blocked toilet");
  const text = "The toilet is blocked and won't flush";
  let job: JobRef;
  s.on(1, '07:45', 'Priya reports it with a photo', async () => {
    const token = await k.report(ids.priya, text, ['Bathroom', 'Last night', 'No', '1']);
    await k.upload(token, [k.photo('basin-drain', await k.takenAt(ids.glebePointRd, 3))]);
  });
  s.on(1, '10:30', 'Bob confirms it and asks Quinn and Finn to quote', async () => {
    job = k.job(bob, await k.confirm(bob, text), 'plumbing');
    await k.requestQuotes(job, [ids.quinn, ids.finn]);
  });
  s.on(1, '14:00', 'Quinn quotes by email', () =>
    k.quote(ids.quinn, job, 'Hi, $240 + GST to clear the blockage in Glebe. Could attend Thursday 9am.', 240_00),
  );
  s.on(1, '16:30', 'Finn quotes', () => k.quote(ids.finn, job, '$190 for the Glebe job, tomorrow 11am', 190_00));
  s.on(2, '09:10', "Bob proceeds on Finn's Estimate, capped at $220, and books him", async () => {
    await k.proceed(job, ids.finn, 220_00);
    await k.book(job, k.at(2, '11:00'), 90);
  });
  s.on(2, '09:20', 'Priya confirms the visit', () => k.confirmVisit(ids.priya, job, 'Yes, see you then'));
  s.on(2, '13:15', 'Finn finishes', () => k.done(ids.finn, job, 'All done at Glebe Point Rd, blockage cleared'));
  s.on(2, '18:00', 'Priya rates the repair', () => k.tenantRates(ids.priya, job, '5'));
  s.on(3, '09:10', 'Bob rates Finn and closes the Ticket', () => k.rateAndClose(job, 4));
}

/** Closed: Bella's oven door at Ocean Ave, all by email. Ally replaced the seal. */
function bellasOvenDoor(k: Kit) {
  const { ids, bob } = k;
  const s = k.story("Bella's oven door");
  const text = "The oven door won't close properly and the seal is torn";
  let job: JobRef;
  s.on(0, '12:00', 'Bella emails it in with a photo', async () => {
    const token = await k.report(ids.bella, text, ['Kitchen', 'About a week ago', 'No', '3']);
    await k.upload(token, [k.photo('oven', await k.takenAt(ids.oceanAve, 8))]);
  });
  s.on(0, '15:00', 'Bob confirms it and asks Ally and Arlo to quote', async () => {
    job = k.job(bob, await k.confirm(bob, text), 'appliances');
    await k.requestQuotes(job, [ids.ally, ids.arlo]);
  });
  s.on(0, '17:00', 'Ally quotes by email', () => k.quote(ids.ally, job, 'Hi Bob, $150 inc GST to replace the door seal, Wednesday 10am.', 150_00));
  s.on(1, '09:00', 'Arlo quotes by email', () => k.quote(ids.arlo, job, 'We can do it for $210 + GST, Friday 2pm', 210_00));
  s.on(1, '11:00', "Bob proceeds on Ally's Estimate, capped at $180, and books her", async () => {
    await k.proceed(job, ids.ally, 180_00);
    await k.book(job, k.at(2, '10:00'), 60);
  });
  s.on(1, '12:00', 'Bella confirms the visit', () => k.confirmVisit(ids.bella, job, 'Thanks, that works for me'));
  s.on(2, '12:30', 'Ally finishes', () => k.done(ids.ally, job, 'All done at Ocean Ave, new seal fitted'));
  s.on(2, '17:10', 'Bella rates the repair', () => k.tenantRates(ids.bella, job, '5 stars, thanks'));
  s.on(3, '10:00', 'Bob rates Ally and closes the Ticket', () => k.rateAndClose(job, 4));
}

/** Urgent Repair, its Reimbursement Request forwarded: Noah's burst pipe at Llewellyn St, fixed by Dana after hours. */
function noahsBurstPipe(k: Kit) {
  const { ids, alice } = k;
  const s = k.story("Noah's burst pipe");
  let receiptToken = '';
  s.on(3, '06:40', 'Noah texts about a burst pipe', async () => {
    const sent = await k.say(ids.noah, 'Water is pouring out of a burst pipe under the laundry tub');
    receiptToken = k.tokenIn(k.expectSent(sent, ids.noah, 'tenant.urgent_repair_reminder'));
  });
  s.on(3, '11:30', 'Noah uploads the receipt and claims $380', () =>
    k.upload(receiptToken, [{ filename: 'receipt.jpg', contentType: 'image/jpeg', content: k.sample('receipt') }], { amountCents: 380_00 }),
  );
  s.on(3, '13:00', 'Alice checks the receipt and forwards it to Henry', async () => {
    const sent = await k.forwardReimbursement(alice, ids.noah);
    k.expectSent(sent, ids.henry, 'owner.urgent_repair_receipt');
  });
}

/** Quoting, one confirmed Quote after 72 hours ("invite more Tradies"), and an unread follow-up: Ethan's leaking roof at Coogee. */
function ethansLeakingRoof(k: Kit) {
  const { ids, bob } = k;
  const s = k.story("Ethan's leaking roof");
  const text = 'The roof is leaking into the back bedroom when it rains';
  let job: JobRef;
  s.on(3, '20:00', 'Ethan reports it with a photo', async () => {
    const token = await k.report(ids.ethan, text, ['Back bedroom ceiling', 'During the storm last night', "Yes, it's getting worse", '4']);
    await k.upload(token, [k.photo('water-stain', await k.takenAt(ids.coogeeBayRd, 12))]);
  });
  s.on(4, '09:30', 'Bob confirms it and asks Rhys and Tess to quote', async () => {
    job = k.job(bob, await k.confirm(bob, text), 'roofing');
    await k.requestQuotes(job, [ids.rhys, ids.tess]);
  });
  s.on(5, '10:00', 'Rhys gives an Estimate on his quote page, and needs to get up on the roof first', () =>
    k.estimate(ids.rhys, job, { priceCents: 650_00, needsInspection: true, calloutFeeCents: 120_00 }),
  );
  s.on(6, '12:00', 'Tess, still silent, was reminded', async () => k.expectSentSince(k.at(6, '08:00'), ids.tess, 'tradie.quote_reminder'));
  s.on(7, '18:30', 'Ethan chases it up', async () => {
    await k.say(ids.ethan, 'Any update on the roof? It rained again last night and the stain is getting bigger');
    if (!(await job.pm.ticket(job.ticketId)).unreadMessages) throw new Error("Ethan's follow-up wasn't left unread on his Ticket");
  });
}

/** Awaiting the Property Owner for over 48 hours, reminded at 24: Priya's hot water system at Glebe Point Rd. */
function priyasHotWater(k: Kit) {
  const { ids, bob } = k;
  const s = k.story("Priya's hot water system");
  const text = 'The hot water system is leaking from the bottom';
  let job: JobRef;
  s.on(4, '07:30', 'Priya reports it with a photo', async () => {
    const token = await k.report(ids.priya, text, ['Laundry', 'Yesterday', "Yes, it's getting worse", '1']);
    await k.upload(token, [k.photo('hot-water-leak', await k.takenAt(ids.glebePointRd, 4))]);
  });
  s.on(4, '11:00', 'Bob confirms it and asks Quinn and Dana to quote', async () => {
    job = k.job(bob, await k.confirm(bob, text), 'plumbing');
    await k.requestQuotes(job, [ids.quinn, ids.dana]);
  });
  s.on(4, '16:00', 'Quinn quotes by email', () =>
    k.quote(ids.quinn, job, 'Quote: $1,150 + GST to replace the hot water unit in Glebe. Tuesday 8am.', 1150_00),
  );
  s.on(5, '08:00', 'Dana quotes', () => k.quote(ids.dana, job, '$980 incl GST to replace the unit, Thu 7:30am', 980_00));
  s.on(5, '11:00', 'Bob confirms both Estimates', () => k.confirmQuotes(job));
  s.on(5, '15:00', 'Quinn and Dana give Firm Quotes', async () => {
    await k.firmQuote(ids.quinn, job, { priceCents: 1265_00, scopeOfWork: 'Supply and install a 250 L electric storage unit, remove the old one', durationDays: 1 });
    await k.firmQuote(ids.dana, job, { priceCents: 980_00, scopeOfWork: 'Replace the hot water unit like for like, dispose of the old unit', durationDays: 1 });
  });
  s.on(6, '10:00', "Bob chooses Dana's Firm Quote, over Glebe's $400 limit, so Oscar is asked", async () => {
    const sent = await k.choose(job, ids.dana);
    k.expectSent(sent, ids.oscar, 'owner.approval_request');
  });
  s.on(7, '12:30', 'Oscar, still silent, was reminded', async () => k.expectSentSince(k.at(7, '09:00'), ids.oscar, 'owner.approval_reminder'));
}

/** Two Jobs: Kai's leak under the sink at Llewellyn St. Plumbing booked with Dana; carpentry has two confirmed Quotes to choose from. */
function kaisLeakUnderSink(k: Kit) {
  const { ids, alice } = k;
  const s = k.story("Kai's leak under the sink");
  const text = 'The cupboard under the kitchen sink is falling apart and the pipe underneath is leaking';
  let plumbing: JobRef;
  let carpentry: JobRef;
  s.on(5, '07:30', 'Kai reports it with a photo', async () => {
    const token = await k.report(ids.kai, text, ['Kitchen', 'Last week', "Yes, it's getting worse", '4']);
    await k.upload(token, [k.photo('cupboard-leak', await k.takenAt(ids.llewellynSt, 5))]);
  });
  s.on(5, '10:15', 'Alice confirms it, adds a carpentry Job, and asks for Quotes on both', async () => {
    const ticketId = await k.confirm(alice, text);
    await alice.addJob(ticketId, 'carpentry');
    plumbing = k.job(alice, ticketId, 'plumbing');
    carpentry = k.job(alice, ticketId, 'carpentry');
    await k.requestQuotes(plumbing, [ids.dana, ids.pete]);
    await k.requestQuotes(carpentry, [ids.carl, ids.harry]);
  });
  s.on(5, '13:00', 'Dana quotes', () => k.quote(ids.dana, plumbing, '$280 for the Marrickville job, Tue 10am', 280_00));
  s.on(5, '14:30', 'Pete quotes', () => k.quote(ids.pete, plumbing, '$320, can do Wednesday 2pm', 320_00));
  s.on(5, '15:00', 'Carl quotes', () => k.quote(ids.carl, carpentry, '$340 to rebuild the cupboard base, Friday 9am', 340_00));
  s.on(6, '16:00', 'Harry quotes', () => k.quote(ids.harry, carpentry, '$290 + GST for the Marrickville job, Monday 1pm', 290_00));
  s.on(6, '17:00', "Alice confirms all four Estimates; the four Tradies give Firm Quotes, and Alice chooses Dana's for the plumbing", async () => {
    await k.confirmQuotes(carpentry);
    await k.confirmQuotes(plumbing);
    await k.firmQuote(ids.dana, plumbing, { priceCents: 280_00, scopeOfWork: 'Replace the leaking waste trap under the sink', durationDays: 1 });
    await k.firmQuote(ids.pete, plumbing, { priceCents: 320_00, scopeOfWork: 'Replace the trap and both flexi hoses', durationDays: 1 });
    await k.firmQuote(ids.carl, carpentry, { priceCents: 340_00, scopeOfWork: 'Rebuild the cupboard base in moisture-resistant board', durationDays: 2 });
    await k.firmQuote(ids.harry, carpentry, { priceCents: 310_00, scopeOfWork: 'Replace the cupboard floor and kickboard', durationDays: 1 });
    await k.choose(plumbing, ids.dana);
  });
  s.on(8, '16:00', 'Alice books Dana three weekdays out', () => k.book(plumbing, k.upcoming(3, '10:00'), 120));
}

/**
 * High, each Tradie on their own path: Quinn quotes firm from the photo, Dana needs a Site
 * Inspection first (for a Call-out Fee), booked for tomorrow: Wei's leaking hot water system
 * at Wilson St. The photo comes with the first message.
 */
function weisHotWaterLeak(k: Kit) {
  const { ids, alice } = k;
  const s = k.story("Wei's hot water leak");
  const text = 'The hot water system is leaking into the laundry';
  let job: JobRef;
  s.on(7, '08:30', 'Wei reports it with a photo in his first message', async () => {
    const photos = [k.photo('hot-water-leak', await k.takenAt(ids.wilsonSt, 6))];
    const token = await k.report(ids.wei, text, ['Laundry', 'This morning', "Yes, it's getting worse", '3'], photos);
    if (!token) throw new Error('Wei should have been sent the upload link');
  });
  s.on(7, '11:00', 'Alice confirms it and asks Quinn and Dana to quote', async () => {
    job = k.job(alice, await k.confirm(alice, text), 'plumbing');
    await k.requestQuotes(job, [ids.quinn, ids.dana]);
  });
  s.on(7, '14:00', 'Quinn quotes by email', () =>
    k.quote(ids.quinn, job, 'Quote: $1,320 + GST to replace the hot water unit at the Newtown job. Friday 8am.', 1320_00),
  );
  s.on(7, '15:30', 'Dana gives an Estimate, and needs to see the unit before a firm price', () =>
    k.estimate(ids.dana, job, { priceCents: 1180_00, needsInspection: true, calloutFeeCents: 90_00 }),
  );
  s.on(7, '17:00', "Alice confirms Quinn's Estimate, and Quinn gives his Firm Quote", async () => {
    await k.confirmQuotes(job);
    await k.firmQuote(ids.quinn, job, { priceCents: 1320_00, scopeOfWork: 'Replace the hot water unit with a 250 L gas storage unit', durationDays: 1 });
  });
  s.on(9, '16:00', "Alice books Dana's Site Inspection for tomorrow", () => k.bookInspection(job, ids.dana, k.upcoming(1, '09:00')));
}

/** Done, waiting for Alice's rating ("rating due"): Maya's bathroom door handle at Albion St. No photos sent. */
function mayasDoorHandle(k: Kit) {
  const { ids, alice } = k;
  const s = k.story("Maya's door handle");
  const text = 'The bathroom door handle has come off';
  let job: JobRef;
  s.on(4, '07:00', 'Maya reports it, and never sends photos', async () => {
    await k.report(ids.maya, text, ['Main bathroom', 'This morning', 'No', '4']);
  });
  s.on(6, '09:00', 'Alice confirms it after the 48-hour wait and asks Carl and Harry to quote', async () => {
    job = k.job(alice, await k.confirm(alice, text), 'carpentry');
    await k.requestQuotes(job, [ids.carl, ids.harry]);
  });
  s.on(6, '11:00', 'Carl quotes', () => k.quote(ids.carl, job, '$120 for the Annandale job, tomorrow 10am', 120_00));
  // Harry is also quoting in Marrickville, so he names the suburb.
  s.on(6, '12:15', 'Harry quotes', () => k.quote(ids.harry, job, '$95 + GST for the Annandale job, Thursday 1pm', 95_00));
  s.on(6, '13:30', "Alice proceeds on Carl's Estimate, capped at $140, and books him", async () => {
    await k.proceed(job, ids.carl, 140_00);
    await k.book(job, k.at(7, '10:00'), 60);
  });
  s.on(6, '14:00', 'Maya confirms the visit', () => k.confirmVisit(ids.maya, job, 'Yes, that works'));
  s.on(7, '11:30', 'Carl finishes', () => k.done(ids.carl, job, 'All done at Albion St, new handle fitted'));
  s.on(7, '18:00', 'Maya rates the repair', () => k.tenantRates(ids.maya, job, '4'));
}

/** Quoting, two Quotes in but not yet confirmed: Maya's oven at Albion St. Her "any update?" is a low-confidence inbox message. */
function mayasOven(k: Kit) {
  const { ids, alice } = k;
  const s = k.story("Maya's oven");
  const text = "The oven isn't heating up properly";
  let job: JobRef;
  s.on(6, '19:00', 'Maya reports it with a photo', async () => {
    const token = await k.report(ids.maya, text, ['Kitchen', 'Two days ago', 'No', '2']);
    await k.upload(token, [k.photo('oven', await k.takenAt(ids.albionSt, 3))]);
  });
  s.on(8, '09:00', 'Alice confirms it and asks Ally and Arlo to quote', async () => {
    job = k.job(alice, await k.confirm(alice, text), 'appliances');
    await k.requestQuotes(job, [ids.ally, ids.arlo]);
  });
  s.on(8, '15:00', 'Ally quotes by email', () =>
    k.quote(ids.ally, job, 'Hi, $240 inc GST to replace the oven element in Annandale. Thursday 2pm suits.', 240_00),
  );
  s.on(9, '10:30', 'Arlo quotes by email', () => k.quote(ids.arlo, job, '$195 + GST for the Annandale job, could come Friday 11am', 195_00));
  // With two Tickets open, the classifier can only guess which one she means.
  s.on(9, '17:00', 'Maya asks for an update without saying which repair', () =>
    k.say(ids.maya, 'Hi, any update? Thanks', { toInbox: 'low_confidence' }),
  );
}

/** Approved, waiting for a Work Order: Liam's light switch at Australia St. His intercom report goes to the inbox (no Building Manager). */
function liamsLightSwitch(k: Kit) {
  const { ids, alice } = k;
  const s = k.story("Liam's light switch");
  const text = "The bedroom light switch is broken and the light won't turn on";
  let job: JobRef;
  s.on(7, '08:00', 'Liam reports it with a photo', async () => {
    const token = await k.report(ids.liam, text, ['Main bedroom', 'Two days ago', 'No', '4']);
    await k.upload(token, [k.photo('light-switch', await k.takenAt(ids.australiaSt, 7))]);
  });
  s.on(7, '12:00', 'Alice confirms it and asks Sam and Erin to quote', async () => {
    job = k.job(alice, await k.confirm(alice, text), 'electrical');
    await k.requestQuotes(job, [ids.sam, ids.erin]);
  });
  s.on(7, '16:00', 'Sam quotes', () => k.quote(ids.sam, job, '$180 for the Camperdown job, Thursday 9am', 180_00));
  s.on(8, '08:30', 'Erin quotes', () => k.quote(ids.erin, job, '$165 incl GST, Friday 1pm', 165_00));
  s.on(8, '11:00', "Alice confirms both and proceeds on Erin's Estimate, capped at $180", async () => {
    await k.proceed(job, ids.erin, 180_00);
  });
  s.on(9, '19:30', "Liam reports the building's intercom, a Common Area with no Building Manager on file", () =>
    k.say(ids.liam, 'The intercom at the front entrance has stopped working', { toInbox: 'common_area_no_building_manager' }),
  );
}

/** Scheduled for the next weekday and confirmed, with an unread note: Wei's running toilet at Wilson St. */
function weisRunningToilet(k: Kit) {
  const { ids, alice } = k;
  const s = k.story("Wei's running toilet");
  const text = 'The toilet cistern keeps running after flushing';
  let job: JobRef;
  s.on(6, '08:00', 'Wei reports it, and never sends photos', async () => {
    await k.report(ids.wei, text, ['Upstairs bathroom', 'Since the weekend', 'No', '1']);
  });
  s.on(8, '09:30', 'Alice confirms it after the 48-hour wait and asks Finn and Nina to quote', async () => {
    job = k.job(alice, await k.confirm(alice, text), 'plumbing');
    await k.requestQuotes(job, [ids.finn, ids.nina]);
  });
  s.on(8, '12:00', 'Finn quotes', () => k.quote(ids.finn, job, '$180 for the Newtown job, Mon 8am', 180_00));
  s.on(8, '13:30', 'Nina quotes', () => k.quote(ids.nina, job, 'Can do it for $210, Tuesday 9am', 210_00));
  s.on(8, '15:10', "Alice proceeds on Finn's Estimate and books him for the next weekday", async () => {
    await k.proceed(job, ids.finn, 200_00);
    await k.book(job, k.upcoming(1, '09:00'), 120);
  });
  s.on(8, '15:30', 'Wei confirms the visit', () => k.confirmVisit(ids.wei, job, 'Yes that works, thanks'));
  s.on(8, '20:00', 'Wei adds a note for the plumber', async () => {
    await k.say(ids.wei, 'Following up on the toilet: the plumber can park in the lane behind the house');
    if (!(await job.pm.ticket(job.ticketId)).unreadMessages) throw new Error("Wei's note wasn't left unread on his Ticket");
  });
}

/** Maintenance Request with clean photos: Wei's slow basin at Wilson St, photographed there just now. */
function weisSlowBasin(k: Kit) {
  const { ids } = k;
  const s = k.story("Wei's slow basin");
  s.on(9, '08:20', 'Wei reports it with two photos', async () => {
    const token = await k.report(ids.wei, 'The bathroom basin is draining really slowly', ['Main bathroom', 'Last week', 'No', '2']);
    await k.upload(token, [k.photo('basin-drain', await k.takenAt(ids.wilsonSt, 3)), k.photo('dripping-tap', await k.takenAt(ids.wilsonSt, 2))]);
  });
}

/** Maintenance Request with no photos, after the 48-hour wait: Noah's loose fence palings at Llewellyn St. */
function noahsLoosePalings(k: Kit) {
  const { ids, alice } = k;
  const s = k.story("Noah's loose palings");
  const text = 'Some palings on the back fence have come loose';
  s.on(6, '17:45', 'Noah reports it, and never sends photos', async () => {
    await k.report(ids.noah, text, ['Back yard', 'Since Saturday', 'No', '3']);
  });
  s.on(9, '08:00', 'It went ahead as a Maintenance Request without photos', async () => {
    const request = (await alice.dashboard({ filter: 'all' })).maintenanceRequests.find((r) => r.description === text);
    if (!request?.noPhotos) throw new Error(`Noah's request should be waiting with no photos, not ${request ? 'with photos' : 'missing'}`);
  });
}

/** Maintenance Request with flagged photos: Ruby's mouldy window at Glenmore Rd, by SMS. One photo predates her tenancy, one was taken in Penrith. */
function rubysMouldyWindow(k: Kit) {
  const { ids, bob } = k;
  const s = k.story("Ruby's mouldy window");
  const text = "The bedroom window frame has mould around it and the window won't close properly";
  s.on(8, '19:00', 'Ruby reports it with two old or far-away photos', async () => {
    const token = await k.report(ids.ruby, text, ['Front bedroom', 'A few weeks ago', "Yes, it's getting worse", '4']);
    const glenmoreRd = await k.locationOf(ids.glenmoreRd);
    await k.upload(token, [
      // Ruby moved in on 17 August 2026: this one is from July.
      k.photo('window-mould', { takenAt: '2026:07:26 16:40:12', ...(glenmoreRd ? { gps: glenmoreRd } : {}) }),
      k.photo('window-mould', { takenAt: exifTime(k.minutesAgo(25), DEMO_TIME_ZONE), gps: FAR_AWAY }),
    ]);
    const request = (await bob.dashboard({ filter: 'all' })).maintenanceRequests.find((r) => r.description === text);
    if (!request?.photos.every((p) => p.metadata === 'flagged')) throw new Error("Ruby's photos should both be flagged");
  });
}

/** Maintenance Request flagged "check urgency", with a photo that has no metadata: Sofia's buzzing power point at Coogee. */
function sofiasBuzzingPowerPoint(k: Kit) {
  const { ids, bob } = k;
  const s = k.story("Sofia's buzzing power point");
  const text = 'The power point in the kitchen is buzzing and feels warm to touch';
  s.on(9, '12:30', 'Sofia reports it with a screenshot', async () => {
    const token = await k.report(ids.sofia, text, ['Kitchen bench', 'This morning', 'No', '4']);
    await k.upload(token, [{ filename: 'screenshot.jpg', contentType: 'image/jpeg', content: k.sample('power-point') }]);
    const request = (await bob.dashboard({ filter: 'all' })).maintenanceRequests.find((r) => r.description === text);
    if (!request?.checkUrgency) throw new Error("Sofia's request should be flagged to check its Urgency");
  });
}

/** Scheduled, then the Tenant asked for another day: Omar's stiff lock at Bronte Rd. */
function omarsStiffLock(k: Kit) {
  const { ids, bob } = k;
  const s = k.story("Omar's stiff lock");
  const text = 'The front door lock is really stiff and the key is hard to turn';
  let job: JobRef;
  s.on(5, '18:30', 'Omar reports it, and never sends photos', async () => {
    await k.report(ids.omar, text, ['Front door', 'A couple of weeks ago', 'No', '2']);
  });
  s.on(8, '09:15', 'Bob confirms it and asks Lucy and Kev to quote', async () => {
    job = k.job(bob, await k.confirm(bob, text), 'locksmith');
    await k.requestQuotes(job, [ids.lucy, ids.kev]);
  });
  s.on(8, '11:10', 'Lucy quotes', () => k.quote(ids.lucy, job, '$165 to service the lock, Tuesday 2pm', 165_00));
  s.on(8, '12:30', 'Kev quotes', () => k.quote(ids.kev, job, '$210 incl GST, tomorrow 3pm', 210_00));
  s.on(8, '14:00', "Bob proceeds on Lucy's Estimate and books her", async () => {
    await k.proceed(job, ids.lucy, 180_00);
    await k.book(job, k.upcoming(2, '13:00'), 60);
  });
  s.on(8, '19:10', 'Omar asks for another day', async () => {
    await k.say(ids.omar, "Sorry, I can't make that day, can we do another day?");
    if ((await k.view(job)).workOrder?.rescheduleRequestedBy !== 'tenant') throw new Error("Omar's reply should have asked to reschedule the visit");
  });
}

/** Urgent Repair waiting for a receipt: Omar's hot water at Bronte Rd. */
function omarsNoHotWater(k: Kit) {
  const { ids } = k;
  const s = k.story("Omar's hot water");
  s.on(9, '07:15', 'Omar texts that there is no hot water', async () => {
    const sent = await k.say(ids.omar, 'There is no hot water at all this morning');
    k.expectSent(sent, ids.omar, 'tenant.urgent_repair_reminder');
  });
}

/** Scheduled six weekdays out and confirmed: Bella's dishwasher at Ocean Ave. Her foyer light goes to Barry, the Building Manager. */
function bellasDishwasher(k: Kit) {
  const { ids, bob } = k;
  const s = k.story("Bella's dishwasher");
  const text = "The dishwasher won't drain and there's dirty water sitting in the bottom";
  let job: JobRef;
  s.on(5, '09:00', 'Bella emails it in, without photos', async () => {
    await k.report(ids.bella, text, ['Kitchen', 'Since Sunday', 'No', '1']);
  });
  s.on(6, '08:15', "Bella emails about the building's foyer light, which goes to Barry", async () => {
    const sent = await k.say(ids.bella, 'The foyer light near the letterboxes has been out for a few days');
    k.expectSent(sent, ids.barry, 'building_manager.common_area_issue');
    k.expectSent(sent, ids.bella, 'tenant.common_area_passed_on');
  });
  s.on(7, '11:00', 'Bob confirms it after the 48-hour wait and asks Ally and Arlo to quote', async () => {
    job = k.job(bob, await k.confirm(bob, text), 'appliances');
    await k.requestQuotes(job, [ids.ally, ids.arlo]);
  });
  s.on(7, '13:00', 'Ally quotes by email', () => k.quote(ids.ally, job, '$185 inc GST for the Bondi job, Wednesday 1pm', 185_00));
  s.on(7, '15:30', 'Arlo quotes by email', () => k.quote(ids.arlo, job, '$230 + GST, Thursday 9am', 230_00));
  s.on(7, '17:00', "Bob proceeds on Ally's Estimate and books her six weekdays out", async () => {
    await k.proceed(job, ids.ally, 200_00);
    await k.book(job, k.upcoming(6, '13:00'), 120);
  });
  s.on(7, '18:10', 'Bella confirms the visit', () => k.confirmVisit(ids.bella, job, 'Thanks, that works for me'));
}

/** Inbox: a question about rent, and a text from a number nobody knows. */
function strayMessages(k: Kit) {
  const { ids } = k;
  const s = k.story('Stray messages');
  s.on(9, '09:00', 'Priya asks about her rent', () =>
    k.say(ids.priya, "Can you tell me when my next rent payment is due? I've changed banks.", { toInbox: 'other' }),
  );
  s.on(9, '20:15', "Ruby's new flatmate texts from an unknown number", () =>
    k.sendFrom('Mia', '+61400000013', 'sms', "Hi, this is Mia, Ruby's new flatmate at Glenmore Rd. The bathroom fan has stopped working.", {
      toInbox: 'unknown_sender',
    }),
  );
}

const STORIES: ((k: Kit) => void)[] = [
  hanasBlockedShower,
  hanasHallwayLight,
  weisLeakingTap,
  priyasBlockedToilet,
  bellasOvenDoor,
  noahsBurstPipe,
  ethansLeakingRoof,
  priyasHotWater,
  weisHotWaterLeak,
  kaisLeakUnderSink,
  mayasDoorHandle,
  mayasOven,
  liamsLightSwitch,
  weisRunningToilet,
  weisSlowBasin,
  noahsLoosePalings,
  rubysMouldyWindow,
  sofiasBuzzingPowerPoint,
  omarsStiffLock,
  omarsNoHotWater,
  bellasDishwasher,
  strayMessages,
];

// --- The moves the stories are made of ---

type Sent = Pick<DemoOutboundMessage, 'at' | 'to' | 'template' | 'text'>;
type InboxReason = 'unknown_sender' | 'other' | 'low_confidence' | 'common_area_no_building_manager';
type SayOptions = { channel?: ChannelType; attachments?: Upload[]; toInbox?: InboxReason };
type SamplePhoto =
  | 'basin-drain'
  | 'cupboard-leak'
  | 'dripping-tap'
  | 'hot-water-leak'
  | 'light-switch'
  | 'oven'
  | 'power-point'
  | 'receipt'
  | 'water-stain'
  | 'window-mould';

/** One Job on a Ticket, named by its Trade. */
interface JobRef {
  pm: PropertyManagerActions;
  ticketId: number;
  trade: Trade;
}

type Step = { at: Date; story: string; what: string; run: () => Promise<unknown>; order: number };
type Kit = Awaited<ReturnType<typeof createKit>>;

/** The timeline, the people, and the moves the stories are made of: each checks it did what the story says. */
async function createKit({ app, simulator, seed, clock, end }: { app: App; simulator: Pick<DemoControls, 'sendAs' | 'outbox'>; seed: DemoSeed; clock: OffsetClock; end: Date }) {
  const { ids } = seed;
  const alice = await app.asPropertyManager(ids.aliceId);
  const bob = await app.asPropertyManager(ids.bobId);
  const people = new Map((await alice.people()).map((p) => [p.id, p]));
  const steps: Step[] = [];
  let photoNumber = 4810;
  let closedTickets = 0;

  const person = (id: number) => {
    const found = people.get(id);
    if (!found) throw new Error(`No person ${id} in the seed`);
    return found;
  };
  const now = () => clock.now();
  const outbox = (): Promise<Sent[]> => simulator.outbox(ids.aliceId);
  const inbox = async () => (await alice.dashboard({ filter: 'all' })).inbox;

  /** Runs every background task that is due, and fails the seeding if one throws. */
  async function tick() {
    const [error] = await app.runWorker();
    if (error) throw new Error(`A background task failed: ${error.message}`, { cause: error });
  }

  /** Moves the clock forward to `target` a step at a time, running the tasks that fall due on the way. */
  async function advanceTo(target: Date) {
    for (;;) {
      const gap = target.getTime() - now().getTime();
      if (gap <= 0) return;
      clock.advance(Math.min(gap, STEP_MS));
      await tick();
    }
  }

  const wait = (minutes: number) => advanceTo(new Date(now().getTime() + minutes * MINUTE_MS));

  /** `time` on story day `day`: day 0 is STORY_DAYS days before the stories end. */
  const at = (day: number, time: string) => localTime(end, day - STORY_DAYS, time);

  /** Sends a message in from any address, as the simulator does, and checks it went to the inbox only if `toInbox` says so. */
  async function sendFrom(who: string, from: string, channel: ChannelType, text: string, options: SayOptions = {}) {
    const inboxBefore = new Set((await inbox()).map((i) => i.itemId));
    const sentBefore = (await outbox()).length;
    await simulator.sendAs(ids.aliceId, from, channel, text, options.attachments ?? []);
    await tick();
    const arrived = (await inbox()).filter((i) => !inboxBefore.has(i.itemId));
    if (options.toInbox && !arrived.some((i) => i.reason === options.toInbox)) {
      throw new Error(`"${text}" from ${who} should have gone to the inbox as ${options.toInbox}`);
    }
    if (!options.toInbox && arrived.length) {
      throw new Error(`"${text}" from ${who} went to the inbox (${arrived[0]!.reason}, best guess ${JSON.stringify(arrived[0]!.bestGuess)}) instead of being handled`);
    }
    return (await outbox()).slice(sentBefore);
  }

  /** A message from someone in the seed, on SMS or email as they prefer. Returns what myEST8 sent in reply. */
  function say(personId: number, text: string, options: SayOptions = {}) {
    const p = person(personId);
    const channel = options.channel ?? (p.mobile ? 'sms' : 'email');
    const from = channel === 'email' ? p.email : p.mobile;
    if (!from) throw new Error(`${p.name} has no ${channel} address`);
    return sendFrom(p.name, from, channel, text, options);
  }

  function expectSent(sent: Sent[], personId: number, template: string): Sent {
    const p = person(personId);
    const found = sent.find((m) => (m.to === p.mobile || m.to === p.email) && m.template === template);
    if (!found) {
      throw new Error(`${p.name} should have been sent ${template}; myEST8 sent ${sent.map((m) => `${m.template} to ${m.to}`).join(', ') || 'nothing'}`);
    }
    return found;
  }

  /** Checks something the worker sent on its own, such as a reminder, since `from`. */
  async function expectSentSince(from: Date, personId: number, template: string) {
    expectSent(
      (await outbox()).filter((m) => Date.parse(m.at) >= from.getTime()),
      personId,
      template,
    );
  }

  const tokenIn = (message: Sent) => {
    const token = /\/u\/([\w-]+)/.exec(message.text)?.[1];
    if (!token) throw new Error(`No upload link in "${message.text}"`);
    return token;
  };

  /**
   * A Tenant reports an issue and answers the guided questions it asks (where,
   * since when, getting worse, when they're home) in one reply a couple of
   * minutes later, worded so the demo's mock extractor reads every answer.
   * Returns the token of the upload link they're sent.
   */
  async function report(tenantId: number, text: string, answers: readonly [string, string, string, string], firstPhotos: Upload[] = []) {
    const first = await say(tenantId, text, firstPhotos.length ? { attachments: firstPhotos } : {});
    expectSent(first, tenantId, 'tenant.acknowledgement');
    expectSent(first, tenantId, 'tenant.missing_details');
    const [location, started, worsening, home] = answers;
    const reply = [
      `${location}, ${started.toLowerCase()}.`,
      worsening.startsWith('Yes') ? "It's getting worse." : "It isn't getting worse.",
      `I'm home ${AVAILABILITY_LABELS[AVAILABILITY[Number(home) - 1]!]}.`,
    ].join(' ');
    await wait(2);
    return tokenIn(expectSent(await say(tenantId, reply), tenantId, 'tenant.upload_link'));
  }

  /** Uploads through a no-login link, as the Tenant's phone would. Returns what myEST8 sent as a result. */
  async function upload(token: string, files: Upload[], o: { amountCents?: number } = {}) {
    await wait(1);
    const sentBefore = (await outbox()).length;
    await app.upload(token, files, o);
    await tick();
    return (await outbox()).slice(sentBefore);
  }

  /** The Property Manager forwards the Tenant's Reimbursement Request, checked, to the Property Owner. Returns what was sent. */
  async function forwardReimbursement(pm: PropertyManagerActions, tenantId: number) {
    const tenant = person(tenantId).name;
    const request = (await pm.approvals({ filter: 'all' })).reimbursements.find((r) => r.tenantName === tenant && r.status === 'receipt_received');
    if (!request) throw new Error(`${tenant} has no Reimbursement Request waiting to be checked`);
    const sentBefore = (await outbox()).length;
    await pm.forwardReimbursement(request.urgentRepairId);
    await tick();
    return (await outbox()).slice(sentBefore);
  }

  const sample = (name: SamplePhoto) => new Uint8Array(readFileSync(new URL(`./sample-photos/${name}.jpg`, import.meta.url)));

  /** A sample photo as a phone would name and stamp it. */
  function photo(name: SamplePhoto, metadata: PhotoMetadata = {}): Upload {
    return { filename: `IMG_${photoNumber++}.jpg`, contentType: 'image/jpeg', content: withExif(sample(name), metadata) };
  }

  const minutesAgo = (minutes: number) => new Date(now().getTime() - minutes * MINUTE_MS);
  const locationOf = async (propertyId: number) => (await alice.properties()).find((p) => p.id === propertyId)?.location ?? null;

  /** Metadata for a photo taken at the Property a few minutes ago, a few metres from its geocoded point. */
  async function takenAt(propertyId: number, minutes: number): Promise<PhotoMetadata> {
    const location = await locationOf(propertyId);
    return {
      takenAt: exifTime(minutesAgo(minutes), DEMO_TIME_ZONE),
      ...(location ? { gps: { lat: location.lat + 0.00012, lng: location.lng - 0.00009 } } : {}),
    };
  }

  /** The Property Manager confirms the waiting Maintenance Request with this description. Returns the new Ticket's id. */
  async function confirm(pm: PropertyManagerActions, description: string) {
    const request = (await pm.dashboard({ filter: 'all' })).maintenanceRequests.find((r) => r.description === description);
    if (!request) throw new Error(`No Maintenance Request "${description}" is waiting to be confirmed`);
    const ticketId = await pm.confirmMaintenanceRequest(request.issueId);
    await tick();
    return ticketId;
  }

  const job = (pm: PropertyManagerActions, ticketId: number, trade: Trade): JobRef => ({ pm, ticketId, trade });

  async function view(ref: JobRef) {
    const found = (await ref.pm.ticket(ref.ticketId)).jobs.find((j) => j.trade === ref.trade);
    if (!found) throw new Error(`Ticket ${ref.ticketId} has no ${ref.trade} Job`);
    return found;
  }

  async function requestQuotes(ref: JobRef, tradieIds: number[]) {
    await ref.pm.sendQuoteRequests((await view(ref)).jobId, tradieIds);
    await tick();
  }

  /** A Tradie replies to a Quote Request by message; checks it was read as an Estimate at `priceCents`. */
  async function quote(tradieId: number, ref: JobRef, text: string, priceCents: number) {
    await say(tradieId, text);
    const read = (await view(ref)).quotes.find((q) => q.tradieId === tradieId && q.stage === 'estimate');
    if (read?.priceCents !== priceCents) {
      throw new Error(`${person(tradieId).name}'s reply should be a $${priceCents / 100} Estimate on the ${ref.trade} Job, not ${read ? `$${(read.priceCents ?? 0) / 100}` : 'missing'}`);
    }
  }

  /** The token of the Tradie's quote page for this Job, from the link in the Quote Request myEST8 sent them. */
  async function quoteToken(tradieId: number, ref: JobRef) {
    const request = (await view(ref)).quoteRequests.find((r) => r.tradieId === tradieId);
    if (!request) throw new Error(`${person(tradieId).name} has no Quote Request on the ${ref.trade} Job`);
    const p = person(tradieId);
    for (const m of await outbox()) {
      if ((m.to !== p.mobile && m.to !== p.email) || m.template !== 'tradie.quote_request') continue;
      const token = /\/q\/([\w-]+)/.exec(m.text)?.[1];
      if (token && (await app.quotePage(token))?.quoteRequestId === request.quoteRequestId) return token;
    }
    throw new Error(`No quote page link was sent to ${p.name} for the ${ref.trade} Job`);
  }

  /** The Tradie gives an Estimate on their quote page, as their phone would. */
  async function estimate(tradieId: number, ref: JobRef, input: { priceCents: number; needsInspection: boolean; calloutFeeCents?: number }) {
    await app.submitEstimate(await quoteToken(tradieId, ref), input);
    await tick();
  }

  /** The Tradie gives a Firm Quote on their quote page, able to start in two and three days' time. */
  async function firmQuote(tradieId: number, ref: JobRef, input: { priceCents: number; scopeOfWork: string; durationDays: number }) {
    const date = (days: number) => {
      const { year, month, day } = wallClock(new Date(now().getTime() + days * 24 * 60 * MINUTE_MS), DEMO_TIME_ZONE);
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };
    await app.submitFirmQuote(await quoteToken(tradieId, ref), { ...input, availableDates: [date(2), date(3)] });
    await tick();
  }

  /** The Property Manager checks and confirms every Quote waiting on the Job, as read. */
  async function confirmQuotes(ref: JobRef) {
    for (const q of (await view(ref)).quotes.filter((q) => !q.confirmed && q.status === 'open')) await ref.pm.confirmQuote(q.quoteId);
    await tick();
  }

  /** Chooses this Tradie's Firm Quote. Returns what myEST8 sent as a result. */
  async function choose(ref: JobRef, tradieId: number) {
    await confirmQuotes(ref);
    const chosen = (await view(ref)).quotes.find((q) => q.tradieId === tradieId && q.stage === 'firm');
    if (!chosen) throw new Error(`${person(tradieId).name} has no Firm Quote on the ${ref.trade} Job`);
    const sentBefore = (await outbox()).length;
    await ref.pm.chooseQuote(chosen.quoteId);
    await tick();
    return (await outbox()).slice(sentBefore);
  }

  /** Confirms the Job's Estimates and proceeds on this Tradie's with a Not-to-exceed Cap. Returns what myEST8 sent as a result. */
  async function proceed(ref: JobRef, tradieId: number, capCents: number) {
    await confirmQuotes(ref);
    const estimate = (await view(ref)).quotes.find((q) => q.tradieId === tradieId && q.stage === 'estimate');
    if (!estimate) throw new Error(`${person(tradieId).name} has no Estimate on the ${ref.trade} Job`);
    const sentBefore = (await outbox()).length;
    await ref.pm.proceedOnEstimate(estimate.quoteId, { capCents });
    await tick();
    return (await outbox()).slice(sentBefore);
  }

  /** Sends the Work Order for a visit starting at `start`. */
  async function book(ref: JobRef, start: Date, minutes: number) {
    await ref.pm.sendWorkOrder((await view(ref)).jobId, { start: start.toISOString(), durationMinutes: minutes });
    await tick();
  }

  /** The Property Manager books this Tradie's Site Inspection; the Job stays quoting. */
  async function bookInspection(ref: JobRef, tradieId: number, start: Date) {
    const request = (await view(ref)).quoteRequests.find((r) => r.tradieId === tradieId);
    if (!request) throw new Error(`${person(tradieId).name} has no Quote Request on the ${ref.trade} Job`);
    await ref.pm.bookInspection(request.quoteRequestId, { start: start.toISOString() });
    await tick();
    if ((await view(ref)).quoteRequests.find((r) => r.tradieId === tradieId)?.status !== 'inspection_booked') {
      throw new Error(`${person(tradieId).name} should have a Site Inspection booked on the ${ref.trade} Job`);
    }
  }

  async function confirmVisit(tenantId: number, ref: JobRef, text: string) {
    await say(tenantId, text);
    if (!(await view(ref)).workOrder?.visitConfirmed) throw new Error(`"${text}" should have confirmed the visit`);
  }

  async function done(tradieId: number, ref: JobRef, text: string) {
    await say(tradieId, text);
    if ((await view(ref)).status !== 'done') throw new Error(`"${text}" should have marked the ${ref.trade} Job done`);
  }

  async function tenantRates(tenantId: number, ref: JobRef, text: string) {
    await say(tenantId, text);
    const { jobId, workOrder } = await view(ref);
    const rated = (await ref.pm.tradie(workOrder!.tradieId)).ratings.some((r) => r.jobId === jobId && r.source === 'tenant');
    if (!rated) throw new Error(`"${text}" should have been the Tenant's rating`);
  }

  async function rateAndClose(ref: JobRef, score: number) {
    await ref.pm.rateTradie((await view(ref)).jobId, score);
    await ref.pm.closeTicket(ref.ticketId);
    await tick();
    closedTickets++;
  }

  /** A weekday after the stories end, at a local time: `nth` 1 is the next weekday. */
  function upcoming(nth: number, time: string) {
    for (let days = 1, found = 0; ; days++) {
      const candidate = localTime(end, days, time);
      const { weekday } = wallClock(candidate, DEMO_TIME_ZONE);
      if (weekday >= 1 && weekday <= 5 && ++found === nth) return candidate;
    }
  }

  return {
    ids,
    alice,
    bob,
    at,
    upcoming,
    minutesAgo,
    locationOf,
    say,
    sendFrom,
    expectSent,
    expectSentSince,
    tokenIn,
    report,
    upload,
    forwardReimbursement,
    sample,
    photo,
    takenAt,
    confirm,
    job,
    view,
    requestQuotes,
    quote,
    estimate,
    firmQuote,
    confirmQuotes,
    choose,
    proceed,
    book,
    bookInspection,
    confirmVisit,
    done,
    tenantRates,
    rateAndClose,
    advanceTo,

    /** A story's steps, each at a time on a story day. */
    story(name: string) {
      return {
        on(day: number, time: string, what: string, run: () => Promise<unknown>) {
          steps.push({ at: at(day, time), story: name, what, run, order: steps.length });
        },
      };
    },

    /** Plays every step in time order across the stories, moving the clock to each one. */
    async play() {
      steps.sort((a, b) => a.at.getTime() - b.at.getTime() || a.order - b.order);
      const [first] = steps;
      if (first && now() > first.at) throw new Error(`The demo clock must start by ${first.at.toISOString()} to play the stories`);
      for (const step of steps) {
        if (step.at > end) throw new Error(`"${step.what}" in ${step.story} is after the stories end`);
        await advanceTo(step.at);
        try {
          await step.run();
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          throw new Error(`Demo story "${step.story}" failed at "${step.what}": ${message}`, { cause: e });
        }
      }
    },

    async summary(): Promise<StoriesSummary> {
      const dashboard = await alice.dashboard({ filter: 'all' });
      return {
        maintenanceRequests: dashboard.maintenanceRequests.length,
        openTickets: dashboard.tickets.length,
        closedTickets,
        urgentRepairs: dashboard.urgentRepairs.length,
        inbox: dashboard.inbox.length,
        alerts: dashboard.alerts.length,
        upcomingVisits: dashboard.calendar.filter((b) => b.status === 'active').length,
      };
    },
  };
}

/** `time` ("08:30") in the demo's time zone, on the local day `days` after `from`'s. */
function localTime(from: Date, days: number, time: string) {
  const { year, month, day } = wallClock(from, DEMO_TIME_ZONE);
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return zonedInstant(DEMO_TIME_ZONE, year, month, day + days, hour, minute);
}
