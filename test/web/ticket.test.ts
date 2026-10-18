import { describe, expect, test } from 'vitest';
import { formatWhen } from '../../src/web/ui.ts';
import { webWorld } from '../support/web.ts';
import { confirmedEstimates, confirmedQuotes, DANA, KING_ST, PETE, quoteToken, TOM, tomsTapTicket, tradieQuotes, type JobRef, type TradieRef } from '../support/world.ts';

const sydney = (local: string) => new Date(`${local}+11:00`);
const TUE_9AM = sydney('2026-10-13T09:00:00');
const TIME_ZONE = 'Australia/Sydney';

type Web = Awaited<ReturnType<typeof webWorld>>;

/** Collapses every kind of space, including the narrow one Intl puts before "am". */
const squash = (s: string) => s.replace(/\s+/g, ' ');
const when = (at: Date) => squash(formatWhen(at.toISOString(), TIME_ZONE));

/** What a person reads on the page: tags dropped, entities decoded. */
function visibleText(page: string) {
  return squash(
    page
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&'),
  );
}

/** The action of the first form on the page posting to a path matching `pattern`: what a person would submit. */
function formPosting(page: string, pattern: RegExp) {
  const action = [...page.matchAll(/<form\b[^>]*\baction="([^"]+)"/g)].map((m) => m[1]!).find((a) => pattern.test(a));
  if (!action) throw new Error(`No form on the page posts to ${pattern}`);
  return action;
}

/** The header's Next step: its words, where it links, and whether it waits on the Property Manager. */
function nextStepOf(page: string) {
  const m = /<p class="ticket-next ?(is-decision)?" data-next-step>([\s\S]*?)<\/p>/.exec(page);
  if (!m) return null;
  return { text: visibleText(m[2]!).trim(), href: /href="([^"]+)"/.exec(m[2]!)?.[1], decision: m[1] === 'is-decision' };
}

/** Alice, signed in, looking at Tom's dripping tap Ticket. */
async function tapTicket() {
  const w = await webWorld();
  const job = await tomsTapTicket(w);
  const cookie = await w.signIn();
  const path = `/tickets/${job.ticketId}`;

  async function open(at = path) {
    const res = await w.get(at, cookie);
    expect(res.status).toBe(200);
    const html = await res.text();
    return { html, text: visibleText(html) };
  }

  /** Submits a form and follows the redirect, as the browser would. */
  async function submit(action: string, fields: Record<string, string | number | (string | number)[]> = {}) {
    const res = await w.post(action, fields, cookie);
    expect(res.status).toBe(303);
    const location = res.headers.get('location')!;
    const query = new URL(location, 'https://myest8.test').searchParams;
    return { location, ok: query.get('ok'), error: query.get('error'), page: await open(location) };
  }

  /** Quote Requests go to `tradie`, who quotes; the quote reader reads `read`. */
  async function quoteFrom(tradie: TradieRef, text: string, read: { priceCents?: number; proposedTime?: Date }, ref: JobRef = job) {
    const { html } = await open();
    // Two Tradies are asked unless the Job has Requests out already; the second stays silent.
    const rule = (await w.alice.ticket(ref.ticketId)).jobs.find((j) => j.jobId === ref.jobId)!.requestRule;
    const silent = rule && rule.minimum > 1 ? [(w.tradies.dana.id === tradie.id ? w.tradies.finn : w.tradies.dana).id] : [];
    await submit(formPosting(html, new RegExp(`/jobs/${ref.jobId}/quote-requests$`)), { tradieIds: [tradie.id, ...silent] });
    await tradieQuotes(w, ref, tradie, text, read);
  }

  /** The Tradie posts a Firm Quote on their quote page, as their phone would. */
  async function firmFrom(tradie: TradieRef, fields: { price: string; proposedTime?: string; ref?: JobRef }) {
    const token = await quoteToken(w, fields.ref ?? job, tradie);
    const body = new FormData();
    body.set('price', fields.price);
    body.set('scopeOfWork', 'Replace the washer and reseat the tap');
    body.set('durationDays', '1');
    body.append('availableDates', '2026-10-13');
    body.set('proposedTime', fields.proposedTime ?? '');
    const res = await w.web.request(`/q/${token}/firm`, { method: 'POST', body });
    expect(res.status).toBe(303);
    await w.h.drain();
  }

  /** Pete gives an Estimate by SMS, Alice confirms it, Pete gives his Firm Quote, and Alice goes ahead with his single Firm Quote. */
  async function approvePete(priceCents: number, proposedTime?: Date) {
    await quoteFrom(w.tradies.pete, `Pete quotes ${priceCents}`, { priceCents, proposedTime });
    await submit(formPosting((await open()).html, /\/confirm$/), { price: priceCents / 100, proposedTime: proposedTime ? '2026-10-13T09:00' : '' });
    await firmFrom(w.tradies.pete, { price: String(priceCents / 100), proposedTime: proposedTime ? '2026-10-13T09:00' : '' });
    return submit(formPosting((await open()).html, /\/choose$/), { reason: 'Our usual plumber' });
  }

  return { w, job, cookie, path, open, submit, quoteFrom, firmFrom, approvePete };
}

