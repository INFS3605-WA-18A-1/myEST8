import type { Context } from './context.ts';
import { all, one, run, transaction } from './db.ts';
import type { ChannelType } from './ports.ts';
import { invalid, iso, normalizeAddress, notFound, type Availability, type Role, type Trade } from './shared.ts';

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
  lastInbound: { channelType: ChannelType; address: string; at: string } | null;
}

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
}

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

export type NewProperty = Omit<Property, 'id' | 'agencyId' | 'location' | 'buildingManagerId'> & {
  buildingManagerId?: number | null;
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
};

/** The Agency, its Property Managers, Properties, Tenants, Property Owners, Tradies and Building Managers. */
export function createProfiles({ db, clock, ports, modules }: Context) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agencies (id INTEGER PRIMARY KEY, name TEXT NOT NULL, time_zone TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agency_channels (
      agency_id INTEGER NOT NULL REFERENCES agencies(id),
      channel_type TEXT NOT NULL,
      address TEXT NOT NULL,
      tested_at TEXT,
      PRIMARY KEY (channel_type, address)
    );
    CREATE TABLE IF NOT EXISTS property_managers (
      id INTEGER PRIMARY KEY,
      agency_id INTEGER NOT NULL REFERENCES agencies(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY,
      agency_id INTEGER NOT NULL REFERENCES agencies(id),
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      business_name TEXT,
      mobile TEXT,
      email TEXT,
      property_id INTEGER,
      tenancy_start TEXT,
      availability TEXT,
      trades TEXT NOT NULL DEFAULT '[]',
      starting_rating REAL,
      google_place_id TEXT,
      google_rating REAL,
      google_review_count INTEGER,
      last_inbound_channel TEXT,
      last_inbound_address TEXT,
      last_inbound_at TEXT
    );
    CREATE TABLE IF NOT EXISTS contact_addresses (
      agency_id INTEGER NOT NULL,
      address TEXT NOT NULL,
      person_id INTEGER NOT NULL REFERENCES people(id),
      PRIMARY KEY (agency_id, address)
    );
    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY,
      agency_id INTEGER NOT NULL REFERENCES agencies(id),
      property_manager_id INTEGER NOT NULL REFERENCES property_managers(id),
      address TEXT NOT NULL,
      suburb TEXT NOT NULL,
      lat REAL,
      lng REAL,
      owner_id INTEGER NOT NULL REFERENCES people(id),
      max_repair_cost_cents INTEGER NOT NULL,
      building_manager_id INTEGER REFERENCES people(id)
    );
    CREATE TABLE IF NOT EXISTS nominated_tradies (
      property_id INTEGER NOT NULL REFERENCES properties(id),
      tradie_id INTEGER NOT NULL REFERENCES people(id),
      PRIMARY KEY (property_id, tradie_id)
    );
    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY,
      tradie_id INTEGER NOT NULL REFERENCES people(id),
      source TEXT NOT NULL,
      score INTEGER NOT NULL,
      job_id INTEGER NOT NULL,
      at TEXT NOT NULL,
      UNIQUE (job_id, source)
    );
  `);

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
      lastInbound:
        row.last_inbound_channel && row.last_inbound_address && row.last_inbound_at
          ? { channelType: row.last_inbound_channel, address: row.last_inbound_address, at: row.last_inbound_at }
          : null,
    };
  }

  function toProperty(row: PropertyRow): Property {
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
      nominatedTradieIds: all<{ tradie_id: number }>(
        db,
        'SELECT tradie_id FROM nominated_tradies WHERE property_id = ? ORDER BY tradie_id',
        row.id,
      ).map((r) => r.tradie_id),
    };
  }

  function person(id: number): Person {
    const row = one<PersonRow>(db, 'SELECT * FROM people WHERE id = ?', id);
    if (!row) throw new Error(`Person ${id} not found`);
    return toPerson(row);
  }

  function addAddress(agencyId: number, personId: number, address: string) {
    const normalized = normalizeAddress(address);
    const existing = one<{ person_id: number }>(
      db,
      'SELECT person_id FROM contact_addresses WHERE agency_id = ? AND address = ?',
      agencyId,
      normalized,
    );
    if (existing && existing.person_id !== personId) invalid(`${address} already belongs to someone else`);
    if (!existing) run(db, 'INSERT INTO contact_addresses (agency_id, address, person_id) VALUES (?, ?, ?)', agencyId, normalized, personId);
  }

  async function googleRating(placeId: string) {
    return ports.places.getRating(placeId);
  }

  return {
    createAgency(input: { name: string; timeZone: string }) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: input.timeZone });
      } catch {
        invalid(`Unknown time zone ${input.timeZone}`);
      }
      return run(db, 'INSERT INTO agencies (name, time_zone) VALUES (?, ?)', input.name, input.timeZone);
    },

    agency(id: number): Agency {
      const row = one<{ id: number; name: string; time_zone: string }>(db, 'SELECT * FROM agencies WHERE id = ?', id);
      if (!row) throw new Error(`Agency ${id} not found`);
      return { id: row.id, name: row.name, timeZone: row.time_zone };
    },

    addPropertyManager(agencyId: number, input: { name: string; email: string }) {
      return run(
        db,
        'INSERT INTO property_managers (agency_id, name, email) VALUES (?, ?, ?)',
        agencyId,
        input.name,
        normalizeAddress(input.email),
      );
    },

    propertyManager(id: number): PropertyManager {
      const row = one<{ id: number; agency_id: number; name: string; email: string }>(
        db,
        'SELECT * FROM property_managers WHERE id = ?',
        id,
      );
      if (!row) notFound('Property Manager');
      return { id: row.id, agencyId: row.agency_id, name: row.name, email: row.email };
    },

    connectChannel(agencyId: number, channelType: ChannelType, address: string) {
      const normalized = normalizeAddress(address);
      const existing = one<{ agency_id: number }>(
        db,
        'SELECT agency_id FROM agency_channels WHERE channel_type = ? AND address = ?',
        channelType,
        normalized,
      );
      if (existing && existing.agency_id !== agencyId) invalid(`${address} is connected to another Agency`);
      run(db, 'DELETE FROM agency_channels WHERE agency_id = ? AND channel_type = ?', agencyId, channelType);
      run(db, 'INSERT INTO agency_channels (agency_id, channel_type, address) VALUES (?, ?, ?)', agencyId, channelType, normalized);
    },

    markChannelTested(agencyId: number, channelType: ChannelType) {
      run(db, 'UPDATE agency_channels SET tested_at = ? WHERE agency_id = ? AND channel_type = ?', iso(clock.now()), agencyId, channelType);
    },

    agencyByChannel(channelType: ChannelType, address: string): number | null {
      return (
        one<{ agency_id: number }>(
          db,
          'SELECT agency_id FROM agency_channels WHERE channel_type = ? AND address = ?',
          channelType,
          normalizeAddress(address),
        )?.agency_id ?? null
      );
    },

    channelAddress(agencyId: number, channelType: ChannelType): string | null {
      return (
        one<{ address: string }>(
          db,
          'SELECT address FROM agency_channels WHERE agency_id = ? AND channel_type = ?',
          agencyId,
          channelType,
        )?.address ?? null
      );
    },

    addPerson(agencyId: number, input: NewPerson) {
      return transaction(db, () => {
        const id = run(
          db,
          `INSERT INTO people (agency_id, role, name, business_name, mobile, email, property_id, tenancy_start, trades, starting_rating, google_place_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        if (input.mobile) addAddress(agencyId, id, input.mobile);
        if (input.email) addAddress(agencyId, id, input.email);
        return id;
      });
    },

    person,

    /** A person in the Agency, optionally with a given role, or a not-found error. */
    personInAgency(agencyId: number, id: number, role?: Role): Person {
      const row = one<PersonRow>(db, 'SELECT * FROM people WHERE id = ? AND agency_id = ?', id, agencyId);
      if (!row || (role && row.role !== role)) notFound(role ? role.replace('_', ' ') : 'Person');
      return toPerson(row);
    },

    /** Finds who sent a message: their role, Agency and Properties. */
    findByAddress(agencyId: number, address: string) {
      const row = one<PersonRow>(
        db,
        `SELECT people.* FROM contact_addresses JOIN people ON people.id = contact_addresses.person_id
         WHERE contact_addresses.agency_id = ? AND contact_addresses.address = ?`,
        agencyId,
        normalizeAddress(address),
      );
      if (!row) return null;
      const propertyIds =
        row.role === 'tenant'
          ? [row.property_id!]
          : all<{ id: number }>(
              db,
              'SELECT id FROM properties WHERE owner_id = ? OR building_manager_id = ? ORDER BY id',
              row.id,
              row.id,
            ).map((p) => p.id);
      return { personId: row.id, role: row.role, agencyId: row.agency_id, propertyIds };
    },

    linkAddress(agencyId: number, personId: number, address: string) {
      addAddress(agencyId, personId, address);
    },

    recordInbound(personId: number, channelType: ChannelType, address: string, at: Date) {
      run(
        db,
        'UPDATE people SET last_inbound_channel = ?, last_inbound_address = ?, last_inbound_at = ? WHERE id = ?',
        channelType,
        normalizeAddress(address),
        iso(at),
        personId,
      );
    },

    setAvailability(tenantId: number, availability: Availability) {
      run(db, 'UPDATE people SET availability = ? WHERE id = ?', availability, tenantId);
    },

    async addProperty(agencyId: number, input: NewProperty) {
      const location = await ports.places.geocode(input.address);
      return transaction(db, () => {
        const id = run(
          db,
          `INSERT INTO properties (agency_id, property_manager_id, address, suburb, lat, lng, owner_id, max_repair_cost_cents, building_manager_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          run(db, 'INSERT INTO nominated_tradies (property_id, tradie_id) VALUES (?, ?)', id, tradieId);
        }
        return id;
      });
    },

    property(id: number): Property {
      const row = one<PropertyRow>(db, 'SELECT * FROM properties WHERE id = ?', id);
      if (!row) throw new Error(`Property ${id} not found`);
      return toProperty(row);
    },

    propertyInAgency(agencyId: number, id: number): Property {
      const row = one<PropertyRow>(db, 'SELECT * FROM properties WHERE id = ? AND agency_id = ?', id, agencyId);
      if (!row) notFound('Property');
      return toProperty(row);
    },

    /** The Properties assigned to a Property Manager. */
    propertyIdsOf(propertyManagerId: number) {
      return all<{ id: number }>(db, 'SELECT id FROM properties WHERE property_manager_id = ?', propertyManagerId).map((r) => r.id);
    },

    tradiesWithTrade(agencyId: number, trade: Trade): Person[] {
      return all<PersonRow>(
        db,
        `SELECT * FROM people WHERE agency_id = ? AND role = 'tradie'
         AND EXISTS (SELECT 1 FROM json_each(people.trades) WHERE value = ?) ORDER BY id`,
        agencyId,
        trade,
      ).map(toPerson);
    },

    recordRating(tradieId: number, source: 'property_manager' | 'tenant', score: number, jobId: number) {
      run(db, 'INSERT INTO ratings (tradie_id, source, score, job_id, at) VALUES (?, ?, ?, ?, ?)', tradieId, source, score, jobId, iso(clock.now()));
    },

    hasRating(jobId: number, source: 'property_manager' | 'tenant') {
      return !!one(db, 'SELECT 1 FROM ratings WHERE job_id = ? AND source = ?', jobId, source);
    },

    ratings(tradieId: number) {
      return all<{ source: 'property_manager' | 'tenant'; score: number; job_id: number; at: string }>(
        db,
        'SELECT source, score, job_id, at FROM ratings WHERE tradie_id = ? ORDER BY id',
        tradieId,
      ).map((r) => ({ source: r.source, score: r.score, jobId: r.job_id, at: r.at }));
    },

    /** The average of the starting rating and every rating since, with how many there are. */
    myEst8Rating(tradieId: number) {
      const { starting_rating } = one<{ starting_rating: number }>(db, 'SELECT starting_rating FROM people WHERE id = ?', tradieId)!;
      const scores = [starting_rating, ...this.ratings(tradieId).map((r) => r.score)];
      return { average: scores.reduce((a, b) => a + b, 0) / scores.length, count: scores.length };
    },

    async refreshGoogleRating(tradieId: number) {
      const tradie = person(tradieId);
      if (!tradie.googlePlaceId) return;
      const { rating, reviewCount } = await googleRating(tradie.googlePlaceId);
      run(db, 'UPDATE people SET google_rating = ?, google_review_count = ? WHERE id = ?', rating, reviewCount, tradieId);
    },

    /** The Trades of a Property's past Tickets, most frequent first. */
    frequentIssues(propertyId: number) {
      const counts = new Map<Trade, number>();
      for (const trade of modules.tickets.tradesForProperty(propertyId)) counts.set(trade, (counts.get(trade) ?? 0) + 1);
      return [...counts].map(([trade, tickets]) => ({ trade, tickets })).sort((a, b) => b.tickets - a.tickets);
    },
  };
}

export type Profiles = ReturnType<typeof createProfiles>;
