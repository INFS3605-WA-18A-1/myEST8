import type { Context } from './context.ts';
import type { ChannelType } from './ports.ts';
import { invalid, TRADES, type Role, type Trade } from './shared.ts';

type Contact = { name: string; mobile?: string; email?: string };

export type TenantInput = Contact & { propertyId: number; tenancyStart: string };

export type TradieInput = Contact & { businessName: string; trades: Trade[]; startingRating: number } & (
    | { googlePlaceId: string; notOnGoogle?: never }
    | { notOnGoogle: true; googlePlaceId?: never }
  );

export type PropertyInput = {
  address: string;
  suburb: string;
  ownerId: number;
  propertyManagerId: number;
  maxRepairCostCents: number;
  nominatedTradieIds: number[];
  buildingManagerId?: number;
};

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

  async function requireRole(agencyId: number, id: number, role: Role) {
    await profiles.personInAgency(agencyId, id, role);
  }

  /** A Property Owner's or Building Manager's details, as addOwner and addBuildingManager check them. */
  function checkContact(input: Contact) {
    requireContact(input);
  }

  async function checkTenant(agencyId: number, input: TenantInput) {
    requireContact(input);
    requireDate(input.tenancyStart, 'tenancyStart');
    await profiles.propertyInAgency(agencyId, input.propertyId);
  }

  function checkTradie(input: TradieInput) {
    requireContact(input);
    if (!input.businessName.trim()) invalid('Enter the business name', 'businessName');
    if (!input.trades.length || input.trades.some((t) => !TRADES.includes(t))) invalid(`Choose Trades from: ${TRADES.join(', ')}`, 'trades');
    if (!Number.isInteger(input.startingRating) || input.startingRating < 1 || input.startingRating > 5) {
      invalid('The starting rating is a whole number from 1 to 5', 'startingRating');
    }
    if (!input.googlePlaceId && !input.notOnGoogle) invalid('Link the Tradie to their Google listing, or mark them as not on Google', 'googlePlaceId');
  }

  /** A Property, as addProperty checks it. Without `ownerId`, for a Property Owner who is added in the same go, the owner isn't checked. */
  async function checkProperty(agencyId: number, input: Omit<PropertyInput, 'ownerId'> & { ownerId?: number }) {
    if (!input.address.trim()) invalid('Enter the address and suburb', 'address');
    if (!input.suburb.trim()) invalid('Enter the address and suburb', 'suburb');
    if (!Number.isInteger(input.maxRepairCostCents) || input.maxRepairCostCents < 0) invalid('The Max Repair Cost must be zero or more', 'maxRepairCostCents');
    if (input.ownerId !== undefined) await requireRole(agencyId, input.ownerId, 'owner');
    if ((await profiles.propertyManager(input.propertyManagerId)).agencyId !== agencyId) invalid('Assign the Property to a Property Manager in your Agency', 'propertyManagerId');
    for (const id of input.nominatedTradieIds) await requireRole(agencyId, id, 'tradie');
    if (input.buildingManagerId !== undefined) await requireRole(agencyId, input.buildingManagerId, 'building_manager');
  }

  return {
    /**
     * Stores an address the caller has already proved (the demo seed, Gmail
     * OAuth, or confirmChannelVerification). A number typed into the channels
     * form goes through startChannelVerification and is not stored here.
     */
    async connectChannel(agencyId: number, channelType: ChannelType, address: string) {
      if (!CHANNEL_TYPES.includes(channelType)) invalid(`Unknown channel ${channelType}`);
      await profiles.connectChannel(agencyId, channelType, address);
    },

    async sendTestMessage(agencyId: number, channelType: ChannelType, to: string) {
      await modules.notifications.sendTest(agencyId, channelType, to);
      await profiles.markChannelTested(agencyId, channelType);
    },

    addOwner(agencyId: number, input: Contact) {
      checkContact(input);
      return profiles.addPerson(agencyId, { role: 'owner', ...input });
    },

    addBuildingManager(agencyId: number, input: Contact) {
      checkContact(input);
      return profiles.addPerson(agencyId, { role: 'building_manager', ...input });
    },

    async addTenant(agencyId: number, input: TenantInput) {
      await checkTenant(agencyId, input);
      return profiles.addPerson(agencyId, { role: 'tenant', ...input });
    },

    /**
     * Takes a Tenant off their Property (Profiles' endTenancy). Refuses while they have an
     * open Ticket or a Maintenance Request waiting, whose messages still need to reach them.
     */
    async removeTenant(agencyId: number, tenantId: number) {
      const tenant = await profiles.personInAgency(agencyId, tenantId, 'tenant');
      if (tenant.propertyId === null) invalid(`${tenant.name} has already left their Property`);
      const [open, waiting] = await Promise.all([modules.tickets.openTickets(agencyId, null), modules.tickets.maintenanceRequests(agencyId, null)]);
      if (open.some((t) => t.tenantId === tenantId)) invalid(`Close ${tenant.name}'s open Tickets before removing them`);
      if (waiting.some((i) => i.tenantId === tenantId)) invalid(`Confirm or reject ${tenant.name}'s waiting Maintenance Requests before removing them`);
      await profiles.endTenancy(tenantId);
      return tenant.name;
    },

    findGoogleListings(query: string) {
      return ports.places.findListings(query);
    },

    /** Adds a Tradie linked to their Google listing, or marked as not on Google. */
    async addTradie(agencyId: number, input: TradieInput) {
      checkTradie(input);
      const { notOnGoogle: _, ...person } = input;
      const id = await profiles.addPerson(agencyId, { role: 'tradie', ...person });
      await profiles.refreshGoogleRating(id);
      return id;
    },

    async addProperty(agencyId: number, input: PropertyInput) {
      await checkProperty(agencyId, input);
      return profiles.addProperty(agencyId, input);
    },

    // The checks each add action makes, for checking many rows before adding any
    // (a spreadsheet import). Each refuses the way its add action would.
    checkContact,
    checkTradie,
    checkTenant,
    checkProperty,
  };
}

export type Onboarding = ReturnType<typeof createOnboarding>;
