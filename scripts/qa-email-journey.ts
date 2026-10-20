// The live email test (ADR 0011): sends a real email from a dedicated test Gmail
// account to the QA Agency, then watches the QA app do what it should, from the
// outside. Run by .github/workflows/qa.yml, or by hand on the home server:
//
//   deploy/qa-exec.sh npx tsx scripts/qa-email-journey.ts
//   deploy/qa-exec.sh npx tsx scripts/qa-email-journey.ts --dry-run   # no Gmail: see below
//
// The journey, as the Tenant (the test Gmail account) and as the QA Property Manager:
//   1. Sign in to the QA app as the Property Manager.
//   2. Email a realistic maintenance issue to the Agency's inbound address, with a
//      unique token in the subject and the body.
//   3. Wait for the app's acknowledgement in the Gmail inbox; check who sent it and what it says.
//   4. Answer the app's guided questions by email, as a Tenant would.
//   5. Open the photo link the app emails and upload a photo.
//   6. Wait for the Maintenance Request to appear for the Property Manager, found by its token.
//   7. Clean up: reject the request (the app emails the Tenant), tidy the Gmail inbox.
//
// Every wait polls with a deadline; nothing sleeps for a fixed time. It exits 0 when
// every step passed, 1 when one failed, 2 when it refused to start. The log goes to
// QA_LOG_DIR (default qa-journey-logs/) and is what the workflow uploads when a run
// fails. This repository is public, so the log never holds a secret, and the test
// account's, Property Manager's and inbox addresses and the upload link are masked.
//
// --dry-run skips Gmail and the real inbound email. It plays the Tenant through the
// app's phone simulator (/demo), which a QA app running on mocks serves, and reads
// the app's replies there. Everything on the app's side runs as in a real run:
// sign-in, the guided questions, the upload, finding and rejecting the request. It
// proves the script and the app's side of the journey, and nothing about Gmail,
// Resend or the tunnel.
//
// Needs (deploy/qa.env.example): PUBLIC_URL, QA_PM_EMAIL, QA_PM_PASSWORD,
// QA_INBOUND_ADDRESS, QA_GMAIL_ADDRESS, QA_GMAIL_CLIENT_ID, QA_GMAIL_CLIENT_SECRET and
// QA_GMAIL_REFRESH_TOKEN. A dry run needs only the first four.

import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { emailAddress } from '../src/adapters/email-text.ts';
import { buildRawMessage, createGmailClient, GmailAuthError, header, messageText, type GmailMessage } from '../src/adapters/gmail.ts';
import { exifTime, fixtureJpeg } from '../src/demo/photo-exif.ts';
import { QA_PROPERTY_ADDRESS, QA_TENANT_NAME, qaTenantFirstName } from './qa-fixture.ts';

// --- Settings ---

const USAGE = 'Usage: deploy/qa-exec.sh npx tsx scripts/qa-email-journey.ts [--dry-run]';
/** How often a wait looks again. */
const POLL_MS = 4_000;
const ACK_TIMEOUT_MS = 150_000;
/** Four questions, each an email out and an email back through Resend and the classifier. */
const QUESTIONS_TIMEOUT_MS = 360_000;
const REQUEST_TIMEOUT_MS = 150_000;
const REJECTION_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_NOTE = 'the photo check and the worker run in the app, so this is the app being slow or stuck';

/** Addresses of the real thing. A QA run must never be pointed at them. */
const PRODUCTION_HOSTS = ['myest8.kevinhe.pro'];
const PRODUCTION_HOST_SUFFIXES = ['.vercel.app'];
const PRODUCTION_INBOUND_DOMAINS = ['mail.kevinhe.pro'];

// --- Refusing to start ---

class Refused extends Error {}
const refuse = (problem: string): never => {
  throw new Refused(problem);
};

