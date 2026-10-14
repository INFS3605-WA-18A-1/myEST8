import { describe, expect, test } from 'vitest';
import type { Context, Modules } from '../src/context.ts';
import { createOnboarding, type PropertyWithPeopleInput } from '../src/onboarding.ts';
import { createProfiles } from '../src/profiles.ts';
import { ActionError } from '../src/shared.ts';
import { OLIVIA, OLIVIA_EMAIL, TOM, world, type World } from './support/world.ts';

const SUN_ST = '3 Sun St, Newtown NSW 2042';

/** A new Property with a new Property Owner and one new Tenant, with `changes` applied. */
function sunSt(w: World, changes: Partial<PropertyWithPeopleInput> = {}): PropertyWithPeopleInput {
  return {
    address: SUN_ST,
    suburb: 'Newtown',
    maxRepairCostCents: 30_000,
    propertyManagerId: w.ids.aliceId,
    nominatedTradieIds: [w.ids.pete],
    owner: { name: 'Omar Owen', mobile: '0400 000 998' },
    buildingManager: null,
    tenants: [{ name: 'Tina Tan', mobile: '0400 000 999', tenancyStart: '2026-01-01' }],
    ...changes,
  };
}

/** The refusal an action throws, with the fields it names. */
async function refusal(promise: Promise<unknown>): Promise<ActionError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ActionError) return error;
    throw error;
  }
  throw new Error('Expected the action to be refused');
}

describe('adding a Property with its people', () => {
  test('adds the Property, a new Property Owner and its Tenant together', async () => {
    const w = await world();
    w.h.places.locations.set(SUN_ST, { lat: -33.9, lng: 151.18 });

    const added = await w.alice.addPropertyWithPeople(sunSt(w));

    const property = (await w.alice.properties()).find((p) => p.id === added.propertyId)!;
    expect(property).toMatchObject({ address: SUN_ST, ownerId: added.ownerId, maxRepairCostCents: 30_000, nominatedTradieIds: [w.ids.pete], location: { lat: -33.9, lng: 151.18 } });
    const people = await w.alice.people();
    expect(people.find((p) => p.id === added.ownerId)).toMatchObject({ role: 'owner', name: 'Omar Owen', mobile: '+61400000998' });
    expect(added.tenantIds).toHaveLength(1);
    expect(people.find((p) => p.id === added.tenantIds[0])).toMatchObject({ role: 'tenant', name: 'Tina Tan', propertyId: added.propertyId, tenancyStart: '2026-01-01' });
  });

  test('reuses a Property Owner the Agency has, by id or by their mobile or email, instead of adding them twice', async () => {
    const w = await world();
    const owners = async () => (await w.alice.people('owner')).length;
    const before = await owners();

    const byContact = await w.alice.addPropertyWithPeople(sunSt(w, { owner: { name: 'Olivia', email: OLIVIA_EMAIL.toUpperCase() } }));
    expect(byContact.ownerId).toBe(w.ids.olivia);
    const byId = await w.alice.addPropertyWithPeople(sunSt(w, { address: '5 Sun St, Newtown NSW 2042', owner: { id: w.ids.olivia }, tenants: [] }));
    expect(byId.ownerId).toBe(w.ids.olivia);
    expect(await owners()).toBe(before);
  });

  test("a mobile or email someone else in the Agency has is refused next to its field, with every other problem, and nothing is added", async () => {
    const w = await world();
    const before = (await w.alice.properties()).length;

    const error = await refusal(
      w.alice.addPropertyWithPeople(
        sunSt(w, {
          address: ' ',
          owner: { name: 'Omar Owen', mobile: TOM },
          tenants: [{ name: '', email: OLIVIA_EMAIL, tenancyStart: 'last year' }],
        }),
      ),
    );

    expect(error.fields).toEqual({
      address: 'Enter the address',
      'owner.mobile': `${TOM} already belongs to Tom Tran, a Tenant`,
      'tenants.0.name': "Enter the Tenant's name",
      'tenants.0.email': `${OLIVIA_EMAIL} already belongs to Olivia Owens, a Property Owner`,
      'tenants.0.tenancyStart': 'Enter the date the tenancy started',
    });
    expect(error.message).toBe('Enter the address');
    expect((await w.alice.properties()).length).toBe(before);
    expect((await w.alice.people('owner')).map((p) => p.name)).not.toContain('Omar Owen');
  });

  test('two people in the same form cannot share a mobile, and a Tenant is never matched to one the Agency has', async () => {
    const w = await world();

    const shared = await refusal(w.alice.addPropertyWithPeople(sunSt(w, { tenants: [{ name: 'Tina Tan', mobile: '0400 000 998', tenancyStart: '2026-01-01' }] })));
    expect(shared.fields).toEqual({ 'tenants.0.mobile': "0400 000 998 is also the Property Owner's. Each person needs their own." });

    const existingTenant = await refusal(w.alice.addPropertyWithPeople(sunSt(w, { tenants: [{ name: 'Tom Again', mobile: TOM, tenancyStart: '2026-01-01' }] })));
    expect(existingTenant.fields).toEqual({ 'tenants.0.mobile': `${TOM} already belongs to Tom Tran, a Tenant` });

    const notAnOwner = await refusal(w.alice.addPropertyWithPeople(sunSt(w, { owner: { id: w.ids.tom }, buildingManager: { name: 'Bo', mobile: OLIVIA } })));
    expect(notAnOwner.fields).toEqual({
      owner: 'Choose a Property Owner in your Agency',
      'buildingManager.mobile': `${OLIVIA} already belongs to Olivia Owens, a Property Owner`,
    });
  });

  test('when adding the Tenant fails, the Property and its new Property Owner are not left behind', async () => {
    const w = await world();
    // The onboarding core over the same database, whose Tenant insert fails after the Property is added.
    const ctx = { db: w.h.db, clock: w.h.clock, ports: { places: w.h.places }, modules: {} as Modules } as unknown as Context;
    const profiles = createProfiles(ctx);
    ctx.modules.profiles = {
      ...profiles,
      async addPerson(agencyId, input) {
        if (input.role === 'tenant') throw new Error('the database went away');
        return profiles.addPerson(agencyId, input);
      },
    };
    const onboarding = createOnboarding(ctx);
    const properties = (await w.alice.properties()).length;
    const owners = (await w.alice.people('owner')).length;

    await expect(onboarding.addPropertyWithPeople(w.ids.agencyId, sunSt(w))).rejects.toThrow('the database went away');

    expect((await w.alice.properties()).length).toBe(properties);
    expect((await w.alice.people('owner')).length).toBe(owners);
    // Resubmitting once the fault is gone adds it once.
    await w.alice.addPropertyWithPeople(sunSt(w));
    expect((await w.alice.properties()).filter((p) => p.address === SUN_ST)).toHaveLength(1);
  });
});
