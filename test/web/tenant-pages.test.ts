import { describe, expect, test } from 'vitest';
import { formatWhen } from '../../src/web/ui.ts';
import { photo } from '../support/photos.ts';
import { webWorld } from '../support/web.ts';
import { confirmedQuotes, inspectionBooked, KING_ST, OLIVIA_EMAIL, TOM, tomsTapTicket } from '../support/world.ts';

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

/** Posts files (and any other fields) to a page the way the browser's upload form does, then lets the worker catch up. */
async function postFiles(w: WebWorld, path: string, files: File[], fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
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
    expect(page).toContain('Send photos of the issue');
    expect(page).toContain('<span class="public-brand">Harbour Realty</span>');
    expect(page).toContain(KING_ST);
    expect(page).toContain('The kitchen tap is dripping');
    expect(page).toContain('Take or choose photos');
    expect(page).toContain('enctype="multipart/form-data"');
    expect(page).toMatch(/data-direct-upload="[^"]+"/);
    // An issue link takes photos only, so the picker doesn't offer PDFs.
    expect(page).toContain('accept="image/*"');
    expect(page).toContain('id="files-chosen"');
    expect(page).toContain('Up to 10 files at a time, each under 10 MB');
    expect(page).toContain('Photos straight from your camera keep their details');
    expect(page.match(/btn-primary/g)).toHaveLength(1);

    const sent = await postFiles(w, path, [jpeg('tap-1.jpg', '2026:10:08 08:30:00'), jpeg('tap-2.jpg')]);
    expect(sent.status).toBe(303);
    expect(sent.headers.get('location')).toBe(`${path}?ok=2`);
    expect((await w.alice.dashboard()).maintenanceRequests).toMatchObject([{ photos: [{ metadata: 'ok' }, { metadata: 'no_metadata' }] }]);

    const thanks = await readable(await w.get(`${path}?ok=2`));
    expect(thanks).toContain('Thanks, Harbour Realty has your 2 photos');
    expect(thanks).toContain('Upload more');

    expect((await postFiles(w, path, [jpeg('tap-3.jpg')])).status).toBe(303);
    expect((await w.alice.dashboard()).maintenanceRequests[0]!.photos).toHaveLength(3);
  });

  test('the thank-you state never repeats text from the address bar', async () => {
    const w = await webWorld();
    const path = await tomsUploadPath(w);
    const page = await readable(await w.get(`${path}?ok=Your%20account%20is%20locked`));

    expect(page).toContain('Thanks, Harbour Realty has your upload');
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

    expect(res.status).toBe(410);
    const refused = await readable(res);
    expect(refused).toContain('This link has expired');
    expect(refused).toContain('reply to the message you got from Harbour Realty');
    expect((await w.get(path)).status).toBe(410);
    expect(await readable(await w.get(path))).not.toContain('enctype="multipart/form-data"');
  });

  test('an Urgent Repair receipt can be sent as a PDF with the amount claimed, and waits for the Property Manager to forward it', async () => {
    const w = await webWorld();
    const { h } = w;
    h.classifier.when('Water is pouring through the ceiling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });
    await h.receive(TOM, 'Water is pouring through the ceiling');
    const path = new URL(h.messenger.last(TOM)!.data.receiptLink as string).pathname;

    const form = await w.get(path);
    expect(form.status).toBe(200);
    const page = await readable(form);
    expect(page).toContain('Send your Urgent Repair receipt');
    expect(page).toContain('Photos, or a PDF receipt');
    expect(page).toContain('accept="image/*,application/pdf"');
    expect(page).toContain(KING_ST);
    expect(page).toContain('Reimbursement Request');
    expect(page).toContain('Amount on the receipt (optional)');
    expect(page).toContain('You can claim up to $1,000.00 back');

    // Not a photo or PDF, or a nonsense amount: refused, with the amount kept.
    const notes = await postFiles(w, path, [new File(['hello'], 'notes.txt', { type: 'text/plain' })], { amount: '$480' });
    expect(notes.status).toBe(400);
    const refused = await readable(notes);
    expect(refused).toContain('Upload the receipt as a photo or PDF');
    expect(refused).toContain('value="$480"');
    const nonsense = await postFiles(w, path, [new File([new Uint8Array([1, 2])], 'receipt.pdf', { type: 'application/pdf' })], { amount: 'four hundred' });
    expect(nonsense.status).toBe(400);
    expect(await readable(nonsense)).toContain('Enter an amount in dollars');

    const res = await postFiles(w, path, [new File([new Uint8Array([1, 2])], 'receipt.pdf', { type: 'application/pdf' })], { amount: '$480.50' });

    expect(res.status).toBe(303);
    expect(await readable(await w.get(res.headers.get('location')!))).toContain('pass your Reimbursement Request to the property owner');
    expect(h.messenger.to(OLIVIA_EMAIL)).toEqual([]);
    expect((await w.alice.dashboard()).urgentRepairs).toMatchObject([{ status: 'receipt_received', receipts: 1 }]);
    const [repair] = (await w.alice.dashboard()).urgentRepairs;
    expect(await w.alice.reimbursement(repair!.urgentRepairId)).toMatchObject({ amountCents: 480_50 });
  });

  test('once the Tenant is reimbursed, the receipt link no longer takes receipts', async () => {
    const w = await webWorld();
    const { h } = w;
    h.classifier.when('Water is pouring through the ceiling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });
    await h.receive(TOM, 'Water is pouring through the ceiling');
    const path = new URL(h.messenger.last(TOM)!.data.receiptLink as string).pathname;
    await postFiles(w, path, [new File([new Uint8Array([1])], 'receipt.jpg', { type: 'image/jpeg' })], { amount: '200' });
    const [repair] = (await w.alice.dashboard()).urgentRepairs;
    await w.alice.forwardReimbursement(repair!.urgentRepairId);
    await w.alice.markReimbursed(repair!.urgentRepairId);

    const opened = await w.get(path);
    expect(opened.status).toBe(410);
    expect(await readable(opened)).toContain('no longer takes receipts');
  });

  test('an unknown link says so as soon as it opens, without a form, and when submitted to', async () => {
    const w = await webWorld();

    const opened = await w.get('/u/expired-token-xyz');
    expect(opened.status).toBe(404);
    const page = await readable(opened);
    expect(page).toContain("This link has expired or isn't right");
    expect(page).toContain('ask for a new link');
    expect(page).not.toContain('enctype="multipart/form-data"');

    const res = await postFiles(w, '/u/not-a-real-token', [jpeg('tap.jpg')]);
    expect(res.status).toBe(404);
    expect(await readable(res)).toContain("This link has expired or isn't right");
  });
});

