import type { Context } from './context.ts';
import type { ChannelType } from './ports.ts';
import { invalid, TRADES, type Role, type Trade } from './shared.ts';
import { formatWeekdayAndTime } from './zoned-time.ts';

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
  /** A pin the form already has. Used when it sits inside Australia; otherwise the address is geocoded. */
  location?: { lat: number; lng: number } | null;
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
     * `verified` marks the address as proved, for one myEST8 itself holds (an SMS number it bought, or one
     * from the Agency's own Twilio account), so no code is needed.
     */
    async connectChannel(agencyId: number, channelType: ChannelType, address: string, o: { verified?: boolean } = {}) {
      if (!CHANNEL_TYPES.includes(channelType)) invalid(`Unknown channel ${channelType}`);
      await profiles.connectChannel(agencyId, channelType, address);
      if (o.verified) await profiles.markChannelTested(agencyId, channelType);
    },

    /** Forgets the Agency's channel of this type, if it is still `address`. */
    async disconnectChannel(agencyId: number, channelType: ChannelType, address: string) {
      await profiles.disconnectChannel(agencyId, channelType, address);
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

    /**
     * Takes a Tradie out of the Agency (Profiles' removeTradie), keeping their Quotes, visits
     * and ratings. Refuses while they are asked to quote on a Job nobody has been chosen for,
     * have a Quote waiting on a Property Owner, or have a visit booked today or later.
     * Returns their business name.
     */
    async removeTradie(agencyId: number, tradieId: number) {
      const tradie = await profiles.personInAgency(agencyId, tradieId, 'tradie');
      const name = tradie.businessName ?? tradie.name;
      if (tradie.removedAt) invalid(`${name} has already been removed`);
      const [undecided] = await modules.quotes.undecidedJobsOf(tradieId);
      if (undecided) {
        const job = `${undecided.trade.replaceAll('_', ' ')} at ${undecided.propertyAddress}`;
        invalid(
          undecided.withOwner
            ? `${name} has a Quote waiting on the Property Owner for ${job}. Wait for their decision first.`
            : `${name} has an open Quote Request for ${job}. Choose a Quote or cancel the Job first.`,
        );
      }
      const [visit] = await modules.scheduling.visitStartsFromToday(agencyId, tradieId);
      if (visit) invalid(`${name} has a visit booked on ${formatWeekdayAndTime(visit, (await profiles.agency(agencyId)).timeZone)}. Cancel or finish it first.`);
      await profiles.removeTradie(tradieId);
      return name;
    },

    findGoogleListings(query: string) {
      return ports.places.findListings(query);
    },

    /**
     * A Google listing's details with the Trades Jev suggests for it. If suggesting fails
     * the details still come back, with no Trades and `tradesSuggested: false`, so the
     * form says to choose them: it never stops a Tradie being added.
     */
    async googleListing(placeId: string) {
      const listing = await ports.places.listingDetails(placeId);
      try {
        return { ...listing, suggestedTrades: await ports.tradeSuggester.suggestTrades(listing), tradesSuggested: true };
      } catch {
        return { ...listing, suggestedTrades: [] as Trade[], tradesSuggested: false };
      }
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