describe('the Ticket view', () => {
  test('shows the Ticket, what the Tenant reported, the Repair Cost against the Max Repair Cost, and ranked Tradies with both ratings', async () => {
    const { open } = await tapTicket();

    const { text } = await open();

    expect(text).toContain(KING_ST);
    expect(text).toContain('Tom Tran');
    expect(text).toContain('The kitchen tap is dripping');
    expect(text).toContain('Kitchen sink');
    expect(text).toContain('No photos arrived within 48 hours.');
    expect(text).toContain('Routine');
    expect(text).toContain('Plumbing Job');
    expect(text).toContain('Max Repair Cost $500.00');
    // No Repair Cost until a Quote is approved.
    expect(text).not.toContain('Repair Cost $0.00');
    // The Nominated Tradie first, then by myEST8 rating, Google rating, then name; four at most, and the electrician isn't recommended for plumbing.
    const ranked = ["1. Nina's Plumbing", '2. Drip Doctors', "3. Pete's Plumbing", '4. Quick Pipes'].map((t) => text.indexOf(t));
    expect(ranked.every((at, i) => at > -1 && (i === 0 || at > ranked[i - 1]!))).toBe(true);
    expect(text).not.toContain('Sparky Sam');
    expect(text).toContain('myEST8 5.0 (1 rating) Not on Google');
    expect(text).toContain('myEST8 4.0 (1 rating) Google 4.8 (120 reviews)');
    expect(text).toContain('Reported by the Tenant');
    expect(text).toContain('Confirmed as a Ticket');
    expect(text).toContain(`From ${TOM}`);
  });

  test('an unknown Ticket is not found', async () => {
    const { w, cookie } = await tapTicket();

    for (const path of ['/tickets/9999', '/tickets/not-a-number']) {
      const res = await w.get(path, cookie);
      expect(res.status).toBe(404);
      expect(visibleText(await res.text())).toContain('Ticket not found');
    }
  });
});

