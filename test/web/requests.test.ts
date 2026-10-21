import { describe, expect, test } from 'vitest';
import { byUrgency } from '../../src/web/pages/requests.ts';
import { doubtsPhotos, passedChecks, photoCaption, requestFlags, type CheckedRequest } from '../../src/web/request-checks.ts';
import { HOUR } from '../support/harness.ts';
import { upload } from '../support/photos.ts';
import { visible, webWorld } from '../support/web.ts';
import { HANA, KING_ST, TOM, type World } from '../support/world.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;

const clean: CheckedRequest = { checkUrgency: false, checkTrade: false, noPhotos: false, photos: [], imageMatch: null };

describe('the checks on a Maintenance Request', () => {
  test('flags come most serious first, with flagged photos and a mismatch among them', () => {
    const flags = requestFlags({
      checkUrgency: true,
      checkTrade: true,
      noPhotos: false,
      photos: [{ metadata: 'flagged', reasons: ['taken_before_tenancy'] }, { metadata: 'ok', reasons: [] }],
      imageMatch: { result: 'does_not_match', reason: 'The photo shows a fence' },
    });
    expect(flags.map((f) => f.label)).toEqual(["Photos don't match the description", 'Check urgency', 'Check trade', 'Flagged photos']);
    expect(flags[0]).toMatchObject({ tone: 'error', detail: 'The photo shows a fence' });
  });

  test('passed checks are kept apart from the flags, and a clean request has neither', () => {
    const checked: CheckedRequest = { ...clean, photos: [{ metadata: 'ok', reasons: [] }], imageMatch: { result: 'matches', reason: 'Shows the tap' } };
    expect(requestFlags(checked)).toEqual([]);
    expect(passedChecks(checked).map((c) => c.label)).toEqual(['Photos match the description', 'Photo metadata matches the report']);
    expect(passedChecks(clean)).toEqual([]);
  });

  test('missing metadata never counts against the Tenant', () => {
    const checked: CheckedRequest = { ...clean, photos: [{ metadata: 'no_metadata', reasons: [] }] };
    expect(requestFlags(checked)).toEqual([]);
    expect(doubtsPhotos(checked)).toBe(false);
    expect(photoCaption({ metadata: 'no_metadata', reasons: [] })).toBe('No metadata');
    expect(photoCaption({ metadata: 'flagged', reasons: ['far_from_property'] })).toBe('Flagged: taken far from the Property');
  });

  test('a mismatch or a flagged photo puts the photos in doubt', () => {
    expect(doubtsPhotos({ ...clean, imageMatch: { result: 'does_not_match', reason: '' } })).toBe(true);
    expect(doubtsPhotos({ ...clean, photos: [{ metadata: 'flagged', reasons: [] }] })).toBe(true);
    expect(doubtsPhotos({ ...clean, imageMatch: { result: 'unclear', reason: '' } })).toBe(false);
  });

  test('requests rank Urgent, High, then Routine, oldest first within each', () => {
    const ranked = byUrgency([
      { id: 1, urgency: 'routine', reportedAt: '2026-10-10T00:00:00Z' },
      { id: 2, urgency: 'high', reportedAt: '2026-10-12T00:00:00Z' },
      { id: 3, urgency: 'routine', reportedAt: '2026-10-09T00:00:00Z' },
      { id: 4, urgency: 'high', reportedAt: '2026-10-11T00:00:00Z' },
    ]);
    expect(ranked.map((r) => r.id)).toEqual([4, 2, 3, 1]);
  });
});

/** Someone reports an issue and answers every question; returns their photo upload link. */
async function report({ h }: World, from: string, description: string, urgency: 'routine' | 'high' = 'routine') {
  h.classifier.when(description, { messageClass: 'new_issue', relatedItem: 'none', urgency, trade: 'plumbing' });
  await h.receive(from, description);
  await h.answer(from, 'Kitchen sink');
  await h.answer(from, 'Since Monday');
  await h.answer(from, 'No', 'no');
  await h.answer(from, 'Mornings', 'weekday_mornings');
  return h.messenger.last(from)!.data.uploadLink as string;
}

