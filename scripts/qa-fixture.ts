// What the QA Agency is made of, shared by scripts/qa-seed.ts (which creates it) and
// scripts/qa-email-journey.ts (which looks for it). See docs/qa.md and ADR 0011.

/** The QA Agency, and the Property Manager the journey signs in as. */
export const QA_AGENCY_NAME = 'myEST8 QA';
export const QA_PM_NAME = 'QA Property Manager';

/** The Tenant the test Gmail account plays: its address is `QA_GMAIL_ADDRESS`. */
export const QA_TENANT_NAME = 'Quinn Tester';
export const QA_PROPERTY_ADDRESS = '1 Test St, Newtown NSW 2042';
export const QA_PROPERTY_SUBURB = 'Newtown';

/** A Property Owner the Property needs. Never contacted: the journey stops before any Quote. */
export const QA_OWNER = { name: 'Olive Owner', mobile: '+61400000900', email: 'qa-owner@myest8-qa.example' };

/** Schemas the QA scripts agree to work in: `qa`, or `qa_` plus a suffix for a dry run. Never `live`, `myest8` or `public`. */
export const QA_SCHEMA = /^qa(_[a-z0-9_]+)?$/;

/** The first name an email from the app greets the Tenant with. */
export const qaTenantFirstName = () => QA_TENANT_NAME.split(' ')[0]!;
