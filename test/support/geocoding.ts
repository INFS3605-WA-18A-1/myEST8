import { vi } from 'vitest';
import type { createApp } from '../../src/app.ts';

/** Replaces the global fetch with one that answers every request with a street-level point, and returns the requests it saw. Call vi.unstubAllGlobals() to undo. */
export function stubFetch() {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return Response.json([{ lat: '-33.897', lon: '151.179', place_rank: 30 }]);
  });
  return requests;
}

/** Signs an Agency up on `app` and adds a Property, which looks its address up. */
export async function addPropertyTo(app: ReturnType<typeof createApp>, address: string) {
  const propertyManagerId = await app.signUp({ agencyName: 'Sunrise Realty', timeZone: 'Australia/Brisbane', name: 'Sam Sun', email: 'sam@sunrise.example', password: 'sunrise-2026' });
  const sam = await app.asPropertyManager(propertyManagerId);
  const ownerId = await sam.addOwner({ name: 'Omar Owen', mobile: '+61400000998' });
  await sam.addProperty({ address, suburb: 'Newtown', ownerId, propertyManagerId, maxRepairCostCents: 300_00, nominatedTradieIds: [] });
}