async function page(w: Web, path: string, cookie: string) {
  const res = await w.get(path, cookie);
  expect(res.status).toBe(200);
  return res.text();
}

async function onlyRequest(w: Web) {
  const [request] = await w.alice.requests({ filter: 'all' });
  return request!;
}

describe('the new Maintenance Requests on Tickets', () => {
  test('reads like a docket: the issue, then the address, ranked by Urgency', async () => {
    const w = await webWorld();
    await report(w, HANA, 'The bathroom fan is rattling');
    await w.h.advance(HOUR);
    await report(w, TOM, 'The kitchen tap is pouring water', 'high');
    await w.h.advance(49 * HOUR);

    const full = await page(w, '/tickets?filter=all', await w.signIn());
    // From the list itself: the filter bar above it names every Property.
    const html = visible(full.slice(full.indexOf('class="request-list')));
    const tap = html.indexOf('The kitchen tap is pouring water');
    expect(tap).toBeGreaterThan(-1);
    expect(tap).toBeLessThan(html.indexOf('The bathroom fan is rattling'));
    expect(tap).toBeLessThan(html.indexOf(KING_ST));
  });
});

describe('photos on the Tickets page', () => {
  test("shows each request's first photo beside it, as the dashboard does", async () => {
    const w = await webWorld();
    await w.h.upload(await report(w, TOM, 'The kitchen tap is dripping'), [upload('tap.jpg')]);
    const r = await onlyRequest(w);

    const html = await page(w, '/tickets?filter=all', await w.signIn());
    expect(html).toContain(`src="/files/${r.photos[0]!.fileId}"`);
    expect(visible(html)).not.toContain('Check Urgency');
  });

  test("keeps the issue's first photo beside its Ticket once confirmed, and a quiet placeholder for a request without one", async () => {
    const w = await webWorld();
    await w.h.upload(await report(w, TOM, 'The kitchen tap is dripping'), [upload('tap.jpg'), upload('tap-close.jpg')]);
    const r = await onlyRequest(w);
    const ticketId = await w.alice.confirmMaintenanceRequest(r.issueId);
    await report(w, HANA, 'The bathroom fan is rattling');
    await w.h.advance(49 * HOUR);

    const html = await page(w, '/tickets?filter=all', await w.signIn());
    const row = html.split('<tr>').find((t) => t.includes(`href="/tickets/${ticketId}"`)) ?? '';
    expect(row).toContain(`src="/files/${r.photos[0]!.fileId}"`);
    expect(row).not.toContain(`src="/files/${r.photos[1]!.fileId}"`);
    const fan = html.split('<article').find((a) => a.includes('The bathroom fan is rattling'))?.split('</article>')[0] ?? '';
    expect(fan).toContain('class="issue-thumb-none"');
    expect(fan).not.toContain('<img');
  });
});

