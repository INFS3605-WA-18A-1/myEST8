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
    expect(flags.map((f) => f.label)).toEqual(["Photos don't match the description", 'Check Urgency', 'Check Trade', 'Flagged photos']);
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

describe('the Requests list', () => {
  test('reads like a docket: the issue, then the address, ranked by Urgency', async () => {
    const w = await webWorld();
    await report(w, HANA, 'The bathroom fan is rattling');
    await w.h.advance(HOUR);
    await report(w, TOM, 'The kitchen tap is pouring water', 'high');
    await w.h.advance(49 * HOUR);

    const html = visible(await page(w, '/requests?filter=all', await w.signIn()));
    const tap = html.indexOf('The kitchen tap is pouring water');
    expect(tap).toBeGreaterThan(-1);
    expect(tap).toBeLessThan(html.indexOf('The bathroom fan is rattling'));
    expect(tap).toBeLessThan(html.indexOf(KING_ST));
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

    const order = ['What the Tenant reported', 'The kitchen tap is dripping', KING_ST, 'Checks', 'Decide', "The Tenant's answers", 'Kitchen sink', 'No metadata'];
    const at = order.map((t) => text.indexOf(t));
    expect(at.every((i) => i > -1), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain(`href="/properties/${r.propertyId}"`);

    // The photo check passed: a quiet line, and no "Nothing to check." above it.
    expect(text).toContain('Photos match the description');
    expect(text).not.toContain('Nothing to check.');
  });

  test('Confirm is the one primary action; Reject and Change Urgency come back to Requests', async () => {
    const w = await webWorld();
    await report(w, TOM, 'The kitchen tap is dripping');
    await w.h.advance(48 * HOUR);
    const r = await onlyRequest(w);
    const html = await page(w, `/requests/${r.issueId}`, await w.signIn());

    const review = html.slice(html.indexOf('class="request-review"'));
    expect(review.match(/btn-primary/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<form method="post" action="/requests/${r.issueId}/confirm">`));
    expect(html).toMatch(/<details class="request-reject">\s*<summary>Reject this Maintenance Request…<\/summary>[\s\S]*name="return" value="\/requests"[\s\S]*name="reason"/);
    expect(html).toMatch(new RegExp(`action="/requests/${r.issueId}/urgency"[^>]*>\\s*<input type="hidden" name="return" value="/requests/${r.issueId}"`));
    expect(visible(html)).toContain('No photos');

    const cookie = await w.signIn();
    const changed = await w.post(`/requests/${r.issueId}/urgency`, { urgency: 'high', return: `/requests/${r.issueId}` }, cookie);
    expect(changed.headers.get('location')).toMatch(new RegExp(`^/requests/${r.issueId}\\?ok=`));
    const rejected = await w.post(`/requests/${r.issueId}/reject`, { reason: 'A new washer fixes this', return: '/requests' }, cookie);
    expect(rejected.headers.get('location')).toMatch(/^\/requests\?ok=/);
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
