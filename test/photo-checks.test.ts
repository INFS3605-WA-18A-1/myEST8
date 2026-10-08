import { describe, expect, test } from 'vitest';
import { upload } from './support/photos.ts';
import { KING_ST_LOCATION, TOM, world } from './support/world.ts';

/** Tom reports a dripping tap on 8 October 2026 and answers the questions. Tenancy began 1 January 2025. */
async function reportedTap() {
  const w = await world();
  const { h } = w;
  h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
  await h.receive(TOM, 'The kitchen tap is dripping');
  await h.answer(TOM, 'Kitchen sink');
  await h.answer(TOM, 'Since Monday');
  await h.answer(TOM, 'No', 'no');
  await h.answer(TOM, 'Mornings', 'weekday_mornings');
  return { ...w, link: h.messenger.last(TOM)!.data.uploadLink as string };
}

describe('photo metadata checks', () => {
  test.each([
    ['taken this morning at the Property', { takenAt: '2026:10:08 08:30:00', gps: KING_ST_LOCATION }, 'ok', []],
    ['with no metadata', {}, 'no_metadata', []],
    ['taken before the tenancy began', { takenAt: '2024:12:20 10:00:00' }, 'flagged', ['taken_before_tenancy', 'taken_long_before_report']],
    ['taken more than 14 days before the report', { takenAt: '2026:09:20 10:00:00' }, 'flagged', ['taken_long_before_report']],
    ['taken 13 days before the report', { takenAt: '2026:09:25 10:00:00' }, 'ok', []],
    ['geotagged in Melbourne', { takenAt: '2026:10:08 08:30:00', gps: { lat: -37.81, lng: 144.96 } }, 'flagged', ['far_from_property']],
    ['geotagged 500 m from the Property', { gps: { lat: KING_ST_LOCATION.lat + 0.0045, lng: KING_ST_LOCATION.lng } }, 'ok', []],
  ])('a photo %s', async (_, metadata, result, reasons) => {
    const { h, alice, link } = await reportedTap();

    await h.upload(link, [upload('photo.jpg', metadata)]);

    expect((await alice.dashboard()).maintenanceRequests[0]!.photos).toEqual([{ photoId: expect.any(Number), fileId: expect.any(Number), metadata: result, reasons }]);
  });

  test('a photo check that cannot run still shows the issue to the Property Manager', async () => {
    const { h, alice, link } = await reportedTap();
    h.imageMatcher.next = new Error('vision model unavailable');

    await h.upload(link, [upload('tap.jpg')]);

    expect((await alice.dashboard()).maintenanceRequests).toMatchObject([{ photos: [{}], imageMatch: { result: 'unclear' } }]);
  });

  test('the image matcher runs again when more photos are added before confirmation', async () => {
    const { h, alice, link } = await reportedTap();
    h.imageMatcher.next = { result: 'unclear', reason: 'The photo is too dark' };
    await h.upload(link, [upload('dark.jpg'), upload('darker.jpg')]);
    expect((await alice.dashboard()).maintenanceRequests[0]).toMatchObject({ imageMatch: { result: 'unclear', reason: 'The photo is too dark' } });

    h.imageMatcher.next = { result: 'matches', reason: 'A dripping tap is visible' };
    await h.upload(link, [upload('bright.jpg')]);

    expect((await alice.dashboard()).maintenanceRequests[0]).toMatchObject({
      photos: [{}, {}, {}],
      imageMatch: { result: 'matches', reason: 'A dripping tap is visible' },
    });
  });
});
