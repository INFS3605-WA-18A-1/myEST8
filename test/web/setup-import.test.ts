import writeXlsxFile from 'write-excel-file/node';
import { describe, expect, test } from 'vitest';
import { visible, webWorld } from '../support/web.ts';
import { OLIVIA } from '../support/world.ts';

type Web = Awaited<ReturnType<typeof webWorld>>;

/** Uploads a file through the setup form, as a browser posts it. */
async function upload(w: Web, path: string, file: File, cookie: string) {
  const body = new FormData();
  body.append('file', file);
  const res = await w.web.request(path, { method: 'POST', body, headers: { cookie } });
  await w.h.drain();
  return res;
}

const csvFile = (text: string, name = 'owners.csv') => new File([text], name, { type: 'text/csv' });

async function follow(w: Web, res: Response, cookie: string) {
  expect(res.status).toBe(303);
  const location = res.headers.get('location')!;
  const page = await w.get(location, cookie);
  expect(page.status).toBe(200);
  return { location, page: await page.text() };
}

describe('spreadsheet templates', () => {
  test('downloads a CSV template with our headings and an example row', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const res = await w.get('/setup/templates/properties.csv', cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="myest8-properties.csv"');
    const [headings, example] = (await res.text()).replace(/^﻿/, '').split('\r\n');
    expect(headings).toBe('Address,Suburb,Max Repair Cost,Property Owner,Property Owner mobile,Property Owner email,Property Manager,Building Manager');
    expect(example).toContain('"12 King St, Newtown NSW 2042",Newtown,500,Olivia Owens');

    expect((await w.get('/setup/templates/nonsense.csv', cookie)).status).toBe(404);
    expect((await w.get('/setup/templates/tenants.csv')).headers.get('location')).toMatch(/^\/login/);
  });

  test('every bulk step on Setup and in the guide offers the template and an upload', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const pages: Record<string, string> = {
      setup: await (await w.get('/setup', cookie)).text(),
      properties: await (await w.get('/properties', cookie)).text(),
      tradies: await (await w.get('/tradies', cookie)).text(),
    };
    const home = { owners: 'setup', 'building-managers': 'setup', tenants: 'setup', tradies: 'tradies', properties: 'properties' } as const;
    for (const kind of ['owners', 'building-managers', 'tradies', 'properties', 'tenants'] as const) {
      const setup = pages[home[kind]]!;
      expect(setup).toContain(`href="/setup/templates/${kind}.csv"`);
      expect(setup).toContain(`action="/setup/import/${kind}"`);
    }
    expect(pages.setup).toContain('enctype="multipart/form-data"');

    const tradies = await (await w.get('/welcome/tradies', cookie)).text();
    expect(tradies).toContain('action="/setup/import/tradies?from=welcome"');
    const property = await (await w.get('/welcome/property', cookie)).text();
    for (const kind of ['owners', 'properties', 'tenants']) expect(property).toContain(`action="/setup/import/${kind}?from=welcome"`);
  });
});

