// A profile's read: one sentence and the numbers behind it, from plain records.
// No database and no model. Callers decide what counts as the last year and which
// judgments are safe to use. Wording never accuses a Tenant: a high tenant-caused
// score is only ever "possibly" or "may have been".

export type ChipTone = 'concern' | 'good' | 'neutral';

export type ProfileChip = { text: string; tone: ChipTone };

export type ProfileRead = { sentence: string; chips: ProfileChip[]; ai: boolean };

/** A request counts as minor when Jev's score is at least this (0 to 1, higher is more minor). */
export const MINOR_AT = 0.6;
/** A repair is mentioned as possibly Tenant-caused only at or above this probability. */
export const TENANT_CAUSED_AT = 0.7;
/** Requests in the last year at or above this are "often". */
export const FREQUENT_REQUESTS = 5;
/** Requests in the last year at or below this are "few" or "rarely". */
export const FEW_REQUESTS = 2;
/** How many possibly Tenant-caused repairs it takes before the sentence says so. */
export const TENANT_CAUSED_SENTENCE_AT = 2;
/** Share of judged requests (each at least MINOR_AT) that counts as "mostly" minor. */
export const MOSTLY_MINOR_SHARE = 0.5;
/** Same Trade and the same summary at one Property, this many times, is a repeat. */
export const REPEAT_AT = 2;
/** A Property Owner who answers within this is quick. */
export const QUICK_REPLY_HOURS = 48;
/** A reply that takes this long is slow. */
export const SLOW_REPLY_HOURS = 24 * 7;
/** Chosen Quotes divided by Quote Requests, at or above this, is "wins most". */
export const WIN_RATE_HIGH = 0.6;
/** Below this, a Tradie is chosen less often than they quote. */
export const WIN_RATE_LOW = 0.4;
/** A typical quote or reply within this many days is quick. */
export const QUICK_DAYS = 2;
/** A typical quote or reply of this many days or more is slow. */
export const SLOW_DAYS = 7;

export type TenantRequest = {
  issueId: number;
  propertyId: number;
  trade: string;
  summary: string | null;
  description: string;
  urgency: string;
  status: string;
};

export type RequestJudgment = { minor: number; tenantCaused: number };

export type OwnerApproval = { status: string; requestedAt: string; answeredAt: string | null };

