import { describe, expect, test } from 'vitest';
import { upload } from '../support/photos.ts';
import { webWorld } from '../support/web.ts';
import { TOM } from '../support/world.ts';

// Nothing in myEST8 opens a new tab by itself: a Property Manager who wants one
// middle-clicks, Ctrl-clicks or uses the context menu, which every link allows.
// Photos open in the viewer (app.js), and are plain same-tab links without it.

/**
 * Tom's dripping tap with two photos, first as a Maintenance Request (its review is read
 * before it is confirmed, as after that the address is a Ticket's), then as a Ticket with
 * its messages and upload link; and an Urgent Repair with a receipt photo and a PDF.
 */
async function pagesWithPhotos() {
  const w = await webWorld();
  const cookie = await w.signIn();

  w.h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
  await w.h.receive(TOM, 'The kitchen tap is dripping');
  await w.h.answerAll(TOM, { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' });
  await w.h.upload(w.h.messenger.last(TOM)!.data.uploadLink as string, [upload('tap.jpg'), upload('tap-close.jpg')]);
  const [request] = await w.alice.requests({ filter: 'all' });
  const reviewPath = `/requests/${request!.issueId}`;
  const review = await (await w.get(reviewPath, cookie)).text();
  const ticketId = await w.alice.confirmMaintenanceRequest(request!.issueId);

  w.h.classifier.when('Water is pouring through the ceiling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });
  await w.h.receive(TOM, 'Water is pouring through the ceiling');
  await w.h.upload(w.h.messenger.last(TOM)!.data.receiptLink as string, [
    { filename: 'receipt.jpg', contentType: 'image/jpeg', content: new Uint8Array([1]) },
    { filename: 'invoice.pdf', contentType: 'application/pdf', content: new Uint8Array([1, 2]) },
  ]);
  const repair = (await w.alice.dashboard()).urgentRepairs[0]!;

  const fetched = async (path: string) => {
    const res = await w.get(path, cookie);
    expect(res.status, path).toBe(200);
    return res.text();
  };
  return { w, cookie, review, reviewPath, ticketPath: `/tickets/${ticketId}`, receiptsPath: `/reimbursements/${repair.urgentRepairId}`, fetched };
}

describe('photos', () => {
  test('the review, the Ticket and the receipts mark their photo grids for the viewer, and link each photo to its file with no target', async () => {
    const { review, ticketPath, receiptsPath, fetched } = await pagesWithPhotos();

    for (const [name, html] of [['the review', review], ['the Ticket', await fetched(ticketPath)], ['the receipts', await fetched(receiptsPath)]] as const) {
      expect(html, name).toMatch(/<ul role="list" data-photo-grid /);
      expect(html, name).toMatch(/<figure[^>]*>\s*<a href="\/files\/\d+" class="block /);
    }
  });
});

describe('links', () => {
  test('no Property Manager page renders target="_blank"', async () => {
    const { w, review, reviewPath, ticketPath, receiptsPath, fetched } = await pagesWithPhotos();
    const paths = [
      '/',
      '/dispatch',
      '/tickets?filter=all',
      '/archive',
      '/approvals',
      '/calendar',
      '/properties',
      `/properties/${w.ids.kingSt}`,
      '/tradies',
      `/tradies/${w.tradies.pete.id}`,
      '/tenants',
      `/tenants/${w.ids.tom}`,
      '/settings',
      '/settings?tab=channels',
      '/settings?tab=team',
      '/settings?tab=import',
      '/setup',
      ticketPath,
      receiptsPath,
    ];

    const pages: [string, string][] = [[reviewPath, review]];
    for (const path of paths) pages.push([path, await fetched(path)]);

    const opening = pages.flatMap(([path, html]) => (html.match(/<a\s[^>]*target="_blank"[^>]*>/g) ?? []).map((tag) => `${path}: ${tag}`));
    expect(opening).toEqual([]);
  });
});