/** Why `raw` can't be the QA app's address, or null when it can. Only the QA hostname (`qa.…` or `qa-…`) is accepted. */
function qaUrlProblem(raw: string, { allowLoopback }: { allowLoopback: boolean }): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `PUBLIC_URL (${raw}) is not a URL`;
  }
  const host = url.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.includes(host) || PRODUCTION_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return `PUBLIC_URL (${raw}) is the production address. The live email test only ever runs against the QA app.`;
  }
  if (['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    return allowLoopback ? null : `PUBLIC_URL (${raw}) is this machine: a real run needs the QA app's public https address, which Resend posts to`;
  }
  if (url.protocol !== 'https:') return `PUBLIC_URL (${raw}) must be https`;
  if (!/^qa([.-]|$)/.test(host)) {
    return `PUBLIC_URL (${raw}) doesn't look like the QA address: its hostname must start with "qa." or "qa-", and anything else could be production`;
  }
  return null;
}

type Config = {
  dryRun: boolean;
  baseUrl: string;
  pmEmail: string;
  pmPassword: string;
  inboundAddress: string;
  gmail: { address: string; clientId: string; clientSecret: string; refreshToken: string } | null;
  logDir: string;
};

function configFromEnv(dryRun: boolean): Config {
  const env = (name: string) => process.env[name]?.trim() || undefined;
  const names = [
    'PUBLIC_URL',
    'QA_PM_EMAIL',
    'QA_PM_PASSWORD',
    'QA_INBOUND_ADDRESS',
    ...(dryRun ? [] : ['QA_GMAIL_ADDRESS', 'QA_GMAIL_CLIENT_ID', 'QA_GMAIL_CLIENT_SECRET', 'QA_GMAIL_REFRESH_TOKEN']),
  ];
  const missing = names.filter((name) => !env(name));
  if (missing.length) refuse(`set ${missing.join(', ')} (see deploy/qa.env.example)`);
  const baseUrl = env('PUBLIC_URL')!.replace(/\/+$/, '');
  const problem = qaUrlProblem(baseUrl, { allowLoopback: dryRun });
  if (problem) refuse(problem);
  const inboundAddress = env('QA_INBOUND_ADDRESS')!.toLowerCase();
  if (PRODUCTION_INBOUND_DOMAINS.some((domain) => inboundAddress.endsWith(`@${domain}`))) {
    refuse(`QA_INBOUND_ADDRESS (${inboundAddress}) is on the production inbound domain: QA has its own domain and its own Resend team`);
  }
  return {
    dryRun,
    baseUrl,
    pmEmail: env('QA_PM_EMAIL')!,
    pmPassword: env('QA_PM_PASSWORD')!,
    inboundAddress,
    gmail: dryRun
      ? null
      : {
          address: env('QA_GMAIL_ADDRESS')!.toLowerCase(),
          clientId: env('QA_GMAIL_CLIENT_ID')!,
          clientSecret: env('QA_GMAIL_CLIENT_SECRET')!,
          refreshToken: env('QA_GMAIL_REFRESH_TOKEN')!,
        },
    logDir: env('QA_LOG_DIR') ?? 'qa-journey-logs',
  };
}

// --- The log: stdout and a file, with secrets and addresses masked ---

function makeLog(config: Config, token: string) {
  const masks: [string, string][] = [
    [config.pmPassword, '<pm-password>'],
    [config.pmEmail, '<pm-email>'],
    [config.inboundAddress, '<qa-inbox>'],
    ...(config.gmail
      ? ([
          [config.gmail.refreshToken, '<refresh-token>'],
          [config.gmail.clientSecret, '<client-secret>'],
          [config.gmail.clientId, '<client-id>'],
          [config.gmail.address, '<test-gmail>'],
        ] as [string, string][])
      : []),
  ];
  const secrets = new Set<string>();
  mkdirSync(config.logDir, { recursive: true });
  const file = join(config.logDir, `journey-${token}.log`);
  writeFileSync(file, '');
  const clean = (text: string) => {
    let out = text;
    for (const [value, label] of masks) if (value) out = out.replaceAll(value, label);
    for (const value of secrets) out = out.replaceAll(value, '<secret>');
    // Upload links are bearer links to one report; a Gmail address anywhere else is masked too.
    return out.replace(/\/u\/[\w-]{10,}/g, '/u/<link>').replace(/[\w.+-]+@gmail\.com/gi, '<gmail>');
  };
  const log = (line: string) => {
    const text = clean(line);
    console.log(text);
    appendFileSync(file, `${new Date().toISOString()} ${text}\n`);
  };
  /** Masks a value learnt at run time (a cookie, an access token) wherever it turns up. */
  log.hide = (value: string) => value && secrets.add(value);
  log.file = file;
  return log;
}
type Log = ReturnType<typeof makeLog>;