export type TradieSignals = {
  jobsDone: number;
  openJobs: number;
  quotesSent: number;
  quotesChosen: number;
  /** Days from the Quote Request to the first Quote, for the ones that came back. */
  turnaroundDays: number[];
  visits: number;
  rescheduledVisits: number;
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** "4 hours" or "3 days". Under a day stays in hours; anything longer rounds to days. */
function spanPhrase(hours: number): string {
  if (hours < 24) {
    const rounded = Math.max(1, Math.round(hours));
    return count(rounded, 'hour', 'hours');
  }
  return count(Math.max(1, Math.round(hours / 24)), 'day', 'days');
}

function toneForDays(days: number): ChipTone {
  if (days <= QUICK_DAYS) return 'good';
  if (days >= SLOW_DAYS) return 'concern';
  return 'neutral';
}

/**
 * The Tenant's read from the requests of the last year and any judgments the caller
 * trusts. An empty list is no history. `ai` is true only when a judgment was used.
 */
export function tenantRead(requests: TenantRequest[], judgments: ReadonlyMap<number, RequestJudgment>): ProfileRead | null {
  if (!requests.length) return null;
  const judged = requests.filter((request) => judgments.has(request.issueId));
  const minorCount = judged.filter((request) => judgments.get(request.issueId)!.minor >= MINOR_AT).length;
  const caused = judged.filter((request) => judgments.get(request.issueId)!.tenantCaused >= TENANT_CAUSED_AT).length;
  const minorShare = judged.length ? minorCount / judged.length : null;
  const rejected = requests.filter((request) => request.status === 'rejected').length;
  const urgent = requests.filter((request) => request.status === 'urgent' || request.urgency === 'urgent').length;
  const ai = judged.length > 0;
  const chips: ProfileChip[] = [];
  if (ai && minorShare !== null) {
    const total = judged.length === requests.length ? requests.length : judged.length;
    const noun = judged.length === requests.length ? (total === 1 ? 'request' : 'requests') : 'judged requests';
    chips.push({
      text: `${minorCount} of ${total} ${noun} in the last year ${minorCount === 1 ? 'was' : 'were'} minor`,
      tone: minorShare >= MOSTLY_MINOR_SHARE ? 'concern' : 'good',
    });
  }
  if (caused > 0) chips.push({ text: `${count(caused, 'repair', 'repairs')} possibly caused by the Tenant`, tone: 'concern' });
  if (rejected > 0) chips.push({ text: `${count(rejected, 'request', 'requests')} rejected`, tone: 'concern' });
  for (const repeat of repeats(requests)) chips.push({ text: `Same issue reported ${repeat.count} times (${repeat.label})`, tone: 'concern' });
  if (urgent > 0) chips.push({ text: count(urgent, 'urgent repair', 'urgent repairs'), tone: 'concern' });
  return { sentence: tenantSentence(requests.length, { minorShare, caused, rejected, ai }), chips, ai };
}

function tenantSentence(total: number, signals: { minorShare: number | null; caused: number; rejected: number; ai: boolean }): string {
  const genuine = signals.rejected === 0 && signals.caused === 0 && (signals.minorShare === null || signals.minorShare < MOSTLY_MINOR_SHARE);
  if (signals.ai && signals.caused >= TENANT_CAUSED_SENTENCE_AT) return 'Several repairs may have been caused by the Tenant';
  if (total >= FREQUENT_REQUESTS && signals.ai && signals.minorShare !== null && signals.minorShare >= MOSTLY_MINOR_SHARE) return 'Reports often, mostly small things';
  if (total <= FEW_REQUESTS && genuine) return "Reports rarely, and it's usually real";
  if (total <= FEW_REQUESTS && signals.rejected === 0) return 'Reliable reporter, few requests';
  if (total <= FEW_REQUESTS) return 'Few requests, and some were rejected';
  if (total >= FREQUENT_REQUESTS) return 'Reports often';
  return 'A steady run of requests';
}

/** Same Trade and the same summary (or the same description, when there is no summary) at one Property. */
function repeats(requests: TenantRequest[]): { label: string; count: number }[] {
  const groups = new Map<string, { label: string; count: number }>();
  for (const request of requests) {
    const raw = (request.summary ?? request.description).replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    const key = `${request.propertyId}|${request.trade}|${raw.toLowerCase()}`;
    const found = groups.get(key);
    if (found) found.count += 1;
    else groups.set(key, { label: raw.length > 48 ? `${raw.slice(0, 45)}…` : raw, count: 1 });
  }
  return [...groups.values()].filter((group) => group.count >= REPEAT_AT);
}

/** A Property Owner's read from their approvals. None decided and none waiting is no history. */
export function ownerRead(approvals: OwnerApproval[]): ProfileRead | null {
  const waiting = approvals.filter((approval) => approval.status === 'requested' || approval.status === 'reminded');
  const declined = approvals.filter((approval) => approval.status === 'declined');
  const hours = approvals.flatMap((approval) => {
    if ((approval.status !== 'approved' && approval.status !== 'declined') || !approval.answeredAt) return [];
    const span = (Date.parse(approval.answeredAt) - Date.parse(approval.requestedAt)) / 3_600_000;
    return Number.isFinite(span) && span >= 0 ? [span] : [];
  });
  if (!waiting.length && !declined.length && !hours.length) return null;
  const typical = median(hours);
  const chips: ProfileChip[] = [{ text: waiting.length ? `${count(waiting.length, 'approval', 'approvals')} waiting` : 'No approvals waiting', tone: waiting.length ? 'concern' : 'good' }];
  if (typical !== null) chips.push({ text: `Typical reply in ${spanPhrase(typical)}`, tone: toneForDays(typical / 24) });
  chips.push({ text: declined.length ? `${count(declined.length, 'Quote', 'Quotes')} declined` : 'No Quotes declined', tone: declined.length ? 'concern' : 'good' });
  let sentence = 'Approves when asked';
  if (declined.length >= 2) sentence = 'Often declines a Quote';
  else if (typical !== null && typical <= QUICK_REPLY_HOURS && declined.length === 0) sentence = 'Quick to approve';
  else if (waiting.length >= 3) sentence = 'Several approvals are waiting';
  return { sentence, chips, ai: false };
}

/** A Building Manager's read. Response time isn't recorded, so only issues passed on are counted. */
export function buildingManagerRead(signals: { commonAreaIssues: number }): ProfileRead | null {
  const issues = signals.commonAreaIssues;
  if (!issues) return null;
  return {
    sentence: issues >= FREQUENT_REQUESTS ? 'Often told about Common Area issues' : 'Looks after the Common Areas',
    chips: [{ text: `${count(issues, 'Common Area issue', 'Common Area issues')} passed on`, tone: 'neutral' }],
    ai: false,
  };
}

/** A Tradie's read. Missed visits aren't recorded; a reschedule is the visit that didn't stay booked. */
export function tradieRead(signals: TradieSignals): ProfileRead | null {
  if (!signals.jobsDone && !signals.openJobs && !signals.quotesSent && !signals.visits) return null;
  const win = signals.quotesSent ? signals.quotesChosen / signals.quotesSent : null;
  const typical = median(signals.turnaroundDays);
  const chips: ProfileChip[] = [];
  if (signals.jobsDone) chips.push({ text: `${count(signals.jobsDone, 'Job', 'Jobs')} done`, tone: 'good' });
  if (signals.openJobs) chips.push({ text: `${count(signals.openJobs, 'open Job', 'open Jobs')}`, tone: 'neutral' });
  if (signals.quotesSent && win !== null) {
    chips.push({
      text: `Chosen for ${signals.quotesChosen} of ${signals.quotesSent} ${signals.quotesSent === 1 ? 'Quote' : 'Quotes'}`,
      tone: win >= WIN_RATE_HIGH ? 'good' : win < WIN_RATE_LOW ? 'concern' : 'neutral',
    });
  }
  if (typical !== null) chips.push({ text: `Typical quote in ${spanPhrase(typical * 24)}`, tone: toneForDays(typical) });
  if (signals.rescheduledVisits) chips.push({ text: `${count(signals.rescheduledVisits, 'visit', 'visits')} rescheduled`, tone: 'concern' });
  else if (signals.visits) chips.push({ text: 'No visits rescheduled', tone: 'good' });
  let sentence = 'A regular Tradie for the Agency';
  if (win !== null && win >= WIN_RATE_HIGH && signals.visits > 0 && signals.rescheduledVisits === 0) sentence = 'Wins most quotes, rarely misses a visit';
  else if (win !== null && win >= WIN_RATE_HIGH) sentence = 'Wins most quotes';
  else if (signals.jobsDone >= 3 && signals.openJobs === 0) sentence = 'Finishes the Jobs they take';
  else if (win !== null && signals.quotesSent >= 3 && win < WIN_RATE_LOW) sentence = 'Quotes often, and is chosen less often';
  return { sentence, chips, ai: false };
}
