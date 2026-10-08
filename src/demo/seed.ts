// The demo Agency, added through the app's own onboarding actions so every
// record passes the same checks as one a Property Manager adds.

import type { App } from '../app.ts';
import type { ChannelType } from '../ports.ts';
import type { Trade } from '../shared.ts';

/** Every demo Property Manager's password. */
export const DEMO_PASSWORD = 'demo1234';

/** The Agency's own channel addresses: where Tenants, Tradies and Owners send to. */
export const DEMO_CHANNELS: Record<ChannelType, string> = {
  sms: '+61290000000',
  whatsapp: '+61290000000',
  email: 'inbox@harbour.example',
};

type TradieSeed = {
  name: string;
  businessName: string;
  mobile?: string;
  email?: string;
  trades: Trade[];
  startingRating: number;
  /** A placeId from DEMO_PLACES, or null when the Tradie isn't on Google. */
  googlePlaceId: string | null;
};

const TRADIES = {
  pete: { name: 'Pete Park', businessName: "Pete's Plumbing", mobile: '+61400000200', trades: ['plumbing'], startingRating: 4, googlePlaceId: 'demo-petes-plumbing' },
  quinn: { name: 'Quinn Quick', businessName: 'Quick Pipes', email: 'quotes@quickpipes.example', trades: ['plumbing'], startingRating: 4, googlePlaceId: 'demo-quick-pipes' },
  dana: { name: 'Dana Drip', businessName: 'Drip Doctors', mobile: '+61400000202', trades: ['plumbing'], startingRating: 5, googlePlaceId: null },
  finn: { name: 'Finn Flow', businessName: 'Flow Bros Plumbing', mobile: '+61400000203', trades: ['plumbing'], startingRating: 3, googlePlaceId: 'demo-flow-bros' },
  nina: { name: 'Nina Nguyen', businessName: "Nina's Plumbing", mobile: '+61400000204', trades: ['plumbing'], startingRating: 4, googlePlaceId: 'demo-ninas-plumbing' },
  sam: { name: 'Sam Spark', businessName: 'Sparky Sam Electrical', mobile: '+61400000205', trades: ['electrical'], startingRating: 4, googlePlaceId: 'demo-sparky-sam' },
  carl: { name: 'Carl Cutter', businessName: 'FixIt Carpentry', mobile: '+61400000206', trades: ['carpentry', 'general_handyman'], startingRating: 4, googlePlaceId: 'demo-fixit-carpentry' },
  ally: { name: 'Ally Appleby', businessName: 'Cool Appliance Repairs', email: 'ally@coolappliances.example', trades: ['appliances'], startingRating: 4, googlePlaceId: 'demo-cool-appliances' },
  lucy: { name: 'Lucy Lock', businessName: "Lucy's Locksmiths", mobile: '+61400000208', trades: ['locksmith'], startingRating: 5, googlePlaceId: null },
} satisfies Record<string, TradieSeed>;

/** What the seed created: the Agency, who can sign in, and the ids a test or script may need. */
export type DemoSeed = Awaited<ReturnType<typeof seedDemo>>;

/**
 * Adds Harbour Realty: two Property Managers, four Properties, their Owners and
 * Tenants, and nine Tradies. The Tradies' Google listings exist only in the mock
 * Places API, so with `googleListings: false` (real Google) they are added as not on Google.
 */
export async function seedDemo(app: App, options: { googleListings?: boolean } = {}) {
  const googleListings = options.googleListings ?? true;
  const agencyId = app.setup.createAgency({ name: 'Harbour Realty', timeZone: 'Australia/Sydney' });
  const logins = [
    { name: 'Alice Archer', email: 'alice@harbour.example', password: DEMO_PASSWORD },
    { name: 'Bob Baker', email: 'bob@harbour.example', password: DEMO_PASSWORD },
  ];
  const [aliceId, bobId] = logins.map((login) => app.setup.addPropertyManager(agencyId, login)) as [number, number];
  const alice = app.asPropertyManager(aliceId);
  const bob = app.asPropertyManager(bobId);

  for (const [channelType, address] of Object.entries(DEMO_CHANNELS) as [ChannelType, string][]) {
    alice.connectChannel(channelType, address);
  }

  const tradies = {} as Record<keyof typeof TRADIES, number>;
  for (const [key, { googlePlaceId, ...tradie }] of Object.entries(TRADIES) as [keyof typeof TRADIES, TradieSeed][]) {
    tradies[key] = await alice.addTradie(googlePlaceId && googleListings ? { ...tradie, googlePlaceId } : { ...tradie, notOnGoogle: true });
  }

  const olivia = alice.addOwner({ name: 'Olivia Owens', mobile: '+61400000100', email: 'olivia@example.com' });
  const oscar = bob.addOwner({ name: 'Oscar Ortiz', mobile: '+61400000101' });
  const barry = bob.addBuildingManager({ name: 'Barry Strata', email: 'barry@strata.example' });

  const kingSt = await alice.addProperty({
    address: '12 King St, Newtown NSW 2042',
    suburb: 'Newtown',
    ownerId: olivia,
    propertyManagerId: aliceId,
    maxRepairCostCents: 500_00,
    nominatedTradieIds: [tradies.nina, tradies.sam],
  });
  const oceanAve = await bob.addProperty({
    address: '5/40 Ocean Ave, Bondi NSW 2026',
    suburb: 'Bondi',
    ownerId: oscar,
    propertyManagerId: bobId,
    maxRepairCostCents: 800_00,
    nominatedTradieIds: [],
    buildingManagerId: barry,
  });
  const wilsonSt = await alice.addProperty({
    address: '7 Wilson St, Newtown NSW 2042',
    suburb: 'Newtown',
    ownerId: olivia,
    propertyManagerId: aliceId,
    maxRepairCostCents: 600_00,
    nominatedTradieIds: [],
  });
  const glebePointRd = await bob.addProperty({
    address: '21 Glebe Point Rd, Glebe NSW 2037',
    suburb: 'Glebe',
    ownerId: oscar,
    propertyManagerId: bobId,
    maxRepairCostCents: 400_00,
    nominatedTradieIds: [],
  });

  const tenants = {
    tom: alice.addTenant({ name: 'Tom Tran', mobile: '+61400000001', propertyId: kingSt, tenancyStart: '2025-01-01' }),
    hana: alice.addTenant({ name: 'Hana Ho', mobile: '+61400000002', propertyId: kingSt, tenancyStart: '2025-01-01' }),
    bella: bob.addTenant({ name: 'Bella Bui', email: 'bella@example.com', propertyId: oceanAve, tenancyStart: '2026-03-01' }),
    wei: alice.addTenant({ name: 'Wei Zhang', mobile: '+61400000003', propertyId: wilsonSt, tenancyStart: '2025-07-01' }),
    priya: bob.addTenant({ name: 'Priya Patel', mobile: '+61400000004', email: 'priya@example.com', propertyId: glebePointRd, tenancyStart: '2024-11-01' }),
  };

  return {
    agencyId,
    logins,
    ids: {
      aliceId,
      bobId,
      ...tradies,
      olivia,
      oscar,
      barry,
      ...tenants,
      kingSt,
      oceanAve,
      wilsonSt,
      glebePointRd,
    },
  };
}
