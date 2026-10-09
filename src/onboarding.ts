import type { Context } from './context.ts';
import type { ChannelType } from './ports.ts';
import { invalid, TRADES, type Role, type Trade } from './shared.ts';

type Contact = { name: string; mobile?: string; email?: string };

const CHANNEL_TYPES: ChannelType[] = ['sms', 'whatsapp', 'email'];

function requireContact(input: Contact) {
  if (!input.name.trim()) invalid('Enter a name', 'name');
  if (!input.mobile && !input.email) invalid('Enter a mobile number or email address', 'mobile');
}

function requireDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) invalid(`${value} is not a date (YYYY-MM-DD)`, field);
}

/** Connecting the Agency's channels, test messages, and the forms for Properties, people and Tradies. */
export function createOnboarding({ ports, modules }: Context) {
  const { profiles } = modules;

  function requireRole(agencyId: number, id: number, role: Role) {
    profiles.personInAgency(agencyId, id, role);
  }

  return {
    connectChannel(agencyId: number, channelType: ChannelType, address: string) {
      if (!CHANNEL_TYPES.includes(channelType)) invalid(`Unknown channel ${channelType}`);
      profiles.connectChannel(agencyId, channelType, address);
    },

    async sendTestMessage(agencyId: number, channelType: ChannelType, to: string) {
      await modules.notifications.sendTest(agencyId, channelType, to);
      profiles.markChannelTested(agencyId, channelType);
    },

    addOwner(agencyId: number, input: Contact) {
      requireContact(input);
      return profiles.addPerson(agencyId, { role: 'owner', ...input });
    },

    addBuildingManager(agencyId: number, input: Contact) {
      requireContact(input);
      return profiles.addPerson(agencyId, { role: 'building_manager', ...input });
    },

    addTenant(agencyId: number, input: Contact & { propertyId: number; tenancyStart: string }) {
      requireContact(input);
      requireDate(input.tenancyStart, 'tenancyStart');
      profiles.propertyInAgency(agencyId, input.propertyId);
      return profiles.addPerson(agencyId, { role: 'tenant', ...input });
    },

    findGoogleListings(query: string) {
      return ports.places.findListings(query);
    },

    /** Adds a Tradie linked to their Google listing, or marked as not on Google. */
    async addTradie(
      agencyId: number,
      input: Contact & { businessName: string; trades: Trade[]; startingRating: number } & (
          | { googlePlaceId: string; notOnGoogle?: never }
          | { notOnGoogle: true; googlePlaceId?: never }
        ),
    ) {
      requireContact(input);
      if (!input.businessName.trim()) invalid('Enter the business name', 'businessName');
      if (!input.trades.length || input.trades.some((t) => !TRADES.includes(t))) invalid(`Choose Trades from: ${TRADES.join(', ')}`, 'trades');
      if (!Number.isInteger(input.startingRating) || input.startingRating < 1 || input.startingRating > 5) {
        invalid('The starting rating is a whole number from 1 to 5', 'startingRating');
      }
      if (!input.googlePlaceId && !input.notOnGoogle) invalid('Link the Tradie to their Google listing, or mark them as not on Google', 'googlePlaceId');
      const { notOnGoogle: _, ...person } = input;
      const id = profiles.addPerson(agencyId, { role: 'tradie', ...person });
      await profiles.refreshGoogleRating(id);
      return id;
    },

    async addProperty(
      agencyId: number,
      input: {
        address: string;
        suburb: string;
        ownerId: number;
        propertyManagerId: number;
        maxRepairCostCents: number;
        nominatedTradieIds: number[];
        buildingManagerId?: number;
      },
    ) {
      if (!input.address.trim()) invalid('Enter the address and suburb', 'address');
      if (!input.suburb.trim()) invalid('Enter the address and suburb', 'suburb');
      if (!Number.isInteger(input.maxRepairCostCents) || input.maxRepairCostCents < 0) invalid('The Max Repair Cost must be zero or more', 'maxRepairCostCents');
      requireRole(agencyId, input.ownerId, 'owner');
      if (profiles.propertyManager(input.propertyManagerId).agencyId !== agencyId) invalid('Assign the Property to a Property Manager in your Agency');
      input.nominatedTradieIds.forEach((id) => requireRole(agencyId, id, 'tradie'));
      if (input.buildingManagerId !== undefined) requireRole(agencyId, input.buildingManagerId, 'building_manager');
      return profiles.addProperty(agencyId, input);
    },
  };
}

export type Onboarding = ReturnType<typeof createOnboarding>;
