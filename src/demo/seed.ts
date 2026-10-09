// The demo Agency, added through the app's own onboarding actions so every
// record passes the same checks as one a Property Manager adds.

import type { App } from '../app.ts';
import type { ChannelType } from '../ports.ts';
import type { Trade } from '../shared.ts';

/** Every demo Property Manager's password. */
export const DEMO_PASSWORD = 'demo1234';

/** Harbour Realty's time zone. */
export const DEMO_TIME_ZONE = 'Australia/Sydney';

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

/** More Tradies, so every Trade has at least two to ask for Quotes. Added after everyone above so their ids never change. */
const MORE_TRADIES = {
  erin: { name: 'Erin Ellis', businessName: 'Ellis Electrical', mobile: '+61400000209', trades: ['electrical'], startingRating: 4, googlePlaceId: 'demo-ellis-electrical' },
  rhys: { name: 'Rhys Ridge', businessName: 'Ridgeline Roofing', mobile: '+61400000210', trades: ['roofing'], startingRating: 4, googlePlaceId: 'demo-ridgeline-roofing' },
  tess: { name: 'Tess Tiler', businessName: 'Topside Roofing', mobile: '+61400000211', trades: ['roofing'], startingRating: 3, googlePlaceId: null },
  arlo: { name: 'Arlo Ashby', businessName: 'Appliance Rescue', email: 'jobs@appliancerescue.example', trades: ['appliances'], startingRating: 3, googlePlaceId: 'demo-appliance-rescue' },
  harry: { name: 'Harry Hughes', businessName: "Handy Harry's", mobile: '+61400000213', trades: ['general_handyman', 'carpentry'], startingRating: 4, googlePlaceId: 'demo-handy-harry' },
  bea: { name: 'Bea Banks', businessName: 'Bugs Away Pest Control', mobile: '+61400000214', trades: ['pest_control'], startingRating: 4, googlePlaceId: 'demo-bugs-away' },
  mo: { name: 'Mo Mansour', businessName: 'Pest Patrol', mobile: '+61400000216', trades: ['pest_control'], startingRating: 4, googlePlaceId: null },
  kev: { name: 'Kev Keyes', businessName: 'Keystone Locksmiths', mobile: '+61400000215', trades: ['locksmith'], startingRating: 3, googlePlaceId: null },
} satisfies Record<string, TradieSeed>;

/** What the seed created: the Agency, who can sign in, and the ids a test or script may need. */
export type DemoSeed = Awaited<ReturnType<typeof seedDemo>>;

/**
 * Adds Harbour Realty: two Property Managers with five Properties each, their
 * Owners and Tenants, a Building Manager, and seventeen Tradies. The Tradies'
 * Google listings exist only in the mock Places API, so with
 * `googleListings: false` (real Google) they are added as not on Google.
 */
export async function seedDemo(app: App, options: { googleListings?: boolean } = {}) {
  const googleListings = options.googleListings ?? true;
  const agencyId = app.setup.createAgency({ name: 'Harbour Realty', timeZone: DEMO_TIME_ZONE });
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

  /** Adds each Tradie, linked to their mock Google listing when there is one, and returns their ids by key. */
  async function addTradies<K extends string>(list: Record<K, TradieSeed>) {
    const ids = {} as Record<K, number>;
    for (const [key, { googlePlaceId, ...tradie }] of Object.entries(list) as [K, TradieSeed][]) {
      ids[key] = await alice.addTradie(googlePlaceId && googleListings ? { ...tradie, googlePlaceId } : { ...tradie, notOnGoogle: true });
    }
    return ids;
  }

  const tradies = await addTradies(TRADIES);

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

  // Everything below came later, so the records above keep their ids.
  const more = await seedMore(app, { aliceId, bobId, tradies: { ...tradies, ...(await addTradies(MORE_TRADIES)) } });

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
      ...more,
    },
  };
}

/**
 * Three more Properties for each Property Manager, with their Owners and
 * Tenants: inner west for Alice, eastern suburbs for Bob. Australia St and
 * Bronte Rd are strata units with no Building Manager on file.
 */
