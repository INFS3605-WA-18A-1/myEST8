import { describe, expect, test } from 'vitest';
import { ActionError } from '../src/shared.ts';
import { HANA, jobView, PETE, QUICK_PIPES, STRANGER, TOM, tomsTapTicket, tradieQuotes, world, type World } from './support/world.ts';

const NEW_MOBILE = '0412 345 678';
const NEW_MOBILE_E164 = '+61412345678';

/** The refusal an action throws, to check its code and the field it names. */
async function refusal(action: Promise<unknown>) {
  const error = await action.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ActionError);
  return error as ActionError;
}

/** A second Agency's Property Manager, for "not found in another Agency". */
async function sunrise(w: World) {
  const id = await w.h.app.signUp({ agencyName: 'Sunrise Realty', timeZone: 'Australia/Brisbane', name: 'Sam Sun', email: 'sam@sunrise.example', password: 'sunrise-2026' });
  return { sam: w.h.as(id) };
}

describe('editing a Tenant', () => {
  test("saves the name, mobile and email, keeping the Tenant's Property and start date", async () => {
    const w = await world();
    await w.alice.editTenant(w.ids.tom, { name: 'Thomas Tran', mobile: NEW_MOBILE, email: 'Tom@Example.com' });

    expect(await w.alice.tenant(w.ids.tom)).toMatchObject({
      name: 'Thomas Tran',
      mobile: NEW_MOBILE_E164,
      email: 'tom@example.com',
      tenancyStart: '2025-01-01',
      property: { propertyId: w.ids.kingSt },
    });
  });

  test('a changed mobile is what intake now matches: the new number is Tom, the old one is a stranger', async () => {
    const w = await world();
    await w.alice.editTenant(w.ids.tom, { name: 'Tom Tran', mobile: NEW_MOBILE });
    w.h.classifier.when('The oven is not heating', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'appliances' });

    await w.h.receive(NEW_MOBILE_E164, 'The oven is not heating');
    expect(w.h.messenger.templatesTo(NEW_MOBILE_E164)).toEqual(['tenant.acknowledgement', 'tenant.missing_details']);

    await w.h.receive(TOM, 'Hi, this is Tom on my old phone');
    expect((await w.alice.dashboard()).inbox).toMatchObject([{ reason: 'unknown_sender', from: TOM }]);
  });

  test('an address a Property Manager linked from the inbox, and one left unchanged, still match', async () => {
    const w = await world();
    await w.h.receive(STRANGER, 'Hi, this is Tom on my work phone');
    const [item] = (await w.alice.dashboard()).inbox;
    await w.alice.linkSender(item!.itemId, w.ids.tom);
    await w.alice.dismissInboxItem(item!.itemId);

    await w.alice.editTenant(w.ids.hana, { name: 'Hana Ho', mobile: HANA, email: 'hana.new@example.com' });
    await w.alice.editTenant(w.ids.tom, { name: 'Tom Tran', mobile: NEW_MOBILE });

    w.h.classifier.when('The oven is not heating', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'appliances' });
    await w.h.receive(STRANGER, 'The oven is not heating');
    expect(w.h.messenger.templatesTo(STRANGER)).toEqual(['tenant.acknowledgement', 'tenant.missing_details']);
    await w.h.receive(HANA, 'The oven is not heating');
    expect(w.h.messenger.templatesTo(HANA)).toEqual(['tenant.acknowledgement', 'tenant.missing_details']);
  });

  test('a missing contact, a bad mobile and a bad email are each refused naming the field, and nothing changes', async () => {
    const w = await world();

    expect((await refusal(w.alice.editTenant(w.ids.bella, { name: 'Bella Bui' }))).fields).toEqual({ mobile: 'Enter a mobile number or email address' });
    expect((await refusal(w.alice.editTenant(w.ids.tom, { name: '  ', mobile: TOM }))).fields).toEqual({ name: 'Enter a name' });
    expect((await refusal(w.alice.editTenant(w.ids.tom, { name: 'Tom Tran', mobile: '0412 345' }))).fields.mobile).toMatch(/9 digits after \+61/);
    expect((await refusal(w.alice.editTenant(w.ids.tom, { name: 'Tom Tran', mobile: TOM, email: 'tom@' }))).fields).toEqual({ email: "tom@ isn't an email address" });

    expect(await w.alice.tenant(w.ids.tom)).toMatchObject({ name: 'Tom Tran', mobile: TOM, email: null });
  });

  test('a mobile or email someone else in the Agency holds is refused naming the field, and nothing changes', async () => {
    const w = await world();

    expect((await refusal(w.alice.editTenant(w.ids.tom, { name: 'Tom Tran', mobile: HANA }))).fields).toEqual({ mobile: `${HANA} already belongs to someone else` });
    expect((await refusal(w.alice.editTenant(w.ids.tom, { name: 'Tom Tran', mobile: PETE }))).fields.mobile).toBe(`${PETE} already belongs to someone else`);
    expect((await refusal(w.alice.editTenant(w.ids.tom, { name: 'Tom Tran', mobile: TOM, email: QUICK_PIPES }))).fields).toEqual({ email: `${QUICK_PIPES} already belongs to someone else` });
    expect(await w.alice.tenant(w.ids.tom)).toMatchObject({ mobile: TOM, email: null });
  });

  test("another Agency's Tenant and someone who is not a Tenant are not found, and a Tenant who has left is refused", async () => {
    const w = await world();
    expect((await refusal((await sunrise(w)).sam.editTenant(w.ids.tom, { name: 'Tom Tran', mobile: TOM }))).code).toBe('not_found');
    expect((await refusal(w.alice.editTenant(w.ids.pete, { name: 'Pete Park', mobile: PETE }))).code).toBe('not_found');

    await w.alice.removeTenant(w.ids.hana);
    expect((await refusal(w.alice.editTenant(w.ids.hana, { name: 'Hana Ho', mobile: STRANGER }))).message).toBe('Hana Ho has already left their Property');
    await w.h.receive(STRANGER, 'Hi, this is Hana');
    expect((await w.alice.dashboard()).inbox).toMatchObject([{ reason: 'unknown_sender', from: STRANGER }]);
  });
});

