import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Context } from './context.ts';
import { all, one, run, transaction } from './db.ts';
import { inAustralia } from './geo.ts';
import type { ChannelType } from './ports.ts';
import { ActionError, invalid, isEmail, iso, normalizeAddress, notFound, type Availability, type Role, type Trade } from './shared.ts';

export interface Agency {
  id: number;
  name: string;
  timeZone: string;
}

export interface PropertyManager {
  id: number;
  agencyId: number;
  name: string;
  email: string;
}

export interface Person {
  id: number;
  agencyId: number;
  role: Role;
  name: string;
  businessName: string | null;
  mobile: string | null;
  email: string | null;
  /** Tenants only. */
  propertyId: number | null;
  tenancyStart: string | null;
  availability: Availability | null;
  /** Tradies only. */
  trades: Trade[];
  startingRating: number | null;
  googlePlaceId: string | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  /** Tradies only: what their Google listing says they do, read when they were linked to it; null for one linked before that was kept. */
  googleListing: { types: string[]; summary: string | null } | null;
  /** Tradies only: where they work from, and the point it geocodes to (null until found). */
  businessAddress: string | null;
  location: { lat: number; lng: number } | null;
  /** Tradies only: when they were removed from the Agency (removeTradie), or null. */
  removedAt: string | null;
  lastInbound: { channelType: ChannelType; address: string; at: string } | null;
}

/** Who chose the photo currently stored for a Property. */
export type PropertyPhotoSource = 'fetched' | 'manager';

export interface Property {
  id: number;
  agencyId: number;
  propertyManagerId: number;
  address: string;
  suburb: string;
  location: { lat: number; lng: number } | null;
  ownerId: number;
  maxRepairCostCents: number;
  buildingManagerId: number | null;
  nominatedTradieIds: number[];
  /** The stored photo, or null when the Property has none. */
  photoFileId: number | null;
  /** Set together with `photoFileId`: the online photo, or the Property Manager's own. */
  photoSource: PropertyPhotoSource | null;
}

/** One of the Agency's channels: the address Tenants, Tradies and Property Owners send to, and when it last passed a test message. */
export interface AgencyChannel {
  type: ChannelType;
  address: string;
  testedAt: string | null;
}

/** A new Agency and the Property Manager signing it up. */
export type SignUp = {
  agencyName: string;
  timeZone: string;
  name: string;
  email: string;
  /** null when WorkOS AuthKit signs them in (ADR 0020) and holds their password, not myEST8. */
  password: string | null;
};

/** Passwords shorter than this are refused. */
export const MIN_PASSWORD_LENGTH = 10;

const CHANNEL_ORDER: ChannelType[] = ['sms', 'whatsapp', 'email'];

/**
 * How many Properties, and how many Tradies, one geocodeMissing call looks up.
 * A Tradie with a Google listing and no address also costs one Places details call.
 */
const MAX_GEOCODES_AT_ONCE = 10;

/** Letters and digits that can't be mistaken for each other when read off a screen. */
const READABLE = 'abcdefghjkmnpqrstuvwxyz23456789';

export type NewPerson = {
  role: Role;
  name: string;
  businessName?: string;
  mobile?: string;
  email?: string;
  propertyId?: number;
  tenancyStart?: string;
  trades?: Trade[];
  startingRating?: number;
  googlePlaceId?: string;
};

export type NewProperty = Omit<Property, 'id' | 'agencyId' | 'location' | 'buildingManagerId' | 'photoFileId' | 'photoSource'> & {
  buildingManagerId?: number | null;
  /** Where the address is on the map, when already looked up (so addProperty can run inside a transaction). A point outside Australia is ignored and the address is looked up. Null means the lookup already found nothing. */
  location?: { lat: number; lng: number } | null;
};

type PersonRow = {
  id: number;
  agency_id: number;
  role: Role;
  name: string;
  business_name: string | null;
  mobile: string | null;
  email: string | null;
  property_id: number | null;
  tenancy_start: string | null;
  availability: Availability | null;
  trades: string;
  starting_rating: number | null;
  google_place_id: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  google_types: string | null;
  google_summary: string | null;
  business_address: string | null;
  lat: number | null;
  lng: number | null;
  removed_at: string | null;
  last_inbound_channel: ChannelType | null;
  last_inbound_address: string | null;
  last_inbound_at: string | null;
};

type PropertyRow = {
  id: number;
  agency_id: number;
  property_manager_id: number;
  address: string;
  suburb: string;
  lat: number | null;
  lng: number | null;
  owner_id: number;
  max_repair_cost_cents: number;
  building_manager_id: number | null;
  photo_file_id: number | null;
  photo_source: PropertyPhotoSource | null;
};