// --- Waiting ---

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Calls `attempt` until it returns something, or `timeoutMs` passes. A failed attempt is tried again (a tunnel hiccup is not a failed run); the last error goes in the timeout message. */
async function waitFor<T>(what: string, timeoutMs: number, attempt: () => Promise<T | undefined | false>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const found = await attempt();
      if (found) return found;
      lastError = undefined;
    } catch (error) {
      if (error instanceof GmailAuthError || error instanceof Refused) throw error;
      lastError = error;
    }
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`Timed out after ${seconds(timeoutMs)} waiting for ${what}.${lastError ? ` The last attempt failed: ${describe(lastError)}` : ''}`);
    await sleep(Math.min(POLL_MS, left));
  }
}

// --- The QA app, over HTTP, as the Property Manager sees it ---

const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
/** HTML as plain text: no tags or scripts, entities decoded, the line breaks of the source kept. */
function plainText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|#x27|nbsp);/g, (entity) => entities[entity]!);
}
/** A page as the reader sees it: plain text with runs of space and line breaks squeezed to one space. */
const pageText = (html: string) => plainText(html).replace(/\s+/g, ' ').trim();

type Page = { status: number; html: string; location: string | null };

class QaApp {
  #cookie = '';
  readonly baseUrl: string;
  #log: Log;
  constructor(baseUrl: string, log: Log) {
    this.baseUrl = baseUrl;
    this.#log = log;
  }

  async request(path: string, init: RequestInit = {}): Promise<Page> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      ...init,
      headers: { ...(this.#cookie ? { cookie: this.#cookie } : {}), ...init.headers },
    });
    return { status: response.status, html: await response.text(), location: response.headers.get('location') };
  }

  /** GETs a page, following redirects. */
  async get(path: string): Promise<Page> {
    let page = await this.request(path);
    for (let hops = 0; page.status >= 300 && page.status < 400 && page.location && hops < 5; hops++) {
      page = await this.request(new URL(page.location, this.baseUrl).pathname + new URL(page.location, this.baseUrl).search);
    }
    return page;
  }

  /** POSTs a form (urlencoded) as the signed-in Property Manager. The action's flash message is in the redirect it answers with. */
  post(path: string, fields: Record<string, string> = {}) {
    return this.request(path, { method: 'POST', body: new URLSearchParams(fields), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  }

  async signIn(email: string, password: string) {
    const response = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email, password }),
    });
    if (response.status === 401) throw new Error('The QA app refused the Property Manager sign-in. Run the seed (scripts/qa-seed.ts) and check QA_PM_EMAIL and QA_PM_PASSWORD.');
    const cookie = response.headers.getSetCookie().map((c) => c.split(';')[0]!).find((c) => c.startsWith('myest8_session='));
    if (response.status !== 303 || !cookie) throw new Error(`Signing in answered ${response.status} and set no session`);
    this.#cookie = cookie;
    this.#log.hide(cookie.split('=')[1]!);
    const home = await this.get('/');
    if (home.status !== 200 || !/Dashboard/i.test(pageText(home.html))) throw new Error(`Signed in, but the dashboard answered ${home.status}`);
  }

  /** The ids of the Maintenance Requests waiting for review, from the Tickets list. */
  async requestIds(): Promise<number[]> {
    const list = await this.get('/tickets?filter=all');
    if (list.status !== 200) throw new Error(`The Tickets list answered ${list.status}`);
    return [...new Set([...list.html.matchAll(/href="\/requests\/(\d+)"/g)].map((m) => Number(m[1])))];
  }

  /** The review page of a Maintenance Request, or null when there is none waiting with that number. */
  async review(id: number): Promise<string | null> {
    const page = await this.get(`/requests/${id}`);
    return page.status === 200 ? pageText(page.html) : null;
  }

  /** The Maintenance Request whose page mentions `needle`, if any is waiting. */
  async findRequest(needle: string, skip: Set<number> = new Set()): Promise<{ id: number; text: string } | undefined> {
    for (const id of await this.requestIds()) {
      if (skip.has(id)) continue;
      const text = await this.review(id);
      if (text?.includes(needle)) return { id, text };
      skip.add(id);
    }
    return undefined;
  }

  /** Rejects a Maintenance Request, telling the Tenant why. Returns whether the app accepted it. */
  async reject(id: number, reason: string): Promise<boolean> {
    const page = await this.post(`/requests/${id}/reject`, { reason });
    return page.status === 303 && !!page.location && !/[?&]error=/.test(page.location);
  }

  /** The dashboard Inbox item whose message mentions `needle`: where a message lands when it isn't a report. */
  async findInboxItem(needle: string): Promise<number | undefined> {
    const dashboard = await this.get('/?filter=all');
    for (const [, id, body] of dashboard.html.matchAll(/<article class="inbox-item[^"]*" id="inbox-(\d+)">([\s\S]*?)<\/article>/g)) {
      if (pageText(body!).includes(needle)) return Number(id);
    }
    return undefined;
  }

  async dismissInboxItem(id: number): Promise<boolean> {
    const page = await this.post(`/inbox/${id}/dismiss?filter=all`);
    return page.status === 303 && !!page.location && !/[?&]error=/.test(page.location);
  }

  /** Sends the photo through the no-login upload link, as the Tenant's browser would. */
  async uploadPhoto(link: string, photo: Uint8Array): Promise<void> {
    const page = await this.get(link);
    if (page.status !== 200) throw new Error(`The upload link answered ${page.status}`);
    const form = new FormData();
    form.append('files', new Blob([photo], { type: 'image/jpeg' }), 'kitchen-tap.jpg');
    const sent = await this.request(link, { method: 'POST', body: form });
    if (sent.status !== 303 || !/[?&]ok=1\b/.test(sent.location ?? '')) throw new Error(`Uploading the photo answered ${sent.status}${sent.location ? ` (${sent.location})` : ''}`);
  }
}