describe('Quote Requests', () => {
  test('go to the ticked Tradies in one action and are listed with their status', async () => {
    const { w, open, submit } = await tapTicket();
    const { pete, quick, dana } = w.tradies;
    const { html } = await open();

    const sent = await submit(formPosting(html, /\/quote-requests$/), { tradieIds: [pete.id, quick.id, dana.id] });

    expect(sent.ok).toBe('Quote Requests sent to 3 Tradies');
    expect(sent.page.text).toContain('Quote Requests sent to 3 Tradies');
    expect(sent.page.text).toContain('3 asked: 0 gave an Estimate, 3 waiting on a reply.');
    expect(sent.page.text).toMatch(/Pete's Plumbing No reply yet, asked just now Quick Pipes No reply yet, asked just now Drip Doctors No reply yet, asked just now/);
    expect(sent.page.text.match(/Already asked/g)).toHaveLength(3);
    expect(sent.page.text).toContain("Pete's Plumbing, Quick Pipes, Drip Doctors");
  });

  test('are refused with no Tradie ticked, or for a Tradie already asked', async () => {
    const { w, open, submit } = await tapTicket();
    const action = formPosting((await open()).html, /\/quote-requests$/);

    expect((await submit(action, {})).error).toBe('Choose at least one Tradie');
    const refused = await submit(action, { tradieIds: [w.tradies.pete.id] });
    expect(refused.error).toBe('Send Quote Requests to at least two Tradies');
    await submit(action, { tradieIds: [w.tradies.pete.id, w.tradies.dana.id] });
    const again = await submit(action, { tradieIds: [w.tradies.pete.id] });

    expect(again.error).toBe("Pete's Plumbing has already been asked to quote");
    expect(again.page.text).toContain("Pete's Plumbing has already been asked to quote");
  });
});

describe('Quotes', () => {
  test('a read Estimate is corrected and confirmed; a single Firm Quote needs a reason, and is then approved', async () => {
    const { w, open, submit, quoteFrom, firmFrom } = await tapTicket();
    await quoteFrom(w.tradies.pete, 'Can do $150, Tuesday 9am', { priceCents: 150_00, proposedTime: TUE_9AM });

    const read = await open();
    expect(read.text).toContain('Needs checking');
    expect(read.text).toContain('$150.00');
    expect(read.html).toContain('value="2026-10-13T09:00"');

    const confirmed = await submit(formPosting(read.html, /\/confirm$/), { price: '180', proposedTime: '2026-10-13T10:00' });
    expect(confirmed.ok).toBe("Quote from Pete's Plumbing confirmed at $180.00");
    expect(confirmed.page.text).toContain('Confirmed');
    expect(confirmed.page.text).toContain(when(sydney('2026-10-13T10:00:00')));
    // An Estimate is never chosen: it offers no Choose, only (folded) Proceed on Estimate.
    expect(confirmed.page.html).not.toMatch(/\/choose"/);
    expect(confirmed.page.text).toContain('Proceed on Estimate');

    await firmFrom(w.tradies.pete, { price: '190' });
    const firm = await open();
    expect(firm.text).toContain('myEST8 needs two Firm Quotes before you choose one');
    expect(firm.text).toContain('Superseded by Firm Quote');
    const choose = formPosting(firm.html, /\/choose$/);
    const refused = await submit(choose, {});
    expect(refused.error).toBe('Choose a Firm Quote once the Job has at least two, or record why you are going ahead with one');

    const approved = await submit(choose, { reason: 'Only plumber free this week' });
    expect(approved.ok).toBe("Quote from Pete's Plumbing chosen and approved");
    expect(approved.page.text).toContain('Approved');
    expect(approved.page.text).toContain('Gone ahead with one Quote: Only plumber free this week');
    expect(approved.page.text).toContain("Quote from Pete's Plumbing chosen and approved");
    expect(approved.page.text).toContain('Repair Cost $190.00');
  });

  test('a routine Job proceeds on an Estimate with a Not-to-exceed Cap', async () => {
    const { w, job, open, submit } = await tapTicket();
    await confirmedEstimates(w, job, [
      [w.tradies.pete, 120_00],
      [w.tradies.dana, 140_00],
    ]);
    const page = await open();
    const proceed = formPosting(page.html, /\/proceed$/);

    expect((await submit(proceed, { cap: '100' })).error).toBe("The Not-to-exceed Cap can't be below the Estimate of $120.00");
    const done = await submit(proceed, { cap: '150' });

    expect(done.ok).toBe("Proceeding on Pete's Plumbing's Estimate, capped at $150.00");
    expect(done.page.text).toContain('Capped at $150.00');
    expect(done.page.text).toContain("Proceeding on Pete's Plumbing's Estimate");
    expect(done.page.text).toContain('Repair Cost $150.00');
  });

  test('a Quote over the Max Repair Cost goes to the Property Owner, and the page says what they were asked', async () => {
    const { approvePete } = await tapTicket();

    const chosen = await approvePete(600_00);

    expect(chosen.ok).toBe(
      "Quote from Pete's Plumbing chosen. It takes the Repair Cost over the Max Repair Cost, so the Property Owner has been asked to approve it.",
    );
    expect(chosen.page.text).toContain('Property Owner approval Requested');
    expect(chosen.page.text).toContain(
      "to approve Pete's Plumbing's Quote of $600.00, which takes the Repair Cost to $600.00, over the Max Repair Cost of $500.00.",
    );
  });
});

describe('Work Orders', () => {
  test('are sent with a picked start and length, and the visit shows on the Job', async () => {
    const { open, submit, approvePete } = await tapTicket();
    await approvePete(150_00);

    const ready = await open();
    // The Job's stage in the words every screen uses.
    expect(ready.text).toContain('Plumbing Job Ready to book');
    expect(ready.text).toContain("Pete's Plumbing's Quote of $150.00 is approved.");
    expect(ready.text).toContain('The Quote has no proposed time. Pick one.');
    const action = formPosting(ready.html, /\/work-order$/);

    expect((await submit(action, { start: '2026-10-01T10:00', hours: 2 })).error).toBe('Pick a start time in the future');
    const sent = await submit(action, { start: '2026-10-13T10:00', hours: 3 });

    expect(sent.ok).toBe(`Work Order sent to Pete's Plumbing for ${formatWhen(sydney('2026-10-13T10:00:00').toISOString(), TIME_ZONE)}`);
    expect(sent.page.text).toContain('Booked');
    expect(sent.page.text).toContain(`Visit ${when(sydney('2026-10-13T10:00:00'))} – 1:00 pm`);
    expect(sent.page.text).toContain('Not confirmed yet');
    expect(sent.page.text).toContain("Work Order sent to Pete's Plumbing");
  });

  test("a Tradie's request for another time is highlighted, and a suggested time is accepted in one click", async () => {
    const { w, path, open, submit, approvePete } = await tapTicket();
    await approvePete(150_00, TUE_9AM);
    await submit(formPosting((await open()).html, /\/work-order$/), { start: '2026-10-13T09:00', hours: 2 });
    const workOrderId = /\?suggest=(\d+)/.exec((await open()).html)![1]!;

    w.h.classifier.when("Can't make Tuesday sorry", { replyType: 'reschedule_request', relatedItem: `work_order:${workOrderId}` });
    await w.h.receive(PETE, "Can't make Tuesday sorry");

    const asked = await open();
    expect(asked.text).toContain('The Tradie asked for another time.');
    expect(asked.text).toContain(`From ${PETE} by SMS`);
    expect(asked.text).toContain('Unread');
    const suggestions = await open(`${path}?suggest=${workOrderId}`);
    expect(suggestions.text).toContain('New times');
    const [first] = [...suggestions.html.matchAll(/name="start" value="([^"]+)"/g)].map((m) => m[1]!);

    const moved = await submit(formPosting(suggestions.html, /\/accept$/), { start: first! });

    expect(moved.ok).toBe(`Visit moved to ${formatWhen(first!, TIME_ZONE)}. Pete's Plumbing and the Tenant have been told.`);
    expect(moved.page.text).not.toContain('The Tradie asked for another time.');
    expect(moved.page.text).toContain('Visit moved');

    const picked = await submit(formPosting(suggestions.html, /\/accept$/), { local: '2026-10-14T14:00' });
    expect(picked.ok).toContain(`Visit moved to ${formatWhen(sydney('2026-10-14T14:00:00').toISOString(), TIME_ZONE)}`);

    const read = await submit(formPosting(picked.page.html, /\/read$/));
    expect(read.ok).toBe('Messages marked read');
    expect(read.page.text).not.toMatch(/Unread(?! messages)/);
  });

  test('once the Tradie replies done, the Property Manager rates them', async () => {
    const { w, open, submit, approvePete } = await tapTicket();
    await approvePete(150_00, TUE_9AM);
    await submit(formPosting((await open()).html, /\/work-order$/), {});
    const workOrderId = /\?suggest=(\d+)/.exec((await open()).html)![1]!;
    w.h.classifier.when('All done', { replyType: 'done', relatedItem: `work_order:${workOrderId}` });
    await w.h.receive(PETE, 'All done');

    const done = await open();
    expect(done.text).toContain("Pete's Plumbing finished the Job");
    const rated = await submit(formPosting(done.html, /\/rate$/), { score: 4 });

    expect(rated.ok).toBe("Pete's Plumbing rated 4 out of 5");
    expect(rated.page.text).toContain("Pete's Plumbing was rated 4 out of 5.");
  });
});

describe('changing the Ticket', () => {
  test('Urgency is High or Routine, never Urgent', async () => {
    const { path, submit } = await tapTicket();

    const urgent = await submit(`${path}/urgency`, { urgency: 'urgent' });
    expect(urgent.error).toBe('Urgent issues are Urgent Repairs, which the Tenant arranges. A Ticket can be High or Routine.');

    const high = await submit(`${path}/urgency`, { urgency: 'high' });
    expect(high.ok).toBe('Urgency changed to High');
    expect(high.page.text).toContain('Urgency changed to High');
  });

  test('the Trade changes before Quote Requests go out, and another Job can be added', async () => {
    const { path, open, submit } = await tapTicket();

    const changed = await submit(formPosting((await open()).html, /\/trade$/), { trade: 'electrical' });
    expect(changed.ok).toBe('Trade changed to Electrical');
    expect(changed.page.text).toContain('1. Sparky Sam');

    expect((await submit(`${path}/jobs`, { trade: 'gardening' })).error).toBe('Choose a Trade from the list');
    const added = await submit(`${path}/jobs`, { trade: 'carpentry' });
    expect(added.ok).toBe('Carpentry Job added');
    expect(added.page.text).toContain('Job 2: Carpentry');
    expect(added.page.text).toContain('No Tradies in the Agency do carpentry work yet.');
  });

  test('closing is refused while a Job is open, and works once it is cancelled', async () => {
    const { path, open, submit } = await tapTicket();

    const page = await open();
    expect(page.text).toContain('Close once every Job is done or cancelled (1 still open).');
    // Close Ticket is offered only once it can work.
    expect(page.text).not.toContain('Close Ticket');
    const refused = await submit(`${path}/close`);
    expect(refused.error).toBe('Every Job must be done or cancelled before the Ticket closes');

    const cancelled = await submit(formPosting(page.html, /\/cancel$/));
    expect(cancelled.ok).toBe('Plumbing Job cancelled');
    const closed = await submit(formPosting(cancelled.page.html, /\/close$/));

    expect(closed.ok).toBe('Ticket closed. The Tenant and Property Owner have been told.');
    expect(closed.page.text).toContain('Ticket closed');
    expect(closed.page.text).not.toContain('Add another Job');
  });
});

describe('the Next step', () => {
  test('asks for Quote Requests first, then says who has not replied yet', async () => {
    const { w, job, open, submit } = await tapTicket();

    const fresh = await open();
    expect(nextStepOf(fresh.html)).toEqual({ text: 'Next Send Quote Requests', href: `#job-${job.jobId}-tradies`, decision: true });

    const sent = await submit(formPosting(fresh.html, /\/quote-requests$/), { tradieIds: [w.tradies.pete.id, w.tradies.dana.id] });
    expect(nextStepOf(sent.page.html)).toEqual({
      text: "Next Waiting on Estimates from Pete's Plumbing and Drip Doctors, asked just now",
      href: `#job-${job.jobId}-requests`,
      decision: false,
    });
  });

  test('while Quotes need checking, names them and links to the comparison', async () => {
    const { w, job, open, quoteFrom } = await tapTicket();
    await quoteFrom(w.tradies.pete, 'Pete can do $150', { priceCents: 150_00 });
    await quoteFrom(w.tradies.dana, 'Dana can do $180', { priceCents: 180_00 });

    const page = await open();

    expect(nextStepOf(page.html)).toEqual({
      text: "Next Check 2 Quotes from Pete's Plumbing and Drip Doctors",
      href: `#job-${job.jobId}-quotes`,
      decision: true,
    });
    expect(page.html).toContain(`id="job-${job.jobId}-quotes"`);
    // Each unchecked Quote folds its correct-and-confirm form under "Check and confirm".
    expect(page.html.match(/<details class="quote-check">\s*<summary[^>]*>Check and confirm<\/summary>/g)).toHaveLength(2);
    expect(page.text).toContain('0 Firm Quotes, 2 Estimates, 2 to check.');
    expect(page.text).toContain('2 asked: 2 gave an Estimate, 0 waiting on a reply.');
    expect(page.text).toMatch(/Pete's Plumbing Estimate in, asked/);
  });

  test('with two Firm Quotes, asks for a choice and compares them with both ratings, apart from the Estimates', async () => {
    const { w, job, open } = await tapTicket();
    await confirmedQuotes(w, job, [
      [w.tradies.pete, 150_00],
      [w.tradies.dana, 180_00],
    ]);

    const page = await open();

    expect(nextStepOf(page.html)).toEqual({ text: 'Next Choose a Firm Quote: 2 in', href: `#job-${job.jobId}-quotes`, decision: true });
    expect(page.text).toMatch(
      /Firm Quotes for the Plumbing Job Tradie Price Scope of work Takes Can start Proposed time Ratings Action Pete's Plumbing Confirmed \$150\.00 Replace the washer and reseat the tap 1 day Thu, 15 Oct None given myEST8 4\.0 Google 4\.8 Choose this Quote/,
    );
    expect(page.text).toMatch(/Estimates Ballparks .* Pete's Plumbing Confirmed \$150\.00 Not needed None given myEST8 4\.0 Google 4\.8 Superseded by Firm Quote/);
    expect(page.text.match(/Choose this Quote/g)).toHaveLength(2);
    // The Quotes that came in one after another are one line in the timeline.
    expect(page.text).toContain("Estimates received from Pete's Plumbing and Drip Doctors");
    expect(page.text).toContain("Firm Quotes received from Pete's Plumbing and Drip Doctors");
  });

  test('waits on the Property Owner while they decide, then on the booked visit', async () => {
    const owner = await tapTicket();
    await owner.approvePete(600_00);
    expect(nextStepOf((await owner.open()).html)).toEqual({
      text: 'Next Waiting on the Property Owner to approve $600.00',
      href: `#job-${owner.job.jobId}-approval`,
      decision: false,
    });

    const { job, open, submit, approvePete } = await tapTicket();
    await approvePete(150_00, TUE_9AM);
    expect(nextStepOf((await open()).html)?.text).toBe("Next Send the Work Order to Pete's Plumbing");
    const booked = await submit(formPosting((await open()).html, /\/work-order$/), { start: '2026-10-13T09:00', hours: 2 });

    expect(nextStepOf(booked.page.html)).toEqual({
      text: `Next Visit ${when(TUE_9AM)} with Pete's Plumbing`,
      href: `#job-${job.jobId}-work-order`,
      decision: false,
    });
    // Once a Quote is approved the Repair Cost shows.
    expect(booked.page.text).toContain('Repair Cost $150.00');
  });

  test('says to close the Ticket once no Job is open', async () => {
    const { open, submit } = await tapTicket();

    const cancelled = await submit(formPosting((await open()).html, /\/cancel$/));

    expect(nextStepOf(cancelled.page.html)).toEqual({ text: 'Next Close the Ticket: every Job is cancelled', href: '#close-ticket', decision: true });
    expect(cancelled.page.html).toContain('id="close-ticket"');
  });
});

describe('Site Inspections, per Tradie', () => {
  /** Pete and Dana are asked; Pete gives an Estimate needing no visit, Dana one that needs a Site Inspection. */
  async function danaInspects() {
    const t = await tapTicket();
    await t.w.alice.sendQuoteRequests(t.job.jobId, [t.w.tradies.pete.id, t.w.tradies.dana.id]);
    await t.w.h.app.submitEstimate(await quoteToken(t.w, t.job, t.w.tradies.pete), { priceCents: 150_00, needsInspection: false });
    await t.w.h.app.submitEstimate(await quoteToken(t.w, t.job, t.w.tradies.dana), { priceCents: 300_00, needsInspection: true, calloutFeeCents: 80_00 });
    return t;
  }

  test('a Tradie who needs one leads the Next block, with a booking form for them alone', async () => {
    const { job, open } = await danaInspects();

    const page = await open();

    expect(nextStepOf(page.html)).toEqual({ text: 'Next Book a Site Inspection with Drip Doctors', href: `#job-${job.jobId}-inspections`, decision: true });
    expect(page.text).toContain('Site Inspections');
    expect(page.text).toContain('Drip Doctors needs a Site Inspection');
    expect(page.text).not.toContain("Pete's Plumbing needs a Site Inspection");
    expect(page.html).toMatch(/name="start" [^>]*value="[\dT:-]+"/);
    expect(page.text).toContain('Needed (Call-out Fee $80.00)');
    // The stage tracker has no separate site quoting stage any more.
    expect(page.text).toMatch(/Quoting \(this step\) With Property Owner Ready to book Booked Done/);
  });

  test('booking lists the visit; marking it done asks the Tradie for the Firm Quote', async () => {
    const { w, open, submit } = await danaInspects();

    const booked = await submit(formPosting((await open()).html, /\/inspection$/), { start: '2026-10-19T09:00' });

    expect(booked.ok).toBe('Site Inspection booked with Drip Doctors. They and the Tenant have been told.');
    expect(booked.page.text).toContain(`${when(sydney('2026-10-19T09:00:00'))} – 10:00 am`);
    expect(booked.page.text).toContain('Drip Doctors Site inspection');
    expect(booked.page.text).toContain('Plumbing Job Quoting');
    expect(nextStepOf(booked.page.html)?.decision).toBe(false);

    const done = await submit(formPosting(booked.page.html, /\/inspected$/));
    expect(done.ok).toBe("Drip Doctors's Site Inspection marked done. They have been asked for their Firm Quote.");
    expect(w.h.messenger.last(DANA)!.template).toBe('tradie.firm_quote_request');
    expect(done.page.text).toContain('Inspected, Firm Quote to come');
  });

  test('the Property Manager can say a Site Inspection is not needed after all', async () => {
    const { w, job, open, submit } = await danaInspects();
    const dana = (await w.alice.ticket(job.ticketId)).jobs[0]!.quoteRequests.find((r) => r.tradieId === w.tradies.dana.id)!;

    const changed = await submit(formPosting((await open()).html, new RegExp(`/quote-requests/${dana.quoteRequestId}/inspection-needed$`)), { needed: 'no' });

    expect(changed.ok).toBe('Drip Doctors can give a Firm Quote without a Site Inspection');
    expect(changed.page.text).not.toContain('Drip Doctors needs a Site Inspection');
    expect(changed.page.text).toContain('(set by you)');
  });
});

describe('the Summary and comparison prices', () => {
  test('the Summary is edited from the header', async () => {
    const { open, submit } = await tapTicket();

    const saved = await submit(formPosting((await open()).html, /\/summary$/), { summary: 'Kitchen tap drips overnight' });

    expect(saved.ok).toBe('Summary saved');
    expect(saved.page.text).toContain('Kitchen tap drips overnight');
    expect((await submit(formPosting(saved.page.html, /\/summary$/), { summary: ' ' })).error).toBeTruthy();
  });

  test('Estimates and Firm Quotes sit in their own tables, never one price column', async () => {
    const { w, job, open } = await tapTicket();
    await confirmedQuotes(w, job, [
      [w.tradies.pete, 150_00],
      [w.tradies.dana, 180_00],
    ]);

    const page = await open();

    expect(page.html.match(/<caption class="sr-only">Firm Quotes for the Plumbing Job<\/caption>/g)).toHaveLength(1);
    expect(page.html.match(/<caption class="sr-only">Estimates for the Plumbing Job<\/caption>/g)).toHaveLength(1);
    expect(page.text).not.toContain('After visit');
  });
});

describe('the message log', () => {
  test('shows the latest messages with the older ones folded, and links by what they are', async () => {
    const { open } = await tapTicket();

    const { html, text } = await open();

    const total = Number(/Show all (\d+) messages/.exec(text)?.[1]);
    expect(total).toBeGreaterThan(6);
    expect(html).toMatch(/<a class="link" href="https?:\/\/[^"]+\/u\/[^"]+"[^>]*>upload link<\/a>/);
    expect(text).not.toMatch(/https?:\/\/\S+\/u\//);
  });

  test('shows when WhatsApp could not deliver a message', async () => {
    const w = await webWorld();
    w.h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await w.h.receive(TOM, 'The kitchen tap is dripping', { channel: 'whatsapp' });
    await w.h.answer(TOM, 'Kitchen sink', 'answer', { channel: 'whatsapp' });
    await w.h.answer(TOM, 'Since Monday', 'answer', { channel: 'whatsapp' });
    await w.h.answer(TOM, 'No', 'no', { channel: 'whatsapp' });
    await w.h.answer(TOM, 'Mornings', 'weekday_mornings', { channel: 'whatsapp' });
    await w.h.advance(48 * 3_600_000);
    await w.h.app.recordDeliveryFailure({ to: TOM, code: 131047, title: 'Re-engagement message' });
    const [request] = (await w.alice.dashboard()).maintenanceRequests;
    const ticketId = await w.alice.confirmMaintenanceRequest(request!.issueId);

    const { text } = await (async () => {
      const cookie = await w.signIn();
      const res = await w.get(`/tickets/${ticketId}`, cookie);
      expect(res.status).toBe(200);
      const html = await res.text();
      return { text: visibleText(html) };
    })();

    expect(text).toContain("WhatsApp couldn't deliver this message (131047): Re-engagement message");
  });
});