describe('editing a Tradie', () => {
  const edit = { name: 'Peter Park', businessName: 'Park Plumbing & Gas', mobile: NEW_MOBILE, email: 'pete@parkplumbing.example', trades: ['plumbing' as const, 'general_handyman' as const] };

  test('saves the business name, contact name, mobile, email and Trades, leaving the rating and Google listing alone', async () => {
    const w = await world();
    await w.alice.editTradie(w.ids.pete, edit);

    expect(await w.alice.tradie(w.ids.pete)).toMatchObject({
      name: 'Peter Park',
      businessName: 'Park Plumbing & Gas',
      mobile: NEW_MOBILE_E164,
      email: 'pete@parkplumbing.example',
      trades: ['plumbing', 'general_handyman'],
      googleRating: { rating: 4.8, reviewCount: 120 },
      myEst8Rating: { average: 4, count: 1 },
    });
  });

  test('Quote Requests go to the new mobile, and a Quote from it is matched to the Tradie', async () => {
    const w = await world();
    await w.alice.editTradie(w.ids.pete, edit);
    const job = await tomsTapTicket(w);

    await w.alice.sendQuoteRequests(job.jobId, [w.ids.pete, w.ids.dana]);
    expect(w.h.messenger.templatesTo(NEW_MOBILE_E164)).toEqual(['tradie.quote_request']);
    expect(w.h.messenger.templatesTo(PETE)).toEqual([]);
    await tradieQuotes(w, job, { id: w.ids.pete, address: NEW_MOBILE_E164 }, '$180 Tuesday', { priceCents: 180_00 });
    expect((await jobView(w, job)).quotes).toMatchObject([{ tradieId: w.ids.pete, priceCents: 180_00 }]);
  });

  test('a business name or contact name left blank, and no Trades, are each refused naming the field', async () => {
    const w = await world();

    expect((await refusal(w.alice.editTradie(w.ids.pete, { ...edit, businessName: ' ' }))).fields).toEqual({ businessName: 'Enter the business name' });
    expect((await refusal(w.alice.editTradie(w.ids.pete, { ...edit, name: '' }))).fields).toEqual({ name: 'Enter a name' });
    expect((await refusal(w.alice.editTradie(w.ids.pete, { ...edit, trades: [] }))).fields.trades).toMatch(/^Choose Trades from: plumbing/);
    expect((await refusal(w.alice.editTradie(w.ids.pete, { ...edit, mobile: undefined, email: undefined }))).fields).toEqual({ mobile: 'Enter a mobile number or email address' });
    expect((await refusal(w.alice.editTradie(w.ids.pete, { ...edit, email: 'pete@' }))).fields).toEqual({ email: "pete@ isn't an email address" });
    expect(await w.alice.tradie(w.ids.pete)).toMatchObject({ name: 'Pete Park', businessName: "Pete's Plumbing", mobile: PETE });
  });

  test('a mobile or email someone else in the Agency holds is refused naming the field', async () => {
    const w = await world();

    expect((await refusal(w.alice.editTradie(w.ids.pete, { ...edit, mobile: TOM }))).fields).toEqual({ mobile: `${TOM} already belongs to someone else` });
    expect((await refusal(w.alice.editTradie(w.ids.pete, { ...edit, email: QUICK_PIPES }))).fields).toEqual({ email: `${QUICK_PIPES} already belongs to someone else` });
    expect(await w.alice.tradie(w.ids.pete)).toMatchObject({ mobile: PETE, email: null });
  });

  test("another Agency's Tradie and someone who is not a Tradie are not found", async () => {
    const w = await world();
    expect((await refusal((await sunrise(w)).sam.editTradie(w.ids.pete, edit))).code).toBe('not_found');
    expect((await refusal(w.alice.editTradie(w.ids.tom, edit))).code).toBe('not_found');
  });
});