describe('uploading a spreadsheet', () => {
  test('a CSV goes to a review page showing each row in words, then adds the ticked rows', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    w.h.classifier.when('Contact No.', { importColumn: ['mobile', 0.9] });

    const res = await upload(w, '/setup/import/owners', csvFile(`Landlord,Contact No.,Email\nPriya Patel,0412 111 222,\nOlivia O,${OLIVIA},\nNo Contact,,\n`), cookie);
    const review = await follow(w, res, cookie);
    expect(review.location).toMatch(/^\/setup\/imports\/[\w-]+$/);
    const text = visible(review.page);
    for (const words of ['Review Property Owners', 'From owners.csv', 'Ready', 'Duplicate', 'Needs a fix', 'Already added: Olivia Owens', 'Matched by name', 'Matched by AI', '+61412111222']) {
      expect(text).toContain(words);
    }
    expect(text).toContain('Add 1 Property Owner');
    expect(review.page).toContain('name="row-2-mobile"');
    expect(review.page).toContain('Enter a mobile number or email address');

    // The Property Manager fills in the flagged cell and adds both rows.
    const token = review.location.split('/').at(-1)!;
    const added = await follow(w, await w.post(`/setup/imports/${token}`, { intent: 'add', include: ['0', '2'], 'row-2-mobile': '0412 999 000' }, cookie), cookie);
    expect(added.location).toMatch(/^\/setup\?ok=Added%202%20Property%20Owners\.#people$/);
    expect(added.page).toContain('Added 2 Property Owners.');
    expect(added.page).toContain('Priya Patel');
    expect(added.page).toContain('+61412999000');

    // A used upload is gone.
    const gone = await w.get(`/setup/imports/${token}`, cookie);
    expect(gone.headers.get('location')).toMatch(/^\/setup\?error=This%20upload%20has%20expired/);
  });

  test('on phones the review stacks: every cell names its column, and the way back is a button', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    w.h.classifier.when('Contact No.', { importColumn: ['mobile', 0.9] });

    const review = await follow(w, await upload(w, '/setup/import/owners', csvFile(`Landlord,Contact No.\nPriya Patel,0412 111 222\nNo Contact,\n`), cookie), cookie);
    const page = review.page;
    expect(page.match(/class="table-frame import-stack"/g)).toHaveLength(2);
    // The columns table: each column's sample values, where it goes and how it was matched.
    for (const label of ['Sample values', 'Goes to', 'How']) expect(page).toContain(`data-label="${label}"`);
    // The rows table: the status, notes and each field under its heading.
    for (const label of ['Row', 'Status', 'Notes', 'Name', 'Mobile']) expect(page).toContain(`data-label="${label}"`);
    expect(page).toMatch(/<a href="\/setup#people" class="btn btn-ghost btn-sm">Back to Setup<\/a>/);
  });

  test('an .xlsx file is read too, and a Tradie Trade the AI filled in is marked as such', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    w.h.classifier.when('Bright Sparks', { importTrade: ['electrical', 0.9] });
    const sheet = await writeXlsxFile([
      [{ value: 'Business' }, { value: 'Mobile' }],
      [{ value: 'Bright Sparks' }, { value: '0412 000 002' }],
    ]).toBuffer();
    const file = new File([new Uint8Array(sheet)], 'tradies.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const review = await follow(w, await upload(w, '/setup/import/tradies?from=welcome', file, cookie), cookie);
    expect(review.location).toMatch(/\?from=welcome$/);
    const text = visible(review.page);
    expect(text).toContain('Electrical Filled in by AI');
    expect(text).toContain('No contact name, so the business name');

    const token = review.location.split('/').at(-1)!.split('?')[0]!;
    const added = await follow(w, await w.post(`/setup/imports/${token}`, { intent: 'add', include: '0', from: 'welcome' }, cookie), cookie);
    expect(added.location).toBe('/welcome/tradies?ok=Added%201%20Tradie.');
    expect(added.page).toContain('Bright Sparks');
  });

  test('importing Properties makes no geocoder call, and says Dispatch will place them', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    const address = '3 Rose St, Glebe NSW 2037';
    // A point the geocoder would return. The import must not ask for it.
    w.h.geocoder.locations.set(address, { lat: -33.8795, lng: 151.1865 });
    let calls = 0;
    const geocode = w.h.geocoder.geocode.bind(w.h.geocoder);
    w.h.geocoder.geocode = async (query) => {
      calls++;
      return geocode(query);
    };

    const review = await follow(
      w,
      await upload(w, '/setup/import/properties', csvFile(`Property address,Landlord,Max spend\n"${address}",Olivia Owens,500\n`, 'properties.csv'), cookie),
      cookie,
    );
    const token = review.location.split('/').at(-1)!;
    const added = await follow(w, await w.post(`/setup/imports/${token}`, { intent: 'add', include: '0' }, cookie), cookie);

    expect(calls).toBe(0);
    expect(visible(added.page)).toContain('Look up missing addresses on Dispatch places them, at most 10 a press.');
    expect((await w.alice.properties()).find((p) => p.address === address)?.location).toBeNull();
  });

  test('refuses a file that is not a spreadsheet, back on the step it came from', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const refused = await follow(w, await upload(w, '/setup/import/owners', new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }), cookie), cookie);
    expect(refused.location).toMatch(/^\/setup\?form=import-owners&error=.*#import-owners$/);
    expect(refused.page).toContain('Upload a spreadsheet saved as .xlsx or .csv');
    expect(refused.page).toMatch(/<details class="import-details" id="import-owners" open/);

    const empty = await follow(w, await upload(w, '/setup/import/tenants?from=welcome', new File([''], 'empty.csv'), cookie), cookie);
    expect(empty.location).toMatch(/^\/welcome\/property\?form=import-tenants&error=Choose%20a%20spreadsheet/);
  });

  test('changes a column the AI was unsure about, and keeps an upload private to who made it', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();
    w.h.classifier.when('Ref', { importColumn: ['email', 0.4] });
    const review = await follow(w, await upload(w, '/setup/import/owners', csvFile('Owner,Ref\nPriya Patel,priya@example.com\n'), cookie), cookie);
    expect(visible(review.page)).toContain("The AI wasn't sure about one column");
    expect(visible(review.page)).toContain('Its guess: Email');
    const token = review.location.split('/').at(-1)!;

    const remapped = await follow(w, await w.post(`/setup/imports/${token}/columns`, { 'column-0': 'name', 'column-1': 'email' }, cookie), cookie);
    expect(visible(remapped.page)).toContain('You chose');
    expect(visible(remapped.page)).toContain('Add 1 Property Owner');

    const bob = await w.signIn('bob@harbour.example');
    expect((await w.get(`/setup/imports/${token}`, bob)).headers.get('location')).toMatch(/expired/);
    expect((await w.post(`/setup/imports/${token}`, { intent: 'add', include: '0' }, bob)).headers.get('location')).toMatch(/expired/);
    expect((await (await w.h.app.asPropertyManager(w.ids.aliceId)).people('owner')).map((p) => p.name)).not.toContain('Priya Patel');
  });
});
