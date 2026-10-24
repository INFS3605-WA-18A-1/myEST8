import { describe, expect, test } from 'vitest';
import { ActionError } from '../src/shared.ts';
import { HANA_EMAIL, OLIVIA, world } from './support/world.ts';

/** The refusal an action throws, to check its code and the field it names. */
async function refusal(action: Promise<unknown>) {
  const error = await action.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ActionError);
  return error as ActionError;
}

describe('a shared contact address', () => {
  test("adding an Owner with a Tenant's email succeeds and both keep it", async () => {
    const w = await world();

    const kevin = await w.alice.addOwner({ name: 'Kevin He', email: HANA_EMAIL });

    expect((await w.alice.people('tenant')).find((p) => p.id === w.ids.hana)).toMatchObject({ name: 'Hana Ho', email: 'hana@example.com' });
    expect((await w.alice.people('owner')).find((p) => p.id === kevin)).toMatchObject({ name: 'Kevin He', email: 'hana@example.com' });
  });

  test("editing a Tradie to an Owner's mobile succeeds and both keep it", async () => {
    const w = await world();

    await w.alice.editTradie(w.ids.pete, { name: 'Pete Park', businessName: "Pete's Plumbing", mobile: OLIVIA, trades: ['plumbing'] });

    expect(await w.alice.tradie(w.ids.pete)).toMatchObject({ name: 'Pete Park', mobile: '+61400000100' });
    expect((await w.alice.people('owner')).find((p) => p.id === w.ids.olivia)).toMatchObject({ name: 'Olivia Owens', mobile: '+61400000100' });
  });

  test('a sign-in email the Agency already has is still refused', async () => {
    const w = await world();

    expect((await refusal(w.alice.addColleague({ name: 'Ada Archer', email: 'Alice@Harbour.example' }))).fields).toEqual({
      email: 'An account with that email already exists',
    });
  });
});
