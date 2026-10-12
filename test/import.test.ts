import writeXlsxFile from 'write-excel-file/node';
import { describe, expect, test } from 'vitest';
import { DAY } from './support/harness.ts';
import { KING_ST, OLIVIA, world } from './support/world.ts';

/** A CSV upload, as a browser would send it. */
function csv(text: string, filename = 'sheet.csv') {
  return { filename, contentType: 'text/csv', content: new TextEncoder().encode(text) };
}

/** A real .xlsx upload, built the way Excel would save it. */
async function xlsx(rows: (string | number | Date)[][], filename = 'sheet.xlsx') {
  const content = await writeXlsxFile(rows.map((row) => row.map((value) => ({ value, ...(value instanceof Date ? { format: 'dd/mm/yyyy' } : {}) })))).toBuffer();
  return { filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: new Uint8Array(content) };
}

const rowAt = <R extends { line: number }>(preview: { rows: R[] }, line: number) => preview.rows.find((r) => r.line === line)!;

async function refusal(promise: unknown) {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('Expected the action to be refused');
}

describe('importing Property Owners from a spreadsheet', () => {
  test('matches messy headers, tidies mobiles and emails, and adds every ready row', async () => {
    const w = await world();
    const { token } = await w.alice.importSheet(
      'owners',
      csv('Landlord,Ph,E-mail\nPriya Patel,0412 111 222,PRIYA@Example.com\nLiam Lee,(04) 1233 3444,\n'),
    );

    const preview = await w.alice.importPreview(token);
    expect(preview.columns.map((c) => [c.header, c.field, c.by])).toEqual([
      ['Landlord', 'name', 'header'],
      ['Ph', 'mobile', 'header'],
      ['E-mail', 'email', 'header'],
    ]);
    expect(rowAt(preview, 2)).toMatchObject({ status: 'ready', included: true, values: { name: 'Priya Patel', mobile: '+61412111222', email: 'priya@example.com' } });
    expect(rowAt(preview, 3)).toMatchObject({ status: 'ready', values: { name: 'Liam Lee', mobile: '+61412333444' } });

    const result = await w.alice.confirmImport(token, {});
    expect(result).toMatchObject({ added: 2, failed: [], finished: true });
    const owners = (await w.alice.people('owner')).map((p) => [p.name, p.mobile, p.email]);
    expect(owners).toContainEqual(['Priya Patel', '+61412111222', 'priya@example.com']);
    expect(owners).toContainEqual(['Liam Lee', '+61412333444', null]);
  });

  test('flags a row that fails the same checks as the Add form, and a duplicate of someone already added', async () => {
    const w = await world();
    const { token } = await w.alice.importSheet('owners', csv(`Name,Mobile,Email\nNo Contact,,\nOlivia O,${OLIVIA},\nBad Phone,12,\n`));

    const preview = await w.alice.importPreview(token);
    expect(rowAt(preview, 2)).toMatchObject({ status: 'needs_fix', problems: { mobile: 'Enter a mobile number or email address' } });
    expect(rowAt(preview, 3)).toMatchObject({ status: 'duplicate', included: false, duplicateOf: 'Olivia Owens' });
    expect(rowAt(preview, 4).problems.mobile).toMatch(/isn't a mobile number/);

    // The Property Manager fixes one row in the preview and leaves the duplicate unticked.
    const result = await w.alice.confirmImport(token, { included: [0, 2], edits: { 0: { email: 'no.contact@example.com' } } });
    expect(result).toMatchObject({ added: 1, finished: false });
    expect(result.failed).toEqual([{ line: 4, message: expect.stringMatching(/isn't a mobile number/) }]);
    expect((await w.alice.people('owner')).map((p) => p.name)).toContain('No Contact');

    // What's left stays in the preview to fix.
    const left = await w.alice.importPreview(token);
    expect(left.rows.map((r) => r.line)).toEqual([3, 4]);
    expect(left.added).toBe(1);
  });

  test('asks the AI about a header it does not know, and never applies an answer it is unsure of', async () => {
    const w = await world();
    w.h.classifier.when('Contact No.', { importColumn: ['mobile', 0.92] });
    w.h.classifier.when('Ref', { importColumn: ['email', 0.4] });
    const { token } = await w.alice.importSheet('owners', csv('Owner,Contact No.,Ref\nPriya Patel,0412 111 222,P-17\n'));

    const preview = await w.alice.importPreview(token);
    expect(preview.columns.map((c) => [c.header, c.field, c.by])).toEqual([
      ['Owner', 'name', 'header'],
      ['Contact No.', 'mobile', 'ai'],
      ['Ref', null, 'unsure'],
    ]);
    expect(preview.columns[2]!.suggestion).toEqual({ field: 'email', confidence: 0.4 });
    expect(rowAt(preview, 2)).toMatchObject({ status: 'ready', values: { mobile: '+61412111222' } });
    expect(rowAt(preview, 2).values.email).toBeUndefined();

    // The Property Manager decides what the column is.
    await w.alice.remapImport(token, ['name', 'mobile', null]);
    expect((await w.alice.importPreview(token)).columns[0]).toMatchObject({ field: 'name', by: 'header' });
    expect((await w.alice.importPreview(token)).columns[2]).toMatchObject({ field: null, by: 'pm' });
  });

  test('works when the AI is down: unknown headers wait for the Property Manager', async () => {
    const w = await world();
    const { token } = await w.alice.importSheet('owners', csv('Owner,Mystery\nPriya Patel,0412 111 222\n'));
    const preview = await w.alice.importPreview(token);
    expect(preview.columns[1]).toMatchObject({ field: null, by: 'unsure' });
    expect(rowAt(preview, 2).status).toBe('needs_fix');
  });
});

describe('importing Tradies', () => {
  test('reads Trades from words, and the AI fills in a missing Trade only when it is sure', async () => {
    const w = await world();
    w.h.classifier.when('Bright Sparks', { importTrade: ['electrical', 0.9] });
    w.h.classifier.when('Fix-It Co', { importTrade: ['carpentry', 0.55] });
    const { token } = await w.alice.importSheet(
      'tradies',
      csv('Company,Contact,Mobile,Services\nRoof Kings,Rhea,0412 000 001,Roofer; gutters\nBright Sparks,Ben,0412 000 002,\nFix-It Co,Fay,0412 000 003,\n'),
    );

    const preview = await w.alice.importPreview(token);
    expect(rowAt(preview, 2)).toMatchObject({ status: 'ready', values: { businessName: 'Roof Kings', trades: 'roofing', startingRating: '3' } });
    expect(rowAt(preview, 2).filled.trades).toBeUndefined();
    expect(rowAt(preview, 3)).toMatchObject({ status: 'ready', values: { trades: 'electrical' }, filled: { trades: { by: 'ai' } } });
    expect(rowAt(preview, 4)).toMatchObject({ status: 'needs_fix', values: { trades: '' } });
    expect(rowAt(preview, 4).problems.trades).toBe("The AI isn't sure. Its guess: Carpentry.");

    await w.alice.reviseImport(token, { edits: { 2: { trades: 'Carpentry, general handyman' } } });
    expect(rowAt(await w.alice.importPreview(token), 4)).toMatchObject({ status: 'ready', values: { trades: 'carpentry, general_handyman' } });

    expect(await w.alice.confirmImport(token, {})).toMatchObject({ added: 3, finished: true });
    const tradies = await w.alice.people('tradie');
    expect(tradies.find((t) => t.businessName === 'Bright Sparks')).toMatchObject({ trades: ['electrical'], startingRating: 3, googlePlaceId: null });
    expect(tradies.find((t) => t.businessName === 'Fix-It Co')?.trades).toEqual(['carpentry', 'general_handyman']);
  });
});

describe('importing Properties', () => {
  test('links each Property to its Property Owner, adds new Property Owners from the sheet, and flags duplicates', async () => {
    const w = await world();
    const { token } = await w.alice.importSheet(
      'properties',
      csv(
        [
          'Property address,Landlord,Landlord phone,Max spend',
          '"3 Rose St, Glebe NSW 2037",Olivia Owens,,"$1,200"',
          '"9 Pine Rd, Ryde NSW 2112",Nora New,0412 555 666,800',
          '"10 Pine Rd, Ryde NSW 2112",Nora New,0412 555 666,800',
          `"${KING_ST}",Olivia Owens,,500`,
          '"1 Nowhere Ln, Penrith NSW 2750",Who Knows,,500',
        ].join('\n'),
      ),
    );

    const preview = await w.alice.importPreview(token);
    expect(rowAt(preview, 2)).toMatchObject({
      status: 'ready',
      values: { address: '3 Rose St, Glebe NSW 2037', suburb: 'Glebe', ownerName: 'Olivia Owens', maxRepairCost: '$1,200.00', propertyManager: 'Alice Archer' },
      filled: { suburb: { by: 'rule' } },
    });
    expect(rowAt(preview, 3).notes).toContain('Adds Nora New as a new Property Owner');
    expect(rowAt(preview, 4).notes).toContain('Uses Nora New, the new Property Owner from row 3');
    expect(rowAt(preview, 5)).toMatchObject({ status: 'duplicate', included: false });
    expect(rowAt(preview, 6)).toMatchObject({ status: 'needs_fix' });
    expect(rowAt(preview, 6).problems.ownerName).toMatch(/No Property Owner called Who Knows/);

    const result = await w.alice.confirmImport(token, { included: [0, 1, 2] });
    expect(result).toMatchObject({ added: 3, failed: [] });
    const properties = await w.alice.properties();
    const nora = (await w.alice.people('owner')).filter((p) => p.name === 'Nora New');
    expect(nora).toHaveLength(1);
    expect(properties.filter((p) => p.ownerId === nora[0]!.id)).toHaveLength(2);
    expect(properties.find((p) => p.address.startsWith('3 Rose St'))).toMatchObject({ ownerId: w.ids.olivia, maxRepairCostCents: 1200_00, propertyManagerId: w.ids.aliceId });
  });
});

describe('importing Tenants', () => {
  test('links each Tenant to a Property by its address and reads Australian dates, from an .xlsx file', async () => {
    const w = await world();
    const sheet = await xlsx([
      ['Tenant', 'Mobile', 'Property', 'Lease start'],
      ['Tia Tenant', 412777888, '12 King Street Newtown', new Date(Date.UTC(2026, 2, 1))],
      ['Uma Unit', '0412 777 999', '5/40 Ocean Ave', '15/07/2025'],
      ['Val Vacant', '0412 777 000', '77 Nowhere St', '2025-01-01'],
    ]);
    const { token } = await w.alice.importSheet('tenants', sheet);

    const preview = await w.alice.importPreview(token);
    expect(rowAt(preview, 2)).toMatchObject({ status: 'ready', values: { name: 'Tia Tenant', mobile: '+61412777888', property: KING_ST, tenancyStart: '2026-03-01' } });
    expect(rowAt(preview, 3)).toMatchObject({ status: 'ready', values: { tenancyStart: '2025-07-15' } });
    expect(rowAt(preview, 4).problems.property).toMatch(/No Property at 77 Nowhere St/);

    await w.alice.confirmImport(token, { included: [0, 1] });
    expect((await w.alice.people('tenant')).find((t) => t.name === 'Tia Tenant')).toMatchObject({ propertyId: w.ids.kingSt, tenancyStart: '2026-03-01' });
  });
});

describe('uploads and who can see them', () => {
  test('refuses files that are not spreadsheets, old .xls files, and sheets that are too big', async () => {
    const w = await world();
    expect(await refusal(w.alice.importSheet('owners', { filename: 'scan.pdf', contentType: 'application/pdf', content: new Uint8Array([37, 80]) }))).toBe(
      'Upload a spreadsheet saved as .xlsx or .csv',
    );
    expect(await refusal(w.alice.importSheet('owners', { filename: 'old.xls', contentType: 'application/vnd.ms-excel', content: new Uint8Array([0xd0, 0xcf]) }))).toMatch(
      /Save it as \.xlsx or \.csv/,
    );
    expect(await refusal(w.alice.importSheet('owners', csv('not,really\n', 'fake.xlsx')))).toMatch(/isn't a readable \.xlsx file/);
    const tooMany = ['Name,Mobile', ...Array.from({ length: 501 }, (_, i) => `P${i},04120${String(i).padStart(5, '0')}`)].join('\n');
    expect(await refusal(w.alice.importSheet('owners', csv(tooMany)))).toBe('That sheet has 501 rows. Upload up to 500 at a time.');
    expect(await refusal(w.alice.importSheet('owners', csv('Name,Mobile\n')))).toBe('That sheet has no rows under its headings');
  });

  test("keeps an upload to the Property Manager who made it, and lets it expire", async () => {
    const w = await world();
    const { token } = await w.alice.importSheet('owners', csv('Name,Mobile\nPriya Patel,0412 111 222\n'));

    const other = await w.h.app.setup.createAgency({ name: 'Other Realty', timeZone: 'Australia/Sydney' });
    const mallory = w.h.as(await w.h.app.setup.addPropertyManager(other, { name: 'Mallory', email: 'mallory@other.example' }));
    expect(await refusal(mallory.importPreview(token))).toMatch(/expired/);
    expect(await refusal(mallory.confirmImport(token, {}))).toMatch(/expired/);
    expect(await mallory.people('owner')).toEqual([]);

    await w.h.advance(2 * DAY);
    expect(await refusal(w.alice.importPreview(token))).toMatch(/expired/);
  });
});

