import type { Context } from './context.ts';
import { transaction } from './db.ts';
import type { ChannelType, SmsNumbers } from './ports.ts';
import { ActionError, invalid, isEmail, normalizeAddress, TRADES, type Role, type Trade } from './shared.ts';

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

/** A Property Owner or Building Manager the Agency has (by id), or a new one (by contact). */
export type PersonChoice = { id: number } | Contact;

/** A Property with the people it comes with, added together by addPropertyWithPeople. */
export type PropertyWithPeopleInput = {
  address: string;
  suburb: string;
  maxRepairCostCents: number;
  propertyManagerId: number;
  nominatedTradieIds: number[];
  owner: PersonChoice;
  buildingManager?: PersonChoice | null;
  /** New Tenants on the lease, each with when their tenancy started. May be none. */
  tenants: (Contact & { tenancyStart: string })[];
};

/** What each role is called on screen and in refusals. */
export const ROLE_LABEL: Record<Role, string> = { tenant: 'Tenant', owner: 'Property Owner', tradie: 'Tradie', building_manager: 'Building Manager' };

type Holder = { name: string; role: Role; mobile: string | null; email: string | null };

/** Who in the Agency already has each mobile and email, by normalised address: what holderOf looks in. */
export function contactHolders<P extends Holder>(people: P[]): Map<string, P> {
  const holders = new Map<string, P>();
  for (const person of people) for (const a of [person.mobile, person.email]) if (a) holders.set(normalizeAddress(a), person);
  return holders;
}

/**
 * The duplicate check for one mobile or email given to someone with `role`: who in
 * the Agency already has it, or null. `sameRole` says whether they could be the same
 * person (to reuse or skip); `message` is the refusal when they can't be.
 */
export function holderOf<P extends Holder>(holders: Map<string, P>, address: string, role: Role): { holder: P; sameRole: boolean; message: string } | null {
  const holder = holders.get(normalizeAddress(address));
  if (!holder) return null;
  return { holder, sameRole: holder.role === role, message: `${address} already belongs to ${holder.name}, a ${ROLE_LABEL[holder.role]}` };
}

/** Whether `value` is a real calendar date written YYYY-MM-DD. */
function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

const CHANNEL_TYPES: ChannelType[] = ['sms', 'whatsapp', 'email'];

/** A made-up channel address for an Agency, unique to it (an address can belong to only one Agency): what a simulated channel connects to. */
export function simulatedAddress(type: ChannelType, agency: { id: number; name: string }) {
  if (type === 'email') {
    const slug = agency.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agency';
    return `inbox@${slug}-${agency.id}.example`;
  }
  return `+61 2 9100 ${String(agency.id).padStart(4, '0')}`;
}

/** Whether a phone number is one `simulatedAddress` made up. */
export function isSimulatedNumber(address: string) {
  return /^\+6129100\d{4}$/.test(normalizeAddress(address));
}

function requireContact(input: Contact) {
  if (!input.name.trim()) invalid('Enter a name', 'name');
  if (!input.mobile && !input.email) invalid('Enter a mobile number or email address', 'mobile');
}

function requireDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) invalid(`${value} is not a date (YYYY-MM-DD)`, field);
}

