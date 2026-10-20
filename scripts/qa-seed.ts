// Makes the QA Agency in the QA schema, so the email journey has someone to sign in
// as and a Tenant to be. Safe to run before every journey: it adds only what is
// missing, and clears what an earlier failed run left half-done. See docs/qa.md.
//
//   deploy/qa-exec.sh npx tsx scripts/qa-seed.ts
//
// It needs the QA app to have started once on the schema (the app marks a schema it
// has opened, and refuses one that has data it didn't make). It goes through the
// app's own sign-up and onboarding actions, with ports that throw: nothing here can
// send a message or call an API, and no background task runs.
//
// Reads QA_PM_EMAIL, QA_PM_PASSWORD, QA_GMAIL_ADDRESS (the Tenant's email),
// QA_INBOUND_ADDRESS (the Agency's inbox, on RESEND_INBOUND_DOMAIN) and
// DATABASE_SCHEMA (`qa`). Works on the local Postgres only.

import { createGooglePlaces } from '../src/adapters/google-places.ts';
import { createApp } from '../src/app.ts';
import { all, isLocalUrl, LOCAL_DATABASE_URL, one, openDb, run } from '../src/db.ts';
import { mockFetch } from '../src/demo/mock-apis.ts';
import { migrate } from '../src/migrate.ts';
import { isEmail, normalizeAddress } from '../src/shared.ts';
import { QA_AGENCY_NAME, QA_OWNER, QA_PM_NAME, QA_PROPERTY_ADDRESS, QA_PROPERTY_SUBURB, QA_SCHEMA, QA_TENANT_NAME } from './qa-fixture.ts';

function refuse(problem: string): never {
  console.error(`QA seed refused: ${problem}`);
  process.exit(2);
}

const env = (name: string) => process.env[name]?.trim() || undefined;
const need = (name: string) => env(name) ?? refuse(`set ${name} (see deploy/qa.env.example)`);

const schema = env('DATABASE_SCHEMA') ?? '';
if (!QA_SCHEMA.test(schema)) refuse(`DATABASE_SCHEMA is "${schema}", and the QA seed only works in a schema named qa (or qa_<suffix>)`);
const url = env('SUPABASE_DB_URL') ?? LOCAL_DATABASE_URL;
if (!isLocalUrl(url)) refuse('SUPABASE_DB_URL is not a Postgres on this machine: QA never uses a hosted database');
if (env('SUPABASE_URL') || env('SUPABASE_SERVICE_ROLE_KEY')) refuse('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is set: QA never uses Supabase Storage');

const pmEmail = need('QA_PM_EMAIL');
const pmPassword = need('QA_PM_PASSWORD');
const gmailAddress = need('QA_GMAIL_ADDRESS');
const inboundAddress = normalizeAddress(need('QA_INBOUND_ADDRESS'));
for (const [name, value] of [['QA_PM_EMAIL', pmEmail], ['QA_GMAIL_ADDRESS', gmailAddress], ['QA_INBOUND_ADDRESS', inboundAddress]] as const) {
  if (!isEmail(value)) refuse(`${name} is not an email address`);
}
const inboundDomain = env('RESEND_INBOUND_DOMAIN');
if (inboundDomain && !inboundAddress.endsWith(`@${inboundDomain.toLowerCase()}`)) refuse(`QA_INBOUND_ADDRESS must be on RESEND_INBOUND_DOMAIN (${inboundDomain})`);

const never = (what: string) => () => {
  throw new Error(`The QA seed never ${what}`);
};
const db = openDb(url, { schema, max: 1 });
try {
  await migrate(db);
  if (!(await one(db, `SELECT 1 AS found FROM demo_state WHERE key = 'saved'`))) {
    refuse(`the QA app has not started on schema ${schema} yet. Start it first (systemctl --user restart myest8-qa), then seed.`);
  }

  const app = createApp({
    db,
    clock: { now: () => new Date() },
    messenger: { send: never('sends a message') },
    classifier: { classify: never('classifies a message') },
    summariser: { summarise: never('writes a Summary') },
    imageMatcher: { match: never('matches a photo') },
    quoteReader: { read: never('reads a Quote') },
    // The same in-process Places the QA app runs on (Google Maps is mocked there).
    places: createGooglePlaces({ apiKey: 'demo', fetch: mockFetch(), placesBaseUrl: 'http://mock.local/google/places', geocodeBaseUrl: 'http://mock.local/google' }),
    fetchMedia: never('fetches media'),
    settings: { baseUrl: env('PUBLIC_URL') ?? 'http://localhost' },
  });

  // The Property Manager: signed up like anyone, or found again by signing in.
  let pmId = await app.login(pmEmail, pmPassword);
  let created = false;
  if (pmId === null) {
    try {
      pmId = await app.signUp({ agencyName: QA_AGENCY_NAME, timeZone: 'Australia/Sydney', name: QA_PM_NAME, email: pmEmail, password: pmPassword });
      created = true;
    } catch {
      refuse(`${pmEmail} already has an account in schema ${schema} with another password. Put the old QA_PM_PASSWORD back, or start the QA data afresh with deploy/qa-reset.sh (it drops only the schema qa, unlike npm run db:reset).`);
    }
  }
  const pm = await app.asPropertyManager(pmId);

  // The Agency's inbox: where the journey's email is addressed.
  if (!(await pm.channels()).some((c) => c.type === 'email' && c.address === inboundAddress)) await pm.connectChannel('email', inboundAddress);

  // The Tenant the test Gmail account plays, with a Property and its Owner.
  let tenant = (await pm.people('tenant')).find((p) => p.name === QA_TENANT_NAME);
  if (tenant && normalizeAddress(tenant.email ?? '') !== normalizeAddress(gmailAddress)) {
    refuse(`${QA_TENANT_NAME} exists with another email address. QA_GMAIL_ADDRESS changed: start the QA data afresh with deploy/qa-reset.sh (it drops only the schema qa, unlike npm run db:reset).`);
  }
  if (!tenant) {
    const ownerId = await pm.addOwner(QA_OWNER);
    const propertyId = await pm.addProperty({
      address: QA_PROPERTY_ADDRESS,
      suburb: QA_PROPERTY_SUBURB,
      ownerId,
      propertyManagerId: pmId,
      maxRepairCostCents: 500_00,
      nominatedTradieIds: [],
    });
    await pm.addTenant({ name: QA_TENANT_NAME, email: gmailAddress, propertyId, tenancyStart: '2025-01-01' });
    created = true;
  }

  // What a failed run leaves behind would confuse the next one: an issue still gathering
  // answers makes the Tenant's next report look like an update to it, and a question still
  // waiting on an answer makes the report look like that answer. The QA Agency has no real work.
  const { agencyId } = pm.me();
  const cleared = (
    await all(
      db,
      `UPDATE issues SET status = 'rejected', rejected_reason = 'Cleared by the QA seed' WHERE agency_id = ? AND status IN ('gathering', 'awaiting_photos', 'checking', 'maintenance_request') RETURNING id`,
      agencyId,
    )
  ).length;
  await run(db, 'DELETE FROM pending_answers WHERE person_id IN (SELECT id FROM people WHERE agency_id = ?)', agencyId);

  console.log(`QA Agency ${created ? 'created' : 'already there'} in schema ${schema}: inbox ${inboundAddress}, Tenant ${QA_TENANT_NAME} at ${QA_PROPERTY_ADDRESS}, Property Manager ${pmEmail}.`);
  if (cleared) console.log(`Cleared ${cleared} unfinished report${cleared === 1 ? '' : 's'} left by an earlier run.`);
} finally {
  await db.close();
}