describe('the Maintenance Request review', () => {
  test('leads with what the Tenant reported, then the decision, then the answers and photos', async () => {
    const w = await webWorld();
    await w.h.upload(await report(w, TOM, 'The kitchen tap is dripping'), [upload('tap.jpg')]);
    const r = await onlyRequest(w);
    const html = await page(w, `/requests/${r.issueId}`, await w.signIn());
    // From the review itself: the Share panel above it repeats the description.
    const text = visible(html.slice(html.indexOf('class="request-review"')));

    const order = ['Summary', 'The kitchen tap is dripping', KING_ST, 'Decide', 'Photos', 'No metadata', "The Tenant's answers", 'Kitchen sink'];
    const at = order.map((t) => text.indexOf(t));
    expect(at.every((i) => i > -1), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain(`href="/properties/${r.propertyId}"`);

    // The photo check passed: a quiet line, and no "Nothing to check." above it.
    expect(text).toContain('Photos match the description');
    expect(text).not.toContain('Nothing to check.');
    expect(text).not.toContain('What the Tenant reported');
  });

  test('Confirm is the one primary action; Change Urgency comes back to the review and Reject to Tickets', async () => {
    const w = await webWorld();
    await report(w, TOM, 'The kitchen tap is dripping');
    await w.h.advance(48 * HOUR);
    const r = await onlyRequest(w);
    const html = await page(w, `/requests/${r.issueId}`, await w.signIn());

    const review = html.slice(html.indexOf('class="request-review"'));
    expect(review.match(/btn-primary/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<form method="post" action="/requests/${r.issueId}/confirm"`));
    expect(html).toMatch(/<details class="request-reject">\s*<summary>Reject this Maintenance Request…<\/summary>[\s\S]*name="return" value="\/tickets"[\s\S]*name="reason"/);
    expect(html).toMatch(new RegExp(`action="/requests/${r.issueId}/urgency"[^>]*>\\s*<input type="hidden" name="return" value="/requests/${r.issueId}"`));
    expect(visible(html)).toContain('No photos');

    const cookie = await w.signIn();
    const changed = await w.post(`/requests/${r.issueId}/urgency`, { urgency: 'high', return: `/requests/${r.issueId}` }, cookie);
    expect(changed.headers.get('location')).toMatch(new RegExp(`^/requests/${r.issueId}\\?ok=`));
    const rejected = await w.post(`/requests/${r.issueId}/reject`, { reason: 'A new washer fixes this', return: '/tickets' }, cookie);
    expect(rejected.headers.get('location')).toMatch(/^\/tickets\?ok=/);
  });

  test('with flagged photos, Confirm asks first', async () => {
    const w = await webWorld();
    await w.h.upload(await report(w, TOM, 'The kitchen tap is dripping'), [upload('old.jpg', { takenAt: '2024:12:20 10:00:00' })]);
    const r = await onlyRequest(w);
    const html = await page(w, `/requests/${r.issueId}`, await w.signIn());

    expect(visible(html)).toContain('Flagged photos');
    expect(html).toMatch(new RegExp(`<details class="request-confirm-check">[\\s\\S]*action="/requests/${r.issueId}/confirm"[\\s\\S]*Confirm anyway[\\s\\S]*</details>`));
  });
});

describe('the Summary on a Maintenance Request', () => {
  /** A request whose Summary the AI wrote (the test summariser), with one photo sent on the first message. */
  async function summarised() {
    const w = await webWorld();
    await w.h.upload(await report(w, TOM, 'The kitchen tap is dripping'), [upload('tap.jpg')]);
    const r = await onlyRequest(w);
    return { w, r, cookie: await w.signIn() };
  }

  test('leads with the Summary under the "Filled in by AI" label, with a pencil to edit', async () => {
    const { w, r, cookie } = await summarised();
    expect(r.summaryBy).toBe('ai');
    const html = await page(w, `/requests/${r.issueId}`, cookie);
    const text = visible(html.slice(html.indexOf('class="request-review"')));
    expect(text).toContain('Filled in by AI');
    expect(text).toContain(r.summary!);
    expect(text.indexOf('Filled in by AI')).toBeLessThan(text.indexOf('Photos'));
    expect(html).toContain(`href="/requests/${r.issueId}?edit=summary#summary"`);
    expect(html).toContain('aria-label="Edit Summary"');
  });

  test('carries the sparkle before its label, as every AI-written thing does', async () => {
    const { w, r, cookie } = await summarised();
    const html = await page(w, `/requests/${r.issueId}`, cookie);
    expect(html).toMatch(/class="ai-filled-label">\s*<svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>\s*<span>Filled in by AI<\/span>/);
  });

  test('a Summary the Property Manager edited loses the AI label, and Confirm can carry an edit', async () => {
    const { w, r, cookie } = await summarised();
    const form = await page(w, `/requests/${r.issueId}?edit=summary`, cookie);
    expect(form).toContain(`action="/requests/${r.issueId}/summary"`);
    expect(form).toMatch(new RegExp(`<button type="submit" form="summary-form-${r.issueId}" formaction="/requests/${r.issueId}/confirm"`));

    const saved = await w.post(`/requests/${r.issueId}/summary`, { summary: 'Kitchen tap drips onto the cupboard' }, cookie);
    expect(saved.headers.get('location')).toMatch(new RegExp(`^/requests/${r.issueId}\\?ok=`));
    const html = await page(w, `/requests/${r.issueId}`, cookie);
    const text = visible(html.slice(html.indexOf('class="request-review"')));
    expect(text).toContain('Kitchen tap drips onto the cupboard');
    expect(text).not.toContain('Filled in by AI');
    expect((await onlyRequest(w)).summaryBy).toBe('property_manager');

    const blank = await w.post(`/requests/${r.issueId}/summary`, { summary: '   ' }, cookie);
    expect(blank.headers.get('location')).toMatch(/error=/);
  });

  test('Confirm posts an edited Summary with it', async () => {
    const { w, r, cookie } = await summarised();
    const res = await w.post(`/requests/${r.issueId}/confirm`, { summary: 'Tap drips, getting worse' }, cookie);
    expect(res.headers.get('location')).toMatch(/^\/tickets\/\d+\?ok=/);
    const [ticket] = await w.alice.dashboard({ filter: 'all' }).then((d) => d.tickets);
    expect(ticket!.description).toBeTruthy();
  });

  test('the list leads each row with the Summary, and the photo strip names where the photos came from', async () => {
    const { w, r, cookie } = await summarised();
    expect(visible(await page(w, '/tickets?filter=all', cookie))).toContain(r.summary!);
    const text = visible(await page(w, `/requests/${r.issueId}`, cookie));
    expect(text).toMatch(/1 photo, (sent with the message|uploaded)/);
  });
});

describe('following up with the Tenant from the review', () => {
  const NOTES = 'Is it still dripping? Can you turn the water off at the meter?';

  /** A request with one photo, and the review's address and cookie. */
  async function waiting(options: { composer?: null } = {}) {
    const w = await webWorld(options);
    await w.h.upload(await report(w, TOM, 'The kitchen tap is dripping'), [upload('tap.jpg')]);
    const r = await onlyRequest(w);
    return { w, r, base: `/requests/${r.issueId}`, cookie: await w.signIn() };
  }

  /** The follow-up panel's markup, from the page it is on. */
  const panel = (html: string) => html.slice(html.indexOf('id="follow-up"')).split('</section>')[0]!;

  test('shows on a request in intake with the Tenant\'s first name, beside Decide, before anything is drafted', async () => {
    const { w, base, cookie } = await waiting();
    const html = await page(w, base, cookie);

    const side = html.slice(html.indexOf('class="request-side"'), html.indexOf('class="request-details"'));
    expect(visible(side)).toContain('Follow up with Tom');
    expect(visible(side).indexOf('Decide')).toBeLessThan(visible(side).indexOf('Follow up with Tom'));
    expect(html).toContain(`action="${base}/follow-up/draft#follow-up"`);
    expect(visible(panel(html))).toContain('Draft with AI');
    expect(panel(html)).toMatch(/<button[^>]*>\s*<svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>\s*Draft with AI/);
    expect(visible(panel(html))).not.toContain('Send to Tom');
    expect(visible(panel(html))).not.toContain('Written by AI');
  });

  test('drafting shows the editable draft under the sparkle and the AI note, with the notes still in their field', async () => {
    const { w, base, cookie } = await waiting();
    const sent = w.h.messenger.sent.length;

    const res = await w.post(`${base}/follow-up/draft`, { notes: NOTES }, cookie);

    expect(res.status).toBe(200);
    const html = panel(await res.text());
    expect(html).toMatch(/<textarea[^>]*name="notes"[^>]*>\s*Is it still dripping\? Can you turn the water off at the meter\?<\/textarea>/);
    expect(html).toMatch(/<textarea[^>]*name="text"[^>]*>\s*Composed: Is it still dripping\?/);
    expect(html).toMatch(/class="ai-filled-label">\s*<svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>\s*<span>Written by AI\. Check it before you send\.<\/span>/);
    expect(visible(html)).toContain('Send to Tom');
    expect(visible(html)).not.toContain("AI drafting isn't available");
    expect(w.h.messenger.sent).toHaveLength(sent);
  });

  test.each([
    ['the composer fails', { composer: undefined }],
    ['there is no composer', { composer: null }],
  ])('when %s, the notes come back as the draft with the fallback note and no AI mark', async (_, options) => {
    const { w, base, cookie } = await waiting(options as { composer?: null });
    w.h.composer.next = new Error('Claude is down');

    const res = await w.post(`${base}/follow-up/draft`, { notes: NOTES }, cookie);

    expect(res.status).toBe(200);
    const html = panel(await res.text());
    expect(html).toMatch(/<textarea[^>]*name="text"[^>]*>\s*Is it still dripping\?/);
    expect(visible(html)).toContain("AI drafting isn't available right now. Your notes are below: edit them and send, or try again.");
    expect(visible(html)).toContain('Send to Tom');
    expect(visible(html)).not.toContain('Written by AI');
    expect(html).not.toContain('ai-filled');
  });

  test('sending flashes "Follow-up sent to" the Tenant, who gets the text as it was edited', async () => {
    const { w, base, cookie } = await waiting();
    const edited = 'Hi Tom, is the tap still dripping? Please turn the water off at the meter.';

    const res = await w.post(`${base}/follow-up/send`, { notes: NOTES, text: edited }, cookie);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${base}?ok=${encodeURIComponent('Follow-up sent to Tom Tran')}`);
    expect(w.h.messenger.last(TOM)).toMatchObject({ template: 'tenant.follow_up', text: edited });
    expect(visible(await page(w, res.headers.get('location')!, cookie))).toContain('Follow-up sent to Tom Tran');
  });

  test('refuses blank notes with the field error under the notes, and no draft', async () => {
    const { w, base, cookie } = await waiting();

    const res = await w.post(`${base}/follow-up/draft`, { notes: '   ' }, cookie);

    expect(res.status).toBe(400);
    const html = panel(await res.text());
    expect(visible(html)).toContain('Write what you want to say');
    expect(html).toMatch(/<textarea[^>]*name="notes"[^>]*aria-invalid="true"/);
    expect(html).not.toContain('name="text"');
    expect(w.h.composer.calls).toEqual([]);
  });

  test('refuses blank text with the field error under the draft, keeping the notes, and sends nothing', async () => {
    const { w, base, cookie } = await waiting();
    const sent = w.h.messenger.sent.length;

    const res = await w.post(`${base}/follow-up/send`, { notes: NOTES, text: '  ' }, cookie);

    expect(res.status).toBe(400);
    const html = panel(await res.text());
    expect(visible(html)).toContain('Write a message to send');
    expect(html).toMatch(/<textarea[^>]*name="text"[^>]*aria-invalid="true"/);
    expect(html).toContain('Is it still dripping?');
    expect(w.h.messenger.sent).toHaveLength(sent);
  });

  test('a refused send keeps the text that was typed, and does not tint it as the AI\'s', async () => {
    const { w, base, cookie } = await waiting();
    const long = `Hi Tom, ${'x'.repeat(4000)}`;

    const res = await w.post(`${base}/follow-up/send`, { notes: NOTES, text: long }, cookie);

    expect(res.status).toBe(400);
    const html = panel(await res.text());
    expect(visible(html)).toContain('Keep the message to 4000 characters');
    expect(html).toContain(long);
    expect(html).not.toContain('ai-filled');
  });

  test('a request that has left intake sends the Property Manager back with the reason, drafting and sending nothing', async () => {
    const { w, r, base, cookie } = await waiting();
    await w.alice.confirmMaintenanceRequest(r.issueId);
    const sent = w.h.messenger.sent.length;

    const draft = await w.post(`${base}/follow-up/draft`, { notes: NOTES }, cookie);
    const send = await w.post(`${base}/follow-up/send`, { text: NOTES }, cookie);

    for (const res of [draft, send]) {
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toMatch(new RegExp(`^${base}\\?error=`));
    }
    expect(w.h.composer.calls).toEqual([]);
    expect(w.h.messenger.sent).toHaveLength(sent);
  });
});