/** Connecting the Agency's channels, test messages, and the forms for Properties, people and Tradies. */
export function createOnboarding({ db, ports, modules }: Context, smsNumbers: SmsNumbers | null = null) {
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

  /**
   * Everything wrong with a Property and its people, by field ("address",
   * "owner.mobile", "tenants.0.tenancyStart"), with the Property Owner and Building
   * Manager to reuse: one the Agency has, chosen by id or matched by mobile or email.
   */
  async function propertyWithPeopleProblems(agencyId: number, input: PropertyWithPeopleInput) {
    const problems: Record<string, string> = {};
    const problem = (field: string, message: string) => {
      problems[field] ??= message;
    };
    if (!input.address.trim()) problem('address', 'Enter the address');
    if (!input.suburb.trim()) problem('suburb', 'Enter the suburb');
    if (!Number.isInteger(input.maxRepairCostCents) || input.maxRepairCostCents < 0) problem('maxRepairCostCents', 'The Max Repair Cost must be zero or more');
    if (!(await profiles.propertyManagers(agencyId)).some((m) => m.id === input.propertyManagerId)) {
      problem('propertyManagerId', 'Choose a Property Manager in your Agency');
    }

    const people = await profiles.people(agencyId);
    const tradieIds = new Set(people.filter((p) => p.role === 'tradie').map((p) => p.id));
    if (input.nominatedTradieIds.some((id) => !tradieIds.has(id))) problem('nominatedTradieIds', 'Choose Tradies from the list');

    const holders = contactHolders(people);
    /** Each mobile and email in this form, with whose it is, so two people in it can't share one. */
    const usedInForm = new Map<string, string>();

    /** Checks one person; returns the existing person with `role` to use instead, if any. */
    function checkPerson(scope: string, label: string, role: Role, choice: PersonChoice, reuse: boolean): number | null {
      const at = (f: string) => `${scope}.${f}`;
      if ('id' in choice) {
        if (!people.some((p) => p.id === choice.id && p.role === role)) problem(scope, `Choose a ${label} in your Agency`);
        return choice.id;
      }
      if (!choice.name.trim()) problem(at('name'), `Enter the ${label}'s name`);
      if (!choice.mobile && !choice.email) problem(at('mobile'), 'Enter a mobile number or email address');
      if (choice.mobile && !/^\+?\d{8,15}$/.test(normalizeAddress(choice.mobile))) problem(at('mobile'), 'Enter a mobile number, like 0412 345 678');
      if (choice.email && !isEmail(choice.email)) problem(at('email'), `${choice.email} isn't an email address`);
      let existing: number | null = null;
      for (const [f, value] of [['mobile', choice.mobile], ['email', choice.email]] as const) {
        if (!value || problems[at(f)]) continue;
        const key = normalizeAddress(value);
        const other = usedInForm.get(key);
        if (other) {
          problem(at(f), `${value} is also the ${other}'s. Each person needs their own.`);
          continue;
        }
        usedInForm.set(key, label);
        const held = holderOf(holders, value, role);
        if (!held) continue;
        if (reuse && held.sameRole && (existing === null || existing === held.holder.id)) existing = held.holder.id;
        else problem(at(f), held.message);
      }
      return existing;
    }

    const ownerId = checkPerson('owner', 'Property Owner', 'owner', input.owner, true);
    input.tenants.forEach((tenant, i) => {
      checkPerson(`tenants.${i}`, 'Tenant', 'tenant', tenant, false);
      if (!isDate(tenant.tenancyStart)) problem(`tenants.${i}.tenancyStart`, 'Enter the date the tenancy started');
    });
    const buildingManagerId = input.buildingManager ? checkPerson('buildingManager', 'Building Manager', 'building_manager', input.buildingManager, true) : null;
    return { problems, ownerId, buildingManagerId };
  }

  /** Refuses with every problem by field; the message is the first one. */
  function refuseIfAny(problems: Record<string, string>) {
    const [first] = Object.values(problems);
    if (first) throw new ActionError('invalid', first, problems);
  }

  return {
    /**
     * Adds a Property with its Property Owner, any Building Manager and its Tenants,
     * all or nothing: every field is checked first (a refusal names each field at
     * fault), then everything is added in one transaction, so a failure part way
     * leaves no Property, Property Owner or Tenant behind. A Property Owner or
     * Building Manager whose mobile or email the Agency already has is reused, not
     * added twice; a mobile or email that belongs to someone else is refused.
     */
    async addPropertyWithPeople(agencyId: number, input: PropertyWithPeopleInput) {
      refuseIfAny((await propertyWithPeopleProblems(agencyId, input)).problems);
      // Looked up before the transaction: it never waits on an external API.
      const location = await ports.places.geocode(input.address);
      return transaction(db, async () => {
        // Checked again inside, so two submits of the same people can't both pass.
        const { problems, ownerId: existingOwner, buildingManagerId: existingBuildingManager } = await propertyWithPeopleProblems(agencyId, input);
        refuseIfAny(problems);
        const addNew = (role: 'owner' | 'building_manager', choice: Contact, existing: number | null) =>
          existing ?? profiles.addPerson(agencyId, { role, name: choice.name.trim(), mobile: choice.mobile, email: choice.email });
        const ownerId = 'id' in input.owner ? input.owner.id : await addNew('owner', input.owner, existingOwner);
        const bm = input.buildingManager;
        const buildingManagerId = !bm ? null : 'id' in bm ? bm.id : await addNew('building_manager', bm, existingBuildingManager);
        const propertyId = await profiles.addProperty(agencyId, {
          address: input.address.trim(),
          suburb: input.suburb.trim(),
          ownerId,
          propertyManagerId: input.propertyManagerId,
          maxRepairCostCents: input.maxRepairCostCents,
          nominatedTradieIds: input.nominatedTradieIds,
          buildingManagerId,
          location,
        });
        const tenantIds: number[] = [];
        for (const t of input.tenants) {
          tenantIds.push(await profiles.addPerson(agencyId, { role: 'tenant', name: t.name.trim(), mobile: t.mobile, email: t.email, propertyId, tenancyStart: t.tenancyStart }));
        }
        return { propertyId, ownerId, buildingManagerId, tenantIds };
      });
    },

    async connectChannel(agencyId: number, channelType: ChannelType, address: string) {
      if (!CHANNEL_TYPES.includes(channelType)) invalid(`Unknown channel ${channelType}`);
      await profiles.connectChannel(agencyId, channelType, address);
    },

    /** Connects each channel to a made-up address for the phone simulator and counts it as tested: for channels with no real provider. */
    async connectSimulatedChannels(agencyId: number, types: ChannelType[]) {
      const agency = await profiles.agency(agencyId);
      for (const type of types) {
        await profiles.connectChannel(agencyId, type, simulatedAddress(type, agency));
        await profiles.markChannelTested(agencyId, type);
      }
    },

    /** Gets the Agency an SMS number of its own and connects it, in place of any simulated one. Returns the number. */
    async getSmsNumber(agencyId: number) {
      if (!smsNumbers) invalid('SMS numbers are not set up on this server');
      const number = await smsNumbers.provision(agencyId);
      await profiles.connectChannel(agencyId, 'sms', number);
      return number;
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