// --- The Tenant's mailbox: Gmail, or the app's phone simulator for a dry run ---

/** An email from the app to the Tenant. `from` is null where the transport can't tell (the simulator). */
type AppEmail = { id: string; from: string | null; subject: string; text: string; spam?: boolean };

interface Mailbox {
  readonly name: string;
  /** Remembers what the app has already sent the Tenant, so it isn't taken for this run's replies. */
  baseline(): Promise<void>;
  send(subject: string, text: string): Promise<void>;
  /** The app's emails that have arrived since the last call, oldest first. */
  fresh(): Promise<AppEmail[]>;
  /** Removes this run's messages from the Tenant's inbox, where the transport allows. */
  tidy(): Promise<number>;
}

function gmailMailbox(config: Config, log: Log): Mailbox {
  const gmail = config.gmail!;
  const client = createGmailClient({ clientId: gmail.clientId, clientSecret: gmail.clientSecret, redirectUri: 'http://127.0.0.1' });
  const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const startedAt = Math.floor(Date.now() / 1000);
  const seen = new Set<string>();
  let accessToken = '';

  /** An access token for the test account, got from the refresh token the first time it is needed. */
  async function authorised(): Promise<string> {
    if (!accessToken) {
      try {
        accessToken = await client.refresh(gmail.refreshToken);
      } catch (error) {
        if (error instanceof GmailAuthError) {
          throw new GmailAuthError(
            'Google refused the test account\'s refresh token (invalid_grant). It lapses after 7 days while the OAuth consent screen is in Testing, when the account\'s password changes, or when access is revoked: publish the consent screen and get a new token with scripts/qa-gmail-token.ts (docs/qa.md).',
          );
        }
        throw error;
      }
      log.hide(accessToken);
      const profile = await client.profile(accessToken);
      if (profile.emailAddress.toLowerCase() !== gmail.address) {
        throw new Refused('QA_GMAIL_ADDRESS is not the account the refresh token belongs to. Both must be the test Gmail account.');
      }
    }
    return accessToken;
  }

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API}/${path}`, { ...init, signal: AbortSignal.timeout(20_000), headers: { ...init.headers, authorization: `Bearer ${await authorised()}` } });
    if (!response.ok) throw new Error(`Gmail ${path.split('?')[0]} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    return (await response.json()) as T;
  }

  /** Message ids matching a Gmail search, Spam included: a reply that lands there is a failure to report, not to miss. */
  const search = async (q: string) =>
    (await api<{ messages?: { id: string }[] }>(`messages?${new URLSearchParams({ q: `in:anywhere -in:trash ${q}`, maxResults: '100' })}`)).messages?.map((m) => m.id) ?? [];

  return {
    name: 'Gmail',
    async baseline() {
      for (const id of await search(`from:${config.inboundAddress} newer_than:2d`)) seen.add(id);
    },
    async send(subject, text) {
      await client.send(await authorised(), buildRawMessage({ from: gmail.address, to: config.inboundAddress, cc: [], subject, text, attachments: [] }));
    },
    async fresh() {
      const found: (AppEmail & { at: number })[] = [];
      for (const id of await search(`from:${config.inboundAddress} after:${startedAt - 300}`)) {
        if (seen.has(id)) continue;
        const message: GmailMessage = await client.message(await authorised(), id);
        seen.add(id);
        found.push({
          id,
          from: emailAddress(header(message.payload, 'From')),
          subject: header(message.payload, 'Subject'),
          text: message.payload ? messageText(message.payload) : '',
          spam: !!message.labelIds?.includes('SPAM'),
          at: Number(message.internalDate ?? 0),
        });
      }
      return found.sort((a, b) => a.at - b.at);
    },
    async tidy() {
      // This run's mail, both ways: what the app sent, and what the Tenant sent.
      const ids = await search(`(from:${config.inboundAddress} OR in:sent) after:${startedAt - 300}`);
      for (const id of ids) await api(`messages/${id}/trash`, { method: 'POST' });
      return ids.length;
    },
  };
}