/** Compared against when an email is unknown; no password matches it. */
const UNUSABLE_HASH = `scrypt$${randomBytes(16).toString('base64')}$${randomBytes(32).toString('base64')}`;

/** A password to read out or copy once: three groups of four, like "k7mq-x2rd-9pfa". */
function temporaryPassword() {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => READABLE[b % READABLE.length]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

function isTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, 32).toString('base64')}`;
}

function passwordMatches(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** The Agency, its Property Managers, Properties, Tenants, Property Owners, Tradies and Building Managers. */
export function createProfiles({ db, clock, ports, worker, modules }: Context) {

  function toPerson(row: PersonRow): Person {
    return {
      id: row.id,
      agencyId: row.agency_id,
      role: row.role,
      name: row.name,
      businessName: row.business_name,
      mobile: row.mobile,
      email: row.email,
      propertyId: row.property_id,
      tenancyStart: row.tenancy_start,
      availability: row.availability,
      trades: JSON.parse(row.trades) as Trade[],
      startingRating: row.starting_rating,
      googlePlaceId: row.google_place_id,
      googleRating: row.google_rating,
      googleReviewCount: row.google_review_count,
      googleListing: row.google_types === null ? null : { types: JSON.parse(row.google_types) as string[], summary: row.google_summary },
      businessAddress: row.business_address,
      location: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
      removedAt: row.removed_at,
      lastInbound:
        row.last_inbound_channel && row.last_inbound_address && row.last_inbound_at
          ? { channelType: row.last_inbound_channel, address: row.last_inbound_address, at: row.last_inbound_at }
          : null,
    };
  }

  async function toProperty(row: PropertyRow): Promise<Property> {
    return {
      id: row.id,
      agencyId: row.agency_id,
      propertyManagerId: row.property_manager_id,
      address: row.address,
      suburb: row.suburb,
      location: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
      ownerId: row.owner_id,
      maxRepairCostCents: row.max_repair_cost_cents,
      buildingManagerId: row.building_manager_id,
      nominatedTradieIds: (await nominatedTradies(row.agency_id)).filter((r) => r.property_id === row.id).map((r) => r.tradie_id),
      photoFileId: row.photo_file_id,
      photoSource: row.photo_source,
    };
  }

  /**
   * Every Nominated Tradie of the Agency's Properties. Read for the whole Agency so a
   * page's many Properties share one read (src/db.ts's read cache), not one each.
   */
  function nominatedTradies(agencyId: number) {
    return all<{ property_id: number; tradie_id: number }>(
      db,
      `SELECT n.property_id, n.tradie_id FROM nominated_tradies n JOIN properties p ON p.id = n.property_id
       WHERE p.agency_id = ? ORDER BY n.tradie_id`,
      agencyId,
    );
  }

  /** Every rating of the Agency's Tradies, oldest first: read for the whole Agency, for the same reason. */
  function agencyRatings(agencyId: number) {
    return all<{ tradie_id: number; source: 'property_manager' | 'tenant'; score: number; job_id: number; at: string }>(
      db,
      'SELECT r.tradie_id, r.source, r.score, r.job_id, r.at FROM ratings r JOIN people p ON p.id = r.tradie_id WHERE p.agency_id = ? ORDER BY r.id',
      agencyId,
    );
  }

  async function person(id: number): Promise<Person> {
    const row = await one<PersonRow>(db, 'SELECT * FROM people WHERE id = ?', id);
    if (!row) throw new Error(`Person ${id} not found`);
    return toPerson(row);
  }

  /**
   * Remembers an address as this person's, so a message from it can be matched to them.
   * Several people may share one: `contact_addresses` keeps a single row (its key is the
   * Agency and the address), and the others are found from their own email or mobile.
   */
  async function addAddress(agencyId: number, personId: number, address: string) {
    const normalized = normalizeAddress(address);
    const existing = await one<{ person_id: number }>(
      db,
      'SELECT person_id FROM contact_addresses WHERE agency_id = ? AND address = ?',
      agencyId,
      normalized,
    );
    if (!existing) await run(db, 'INSERT INTO contact_addresses (agency_id, address, person_id) VALUES (?, ?, ?)', agencyId, normalized, personId);
  }

  async function emailTaken(email: string) {
    return !!(await one(db, 'SELECT 1 FROM property_managers WHERE email = ?', normalizeAddress(email)));
  }

  /** What's wrong with a new Property Manager's name and email, by field. */
  async function accountProblems(input: { name: string; email: string }): Promise<Record<string, string>> {
    const problems: Record<string, string> = {};
    if (!input.name.trim()) problems.name = 'Enter a name';
    if (!input.email.trim()) problems.email = 'Enter an email address';
    else if (!isEmail(input.email)) problems.email = `${input.email.trim()} isn't an email address`;
    else if (await emailTaken(input.email)) problems.email = 'An account with that email already exists';
    return problems;
  }

  /** Refuses with every problem at once, each against its field; the first one is the message. */
  function refuse(problems: Record<string, string>) {
    const [first] = Object.values(problems);
    if (!first) return;
    const conflict = Object.keys(problems).length === 1 && problems.email === 'An account with that email already exists';
    throw new ActionError(conflict ? 'conflict' : 'invalid', first, problems);
  }

  async function insertPropertyManager(agencyId: number, input: { name: string; email: string; password?: string }) {
    return run(
      db,
      'INSERT INTO property_managers (agency_id, name, email, password_hash) VALUES (?, ?, ?, ?) RETURNING id',
      agencyId,
      input.name.trim(),
      normalizeAddress(input.email),
      input.password ? hashPassword(input.password) : null,
    );
  }

  async function googleRating(placeId: string) {
    return ports.places.getRating(placeId);
  }

  /** An address's point on the map, or null when the lookup finds nothing or fails (it can be retried later). */
  async function geocode(address: string) {
    try {
      return await ports.geocoder.geocode(address);
    } catch {
      return null;
    }
  }

  /**
   * Where a Property's address is on the map. A pin the form already has is kept when it is in
   * Australia. Anything else, including a pin outside the country, is looked up. A lookup that fails
   * leaves the Property without a location: geocodeMissing tries it again.
   * `location: null` was already looked up and found nothing, so it is not tried again here.
   */
  async function locate(input: Pick<NewProperty, 'address' | 'location'>) {
    const given = input.location;
    return given && inAustralia(given) ? given : given === null ? null : await geocode(input.address);
  }

  /**
   * Where an address sits, kept only when the point is in Australia, as a Property's pin is.
   * A miss, a failed lookup or a point outside the country is null, so it can be tried again.
   */
  async function placeAddress(address: string) {
    const point = await locate({ address });
    return point && inAustralia(point) ? point : null;
  }

  return {
    async createAgency(input: { name: string; timeZone: string }) {
      if (!isTimeZone(input.timeZone)) invalid(`Unknown time zone ${input.timeZone}`);
      return run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?) RETURNING id', input.name, input.timeZone);
    },

    async agency(id: number): Promise<Agency> {
      const row = await one<{ id: number; name: string; time_zone: string }>(db, 'SELECT * FROM agencies WHERE id = ?', id);
      if (!row) throw new Error(`Agency ${id} not found`);
      return { id: row.id, name: row.name, timeZone: row.time_zone };
    },

    addPropertyManager(agencyId: number, input: { name: string; email: string; password?: string }) {
      return insertPropertyManager(agencyId, input);
    },

    /**
     * Creates an Agency and the Property Manager signing it up, together or not at
     * all. Refuses a missing field, an email that isn't one, a password under
     * MIN_PASSWORD_LENGTH characters, an unknown time zone and an email that
     * already has an account, each against its field. Returns the Property Manager's id.
     */
    async signUp(input: SignUp): Promise<number> {
      // Checked inside the transaction, so two sign-ups with one email can't both pass the check.
      return transaction(db, async () => {
        const problems = await accountProblems(input);
        if (input.password === null) {
          // AuthKit holds the password.
        } else if (!input.password) problems.password = 'Choose a password';
        else if (input.password.length < MIN_PASSWORD_LENGTH) problems.password = `Use at least ${MIN_PASSWORD_LENGTH} characters`;
        if (!input.agencyName.trim()) problems.agencyName = "Enter your Agency's name";
        if (!isTimeZone(input.timeZone)) problems.timeZone = 'Choose a time zone';
        refuse(problems);
        const agencyId = await run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?) RETURNING id', input.agencyName.trim(), input.timeZone);
        return insertPropertyManager(agencyId, { ...input, password: input.password ?? undefined });
      });
    },

    /**
     * Adds a colleague to the Agency as a Property Manager, checked like a sign-up. With
     * `temporaryPassword`, they get one, returned once to pass on. Without it they have no
     * password: they sign in through WorkOS AuthKit with this email (ADR 0020).
     */
    async addColleague(agencyId: number, input: { name: string; email: string }, o: { temporaryPassword: boolean } = { temporaryPassword: true }) {
      return transaction(db, async () => {
        refuse(await accountProblems(input));
        const password = o.temporaryPassword ? temporaryPassword() : null;
        return { propertyManagerId: await insertPropertyManager(agencyId, { ...input, password: password ?? undefined }), temporaryPassword: password };
      });
    },

    /** Renames the Agency and changes its time zone. Refuses a blank name and an unknown time zone, each against its field. */
    async editAgency(agencyId: number, input: { name: string; timeZone: string }): Promise<Agency> {
      const problems: Record<string, string> = {};
      if (!input.name.trim()) problems.name = "Enter your Agency's name";
      if (!isTimeZone(input.timeZone)) problems.timeZone = 'Choose a time zone';
      refuse(problems);
      await run(db, 'UPDATE agencies SET name = ?, time_zone = ? WHERE id = ?', input.name.trim(), input.timeZone, agencyId);
      return { id: agencyId, name: input.name.trim(), timeZone: input.timeZone };
    },

    /**
     * Takes a colleague out of the Agency: they can no longer sign in, and their uploads
     * waiting for review go. Their Properties move to `handTo`, another of the Agency's
     * Property Managers, which is required while they manage any. Refuses removing
     * yourself (`by`). Returns their name and how many Properties moved.
     */
    async removePropertyManager(agencyId: number, propertyManagerId: number, o: { by: number; handTo?: number | null }) {
      return transaction(db, async () => {
        const row = await one<{ name: string }>(db, 'SELECT name FROM property_managers WHERE id = ? AND agency_id = ?', propertyManagerId, agencyId);
        if (!row) notFound('Property Manager');
        if (propertyManagerId === o.by) invalid("You can't remove yourself. Ask a colleague to remove you.");
        const managed = (await all<{ id: number }>(db, 'SELECT id FROM properties WHERE property_manager_id = ?', propertyManagerId)).length;
        if (managed) {
          const to = o.handTo
            ? await one<{ id: number }>(db, 'SELECT id FROM property_managers WHERE id = ? AND agency_id = ? AND id <> ?', o.handTo, agencyId, propertyManagerId)
            : null;
          if (!to) invalid(`Choose who looks after ${row.name}'s Properties`, 'handTo');
          await run(db, 'UPDATE properties SET property_manager_id = ? WHERE property_manager_id = ?', to.id, propertyManagerId);
        }
        await run(db, 'DELETE FROM imports WHERE property_manager_id = ?', propertyManagerId);
        await run(db, 'DELETE FROM sessions WHERE property_manager_id = ?', propertyManagerId);
        await run(db, 'DELETE FROM property_managers WHERE id = ?', propertyManagerId);
        return { name: row.name, moved: managed };
      });
    },

    /** The Property Manager with this email and password, or null. */
    async verifyLogin(email: string, password: string): Promise<number | null> {
      const row = await one<{ id: number; password_hash: string | null }>(
        db,
        'SELECT id, password_hash FROM property_managers WHERE email = ?',
        normalizeAddress(email),
      );
      // Hash even for an unknown email, so the response time doesn't reveal which emails exist.
      const matches = passwordMatches(password, row?.password_hash ?? UNUSABLE_HASH);
      return row?.password_hash && matches ? row.id : null;
    },

    /** The Property Manager with this email, or null. For sign-in through WorkOS AuthKit, which has already checked who they are. */
    async propertyManagerIdByEmail(email: string): Promise<number | null> {
      const row = await one<{ id: number }>(db, 'SELECT id FROM property_managers WHERE email = ?', normalizeAddress(email));
      return row?.id ?? null;
    },

    async propertyManagers(agencyId: number): Promise<PropertyManager[]> {
      return (await all<{ id: number; agency_id: number; name: string; email: string }>(
        db,
        'SELECT id, agency_id, name, email FROM property_managers WHERE agency_id = ? ORDER BY name, id',
        agencyId,
      )).map((r) => ({ id: r.id, agencyId: r.agency_id, name: r.name, email: r.email }));
    },

    /**
     * The Agency's people, optionally of one role. A Tenant who has left their Property
     * (endTenancy) and anyone removed from the Agency (removePerson, including a Tradie
     * through removeTradie) aren't among them: every list and picker reads this.
     */
    async people(agencyId: number, role?: Role): Promise<Person[]> {
      return (await all<PersonRow>(
        db,
        `SELECT * FROM people WHERE agency_id = ? AND (?::text IS NULL OR role = ?) AND (role <> 'tenant' OR property_id IS NOT NULL) AND removed_at IS NULL
         ORDER BY role, name, id`,
        agencyId,
        role ?? null,
        role ?? null,
      )).map(toPerson);
    },

    async properties(agencyId: number): Promise<Property[]> {
      return Promise.all((await all<PropertyRow>(db, 'SELECT * FROM properties WHERE agency_id = ? ORDER BY address, id', agencyId)).map(toProperty));
    },

    async propertyManager(id: number): Promise<PropertyManager> {
      const row = await one<{ id: number; agency_id: number; name: string; email: string }>(
        db,
        'SELECT * FROM property_managers WHERE id = ?',
        id,
      );
      if (!row) notFound('Property Manager');
      return { id: row.id, agencyId: row.agency_id, name: row.name, email: row.email };
    },

    async connectChannel(agencyId: number, channelType: ChannelType, address: string) {
      await transaction(db, async () => {
        const normalized = normalizeAddress(address);
        const existing = await one<{ agency_id: number }>(
          db,
          'SELECT agency_id FROM agency_channels WHERE channel_type = ? AND address = ?',
          channelType,
          normalized,
        );
        if (existing && existing.agency_id !== agencyId) invalid(`${address} is connected to another Agency`);
        await run(db, 'DELETE FROM agency_channels WHERE agency_id = ? AND channel_type = ?', agencyId, channelType);
        await run(db, 'INSERT INTO agency_channels (agency_id, channel_type, address) VALUES (?, ?, ?)', agencyId, channelType, normalized);
      });
    },

    /** Forgets the Agency's channel of this type, when it is still `address`: texts to it no longer reach the Agency. */
    async disconnectChannel(agencyId: number, channelType: ChannelType, address: string) {
      await run(db, 'DELETE FROM agency_channels WHERE agency_id = ? AND channel_type = ? AND address = ?', agencyId, channelType, normalizeAddress(address));
    },

    /** The Agency's connected channels: SMS, then WhatsApp, then email. */
    async channels(agencyId: number): Promise<AgencyChannel[]> {
      return (await all<{ channel_type: ChannelType; address: string; tested_at: string | null }>(
        db,
        'SELECT channel_type, address, tested_at FROM agency_channels WHERE agency_id = ?',
        agencyId,
      ))
        .map((r) => ({ type: r.channel_type, address: r.address, testedAt: r.tested_at }))
        .sort((a, b) => CHANNEL_ORDER.indexOf(a.type) - CHANNEL_ORDER.indexOf(b.type));
    },

    async markChannelTested(agencyId: number, channelType: ChannelType) {
      await run(db, 'UPDATE agency_channels SET tested_at = ? WHERE agency_id = ? AND channel_type = ?', iso(clock.now()), agencyId, channelType);
    },

    async agencyByChannel(channelType: ChannelType, address: string): Promise<number | null> {
      return (
        (await one<{ agency_id: number }>(
          db,
          'SELECT agency_id FROM agency_channels WHERE channel_type = ? AND address = ?',
          channelType,
          normalizeAddress(address),
        ))?.agency_id ?? null
      );
    },

    async channelAddress(agencyId: number, channelType: ChannelType): Promise<string | null> {
      return (
        (await one<{ address: string }>(
          db,
          'SELECT address FROM agency_channels WHERE agency_id = ? AND channel_type = ?',
          agencyId,
          channelType,
        ))?.address ?? null
      );
    },

    async addPerson(agencyId: number, input: NewPerson) {
      return transaction(db, async () => {
        const id = await run(
          db,
          `INSERT INTO people (agency_id, role, name, business_name, mobile, email, property_id, tenancy_start, trades, starting_rating, google_place_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          agencyId,
          input.role,
          input.name,
          input.businessName ?? null,
          input.mobile ? normalizeAddress(input.mobile) : null,
          input.email ? normalizeAddress(input.email) : null,
          input.propertyId ?? null,
          input.tenancyStart ?? null,
          JSON.stringify(input.trades ?? []),
          input.startingRating ?? null,
          input.googlePlaceId ?? null,
        );
        if (input.mobile) await addAddress(agencyId, id, input.mobile);
        if (input.email) await addAddress(agencyId, id, input.email);
        return id;
      });
    },

    /**
     * Changes a person's name, mobile and email, and moves the addresses messages are matched on with
     * them: a new mobile or email is theirs from now on, the old one no longer reaches them, and an address
     * a Property Manager linked from the inbox stays. Someone else in the Agency may already use the new
     * one; both keep it. A Tradie's business name and Trades change too when given.
     */
    async updatePerson(personId: number, input: { name: string; mobile?: string; email?: string; businessName?: string; trades?: Trade[] }) {
      await transaction(db, async () => {
        const before = await person(personId);
        const mobile = input.mobile ? normalizeAddress(input.mobile) : null;
        const email = input.email ? normalizeAddress(input.email) : null;
        await run(
          db,
          'UPDATE people SET name = ?, business_name = ?, mobile = ?, email = ?, trades = ? WHERE id = ?',
          input.name,
          input.businessName ?? before.businessName,
          mobile,
          email,
          JSON.stringify(input.trades ?? before.trades),
          personId,
        );
        for (const [was, now, typed] of [[before.mobile, mobile, input.mobile], [before.email, email, input.email]] as const) {
          if (typed) await addAddress(before.agencyId, personId, typed);
          if (was && was !== now) await run(db, 'DELETE FROM contact_addresses WHERE person_id = ? AND address = ?', personId, was);
        }
      });
    },

    /**
     * A Tenant leaves their Property. Their record stays, so the Tickets they raised still
     * name them, but their mobile and email stop reaching the Agency as them and can be
     * given to someone else.
     */
    async endTenancy(personId: number) {
      await transaction(db, async () => {
        await run(db, 'UPDATE people SET property_id = NULL WHERE id = ?', personId);
        await run(db, 'DELETE FROM contact_addresses WHERE person_id = ?', personId);
      });
    },

    /**
     * A Tradie leaves the Agency. Their record stays, so past Quotes, visits and ratings still
     * name them, but they leave every Property's Nominated Tradies, stop being offered for
     * Jobs (people and tradiesWithTrade leave them out), and their mobile and email stop
     * reaching the Agency as them and can be given to someone else.
     */
    async removeTradie(tradieId: number) {
      await transaction(db, async () => {
        await this.removePerson(tradieId);
        await run(db, 'DELETE FROM nominated_tradies WHERE tradie_id = ?', tradieId);
      });
    },

    /**
     * A person leaves the Agency. Their record stays, so past work still names them, but they
     * drop out of every list and picker (people leaves out removed_at), and their mobile and
     * email stop reaching the Agency as them and can be given to someone else.
     */
    async removePerson(personId: number) {
      await transaction(db, async () => {
        await run(db, 'UPDATE people SET removed_at = ? WHERE id = ?', iso(clock.now()), personId);
        await run(db, 'DELETE FROM contact_addresses WHERE person_id = ?', personId);
      });
    },

    person,

    /** A person in the Agency, optionally with a given role, or a not-found error. */
    async personInAgency(agencyId: number, id: number, role?: Role): Promise<Person> {
      const row = await one<PersonRow>(db, 'SELECT * FROM people WHERE id = ? AND agency_id = ?', id, agencyId);
      if (!row || (role && row.role !== role)) notFound(role ? role.replace('_', ' ') : 'Person');
      return toPerson(row);
    },

    /**
     * Every active person an address belongs to: their own email or mobile, and any address
     * linked from the inbox (`contact_addresses` keeps one row per address). A removed person,
     * and a Tenant who has left their Property, no longer match.
     */
    async findByAddress(agencyId: number, address: string): Promise<Person[]> {
      const normalized = normalizeAddress(address);
      const active = `people.removed_at IS NULL AND (people.role <> 'tenant' OR people.property_id IS NOT NULL)`;
      const rows = await all<PersonRow>(
        db,
        `SELECT people.* FROM people
         WHERE people.agency_id = ? AND ${active} AND (people.mobile = ? OR people.email = ?)
         UNION
         SELECT people.* FROM contact_addresses JOIN people ON people.id = contact_addresses.person_id
         WHERE contact_addresses.agency_id = ? AND contact_addresses.address = ? AND ${active}
         ORDER BY id`,
        agencyId,
        normalized,
        normalized,
        agencyId,
        normalized,
      );
      return rows.map(toPerson);
    },

    async linkAddress(agencyId: number, personId: number, address: string) {
      await addAddress(agencyId, personId, address);
    },

    async recordInbound(personId: number, channelType: ChannelType, address: string, at: Date) {
      await run(
        db,
        'UPDATE people SET last_inbound_channel = ?, last_inbound_address = ?, last_inbound_at = ? WHERE id = ?',
        channelType,
        normalizeAddress(address),
        iso(at),
        personId,
      );
    },

    async setAvailability(tenantId: number, availability: Availability) {
      await run(db, 'UPDATE people SET availability = ? WHERE id = ?', availability, tenantId);
    },

    async addProperty(agencyId: number, input: NewProperty) {
      const location = await locate(input);
      const id = await transaction(db, async () => {
        const propertyId = await run(
          db,
          `INSERT INTO properties (agency_id, property_manager_id, address, suburb, lat, lng, owner_id, max_repair_cost_cents, building_manager_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          agencyId,
          input.propertyManagerId,
          input.address,
          input.suburb,
          location?.lat ?? null,
          location?.lng ?? null,
          input.ownerId,
          input.maxRepairCostCents,
          input.buildingManagerId ?? null,
        );
        for (const tradieId of input.nominatedTradieIds) {
          await run(db, 'INSERT INTO nominated_tradies (property_id, tradie_id) VALUES (?, ?)', propertyId, tradieId);
        }
        return propertyId;
      });
      // After the row is committed, so the task can see it. The fetch never blocks adding.
      await worker.schedule('properties.fetch_photo', { propertyId: id });
      return id;
    },

    /**
     * Changes everything about a Property but its Tickets and Tenants. A new address clears the map
     * location and looks it up again, as adding does; the same address keeps its location.
     * The Nominated Tradies are replaced by the ones given.
     */
    async updateProperty(propertyId: number, input: NewProperty) {
      const before = await this.property(propertyId);
      const location = input.address === before.address ? before.location : await locate(input);
      await transaction(db, async () => {
        await run(
          db,
          `UPDATE properties SET property_manager_id = ?, address = ?, suburb = ?, lat = ?, lng = ?, owner_id = ?, max_repair_cost_cents = ?, building_manager_id = ?
           WHERE id = ?`,
          input.propertyManagerId,
          input.address,
          input.suburb,
          location?.lat ?? null,
          location?.lng ?? null,
          input.ownerId,
          input.maxRepairCostCents,
          input.buildingManagerId ?? null,
          propertyId,
        );
        await run(db, 'DELETE FROM nominated_tradies WHERE property_id = ?', propertyId);
        for (const tradieId of input.nominatedTradieIds) {
          await run(db, 'INSERT INTO nominated_tradies (property_id, tradie_id) VALUES (?, ?)', propertyId, tradieId);
        }
      });
    },

    /**
     * Sets where a Tradie works from and looks it up on the map, the same way a Property's
     * address is. The address is kept even when the lookup finds nothing, fails, or lands
     * outside Australia: geocodeMissing tries it again. A blank address clears both.
     */
    async setTradieAddress(agencyId: number, tradieId: number, address: string) {
      await this.personInAgency(agencyId, tradieId, 'tradie');
      const trimmed = address.trim();
      const location = trimmed ? await placeAddress(trimmed) : null;
      await run(db, 'UPDATE people SET business_address = ?, lat = ?, lng = ? WHERE id = ?', trimmed || null, location?.lat ?? null, location?.lng ?? null, tradieId);
    },

    /**
     * Tries the map lookup again for the Agency's Properties without a location, and for
     * its Tradies who have an address but no location or a Google listing and no address,
     * at most MAX_GEOCODES_AT_ONCE of each so a press stays quick. A Tradie with a listing
     * and no address is filled from that listing first, then geocoded; a Places failure is
     * skipped and tried next time. A lookup that finds nothing or fails leaves a record
     * that already had an address as it was. Returns how many were placed.
     */
    async geocodeMissing(agencyId: number): Promise<number> {
      const properties = await all<{ id: number; address: string }>(
        db,
        'SELECT id, address FROM properties WHERE agency_id = ? AND (lat IS NULL OR lng IS NULL) ORDER BY id LIMIT ?',
        agencyId,
        MAX_GEOCODES_AT_ONCE,
      );
      const tradies = await all<{ id: number; address: string | null; google_place_id: string | null }>(
        db,
        `SELECT id, business_address AS address, google_place_id FROM people
         WHERE agency_id = ? AND role = 'tradie' AND removed_at IS NULL AND (lat IS NULL OR lng IS NULL)
           AND (business_address IS NOT NULL OR google_place_id IS NOT NULL)
         ORDER BY id LIMIT ?`,
        agencyId,
        MAX_GEOCODES_AT_ONCE,
      );
      const propertyPoints = await Promise.all(properties.map(async ({ id, address }) => ({ id, location: await geocode(address) })));
      const tradiePoints = await Promise.all(
        tradies.map(async (row) => {
          const hadAddress = !!row.address?.trim();
          let address = row.address?.trim() ?? '';
          if (!address && row.google_place_id) {
            try {
              address = (await ports.places.listingDetails(row.google_place_id)).address.trim();
            } catch {
              return null;
            }
            if (!address) return null;
          }
          if (!address) return null;
          return { id: row.id, address, hadAddress, location: await placeAddress(address) };
        }),
      );
      let placed = 0;
      for (const { id, location } of propertyPoints) {
        if (!location) continue;
        const row = await one<{ photo_file_id: number | null }>(
          db,
          'UPDATE properties SET lat = ?, lng = ? WHERE id = ? RETURNING photo_file_id',
          location.lat,
          location.lng,
          id,
        );
        placed++;
        // A Property that still has no photo can now be looked up by its point. One already fetched, or a Property Manager's, is left alone.
        if (row?.photo_file_id === null) await worker.scheduleUnlessWaiting('properties.fetch_photo', { propertyId: id });
      }
      for (const row of tradiePoints) {
        if (!row) continue;
        if (!row.location) {
          // The listing's address is worth keeping even when the map lookup misses, so the next press only geocodes.
          if (!row.hadAddress) await run(db, 'UPDATE people SET business_address = ? WHERE id = ?', row.address, row.id);
          continue;
        }
        await run(db, 'UPDATE people SET business_address = ?, lat = ?, lng = ? WHERE id = ?', row.address, row.location.lat, row.location.lng, row.id);
        placed++;
      }
      return placed;
    },

    async property(id: number): Promise<Property> {
      const row = await one<PropertyRow>(db, 'SELECT * FROM properties WHERE id = ?', id);
      if (!row) throw new Error(`Property ${id} not found`);
      return toProperty(row);
    },

    async propertyInAgency(agencyId: number, id: number): Promise<Property> {
      const row = await one<PropertyRow>(db, 'SELECT * FROM properties WHERE id = ? AND agency_id = ?', id, agencyId);
      if (!row) notFound('Property');
      return toProperty(row);
    },

    /** The Properties assigned to a Property Manager. */
    async propertyIdsOf(propertyManagerId: number) {
      return (await all<{ id: number }>(db, 'SELECT id FROM properties WHERE property_manager_id = ?', propertyManagerId)).map((r) => r.id);
    },

    /** The Agency's Tradies who do the Trade, not counting those removed. */
    async tradiesWithTrade(agencyId: number, trade: Trade): Promise<Person[]> {
      return (await all<PersonRow>(
        db,
        `SELECT * FROM people WHERE agency_id = ? AND role = 'tradie' AND removed_at IS NULL
         AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(people.trades::jsonb) AS t (value) WHERE t.value = ?) ORDER BY id`,
        agencyId,
        trade,
      )).map(toPerson);
    },

    async recordRating(tradieId: number, source: 'property_manager' | 'tenant', score: number, jobId: number) {
      await run(db, 'INSERT INTO ratings (tradie_id, source, score, job_id, at) VALUES (?, ?, ?, ?, ?)', tradieId, source, score, jobId, iso(clock.now()));
    },

    async hasRating(jobId: number, source: 'property_manager' | 'tenant') {
      return !!(await one(db, 'SELECT 1 FROM ratings WHERE job_id = ? AND source = ?', jobId, source));
    },

    async ratings(tradieId: number) {
      const tradie = await person(tradieId);
      return (await agencyRatings(tradie.agencyId))
        .filter((r) => r.tradie_id === tradieId)
        .map((r) => ({ source: r.source, score: r.score, jobId: r.job_id, at: r.at }));
    },

    /** The average of the starting rating and every rating since, with how many there are. */
    async myEst8Rating(tradieId: number) {
      const tradie = await person(tradieId);
      const scores = [tradie.startingRating ?? 0, ...(await this.ratings(tradieId)).map((r) => r.score)];
      return { average: scores.reduce((a, b) => a + b, 0) / scores.length, count: scores.length };
    },

    async refreshGoogleRating(tradieId: number) {
      const tradie = await person(tradieId);
      if (!tradie.googlePlaceId) return;
      const { rating, reviewCount } = await googleRating(tradie.googlePlaceId);
      await run(db, 'UPDATE people SET google_rating = ?, google_review_count = ? WHERE id = ?', rating, reviewCount, tradieId);
    },

    /**
     * Reads a newly linked Tradie's listing: its rating, as refreshGoogleRating does, and what it
     * says they do (for job fit, ADR 0016). Returns the listing's address, for the map, or null
     * when there is no listing or it names no address.
     */
    async readGoogleListing(tradieId: number): Promise<string | null> {
      const tradie = await person(tradieId);
      if (!tradie.googlePlaceId) return null;
      const { rating, reviewCount, types, summary, address } = await ports.places.listingDetails(tradie.googlePlaceId);
      await run(
        db,
        'UPDATE people SET google_rating = ?, google_review_count = ?, google_types = ?, google_summary = ? WHERE id = ?',
        rating,
        reviewCount,
        JSON.stringify(types),
        summary,
        tradieId,
      );
      return address.trim() || null;
    },

    /** The Trades of a Property's past Tickets, most frequent first. */
    async frequentIssues(propertyId: number) {
      const counts = new Map<Trade, number>();
      for (const trade of await modules.tickets.tradesForProperty(propertyId)) counts.set(trade, (counts.get(trade) ?? 0) + 1);
      return [...counts].map(([trade, tickets]) => ({ trade, tickets })).sort((a, b) => b.tickets - a.tickets);
    },
  };
}

export type Profiles = ReturnType<typeof createProfiles>;
