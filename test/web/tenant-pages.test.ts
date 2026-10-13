import { describe, expect, test } from 'vitest';
import { formatWhen } from '../../src/web/ui.ts';
import { photo } from '../support/photos.ts';
import { webWorld } from '../support/web.ts';
import { confirmedQuotes, OLIVIA_EMAIL, TOM, tomsTapTicket } from '../support/world.ts';

type WebWorld = Awaited<ReturnType<typeof webWorld>>;

/** Tom reports a dripping tap and answers the guided questions; returns the path of his upload link. */
async function tomsUploadPath({ h }: WebWorld) {
  h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
  await h.receive(TOM, 'The kitchen tap is dripping');
  await h.answer(TOM, 'Kitchen sink');
  await h.answer(TOM, 'Since Monday');
  await h.answer(TOM, 'No', 'no');
  await h.answer(TOM, 'Mornings', 'weekday_mornings');
  return new URL(h.messenger.last(TOM)!.data.uploadLink as string).pathname;
}

/** Posts files to a page the way the browser's upload form does, then lets the worker catch up. */
async function postFiles(w: WebWorld, path: string, files: File[]) {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  const res = await w.web.request(path, { method: 'POST', body: form });
  await w.h.drain();
  return res;
}

/** A page's text as a reader sees it: `html` escapes apostrophes. */
const readable = async (res: Response) => (await res.text()).replaceAll('&#39;', "'");

const jpeg = (name: string, takenAt?: string) => new File([photo(takenAt ? { takenAt } : {})], name, { type: 'image/jpeg' });

describe('the upload page', () => {
  test('a Tenant opens their link without signing in and uploads photos, which reach the Maintenance Request', async () => {
    const w = await webWorld();
    const path = await tomsUploadPath(w);

    const form = await w.get(path);
    expect(form.status).toBe(200);
    const page = await readable(form);
    expect(page).toContain('Upload photos or your receipt');
    expect(page).toContain('enctype="multipart/form-data"');
    expect(page).toContain('accept="image/*,application/pdf"');
    expect(page).toContain('Up to 10 files at a time, each under 10 MB');
    expect(page).toContain('Send photos straight from your camera');
    expect(page.match(/btn-primary/g)).toHaveLength(1);

    const sent = await postFiles(w, path, [jpeg('tap-1.jpg', '2026:10:08 08:30:00'), jpeg('tap-2.jpg')]);
    expect(sent.status).toBe(303);
    expect(sent.headers.get('location')).toBe(`${path}?ok=2`);
    expect((await w.alice.dashboard()).maintenanceRequests).toMatchObject([{ photos: [{ metadata: 'ok' }, { metadata: 'no_metadata' }] }]);

    const thanks = await readable(await w.get(`${path}?ok=2`));
    expect(thanks).toContain("Thanks, we've got your 2 files");
    expect(thanks).toContain('Upload more');

    expect((await postFiles(w, path, [jpeg('tap-3.jpg')])).status).toBe(303);
    expect((await w.alice.dashboard()).maintenanceRequests[0]!.photos).toHaveLength(3);
  });

  test('the thank-you state never repeats text from the address bar', async () => {
    const w = await webWorld();
    const page = await readable(await w.get('/u/anything?ok=Your%20account%20is%20locked'));

    expect(page).toContain("Thanks, we've got your upload");
    expect(page).not.toContain('Your account is locked');
  });

  test('something other than a photo is refused on an issue link, with the reason on the page', async () => {
    const w = await webWorld();
    const path = await tomsUploadPath(w);

    const res = await postFiles(w, path, [new File(['hello'], 'notes.txt', { type: 'text/plain' })]);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Only photos can be uploaded here');
    expect((await w.alice.dashboard()).maintenanceRequests).toEqual([]);
  });

  test('submitting with no files says how many can be sent', async () => {
    const w = await webWorld();
    const path = await tomsUploadPath(w);

    const res = await postFiles(w, path, []);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Upload between 1 and 10 files');
  });

  test('a link stops taking photos once the Property Manager has dealt with the issue', async () => {
    const w = await webWorld();
    const path = await tomsUploadPath(w);
    await postFiles(w, path, [jpeg('tap.jpg')]);
    const [request] = (await w.alice.dashboard()).maintenanceRequests;
    await w.alice.rejectMaintenanceRequest(request!.issueId, "The tap is the Tenant's own fitting");

    const res = await postFiles(w, path, [jpeg('more.jpg')]);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('This upload link has expired');
  });

  test('an Urgent Repair receipt can be sent as a PDF and reaches the Property Owner', async () => {
    const w = await webWorld();
    const { h } = w;
    h.classifier.when('Water is pouring through the ceiling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });
    await h.receive(TOM, 'Water is pouring through the ceiling');
    const path = new URL(h.messenger.last(TOM)!.data.receiptLink as string).pathname;

    expect((await w.get(path)).status).toBe(200);
    const res = await postFiles(w, path, [new File([new Uint8Array([1, 2])], 'receipt.pdf', { type: 'application/pdf' })]);

    expect(res.status).toBe(303);
    expect(h.messenger.to(OLIVIA_EMAIL)).toMatchObject([{ template: 'owner.urgent_repair_receipt', attachments: ['receipt.pdf'] }]);
  });

  test('an unknown link is not found when the Tenant submits', async () => {
    const w = await webWorld();

    const res = await postFiles(w, '/u/not-a-real-token', [jpeg('tap.jpg')]);

    expect(res.status).toBe(404);
    expect(await readable(res)).toContain("This upload link doesn't work");
  });
});

describe("the Tenant's progress tracker", () => {
  test('shows every stage, reached or not, without signing in', async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    const path = new URL(w.h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string).pathname;

    const res = await w.get(path);

    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain('The kitchen tap is dripping');
    for (const stage of ['Reported', 'Confirmed', 'Getting quotes', 'Approved', 'Booked', 'Done', 'Closed']) expect(page).toContain(stage);
    expect(page).toContain('Now: Confirmed');
  });

  test("shows the booked visit time in the Agency's time zone, and never a price, Quote or rating", async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const tuesday9am = new Date('2026-10-13T09:00:00+11:00');
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 180_00, tuesday9am]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const path = new URL(w.h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string).pathname;

    const page = await (await w.get(path)).text();

    expect(page).toContain('Now: Booked');
    expect(page).toContain(`Visit ${formatWhen(tuesday9am.toISOString(), 'Australia/Sydney')}`);
    expect(page).not.toContain('Sydney time');
    expect(page).not.toMatch(/\$\s?\d/);
    expect(page).not.toContain('180');
    expect(page).not.toMatch(/rating/i);
  });

  test('an unknown link is not found', async () => {
    const w = await webWorld();

    const res = await w.get('/t/not-a-real-token');

    expect(res.status).toBe(404);
    expect(await readable(res)).toContain("We couldn't find that link");
  });
});