/** The Tenant's phone simulator in the QA app (/demo): the dry run's stand-in for a Gmail inbox. */
function simulatorMailbox(app: QaApp): Mailbox {
  let contact = 0;
  const seen = new Set<string>();

  async function thread() {
    if (!contact) {
      const people = await app.get('/demo');
      if (people.status !== 200) throw new Error(`The phone simulator answered ${people.status}: a dry run needs the QA app running on mocks, which serves /demo`);
      for (const [, id, label] of people.html.matchAll(/href="[^"]*contact=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
        if (pageText(label!).includes(QA_TENANT_NAME)) contact = Number(id);
      }
      if (!contact) throw new Error(`${QA_TENANT_NAME} is not in the phone simulator: run the seed first`);
    }
    const page = await app.get(`/demo?contact=${contact}`);
    const mails: AppEmail[] = [];
    // From myEST8 to the Tenant: `chat-start` bubbles. Each starts "Subject: …" when the message has one.
    for (const [, at, bubble] of page.html.matchAll(/<div class="chat chat-start">[\s\S]*?datetime="([^"]*)"[\s\S]*?<div class="chat-bubble[^"]*">([\s\S]*?)<\/div>/g)) {
      const raw = plainText(bubble!).trim();
      const subject = /^Subject: ([^\n]*)\n/.exec(raw)?.[1]?.trim() ?? '';
      mails.push({ id: `${at}|${raw}`, from: null, subject, text: (subject ? raw.slice(raw.indexOf('\n')) : raw).trim() });
    }
    return mails;
  }

  return {
    name: 'phone simulator',
    async baseline() {
      for (const mail of await thread()) seen.add(mail.id);
    },
    async send(_subject, text) {
      const form = new FormData();
      form.append('contact', String(contact));
      form.append('channel', 'email');
      form.append('text', text);
      const sent = await app.request('/demo/send', { method: 'POST', body: form });
      if (sent.status !== 303 || /[?&]error=/.test(sent.location ?? '')) throw new Error(`The phone simulator refused the message (${sent.status} ${sent.location ?? ''})`);
    },
    async fresh() {
      const mails = (await thread()).filter((mail) => !seen.has(mail.id));
      for (const mail of mails) seen.add(mail.id);
      return mails;
    },
    async tidy() {
      return 0;
    },
  };
}

/** Collects the app's emails as they arrive, so one that comes early (the first guided question beside the acknowledgement) waits for the step that wants it. */
class AppMail {
  #queue: AppEmail[] = [];
  #mailbox: Mailbox;
  #log: Log;
  constructor(mailbox: Mailbox, log: Log) {
    this.#mailbox = mailbox;
    this.#log = log;
  }

