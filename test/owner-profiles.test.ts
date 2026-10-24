import { describe, expect, test } from 'vitest';
import { ActionError } from '../src/shared.ts';
import { BARRY, HANA, KING_ST, OCEAN_AVE, OLIVIA, OLIVIA_EMAIL, PETE, world, type World } from './support/world.ts';

const NEW_MOBILE = '0412 345 678';
const NEW_MOBILE_E164 = '+61412345678';
const NEW_EMAIL = 'Kevin@Example.com';

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

describe('editing a Property Owner', () => {
  test('saves the name, mobile and email', async () => {
    const w = await world();
    await w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owen', mobile: NEW_MOBILE, email: NEW_EMAIL });

    expect((await w.alice.people('owner')).find((p) => p.id === w.ids.olivia)).toMatchObject({
      name: 'Olivia Owen',
      mobile: NEW_MOBILE_E164,
      email: 'kevin@example.com',
    });
  });

  test('a changed email is what intake now matches: the new address is Olivia, the old one is a stranger', async () => {
    const w = await world();
    await w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owens', mobile: OLIVIA, email: NEW_EMAIL });
    w.h.classifier.when('Can I see the quote?', { replyType: 'other' });

    await w.h.receive('kevin@example.com', 'Can I see the quote?');
    expect((await w.alice.dashboard()).inbox).toMatchObject([{ reason: 'other', from: 'kevin@example.com', personName: 'Olivia Owens' }]);

    await w.h.receive(OLIVIA_EMAIL, 'This is my old address');
    expect((await w.alice.dashboard()).inbox).toMatchObject([
      { reason: 'other', from: 'kevin@example.com', personName: 'Olivia Owens' },
      { reason: 'unknown_sender', from: OLIVIA_EMAIL, personName: null },
    ]);
  });

  test('a missing contact, a bad mobile and a bad email are each refused naming the field, and nothing changes', async () => {
    const w = await world();

    expect((await refusal(w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owens' }))).fields).toEqual({ mobile: 'Enter a mobile number or email address' });
    expect((await refusal(w.alice.editOwner(w.ids.olivia, { name: '  ', mobile: OLIVIA }))).fields).toEqual({ name: 'Enter a name' });
    expect((await refusal(w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owens', mobile: '0412 345' }))).fields.mobile).toMatch(/9 digits after \+61/);
    expect((await refusal(w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owens', mobile: OLIVIA, email: 'olivia@' }))).fields).toEqual({
      email: "olivia@ isn't an email address",
    });

    expect((await w.alice.people('owner')).find((p) => p.id === w.ids.olivia)).toMatchObject({ name: 'Olivia Owens', mobile: OLIVIA, email: OLIVIA_EMAIL });
  });

  test('a mobile or email someone else in the Agency holds is kept by both', async () => {
    const w = await world();

    await w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owens', mobile: HANA });
    expect((await w.alice.people('owner')).find((p) => p.id === w.ids.olivia)).toMatchObject({ name: 'Olivia Owens', mobile: HANA, email: null });
    expect(await w.alice.tenant(w.ids.hana)).toMatchObject({ mobile: HANA });

    await w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owens', mobile: PETE });
    expect((await w.alice.people('owner')).find((p) => p.id === w.ids.olivia)).toMatchObject({ mobile: PETE, email: null });
    expect(await w.alice.tradie(w.ids.pete)).toMatchObject({ mobile: PETE });

    await w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owens', email: 'hana@example.com' });
    expect((await w.alice.people('owner')).find((p) => p.id === w.ids.olivia)).toMatchObject({ name: 'Olivia Owens', mobile: null, email: 'hana@example.com' });
    expect(await w.alice.tenant(w.ids.hana)).toMatchObject({ email: 'hana@example.com' });
  });

  test("another Agency's Property Owner, and someone who is not a Property Owner, are not found", async () => {
    const w = await world();
    expect((await refusal((await sunrise(w)).sam.editOwner(w.ids.olivia, { name: 'Olivia Owens', mobile: OLIVIA }))).code).toBe('not_found');
    expect((await refusal(w.alice.editOwner(w.ids.pete, { name: 'Pete Park', mobile: PETE }))).code).toBe('not_found');
    expect((await w.alice.people('owner')).find((p) => p.id === w.ids.olivia)).toMatchObject({ name: 'Olivia Owens', mobile: OLIVIA });
  });
});

describe('editing a Building Manager', () => {
  test('saves the name, mobile and email', async () => {
    const w = await world();
    await w.alice.editBuildingManager(w.ids.barry, { name: 'Barry Stone', mobile: NEW_MOBILE, email: NEW_EMAIL });

    expect((await w.alice.people('building_manager')).find((p) => p.id === w.ids.barry)).toMatchObject({
      name: 'Barry Stone',
      mobile: NEW_MOBILE_E164,
      email: 'kevin@example.com',
    });
  });

  test('a changed email is what intake now matches, and the old one is a stranger', async () => {
    const w = await world();
    await w.alice.editBuildingManager(w.ids.barry, { name: 'Barry Strata', email: NEW_EMAIL });

    await w.h.receive('kevin@example.com', 'The lift is out');
    expect((await w.alice.dashboard()).inbox).toMatchObject([{ reason: 'other', from: 'kevin@example.com', personName: 'Barry Strata' }]);

    await w.h.receive(BARRY, 'Old inbox');
    expect((await w.alice.dashboard()).inbox).toMatchObject([
      { reason: 'other', from: 'kevin@example.com', personName: 'Barry Strata' },
      { reason: 'unknown_sender', from: BARRY, personName: null },
    ]);
  });

  test('a missing contact and a bad email are refused naming the field, and nothing changes', async () => {
    const w = await world();

    expect((await refusal(w.alice.editBuildingManager(w.ids.barry, { name: 'Barry Strata' }))).fields).toEqual({ mobile: 'Enter a mobile number or email address' });
    expect((await refusal(w.alice.editBuildingManager(w.ids.barry, { name: 'Barry Strata', email: 'barry@' }))).fields).toEqual({ email: "barry@ isn't an email address" });
    expect((await w.alice.people('building_manager')).find((p) => p.id === w.ids.barry)).toMatchObject({ name: 'Barry Strata', mobile: null, email: BARRY });

    await w.alice.editBuildingManager(w.ids.barry, { name: 'Barry Strata', email: OLIVIA_EMAIL });
    expect((await w.alice.people('building_manager')).find((p) => p.id === w.ids.barry)).toMatchObject({ name: 'Barry Strata', email: OLIVIA_EMAIL });
    expect((await w.alice.people('owner')).find((p) => p.id === w.ids.olivia)).toMatchObject({ email: OLIVIA_EMAIL });
  });

  test("another Agency's Building Manager, and someone who is not a Building Manager, are not found", async () => {
    const w = await world();
    expect((await refusal((await sunrise(w)).sam.editBuildingManager(w.ids.barry, { name: 'Barry Strata', email: BARRY }))).code).toBe('not_found');
    expect((await refusal(w.alice.editBuildingManager(w.ids.olivia, { name: 'Olivia Owens', email: OLIVIA_EMAIL }))).code).toBe('not_found');
  });
});

describe('removing a Property Owner', () => {
  test('is refused while they own a Property, naming it, and allowed once they do not', async () => {
    const w = await world();

    expect(await refusal(w.alice.removeOwner(w.ids.olivia))).toMatchObject({
      message: `Olivia Owens owns ${KING_ST}. Give it another Property Owner first.`,
    });
    expect((await w.alice.people('owner')).map((p) => p.id)).toContain(w.ids.olivia);

    await w.alice.editProperty(w.ids.kingSt, {
      address: KING_ST,
      suburb: 'Newtown',
      ownerId: w.ids.oscar,
      propertyManagerId: w.ids.aliceId,
      maxRepairCostCents: 500_00,
      nominatedTradieIds: [w.ids.nina, w.ids.sam],
    });

    expect(await w.alice.removeOwner(w.ids.olivia)).toBe('Olivia Owens');
    expect((await w.alice.people('owner')).map((p) => p.id)).not.toContain(w.ids.olivia);
    expect((await refusal(w.alice.removeOwner(w.ids.olivia))).message).toBe('Olivia Owens has already been removed');
    expect((await refusal(w.alice.editOwner(w.ids.olivia, { name: 'Olivia Owens', email: 'olive@example.com' }))).message).toBe(
      'Olivia Owens has been removed from the Agency',
    );
  });

  test('their mobile and email no longer reach the Agency as them, and can be given to someone else', async () => {
    const w = await world();
    await w.alice.editProperty(w.ids.kingSt, {
      address: KING_ST,
      suburb: 'Newtown',
      ownerId: w.ids.oscar,
      propertyManagerId: w.ids.aliceId,
      maxRepairCostCents: 500_00,
      nominatedTradieIds: [w.ids.nina, w.ids.sam],
    });
    await w.alice.removeOwner(w.ids.olivia);

    await w.h.receive(OLIVIA, 'Did you get my approval?');
    await w.h.receive(OLIVIA_EMAIL, 'Checking my old email');
    expect((await w.alice.dashboard()).inbox).toMatchObject([
      { reason: 'unknown_sender', from: OLIVIA, personName: null },
      { reason: 'unknown_sender', from: OLIVIA_EMAIL, personName: null },
    ]);

    await w.alice.addOwner({ name: 'Olive New', mobile: OLIVIA, email: OLIVIA_EMAIL });
  });

  test("another Agency's Property Owner is not found", async () => {
    const w = await world();
    expect((await refusal((await sunrise(w)).sam.removeOwner(w.ids.olivia))).code).toBe('not_found');
    expect((await w.alice.people('owner')).map((p) => p.id)).toContain(w.ids.olivia);
  });
});

describe('removing a Building Manager', () => {
  test('is refused while they look after a Property, naming it, and allowed once they do not', async () => {
    const w = await world();

    expect((await refusal(w.alice.removeBuildingManager(w.ids.barry))).message).toBe(
      `Barry Strata looks after ${OCEAN_AVE}. Give it another Building Manager first.`,
    );
    expect((await w.alice.people('building_manager')).map((p) => p.id)).toContain(w.ids.barry);

    await w.alice.editProperty(w.ids.oceanAve, {
      address: OCEAN_AVE,
      suburb: 'Bondi',
      ownerId: w.ids.oscar,
      propertyManagerId: w.ids.bobId,
      maxRepairCostCents: 800_00,
      nominatedTradieIds: [],
    });

    expect(await w.alice.removeBuildingManager(w.ids.barry)).toBe('Barry Strata');
    expect((await w.alice.people('building_manager')).map((p) => p.id)).toEqual([]);

    await w.h.receive(BARRY, 'The foyer light is out');
    expect((await w.alice.dashboard()).inbox).toMatchObject([{ reason: 'unknown_sender', from: BARRY, personName: null }]);
    await w.alice.addBuildingManager({ name: 'Bea Strata', email: BARRY });
  });
});
