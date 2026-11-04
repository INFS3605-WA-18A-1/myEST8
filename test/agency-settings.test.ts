import { describe, expect, test } from 'vitest';
import { ActionError } from '../src/shared.ts';
import { PASSWORD, world } from './support/world.ts';

async function refusal(promise: Promise<unknown>): Promise<ActionError> {
  const error = await promise.then(() => null, (e: unknown) => e);
  if (!(error instanceof ActionError)) throw new Error(`Expected a refusal, got ${String(error)}`);
  return error;
}

describe("editing the Agency's details", () => {
  test('renames the Agency and changes its time zone', async () => {
    const w = await world();
    expect(await w.alice.editAgency({ name: '  Harbour Realty Group ', timeZone: 'Australia/Perth' })).toMatchObject({ name: 'Harbour Realty Group', timeZone: 'Australia/Perth' });
    expect(await w.bob.agency()).toMatchObject({ name: 'Harbour Realty Group', timeZone: 'Australia/Perth' });
  });

  test('refuses a blank name and an unknown time zone, each against its field', async () => {
    const w = await world();
    const error = await refusal(w.alice.editAgency({ name: ' ', timeZone: 'Mars/Olympus' }));
    expect(error.fields).toEqual({ name: "Enter your Agency's name", timeZone: 'Choose a time zone' });
    expect(await w.alice.agency()).toMatchObject({ name: 'Harbour Realty', timeZone: 'Australia/Sydney' });
  });
});

describe('removing a Property Manager', () => {
  test("hands their Properties to the colleague chosen, and they can't sign in again", async () => {
    const w = await world();
    const { bobId, aliceId, oceanAve } = w.ids;
    expect(await w.h.app.login('bob@harbour.example', PASSWORD)).toBe(bobId);
    expect(await w.alice.removePropertyManager(bobId, { handTo: aliceId })).toEqual({ name: 'Bob Baker', moved: 1 });
    expect((await w.alice.propertyManagers()).map((m) => m.name)).toEqual(['Alice Archer']);
    expect((await w.alice.properties()).find((p) => p.id === oceanAve)?.propertyManagerId).toBe(aliceId);
    expect(await w.h.app.login('bob@harbour.example', PASSWORD)).toBeNull();
  });

  test('needs someone to hand their Properties to while they manage any', async () => {
    const w = await world();
    const error = await refusal(w.alice.removePropertyManager(w.ids.bobId));
    expect(error.fields).toEqual({ handTo: "Choose who looks after Bob Baker's Properties" });
    // Not to themselves either.
    await refusal(w.alice.removePropertyManager(w.ids.bobId, { handTo: w.ids.bobId }));
    expect(await w.alice.propertyManagers()).toHaveLength(2);
  });

  test('removes a colleague with no Properties straight away', async () => {
    const w = await world();
    const { propertyManagerId } = await w.alice.addColleague({ name: 'Cara Cole', email: 'cara@harbour.example' });
    expect(await w.alice.removePropertyManager(propertyManagerId)).toEqual({ name: 'Cara Cole', moved: 0 });
  });

  test('refuses removing yourself, and anyone outside the Agency', async () => {
    const w = await world();
    expect((await refusal(w.alice.removePropertyManager(w.ids.aliceId))).message).toBe("You can't remove yourself. Ask a colleague to remove you.");
    expect((await refusal(w.alice.removePropertyManager(99_999))).code).toBe('not_found');
  });
});