  async take(what: string, timeoutMs: number, matches: (mail: AppEmail) => boolean): Promise<AppEmail> {
    return waitFor(what, timeoutMs, async () => {
      for (const mail of await this.#mailbox.fresh()) {
        this.#log(`  email from the app: "${mail.subject}" ${JSON.stringify(mail.text)}`);
        this.#queue.push(mail);
      }
      const at = this.#queue.findIndex(matches);
      return at === -1 ? undefined : this.#queue.splice(at, 1)[0];
    });
  }

  /** Emails nobody asked for. */
  get unclaimed() {
    return this.#queue;
  }
}

// --- What the app asks, and what the Tenant answers ---

const QUESTIONS = [
  { key: 'location', asks: /where in the property/i, answer: 'The kitchen, the cold tap on the sink' },
  { key: 'started', asks: /when did it start/i, answer: 'About three days ago' },
  { key: 'worsening', asks: /getting worse/i, answer: 'NO' },
  { key: 'availability', asks: /when are you usually home/i, answer: '1' },
];
const isAcknowledgement = (mail: AppEmail) => /we got your message/i.test(mail.subject) || /we've got your message/i.test(mail.text);
const isUrgentReminder = (mail: AppEmail) => /urgent repair/i.test(mail.subject) || /this sounds urgent/i.test(mail.text);
const askedQuestion = (mail: AppEmail) => QUESTIONS.find((q) => q.asks.test(mail.text));
const uploadLinkOf = (mail: AppEmail) => /https?:\/\/[^\s/]+(\/u\/[\w-]+)/.exec(mail.text)?.[1];

/**
 * The report the Tenant emails: a routine tap, in their own words, with this run's token in the
 * subject and at the end. It keeps clear of the words that make a report urgent (leak, flood,
 * worse, mould...): an urgent report skips the acknowledgement and goes down another path.
 */
function report(token: string) {
  return {
    subject: `Dripping kitchen tap (QA run ${token})`,
    text: [
      'Hi,',
      '',
      'The cold tap in the kitchen has been dripping steadily for the past few days. The drip is constant and loud at night, but it is only a drip. Could someone take a look at the tap washer please?',
      '',
      `Thanks, ${qaTenantFirstName()}`,
      `(QA run ${token})`,
    ].join('\n'),
  };
}

// --- The journey ---

type Result = { name: string; status: 'ok' | 'FAIL' | 'skipped' | 'warn'; ms: number; note?: string };