async function seedMore(app: App, { aliceId, bobId, tradies }: { aliceId: number; bobId: number; tradies: Record<keyof typeof TRADIES | keyof typeof MORE_TRADIES, number> }) {
  const alice = app.asPropertyManager(aliceId);
  const bob = app.asPropertyManager(bobId);

  const grace = alice.addOwner({ name: 'Grace Green', mobile: '+61400000102', email: 'grace@example.com' });
  const henry = alice.addOwner({ name: 'Henry Hill', mobile: '+61400000103', email: 'henry@example.com' });
  const isla = bob.addOwner({ name: 'Isla Irwin', mobile: '+61400000104', email: 'isla@example.com' });
  const jack = bob.addOwner({ name: 'Jack Jones', mobile: '+61400000105' });

  const australiaSt = await alice.addProperty({
    address: '2/31 Australia St, Camperdown NSW 2050',
    suburb: 'Camperdown',
    ownerId: grace,
    propertyManagerId: aliceId,
    maxRepairCostCents: 500_00,
    nominatedTradieIds: [tradies.sam],
  });
  const albionSt = await alice.addProperty({
    address: '9 Albion St, Annandale NSW 2038',
    suburb: 'Annandale',
    ownerId: grace,
    propertyManagerId: aliceId,
    maxRepairCostCents: 700_00,
    nominatedTradieIds: [tradies.dana, tradies.erin],
  });
  const llewellynSt = await alice.addProperty({
    address: '27 Llewellyn St, Marrickville NSW 2204',
    suburb: 'Marrickville',
    ownerId: henry,
    propertyManagerId: aliceId,
    maxRepairCostCents: 400_00,
    nominatedTradieIds: [tradies.dana, tradies.lucy],
  });
  const glenmoreRd = await bob.addProperty({
    address: '17 Glenmore Rd, Paddington NSW 2021',
    suburb: 'Paddington',
    ownerId: isla,
    propertyManagerId: bobId,
    maxRepairCostCents: 600_00,
    nominatedTradieIds: [tradies.finn],
  });
  const coogeeBayRd = await bob.addProperty({
    address: '42 Coogee Bay Rd, Coogee NSW 2034',
    suburb: 'Coogee',
    ownerId: isla,
    propertyManagerId: bobId,
    maxRepairCostCents: 800_00,
    nominatedTradieIds: [tradies.finn, tradies.erin],
  });
  const bronteRd = await bob.addProperty({
    address: '3/15 Bronte Rd, Bondi Junction NSW 2022',
    suburb: 'Bondi Junction',
    ownerId: jack,
    propertyManagerId: bobId,
    maxRepairCostCents: 500_00,
    nominatedTradieIds: [],
  });

  const tenants = {
    liam: alice.addTenant({ name: 'Liam Lee', mobile: '+61400000005', propertyId: australiaSt, tenancyStart: '2025-09-01' }),
    maya: alice.addTenant({ name: 'Maya Morris', mobile: '+61400000006', email: 'maya@example.com', propertyId: albionSt, tenancyStart: '2024-06-15' }),
    noah: alice.addTenant({ name: 'Noah Nair', mobile: '+61400000007', propertyId: llewellynSt, tenancyStart: '2025-03-01' }),
    kai: alice.addTenant({ name: 'Kai Kelly', mobile: '+61400000008', propertyId: llewellynSt, tenancyStart: '2025-03-01' }),
    ruby: bob.addTenant({ name: 'Ruby Russo', mobile: '+61400000009', propertyId: glenmoreRd, tenancyStart: '2026-08-17' }),
    ethan: bob.addTenant({ name: 'Ethan Evans', mobile: '+61400000010', propertyId: coogeeBayRd, tenancyStart: '2025-11-01' }),
    sofia: bob.addTenant({ name: 'Sofia Silva', mobile: '+61400000011', email: 'sofia@example.com', propertyId: coogeeBayRd, tenancyStart: '2025-11-01' }),
    omar: bob.addTenant({ name: 'Omar Odeh', mobile: '+61400000012', propertyId: bronteRd, tenancyStart: '2026-02-01' }),
  };

  return {
    ...tradies,
    grace,
    henry,
    isla,
    jack,
    ...tenants,
    australiaSt,
    albionSt,
    llewellynSt,
    glenmoreRd,
    coogeeBayRd,
    bronteRd,
  };
}
