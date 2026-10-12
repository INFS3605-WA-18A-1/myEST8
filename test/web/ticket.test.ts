import { describe, expect, test } from 'vitest';
import { formatWhen } from '../../src/web/ui.ts';
import { webWorld } from '../support/web.ts';
import { KING_ST, PETE, TOM, tomsTapTicket, tradieQuotes, type JobRef, type TradieRef } from '../support/world.ts';

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
    await submit(formPosting(html, new RegExp(`/jobs/${ref.jobId}/quote-requests$`)), { tradieIds: [tradie.id] });
    await tradieQuotes(w, ref, tradie, text, read);
  }

  /** Pete quotes, Alice confirms it and goes ahead with his single Quote. */
  async function approvePete(priceCents: number, proposedTime?: Date) {
    await quoteFrom(w.tradies.pete, `Pete quotes ${priceCents}`, { priceCents, proposedTime });
    const confirmed = await submit(formPosting((await open()).html, /\/confirm$/), {
      price: priceCents / 100,
      proposedTime: proposedTime ? '2026-10-13T09:00' : '',
    });
    return submit(formPosting(confirmed.page.html, /\/choose$/), { reason: 'Our usual plumber' });
  }

  return { w, job, cookie, path, open, submit, quoteFrom, approvePete };
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
    // Ranked by myEST8 rating, then Google rating, then name; the electrician isn't recommended for plumbing.
    const ranked = ['1. Drip Doctors', "2. Pete's Plumbing", "3. Nina's Plumbing", '4. Quick Pipes', '5. Flow Bros'].map((t) => text.indexOf(t));
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
    expect(sent.page.text).toMatch(/Tradie Sent Status Pete's Plumbing .*Sent Quick Pipes .*Sent Drip Doctors .*Sent/);
    expect(sent.page.text.match(/Already asked/g)).toHaveLength(3);
    expect(sent.page.text).toContain("Pete's Plumbing, Quick Pipes, Drip Doctors");
  });

  test('are refused with no Tradie ticked, or for a Tradie already asked', async () => {
    const { w, open, submit } = await tapTicket();
    const action = formPosting((await open()).html, /\/quote-requests$/);

    expect((await submit(action, {})).error).toBe('Choose at least one Tradie');
    await submit(action, { tradieIds: [w.tradies.pete.id] });
    const again = await submit(action, { tradieIds: [w.tradies.pete.id] });

    expect(again.error).toBe("Pete's Plumbing has already been asked to quote");
    expect(again.page.text).toContain("Pete's Plumbing has already been asked to quote");
  });
});

describe('Quotes', () => {
  test('a read Quote is corrected and confirmed, needs a reason while it is the only one, and is then approved', async () => {
    const { w, open, submit, quoteFrom } = await tapTicket();
    await quoteFrom(w.tradies.pete, 'Can do $150, Tuesday 9am', { priceCents: 150_00, proposedTime: TUE_9AM });

    const read = await open();
    expect(read.text).toContain('Needs checking');
    expect(read.text).toContain('$150.00');
    expect(read.html).toContain('value="2026-10-13T09:00"');

    const confirmed = await submit(formPosting(read.html, /\/confirm$/), { price: '180', proposedTime: '2026-10-13T10:00' });
    expect(confirmed.ok).toBe("Quote from Pete's Plumbing confirmed at $180.00");
    expect(confirmed.page.text).toContain('Confirmed');
    expect(confirmed.page.text).toContain(`Proposed time: ${when(sydney('2026-10-13T10:00:00'))}`);
    expect(confirmed.page.text).toContain('myEST8 needs two confirmed Quotes before you choose one');

    const choose = formPosting(confirmed.page.html, /\/choose$/);
    const refused = await submit(choose, {});
    expect(refused.error).toBe('Choose a Quote once the Job has at least two confirmed Quotes, or record why you are going ahead with one');

    const approved = await submit(choose, { reason: 'Only plumber free this week' });
    expect(approved.ok).toBe("Quote from Pete's Plumbing chosen and approved");
    expect(approved.page.text).toContain('Approved');
    expect(approved.page.text).toContain('Chosen with one Quote: Only plumber free this week');
    expect(approved.page.text).toContain("Quote from Pete's Plumbing approved");
    expect(approved.page.text).toContain('Repair Cost $180.00');
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
    expect(asked.text).toContain(`From ${PETE} · SMS`);
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