async function journey(config: Config, log: Log, token: string): Promise<boolean> {
  const results: Result[] = [];
  let failed = false;
  const app = new QaApp(config.baseUrl, log);
  const mailbox = config.dryRun ? simulatorMailbox(app) : gmailMailbox(config, log);
  const mail = new AppMail(mailbox, log);
  const { subject, text } = report(token);
  const checked = new Set<number>();
  let requestId: number | null = null;
  let uploadLink = '';
  const timings: Record<string, number> = {};

  /** Runs one step, times it, and skips the rest once one has failed. */
  async function step(name: string, fn: () => Promise<string | void>) {
    if (failed) return void results.push({ name, status: 'skipped', ms: 0 });
    log(`\n> ${name}`);
    const started = Date.now();
    try {
      const note = (await fn()) || undefined;
      results.push({ name, status: 'ok', ms: Date.now() - started, ...(note ? { note } : {}) });
      log(`  ok (${seconds(Date.now() - started)})${note ? `: ${note}` : ''}`);
    } catch (error) {
      failed = true;
      results.push({ name, status: 'FAIL', ms: Date.now() - started, note: describe(error) });
      log(`  FAILED (${seconds(Date.now() - started)}): ${describe(error)}`);
      if (error instanceof Refused) throw error;
    }
  }

  const steps = async () => {
    await step('Sign in to the QA app as the Property Manager', async () => {
      await app.signIn(config.pmEmail, config.pmPassword);
      // A run that died halfway can leave its request waiting; one request per Tenant is what the checks below expect.
      let swept = 0;
      for (const id of await app.requestIds()) {
        if ((await app.review(id))?.includes('(QA run ') && (await app.reject(id, 'Left by an earlier QA run'))) swept++;
      }
      return swept ? `rejected ${swept} request${swept === 1 ? '' : 's'} left by earlier runs` : undefined;
    });

    let sentAt = 0;
    await step(`Email the report from the test account (${mailbox.name})`, async () => {
      await mailbox.baseline();
      sentAt = Date.now();
      await mailbox.send(subject, text);
      return `subject "${subject}"`;
    });

    await step("The app's acknowledgement reaches the Tenant's inbox", async () => {
      const ack = await mail.take('the acknowledgement email', ACK_TIMEOUT_MS, (m) => isAcknowledgement(m) || isUrgentReminder(m));
      if (isUrgentReminder(ack)) throw new Error('The app took a dripping tap for an urgent repair and sent the urgent-repair reminder instead of an acknowledgement. The classifier is judging a routine report as urgent.');
      timings.acknowledgement = Date.now() - sentAt;
      const problems = [
        ...(ack.spam ? ['it landed in the Spam folder'] : []),
        ...(ack.from !== null && ack.from !== config.inboundAddress ? [`it came from ${ack.from}, not the Agency's inbox ${config.inboundAddress}`] : []),
        ...(!/we got your message/i.test(ack.subject) ? [`its subject is "${ack.subject}"`] : []),
        ...(!ack.text.includes(`Hi ${qaTenantFirstName()}`) ? [`it doesn't greet ${qaTenantFirstName()}`] : []),
        ...(!ack.text.includes(QA_PROPERTY_ADDRESS) ? [`it doesn't name ${QA_PROPERTY_ADDRESS}`] : []),
        ...(!/this is myEST8 QA/.test(ack.text) ? ['it is not signed by the QA Agency'] : []),
      ];
      if (problems.length) throw new Error(`The acknowledgement arrived but is wrong: ${problems.join('; ')}.`);
      return `${seconds(timings.acknowledgement)} after sending${ack.from ? `, from the Agency's inbox` : ''}`;
    });

    await step('Answer the app\'s guided questions by email, until it sends the photo link', async () => {
      const answered = new Set<string>();
      for (;;) {
        const next = await mail.take(`the next question or the photo link (answered so far: ${[...answered].join(', ') || 'none'})`, QUESTIONS_TIMEOUT_MS, (m) => !!askedQuestion(m) || !!uploadLinkOf(m));
        const link = uploadLinkOf(next);
        if (link) {
          uploadLink = link;
          return `${answered.size} questions answered, then the photo link`;
        }
        const question = askedQuestion(next)!;
        if (answered.has(question.key)) throw new Error(`The app asked the "${question.key}" question twice, so it did not take the answer.`);
        answered.add(question.key);
        await mailbox.send(`Re: ${next.subject}`, question.answer);
        log(`  answered "${question.key}": ${question.answer}`);
      }
    });

    await step('Upload a photo through the link', async () => {
      await app.uploadPhoto(uploadLink, fixtureJpeg({ takenAt: exifTime(new Date(), 'Australia/Sydney') }));
    });

    await step('The Maintenance Request appears for the Property Manager', async () => {
      const found = await waitFor(`the Maintenance Request with ${token} on the Tickets list (${REQUEST_TIMEOUT_NOTE})`, REQUEST_TIMEOUT_MS, () => app.findRequest(token, checked));
      requestId = found.id;
      timings.request = Date.now() - sentAt;
      const missing = [QA_TENANT_NAME, QA_PROPERTY_ADDRESS, QUESTIONS[0]!.answer, QUESTIONS[1]!.answer].filter((fact) => !found.text.includes(fact));
      if (missing.length) throw new Error(`The Maintenance Request ${found.id} is there, but its page doesn't show: ${missing.join('; ')}.`);
      return `request ${found.id}, ${seconds(timings.request)} after sending, with the Tenant's own words and answers`;
    });
  };

  // Clean-up always runs, and never fails the journey: it reports what it could not do.
  const cleanup = async () => {
    log('\n> Clean up');
    const started = Date.now();
    const notes: string[] = [];
    try {
      requestId ??= (await app.findRequest(token))?.id ?? null;
      if (requestId !== null) {
        const rejected = await app.reject(requestId, 'This was a QA test report. No visit is needed.');
        const gone = rejected && (await app.review(requestId)) === null;
        notes.push(gone ? `rejected request ${requestId}` : `could not reject request ${requestId}`);
        if (gone) {
          // The app tells the Tenant, which is one more email to prove (and to tidy).
          const told = await mail.take('the rejection email', REJECTION_TIMEOUT_MS, (m) => /about your maintenance request/i.test(m.subject) || /won't be going ahead/i.test(m.text)).then(
            () => true,
            () => false,
          );
          notes.push(told ? 'the Tenant was told' : 'no rejection email arrived in a minute');
        }
      } else {
        const item = await app.findInboxItem(token);
        if (item !== undefined) notes.push((await app.dismissInboxItem(item)) ? `dismissed Inbox item ${item}` : `could not dismiss Inbox item ${item}`);
      }
    } catch (error) {
      notes.push(`the app's side failed: ${describe(error)}`);
    }
    try {
      const tidied = await mailbox.tidy();
      if (tidied) notes.push(`moved ${tidied} messages to the Gmail trash`);
    } catch (error) {
      notes.push(`tidying ${mailbox.name} failed: ${describe(error)}`);
    }
    const worried = notes.some((n) => /could not|failed|no rejection/.test(n));
    results.push({ name: 'Clean up', status: worried ? 'warn' : 'ok', ms: Date.now() - started, note: notes.join('; ') || 'nothing to clean up' });
    log(`  ${worried ? 'warning' : 'ok'}: ${notes.join('; ') || 'nothing to clean up'}`);
  };

  /** When the acknowledgement never came, says where the email went: the Inbox, a Maintenance Request, or nowhere. */
  async function whereDidItGo() {
    const failure = results.find((r) => r.name.startsWith("The app's acknowledgement") && r.status === 'FAIL');
    if (!failure || /urgent repair/.test(failure.note ?? '')) return;
    const item = await app.findInboxItem(token).catch(() => undefined);
    const request = item === undefined ? await app.findRequest(token).catch(() => undefined) : undefined;
    const where =
      item !== undefined
        ? `The app did receive the email: it is in the dashboard Inbox (item ${item}), so the classifier did not take it for a new report.`
        : request
          ? 'The app did receive the email and made a Maintenance Request, but sent no acknowledgement.'
          : "The app does not show the email anywhere: it never arrived. Check the Resend webhook (in the QA team's dashboard) and the tunnel.";
    log(`  ${where}`);
    failure.note += ` ${where}`;
  }

  try {
    await steps();
  } finally {
    await whereDidItGo().catch(() => undefined);
    await cleanup();
  }

  const unclaimed = mail.unclaimed;
  if (unclaimed.length) log(`\nNot used by any step: ${unclaimed.map((m) => `"${m.subject}"`).join(', ')}`);

  // The summary
  const total = results.reduce((sum, r) => sum + r.ms, 0);
  log(`\nQA email journey ${failed ? 'FAILED' : 'passed'} in ${seconds(total)} (${config.dryRun ? 'dry run: the phone simulator stood in for Gmail' : 'real Gmail, Resend and Claude'}), token ${token}`);
  for (const r of results) log(`  ${r.status.padEnd(7)} ${r.name}${r.ms ? ` (${seconds(r.ms)})` : ''}${r.note ? `\n          ${r.note}` : ''}`);
  if (!failed) log(`  Timings from sending: acknowledgement ${seconds(timings.acknowledgement ?? 0)}, request visible ${seconds(timings.request ?? 0)}.`);
  return !failed;
}

// --- Main ---

async function main() {
  const { values } = (() => {
    try {
      return parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } }, strict: true, allowPositionals: false });
    } catch (error) {
      return refuse(describe(error));
    }
  })();
  const config = configFromEnv(values['dry-run']);
  const token = `qa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const log = makeLog(config, token);
  log(`QA email journey${config.dryRun ? ' (dry run)' : ''}: ${config.baseUrl}, token ${token}, log ${log.file}`);
  return (await journey(config, log, token)) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Refused ? `Refusing to run: ${error.message}\n${USAGE}` : `The journey stopped unexpectedly: ${describe(error)}`);
    process.exit(error instanceof Refused ? 2 : 1);
  },
);
