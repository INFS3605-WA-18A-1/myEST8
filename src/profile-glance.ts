// What a profile's read is built from. The Tenant's requests of the last year are
// judged here, lazily, the first time the profile opens: at most one call, and
// never long enough to hold the page. A failure is one line on stderr, with none
// of the Tenant's words, and the read falls back to the counts code can see.
// Tradie, Property Owner and Building Manager reads use records already kept.

import type { Context } from './context.ts';
import { all, one, run } from './db.ts';
import type { Db } from './db.ts';
import { tenantRead, tradieRead, type ProfileRead, type RequestJudgment, type TenantRequest, type TradieSignals } from './profile-reads.ts';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
/** One profile never waits longer than this for Jev. */
export const JUDGE_TIMEOUT_MS = 8_000;
/** How many still-unjudged requests one call may cover. */
export const JUDGE_BATCH = 20;
const MODEL = 'jev-latest';

const COUNTED = `('maintenance_request', 'confirmed', 'rejected', 'urgent')`;

type IssueRow = {
  id: number;
  property_id: number;
  trade: string;
  summary: string | null;
  description: string;
  urgency: string;
  status: string;
};

/** The Tenant's read, judging any of the last year's requests that have none yet. */
export async function tenantProfileRead(ctx: Context, agencyId: number, tenantId: number, options: { timeoutMs?: number } = {}): Promise<ProfileRead | null> {
  const since = new Date(ctx.clock.now().getTime() - YEAR_MS).toISOString();
  const requests = (
    await all<IssueRow>(
      ctx.db,
      `SELECT id, property_id, trade, summary, description, urgency, status FROM issues
       WHERE agency_id = ? AND tenant_id = ? AND reported_at >= ? AND status IN ${COUNTED}
       ORDER BY reported_at DESC, id DESC`,
      agencyId,
      tenantId,
      since,
    )
  ).map(toRequest);
  if (!requests.length) return null;
  const judgments = await remembered(ctx.db, requests.map((request) => request.issueId));
  const missing = requests.filter((request) => !judgments.has(request.issueId)).slice(0, JUDGE_BATCH);
  const judge = ctx.ports.requestJudge;
  if (judge && missing.length) {
    try {
      const judged = await withTimeout(
        judge.judge(missing.map((request) => ({ issueId: request.issueId, description: request.description, summary: request.summary, urgency: request.urgency }))),
        options.timeoutMs ?? JUDGE_TIMEOUT_MS,
      );
      for (const request of missing) {
        const judgment = judged.get(request.issueId);
        if (!judgment || !usable(judgment)) continue;
        await run(
          ctx.db,
          `INSERT INTO issue_judgments (issue_id, minor, tenant_caused, model) VALUES (?, ?, ?, ?) ON CONFLICT (issue_id) DO NOTHING`,
          request.issueId,
          judgment.minor,
          judgment.tenantCaused,
          MODEL,
        );
        judgments.set(request.issueId, judgment);
      }
    } catch (error) {
      // The page still renders. The line names the failure, never a Tenant's words.
      console.error(`request judge failed: ${failureOf(error)}`);
    }
  }
  return tenantRead(requests, judgments);
}

function toRequest(row: IssueRow): TenantRequest {
  return {
    issueId: row.id,
    propertyId: row.property_id,
    trade: row.trade,
    summary: row.summary,
    description: row.description,
    urgency: row.urgency,
    status: row.status,
  };
}

async function remembered(db: Db, issueIds: number[]) {
  if (!issueIds.length) return new Map<number, RequestJudgment>();
  const rows = await all<{ issue_id: number; minor: number; tenant_caused: number }>(
    db,
    `SELECT issue_id, minor, tenant_caused FROM issue_judgments
     WHERE issue_id IN (SELECT value::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS ids (value))`,
    JSON.stringify(issueIds),
  );
  return new Map(rows.map((row) => [row.issue_id, { minor: row.minor, tenantCaused: row.tenant_caused }]));
}

const usable = (judgment: RequestJudgment) =>
  typeof judgment.minor === 'number' && judgment.minor >= 0 && judgment.minor <= 1 && typeof judgment.tenantCaused === 'number' && judgment.tenantCaused >= 0 && judgment.tenantCaused <= 1;

/** A short reason that cannot contain a request's text: the judge's own message is not logged. */
function failureOf(error: unknown): string {
  if (error instanceof Error && error.message === 'timed out') return 'timed out';
  if (error instanceof Error && /^Jev returned \d+/.test(error.message)) return error.message.split(':')[0]!;
  return 'unavailable';
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Common Area issues passed to this Building Manager. Their reply time isn't recorded. */
export async function commonAreaIssues(db: Db, agencyId: number, personId: number): Promise<number> {
  const row = await one<{ n: number }>(
    db,
    `SELECT count(*) AS n FROM messages WHERE agency_id = ? AND person_id = ? AND template = 'building_manager.common_area_issue'`,
    agencyId,
    personId,
  );
  return Number(row?.n ?? 0);
}

/** Jobs, Quotes and visits already on record for this Tradie. */
export async function tradieSignals(db: Db, tradieId: number): Promise<TradieSignals> {
  const [jobs, sent, chosen, visits, quotes] = await Promise.all([
    one<{ done: number; open: number }>(
      db,
      `SELECT count(DISTINCT j.id) FILTER (WHERE j.status = 'done') AS done,
              count(DISTINCT j.id) FILTER (WHERE j.status NOT IN ('done', 'cancelled')) AS open
       FROM quotes q JOIN jobs j ON j.id = q.job_id
       WHERE q.tradie_id = ? AND q.status = 'approved'`,
      tradieId,
    ),
    one<{ n: number }>(db, `SELECT count(*) AS n FROM quote_requests WHERE tradie_id = ?`, tradieId),
    one<{ n: number }>(db, `SELECT count(*) AS n FROM quotes WHERE tradie_id = ? AND status = 'approved'`, tradieId),
    one<{ visits: number; rescheduled: number }>(
      db,
      `SELECT count(*) FILTER (WHERE status <> 'cancelled') AS visits,
              count(*) FILTER (WHERE status <> 'cancelled' AND reschedule_requested_by IS NOT NULL) AS rescheduled
       FROM work_orders WHERE tradie_id = ?`,
      tradieId,
    ),
    all<{ sent_at: string; received_at: string }>(
      db,
      `SELECT r.sent_at, min(q.received_at) AS received_at
       FROM quote_requests r JOIN quotes q ON q.quote_request_id = r.id
       WHERE r.tradie_id = ? GROUP BY r.id, r.sent_at`,
      tradieId,
    ),
  ]);
  const dayMs = 24 * 60 * 60 * 1000;
  return {
    jobsDone: Number(jobs?.done ?? 0),
    openJobs: Number(jobs?.open ?? 0),
    quotesSent: Number(sent?.n ?? 0),
    quotesChosen: Number(chosen?.n ?? 0),
    visits: Number(visits?.visits ?? 0),
    rescheduledVisits: Number(visits?.rescheduled ?? 0),
    turnaroundDays: quotes.flatMap((quote) => {
      const days = (Date.parse(quote.received_at) - Date.parse(quote.sent_at)) / dayMs;
      return Number.isFinite(days) && days >= 0 ? [days] : [];
    }),
  };
}

/** The Tradie's read from those signals. */
export async function tradieProfileRead(db: Db, tradieId: number): Promise<ProfileRead | null> {
  return tradieRead(await tradieSignals(db, tradieId));
}