describe("the Tenant's progress tracker", () => {
  test('shows every stage, reached or not, without signing in', async () => {
    const w = await webWorld();
    await tomsTapTicket(w);
    const path = new URL(w.h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string).pathname;

    const res = await w.get(path);

    expect(res.status).toBe(200);
    const page = await readable(res);
    expect(page).toContain('The kitchen tap is dripping');
    expect(page).toContain('<span class="public-brand">Harbour Realty</span>');
    expect(page).toContain(KING_ST);
    for (const stage of ['Reported', 'Confirmed', 'Getting quotes', 'Repair approved', 'Booked', 'Fixed']) expect(page).toContain(`${stage}<span class="sr-only">`);
    // Done and Closed are one step for the Tenant, and the current step isn't repeated as a heading.
    expect(page).not.toContain('>Done<span');
    expect(page).not.toContain('>Closed<span');
    expect(page).not.toContain('Now:');
    expect(page).toContain('Harbour Realty has confirmed the repair and is arranging a tradie.');
  });

  test("shows the booked visit time in the Agency's time zone, and never a price, Quote or rating", async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const tuesday9am = new Date('2026-10-13T09:00:00+11:00');
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 180_00, tuesday9am]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);
    const path = new URL(w.h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string).pathname;

    const page = await readable(await w.get(path));

    const when = formatWhen(tuesday9am.toISOString(), 'Australia/Sydney');
    expect(page).toContain(`A plumber from Pete's Plumbing is booked for ${when}.`);
    expect(page).toContain(`<p class="tracker-detail">Pete's Plumbing</p>`);
    // No Tailwind runtime on the Tenant pages: the circles and lines are plain CSS.
    expect(page).not.toContain('tw.css');
    expect(page).toContain('/assets/tenant.css');
    expect(page).toContain(`Visit ${when}`);
    expect(page).toContain('Harbour Realty');
    expect(page).toContain(KING_ST);
    expect(page).not.toContain('Sydney time');
    expect(page).not.toMatch(/\$\s?\d/);
    expect(page).not.toContain('180');
    expect(page).not.toMatch(/rating/i);
  });

  test('its read model names the Agency, the Property and who is coming, and nothing about money', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [[w.tradies.pete, 180_00, new Date('2026-10-13T09:00:00+11:00')]]);
    await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
    await w.alice.sendWorkOrder(job.jobId);

    const tracker = await w.h.tracker(w.h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string);

    expect(tracker).toMatchObject({ agencyName: 'Harbour Realty', address: KING_ST });
    expect(tracker.stages.find((s) => s.stage === 'booked')).toMatchObject({ reached: true, tradie: "Pete's Plumbing", trade: 'plumbing' });
    expect(JSON.stringify(tracker)).not.toMatch(/180|Cents|rating/i);
  });

  test('an unknown link is not found', async () => {
    const w = await webWorld();

    const res = await w.get('/t/not-a-real-token');

    expect(res.status).toBe(404);
    expect(await readable(res)).toContain("We couldn't find that link");
  });
});

describe('the tracker: Site Inspections', () => {
  test('shows a Site visit step with each Tradie and the time of their visit', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    await w.alice.sendQuoteRequests(job.jobId, [w.tradies.pete.id, w.tradies.dana.id]);
    const tue = new Date('2026-10-13T10:00:00+11:00');
    const wed = new Date('2026-10-14T10:00:00+11:00');
    await inspectionBooked(w, job, w.tradies.pete, tue);
    await inspectionBooked(w, job, w.tradies.dana, wed);
    const path = new URL(w.h.messenger.to(TOM).find((m) => m.template === 'tenant.confirmed')!.data.trackerLink as string).pathname;

    const page = await readable(await w.get(path));

    expect(page).toContain('Site visit<span class="sr-only">');
    expect(page).toContain(`Pete's Plumbing, ${formatWhen(tue.toISOString(), 'Australia/Sydney')}`);
    expect(page).toContain(`Drip Doctors, ${formatWhen(wed.toISOString(), 'Australia/Sydney')}`);
  });
});
