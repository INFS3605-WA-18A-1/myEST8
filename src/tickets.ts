import type { Context } from './context.ts';
import { all, one, run, transaction, type Param } from './db.ts';
import type { ChannelType, ImageMatchResult } from './ports.ts';
import { invalid, iso, newToken, normalizeAddress, notFound, TRADES, URGENCIES, type Availability, type Trade, type Urgency } from './shared.ts';

export type IssueStatus = 'gathering' | 'awaiting_photos' | 'checking' | 'maintenance_request' | 'confirmed' | 'rejected' | 'urgent';
const IN_INTAKE: IssueStatus[] = ['gathering', 'awaiting_photos', 'checking', 'maintenance_request'];
/** An issue's photo link takes photos only while the issue is in these statuses (the same rule as intake.upload). */
const TAKES_PHOTOS: IssueStatus[] = ['awaiting_photos', 'checking', 'maintenance_request'];

export type JobStatus = 'quoting' | 'awaiting_owner' | 'approved' | 'scheduled' | 'done' | 'cancelled';
/** Who wrote a Maintenance Request's Summary: the model, or a Property Manager who edited it (never overwritten by the model again). */
export type SummaryBy = 'ai' | 'property_manager';
/**
 * Where an Urgent Repair's Reimbursement Request stands: waiting for the Tenant's
 * receipt, waiting for the Property Manager to check it, with the Property Owner,
 * then reimbursed.
 */
export type UrgentRepairStatus = 'reminder_sent' | 'receipt_received' | 'receipt_forwarded' | 'reimbursed';
/** How a receipt arrived: through the upload link, or attached to a message on a channel. */
export type ReceiptVia = 'upload' | ChannelType;
/** A claim over this is surely a typo (the limit is $1,000): refused rather than stored. */
const MAX_CLAIM_CENTS = 100_000_00;
/** What a Property Manager may type to have a follow-up drafted, and the most a follow-up may say once sent. */
const MAX_FOLLOW_UP_NOTES = 1000;
const MAX_FOLLOW_UP_TEXT = 4000;
export type PhotoMetadata = 'ok' | 'flagged' | 'no_metadata';

export interface Issue {
  id: number;
  agencyId: number;
  propertyId: number;
  tenantId: number;
  status: IssueStatus;
  description: string;
  /** One line describing the issue, written by AI or edited by a Property Manager; null until the summariser has run. */
  summary: string | null;
  summaryBy: SummaryBy | null;
  answers: { location: string | null; started: string | null; worsening: string | null; availability: Availability | null };
  urgency: Urgency;
  checkUrgency: boolean;
  trade: Trade;
  checkTrade: boolean;
  noPhotos: boolean;
  /** How many photos came with the Tenant's first message, before any upload link. */
  photosOnArrival: number;
  imageMatch: { result: ImageMatchResult; reason: string } | null;
  photosToken: string;
  reportedAt: string;
  rejectedReason: string | null;
}

export interface Ticket {
  id: number;
  agencyId: number;
  issueId: number;
  propertyId: number;
  tenantId: number;
  status: 'open' | 'closed';
  urgency: Urgency;
  checkUrgency: boolean;
  reportedAt: string;
  trackerToken: string;
  closedAt: string | null;
}

export interface Job {
  id: number;
  agencyId: number;
  ticketId: number;
  trade: Trade;
  checkTrade: boolean;
  status: JobStatus;
}

export interface UrgentRepair {
  id: number;
  agencyId: number;
  issueId: number;
  propertyId: number;
  tenantId: number;
  status: UrgentRepairStatus;
  receiptToken: string;
  receiptFileIds: number[];
  /** What the Tenant claims, as they or the Property Manager entered it; null until someone does. */
  amountCents: number | null;
  createdAt: string;
  forwardedAt: string | null;
  reimbursedAt: string | null;
}

export interface LoggedMessage {
  agencyId: number;
  direction: 'in' | 'out';
  personId: number | null;
  channelType: ChannelType;
  address: string;
  template: string | null;
  text: string;
  issueId: number | null;
  fileIds: number[];
  unread?: boolean;
}

/** An item a classifier can relate a message to: "issue:3", "ticket:2", "job:5", "urgent_repair:1". */
export interface OpenItem {
  ref: string;
  summary: string;
}

type IssueRow = {
  id: number;
  agency_id: number;
  property_id: number;
  tenant_id: number;
  status: IssueStatus;
  description: string;
  summary: string | null;
  summary_by: SummaryBy | null;
  photos_on_arrival: number;
  location: string | null;
  started: string | null;
  worsening: string | null;
  availability: Availability | null;
  urgency: Urgency;
  check_urgency: number;
  trade: Trade;
  check_trade: number;
  no_photos: number;
  image_match: ImageMatchResult | null;
  image_match_reason: string | null;
  photos_token: string;
  reported_at: string;
  rejected_reason: string | null;
};

type TicketRow = {
  id: number;
  agency_id: number;
  issue_id: number;
  property_id: number;
  tenant_id: number;
  status: 'open' | 'closed';
  urgency: Urgency;
  check_urgency: number;
  reported_at: string;
  tracker_token: string;
  closed_at: string | null;
};

type JobRow = { id: number; agency_id: number; ticket_id: number; trade: Trade; check_trade: number; status: JobStatus };

type UrgentRepairRow = {
  id: number;
  agency_id: number;
  issue_id: number;
  property_id: number;
  tenant_id: number;
  status: UrgentRepairStatus;
  receipt_token: string;
  amount_cents: number | null;
  created_at: string;
  forwarded_at: string | null;
  reimbursed_at: string | null;
};

const ISSUE_COLUMNS = {
  status: 'status',
  location: 'location',
  started: 'started',
  worsening: 'worsening',
  availability: 'availability',
  urgency: 'urgency',
  checkUrgency: 'check_urgency',
  trade: 'trade',
  checkTrade: 'check_trade',
  noPhotos: 'no_photos',
  photosOnArrival: 'photos_on_arrival',
  summary: 'summary',
  summaryBy: 'summary_by',
  imageMatch: 'image_match',
  imageMatchReason: 'image_match_reason',
} as const;

export type IssuePatch = Partial<{
  status: IssueStatus;
  location: string;
  started: string;
  worsening: string;
  availability: Availability;
  urgency: Urgency;
  checkUrgency: boolean;
  trade: Trade;
  checkTrade: boolean;
  noPhotos: boolean;
  photosOnArrival: number;
  summary: string;
  summaryBy: SummaryBy;
  imageMatch: ImageMatchResult;
  imageMatchReason: string;
}>;

const toIssue = (r: IssueRow): Issue => ({
  id: r.id,
  agencyId: r.agency_id,
  propertyId: r.property_id,
  tenantId: r.tenant_id,
  status: r.status,
  description: r.description,
  summary: r.summary,
  summaryBy: r.summary_by,
  answers: { location: r.location, started: r.started, worsening: r.worsening, availability: r.availability },
  urgency: r.urgency,
  checkUrgency: !!r.check_urgency,
  trade: r.trade,
  checkTrade: !!r.check_trade,
  noPhotos: !!r.no_photos,
  photosOnArrival: r.photos_on_arrival ?? 0,
  imageMatch: r.image_match ? { result: r.image_match, reason: r.image_match_reason ?? '' } : null,
  photosToken: r.photos_token,
  reportedAt: r.reported_at,
  rejectedReason: r.rejected_reason,
});

const toTicket = (r: TicketRow): Ticket => ({
  id: r.id,
  agencyId: r.agency_id,
  issueId: r.issue_id,
  propertyId: r.property_id,
  tenantId: r.tenant_id,
  status: r.status,
  urgency: r.urgency,
  checkUrgency: !!r.check_urgency,
  reportedAt: r.reported_at,
  trackerToken: r.tracker_token,
  closedAt: r.closed_at,
});

const toJob = (r: JobRow): Job => ({
  id: r.id,
  agencyId: r.agency_id,
  ticketId: r.ticket_id,
  trade: r.trade,
  checkTrade: !!r.check_trade,
  status: r.status,
});

function requireTrade(trade: Trade) {
  if (!TRADES.includes(trade)) invalid(`Choose a Trade from: ${TRADES.join(', ')}`);
}

/** A claim must be a positive amount of cents, and not absurd. Over the $1,000 limit is allowed: the page warns. */
export function requireClaim(amountCents: number) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) invalid('Enter the amount on the receipt, more than $0');
  if (amountCents > MAX_CLAIM_CENTS) invalid('Check the amount: that is far over the $1,000 an Urgent Repair can claim');
}

/** Restricts a dashboard query to some Properties, or to none when `propertyIds` is null. */
function propertyFilter(propertyIds: number[] | null): [string, Param[]] {
  return propertyIds === null ? ['', []] : [' AND property_id IN (SELECT value::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS ids (value))', [JSON.stringify(propertyIds)]];
}

/** Issues in intake, Maintenance Requests, Tickets, Jobs, Urgent Repairs, the message log and the Ticket timeline. */
export function createTickets({ db, clock, settings, ports, modules }: Context) {

  async function issue(id: number): Promise<Issue> {
    const row = await one<IssueRow>(db, 'SELECT * FROM issues WHERE id = ?', id);
    if (!row) throw new Error(`Issue ${id} not found`);
    return toIssue(row);
  }

  async function issueInAgency(agencyId: number, id: number) {
    const row = await one<IssueRow>(db, 'SELECT * FROM issues WHERE id = ? AND agency_id = ?', id, agencyId);
    if (!row) notFound('Maintenance Request');
    return toIssue(row);
  }

  async function ticket(id: number): Promise<Ticket> {
    const row = await one<TicketRow>(db, 'SELECT * FROM tickets WHERE id = ?', id);
    if (!row) throw new Error(`Ticket ${id} not found`);
    return toTicket(row);
  }

  /** An issue of the Agency still in intake: the only kind a follow-up to the Tenant can be about. */
  async function followUpIssue(agencyId: number, issueId: number) {
    const found = await issueInAgency(agencyId, issueId);
    if (!IN_INTAKE.includes(found.status)) invalid('Only a Maintenance Request still in intake can be followed up');
    return found;
  }

  async function ticketInAgency(agencyId: number, id: number) {
    const row = await one<TicketRow>(db, 'SELECT * FROM tickets WHERE id = ? AND agency_id = ?', id, agencyId);
    if (!row) notFound('Ticket');
    return toTicket(row);
  }

  async function job(id: number): Promise<Job> {
    const row = await one<JobRow>(db, 'SELECT * FROM jobs WHERE id = ?', id);
    if (!row) throw new Error(`Job ${id} not found`);
    return toJob(row);
  }

  async function jobInAgency(agencyId: number, id: number) {
    const row = await one<JobRow>(db, 'SELECT * FROM jobs WHERE id = ? AND agency_id = ?', id, agencyId);
    if (!row) notFound('Job');
    return toJob(row);
  }

  async function jobsOf(ticketId: number) {
    return (await all<JobRow>(db, 'SELECT * FROM jobs WHERE ticket_id = ? ORDER BY id', ticketId)).map(toJob);
  }

  async function urgentRepair(id: number): Promise<UrgentRepair> {
    const row = await one<UrgentRepairRow>(db, 'SELECT * FROM urgent_repairs WHERE id = ?', id);
    if (!row) throw new Error(`Urgent Repair ${id} not found`);
    return toUrgentRepair(row);
  }

  async function toUrgentRepair(r: UrgentRepairRow): Promise<UrgentRepair> {
    return {
      id: r.id,
      agencyId: r.agency_id,
      issueId: r.issue_id,
      propertyId: r.property_id,
      tenantId: r.tenant_id,
      status: r.status,
      receiptToken: r.receipt_token,
      receiptFileIds: (await all<{ file_id: number }>(
        db,
        'SELECT file_id FROM urgent_repair_receipts WHERE urgent_repair_id = ? ORDER BY file_id',
        r.id,
      )).map((f) => f.file_id),
      amountCents: r.amount_cents,
      createdAt: r.created_at,
      forwardedAt: r.forwarded_at,
      reimbursedAt: r.reimbursed_at,
    };
  }

  async function urgentRepairInAgency(agencyId: number, id: number) {
    const row = await one<UrgentRepairRow>(db, 'SELECT * FROM urgent_repairs WHERE id = ? AND agency_id = ?', id, agencyId);
    if (!row) notFound('Reimbursement Request');
    return toUrgentRepair(row);
  }

  async function recordUrgentRepairEvent(urgentRepairId: number, kind: string, data: object = {}) {
    await run(db, 'INSERT INTO urgent_repair_events (urgent_repair_id, kind, data, at) VALUES (?, ?, ?, ?)', urgentRepairId, kind, JSON.stringify(data), iso(clock.now()));
  }

  async function recordEvent(ticketId: number, kind: string, data: object = {}, at: Date | string = clock.now()) {
    await run(db, 'INSERT INTO timeline (ticket_id, kind, data, at) VALUES (?, ?, ?, ?)', ticketId, kind, JSON.stringify(data), typeof at === 'string' ? at : iso(at));
  }

  async function timeline(ticketId: number) {
    return (await all<{ kind: string; data: string; at: string }>(
      db,
      'SELECT kind, data, at FROM timeline WHERE ticket_id = ? ORDER BY at, id',
      ticketId,
    )).map((e) => ({ kind: e.kind, at: e.at, ...(JSON.parse(e.data) as object) }));
  }

  async function ticketForIssue(issueId: number): Promise<Ticket | null> {
    const row = await one<TicketRow>(db, 'SELECT * FROM tickets WHERE issue_id = ?', issueId);
    return row ? toTicket(row) : null;
  }

  /** The booked visit's page, where the Tenant can ask for another time. */
  async function anotherTimeLink(jobId: number) {
    const row = await one<{ token: string }>(db, `SELECT token FROM visit_offers WHERE job_id = ? AND status = 'picked' ORDER BY round DESC LIMIT 1`, jobId);
    return row ? `${settings.baseUrl}/v/${row.token}` : undefined;
  }

  return {
    async createIssue(input: {
      agencyId: number;
      propertyId: number;
      tenantId: number;
      description: string;
      urgency: Urgency;
      checkUrgency: boolean;
      trade: Trade;
      checkTrade: boolean;
    }) {
      return run(
        db,
        `INSERT INTO issues (agency_id, property_id, tenant_id, status, description, urgency, check_urgency, trade, check_trade, photos_token, reported_at)
         VALUES (?, ?, ?, 'gathering', ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        input.agencyId,
        input.propertyId,
        input.tenantId,
        input.description,
        input.urgency,
        Number(input.checkUrgency),
        input.trade,
        Number(input.checkTrade),
        newToken(),
        iso(clock.now()),
      );
    },

    issue,

    /** Many issues in one query, with how many unread messages each has, by issue id. */
    async issuesWithUnread(issueIds: number[]) {
      if (!issueIds.length) return new Map<number, Issue & { unreadMessages: number }>();
      const rows = await all<IssueRow & { unread_messages: number }>(
        db,
        `SELECT issues.*, (SELECT count(*) FROM messages WHERE messages.issue_id = issues.id AND messages.unread = 1) AS unread_messages
         FROM issues WHERE id IN (SELECT value::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS ids (value))`,
        JSON.stringify(issueIds),
      );
      return new Map(rows.map((r) => [r.id, { ...toIssue(r), unreadMessages: r.unread_messages }]));
    },

    async updateIssue(id: number, patch: IssuePatch) {
      const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
      if (!entries.length) return;
      const columns = entries.map(([key]) => `${ISSUE_COLUMNS[key as keyof IssuePatch]} = ?`);
      const values = entries.map(([, value]) => (typeof value === 'boolean' ? Number(value) : (value as Param)));
      await run(db, `UPDATE issues SET ${columns.join(', ')} WHERE id = ?`, ...values, id);
    },

    async issueByPhotosToken(token: string): Promise<Issue | null> {
      const row = await one<IssueRow>(db, 'SELECT * FROM issues WHERE photos_token = ?', token);
      return row ? toIssue(row) : null;
    },

    /**
     * What a no-login upload link is, for the page that opens it: issue photos or an
     * Urgent Repair receipt, whether it still takes files, and who and where it is
     * from. Null for a token that is neither. Reads only; intake.upload still decides.
     */
    async uploadLink(token: string) {
      const photos = await this.issueByPhotosToken(token);
      const receipt = photos ? null : await this.urgentRepairByToken(token);
      if (!photos && !receipt) return null;
      const about = photos ?? (await issue(receipt!.issueId));
      return {
        kind: photos ? ('photos' as const) : ('receipt' as const),
        // A receipt link stays open until the Tenant is reimbursed: they may send a second page or a better photo.
        open: photos ? TAKES_PHOTOS.includes(photos.status) : receipt!.status !== 'reimbursed',
        description: about.description,
        agencyName: (await modules.profiles.agency(about.agencyId)).name,
        address: (await modules.profiles.property(about.propertyId)).address,
      };
    },

    async addPhoto(issueId: number, fileId: number, metadata: PhotoMetadata, reasons: string[]) {
      await run(
        db,
        'INSERT INTO photos (issue_id, file_id, metadata, reasons, uploaded_at) VALUES (?, ?, ?, ?, ?)',
        issueId,
        fileId,
        metadata,
        JSON.stringify(reasons),
        iso(clock.now()),
      );
    },

    /** The photos of several issues in one query, by issue: the id and file of each, in the order they came. */
    async photosOfIssues(issueIds: number[]) {
      const byIssue = new Map<number, { photoId: number; fileId: number }[]>();
      if (!issueIds.length) return byIssue;
      for (const p of await all<{ id: number; issue_id: number; file_id: number }>(
        db,
        'SELECT id, issue_id, file_id FROM photos WHERE issue_id IN (SELECT value::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS ids (value)) ORDER BY id',
        JSON.stringify(issueIds),
      )) {
        byIssue.set(p.issue_id, [...(byIssue.get(p.issue_id) ?? []), { photoId: p.id, fileId: p.file_id }]);
      }
      return byIssue;
    },

    async photos(issueId: number) {
      return (await all<{ id: number; file_id: number; metadata: PhotoMetadata; reasons: string }>(
        db,
        'SELECT id, file_id, metadata, reasons FROM photos WHERE issue_id = ? ORDER BY id',
        issueId,
      )).map((p) => ({ photoId: p.id, fileId: p.file_id, metadata: p.metadata, reasons: JSON.parse(p.reasons) as string[] }));
    },

    /** Confirms a Maintenance Request. A non-blank `edits.summary` replaces the Summary, as the Property Manager's own words. */
    async confirmMaintenanceRequest(agencyId: number, issueId: number, edits: { summary?: string } = {}) {
      const editedSummary = edits.summary?.trim() ?? '';
      // Checked inside the transaction, so confirming twice at once makes one Ticket.
      const { confirmed, ticketId, trackerToken } = await transaction(db, async () => {
        const confirmed = await issueInAgency(agencyId, issueId);
        if (confirmed.status !== 'maintenance_request') invalid('Only a Maintenance Request waiting for confirmation can be confirmed');
        const trackerToken = newToken();
        const ticketId = await run(
          db,
          `INSERT INTO tickets (agency_id, issue_id, property_id, tenant_id, status, urgency, check_urgency, reported_at, tracker_token)
           VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?) RETURNING id`,
          agencyId,
          issueId,
          confirmed.propertyId,
          confirmed.tenantId,
          confirmed.urgency,
          Number(confirmed.checkUrgency),
          confirmed.reportedAt,
          trackerToken,
        );
        await run(
          db,
          `INSERT INTO jobs (agency_id, ticket_id, trade, check_trade, status) VALUES (?, ?, ?, ?, 'quoting')`,
          agencyId,
          ticketId,
          confirmed.trade,
          Number(confirmed.checkTrade),
        );
        await run(db, `UPDATE issues SET status = 'confirmed' WHERE id = ?`, issueId);
        await recordEvent(ticketId, 'reported', {}, confirmed.reportedAt);
        await recordEvent(ticketId, 'confirmed');
        if (editedSummary && editedSummary !== confirmed.summary) {
          await run(db, `UPDATE issues SET summary = ?, summary_by = 'property_manager' WHERE id = ?`, editedSummary, issueId);
          await recordEvent(ticketId, 'summary_edited', { summary: editedSummary });
        }
        return { confirmed, ticketId, trackerToken };
      });
      await modules.notifications.send(
        confirmed.tenantId,
        'tenant.confirmed',
        { trackerLink: `${settings.baseUrl}/t/${trackerToken}` },
        { issueId },
      );
      return ticketId;
    },

    /** Edits the Summary of a Maintenance Request or of a Ticket's issue. Blank is refused. Once edited, the model never overwrites it. */
    async editSummary(agencyId: number, target: { issueId: number } | { ticketId: number }, summary: string) {
      const trimmed = summary.trim();
      if (!trimmed) invalid('Write a Summary');
      if (trimmed.length > 160) invalid('Keep the Summary to 160 characters');
      const ticketId = 'ticketId' in target ? (await ticketInAgency(agencyId, target.ticketId)).id : null;
      const issueId = ticketId === null ? (await issueInAgency(agencyId, (target as { issueId: number }).issueId)).id : (await ticket(ticketId)).issueId;
      const current = await issue(issueId);
      if (current.summary === trimmed && current.summaryBy === 'property_manager') return;
      await this.updateIssue(issueId, { summary: trimmed, summaryBy: 'property_manager' });
      const linked = ticketId ?? (await one<{ id: number }>(db, 'SELECT id FROM tickets WHERE issue_id = ?', issueId))?.id;
      if (linked !== undefined) await recordEvent(linked, 'summary_edited', { summary: trimmed });
    },

    async rejectMaintenanceRequest(agencyId: number, issueId: number, reason: string) {
      const trimmed = reason.trim();
      const rejected = await transaction(db, async () => {
        const rejected = await issueInAgency(agencyId, issueId);
        if (rejected.status !== 'maintenance_request') invalid('Only a Maintenance Request waiting for confirmation can be rejected');
        if (!trimmed) invalid('Give the Tenant a reason');
        await run(db, `UPDATE issues SET status = 'rejected', rejected_reason = ? WHERE id = ?`, trimmed, issueId);
        return rejected;
      });
      await modules.notifications.send(rejected.tenantId, 'tenant.rejected', { reason: trimmed }, { issueId });
    },

    /**
     * Writes the Property Manager's notes up as a message to the Tenant, for them to check and edit. The model
     * only rewords the notes (ADR 0011); with no model, or when it fails, the notes come back as written, not
     * marked as AI. Sends nothing.
     */
    async draftFollowUp(agencyId: number, propertyManagerId: number, issueId: number, notes: string) {
      const trimmed = notes.trim();
      const found = await followUpIssue(agencyId, issueId);
      if (!trimmed) invalid('Write what you want to say', 'notes');
      if (trimmed.length > MAX_FOLLOW_UP_NOTES) invalid(`Keep your notes to ${MAX_FOLLOW_UP_NOTES} characters`, 'notes');
      const { composer } = ports;
      if (!composer) return { text: trimmed, byAI: false };
      const { profiles } = modules;
      const [tenant, property, agency, propertyManager, channel] = await Promise.all([
        profiles.person(found.tenantId),
        profiles.property(found.propertyId),
        profiles.agency(agencyId),
        profiles.propertyManager(propertyManagerId),
        modules.notifications.channelFor(found.tenantId),
      ]);
      try {
        const { text } = await composer.compose({
          template: 'tenant.follow_up',
          purpose: 'A Property Manager following up with the Tenant about their Maintenance Request',
          recipientRole: 'tenant',
          channel,
          agencyName: agency.name,
          facts: {
            tenantName: tenant.name,
            propertyAddress: property.address,
            request: found.summary ?? found.description,
            propertyManagerName: propertyManager.name,
            notes: trimmed,
          },
          untrustedFields: ['request'],
          draft: trimmed,
          mustInclude: [],
        });
        return { text, byAI: true };
      } catch {
        return { text: trimmed, byAI: false };
      }
    },

    /** Sends the Tenant the follow-up as the Property Manager left it, on the channel intake would reply on. Returns the Tenant's name. */
    async sendFollowUp(agencyId: number, issueId: number, text: string) {
      const trimmed = text.trim();
      const found = await followUpIssue(agencyId, issueId);
      if (!trimmed) invalid('Write a message to send', 'text');
      if (trimmed.length > MAX_FOLLOW_UP_TEXT) invalid(`Keep the message to ${MAX_FOLLOW_UP_TEXT} characters`, 'text');
      await modules.notifications.send(found.tenantId, 'tenant.follow_up', { text: trimmed }, { issueId });
      return (await modules.profiles.person(found.tenantId)).name;
    },

    async changeUrgency(agencyId: number, target: { issueId: number } | { ticketId: number }, urgency: Urgency) {
      if (!URGENCIES.includes(urgency)) invalid(`Unknown Urgency ${urgency}`);
      if ('issueId' in target) {
        const changed = await issueInAgency(agencyId, target.issueId);
        if (!IN_INTAKE.includes(changed.status)) invalid('This issue is no longer in intake');
        if (urgency === 'urgent') return modules.intake.startUrgentRepair(changed.id);
        await this.updateIssue(changed.id, { urgency, checkUrgency: false });
        return;
      }
      await transaction(db, async () => {
        const changed = await ticketInAgency(agencyId, target.ticketId);
        if (urgency === 'urgent') invalid('Urgent issues are Urgent Repairs, which the Tenant arranges. A Ticket can be High or Routine.');
        await run(db, 'UPDATE tickets SET urgency = ?, check_urgency = 0 WHERE id = ?', urgency, changed.id);
        await recordEvent(changed.id, 'urgency_changed', { urgency });
      });
    },

    async createUrgentRepair(issueId: number) {
      const urgent = await issue(issueId);
      return await transaction(db, async () => {
        await run(db, `UPDATE issues SET status = 'urgent', urgency = 'urgent', check_urgency = 0 WHERE id = ?`, issueId);
        const receiptToken = newToken();
        const id = await run(
          db,
          `INSERT INTO urgent_repairs (agency_id, issue_id, property_id, tenant_id, status, receipt_token, created_at)
           VALUES (?, ?, ?, ?, 'reminder_sent', ?, ?) RETURNING id`,
          urgent.agencyId,
          issueId,
          urgent.propertyId,
          urgent.tenantId,
          receiptToken,
          iso(clock.now()),
        );
        await recordUrgentRepairEvent(id, 'reminder_sent');
        return { id, receiptToken };
      });
    },

    urgentRepair,

    async urgentRepairByToken(token: string): Promise<UrgentRepair | null> {
      const row = await one<UrgentRepairRow>(db, 'SELECT * FROM urgent_repairs WHERE receipt_token = ?', token);
      return row ? toUrgentRepair(row) : null;
    },

    urgentRepairInAgency,

    /**
     * Adds receipt files to a Reimbursement Request, which then waits for the Property
     * Manager to check it, even if it was forwarded before (the Tenant sent another
     * page). `amountCents`, when given, is what the Tenant claims. Refused once reimbursed.
     */
    async addReceipt(urgentRepairId: number, fileIds: number[], o: { amountCents?: number | null; via: ReceiptVia }) {
      if (o.amountCents != null) requireClaim(o.amountCents);
      await transaction(db, async () => {
        const current = await urgentRepair(urgentRepairId);
        if (current.status === 'reimbursed') invalid('This Reimbursement Request is already reimbursed, so this link has expired');
        for (const fileId of fileIds) {
          await run(db, 'INSERT INTO urgent_repair_receipts (urgent_repair_id, file_id) VALUES (?, ?)', urgentRepairId, fileId);
        }
        await run(
          db,
          `UPDATE urgent_repairs SET status = 'receipt_received', amount_cents = COALESCE(?, amount_cents) WHERE id = ?`,
          o.amountCents ?? null,
          urgentRepairId,
        );
        await recordUrgentRepairEvent(urgentRepairId, 'receipt_received', {
          files: fileIds.length,
          via: o.via,
          ...(o.amountCents != null ? { amountCents: o.amountCents } : {}),
        });
      });
    },

    /**
     * Marks a Reimbursement Request forwarded to the Property Owner with the amount
     * claimed: from Awaiting your review, or again once forwarded. `amountCents`
     * replaces the Tenant's amount; without it the Tenant's stands, and one is needed.
     * Returns the request as forwarded, for the caller to send.
     */
    async forwardUrgentRepair(agencyId: number, urgentRepairId: number, o: { amountCents?: number | null; ownerName: string }) {
      return transaction(db, async () => {
        const current = await urgentRepairInAgency(agencyId, urgentRepairId);
        if (current.status === 'reimbursed') invalid('This Reimbursement Request is already reimbursed');
        if (current.status === 'reminder_sent' || !current.receiptFileIds.length) invalid('The Tenant has not sent the receipt yet');
        const amountCents = o.amountCents ?? current.amountCents;
        if (amountCents == null) invalid('Enter the amount on the receipt');
        requireClaim(amountCents);
        const at = iso(clock.now());
        await run(db, `UPDATE urgent_repairs SET status = 'receipt_forwarded', amount_cents = ?, forwarded_at = ? WHERE id = ?`, amountCents, at, urgentRepairId);
        await recordUrgentRepairEvent(urgentRepairId, 'forwarded', { amountCents, ownerName: o.ownerName, ...(current.forwardedAt ? { again: true } : {}) });
        return { ...current, status: 'receipt_forwarded' as const, amountCents, forwardedAt: at };
      });
    },

    /** Marks a forwarded Reimbursement Request reimbursed: the Property Owner has paid the Tenant back. */
    async markUrgentRepairReimbursed(agencyId: number, urgentRepairId: number) {
      return transaction(db, async () => {
        const current = await urgentRepairInAgency(agencyId, urgentRepairId);
        if (current.status === 'reimbursed') invalid('This Reimbursement Request is already reimbursed');
        if (current.status !== 'receipt_forwarded') invalid('Forward the receipt to the Property Owner before marking it reimbursed');
        const at = iso(clock.now());
        await run(db, `UPDATE urgent_repairs SET status = 'reimbursed', reimbursed_at = ? WHERE id = ?`, at, urgentRepairId);
        await recordUrgentRepairEvent(urgentRepairId, 'reimbursed', current.amountCents != null ? { amountCents: current.amountCents } : {});
        return { ...current, status: 'reimbursed' as const, reimbursedAt: at };
      });
    },

    recordUrgentRepairEvent,

    /** A Reimbursement Request's events, oldest first. */
    async urgentRepairTimeline(urgentRepairId: number) {
      return (await all<{ kind: string; data: string; at: string }>(
        db,
        'SELECT kind, data, at FROM urgent_repair_events WHERE urgent_repair_id = ? ORDER BY at, id',
        urgentRepairId,
      )).map((e) => ({ kind: e.kind, at: e.at, ...(JSON.parse(e.data) as Record<string, unknown>) }));
    },

    /** The receipt files of a Reimbursement Request, without their bytes, in the order they came. */
    async urgentRepairReceipts(urgentRepairId: number) {
      return (await all<{ file_id: number; filename: string; content_type: string }>(
        db,
        `SELECT r.file_id, f.filename, f.content_type FROM urgent_repair_receipts r JOIN files f ON f.id = r.file_id
         WHERE r.urgent_repair_id = ? ORDER BY r.file_id`,
        urgentRepairId,
      )).map((f) => ({ fileId: f.file_id, filename: f.filename, contentType: f.content_type }));
    },

    /** Marks every message on an issue read: a Reimbursement Request's, which has no Ticket. */
    async markIssueRead(issueId: number) {
      await run(db, 'UPDATE messages SET unread = 0 WHERE issue_id = ?', issueId);
    },

    ticket,
    ticketInAgency,
    ticketForIssue,

    async ticketByTrackerToken(token: string): Promise<Ticket | null> {
      const row = await one<TicketRow>(db, 'SELECT * FROM tickets WHERE tracker_token = ?', token);
      return row ? toTicket(row) : null;
    },

    job,
    jobInAgency,
    jobsOf,

    /** The Jobs of many Tickets in one query, each Ticket's in the order they were added. */
    async jobsOfTickets(ticketIds: number[]) {
      if (!ticketIds.length) return [];
      return (await all<JobRow>(
        db,
        'SELECT * FROM jobs WHERE ticket_id IN (SELECT value::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS ids (value)) ORDER BY ticket_id, id',
        JSON.stringify(ticketIds),
      )).map(toJob);
    },

    async setJobStatus(jobId: number, status: JobStatus) {
      await run(db, 'UPDATE jobs SET status = ? WHERE id = ?', status, jobId);
    },

    async setJobTrade(agencyId: number, jobId: number, trade: Trade) {
      return transaction(db, async () => {
        requireTrade(trade);
        const changed = await jobInAgency(agencyId, jobId);
        if (changed.status !== 'quoting' || (await modules.quotes.hasQuoteRequests(jobId))) {
          invalid('The Trade can only change before Quote Requests are sent');
        }
        await run(db, 'UPDATE jobs SET trade = ?, check_trade = 0 WHERE id = ?', trade, jobId);
        await recordEvent(changed.ticketId, 'trade_changed', { jobId, trade });
      });
    },

    async addJob(agencyId: number, ticketId: number, trade: Trade) {
      return transaction(db, async () => {
        requireTrade(trade);
        const parent = await ticketInAgency(agencyId, ticketId);
        if (parent.status !== 'open') invalid('This Ticket is closed');
        const jobId = await run(db, `INSERT INTO jobs (agency_id, ticket_id, trade, status) VALUES (?, ?, ?, 'quoting') RETURNING id`, agencyId, ticketId, trade);
        await recordEvent(ticketId, 'job_added', { jobId, trade });
        return jobId;
      });
    },

    async cancelJob(agencyId: number, jobId: number) {
      const inspections = await transaction(db, async () => {
        const cancelled = await jobInAgency(agencyId, jobId);
        if (cancelled.status === 'done' || cancelled.status === 'cancelled') invalid(`This Job is already ${cancelled.status}`);
        await run(db, `UPDATE jobs SET status = 'cancelled' WHERE id = ?`, jobId);
        const inspections = await modules.quotes.jobCancelled(jobId);
        await modules.scheduling.jobCancelled(jobId);
        await recordEvent(cancelled.ticketId, 'job_cancelled', { jobId });
        return inspections;
      });
      await modules.quotes.inspectionsCancelled(inspections);
    },

    async closeTicket(agencyId: number, ticketId: number) {
      const closing = await transaction(db, async () => {
        const closing = await ticketInAgency(agencyId, ticketId);
        if (closing.status !== 'open') invalid('This Ticket is already closed');
        if ((await jobsOf(ticketId)).some((j) => j.status !== 'done' && j.status !== 'cancelled')) {
          invalid('Every Job must be done or cancelled before the Ticket closes');
        }
        await run(db, `UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?`, iso(clock.now()), ticketId);
        await recordEvent(ticketId, 'closed');
        return closing;
      });
      const property = await modules.profiles.property(closing.propertyId);
      const { description } = await issue(closing.issueId);
      await modules.notifications.send(closing.tenantId, 'tenant.ticket_closed', { propertyAddress: property.address }, { issueId: closing.issueId });
      await modules.notifications.send(
        property.ownerId,
        'owner.ticket_closed',
        { propertyAddress: property.address, description },
        { issueId: closing.issueId },
      );
    },

    recordEvent,
    timeline,

    async logMessage(entry: LoggedMessage) {
      return run(
        db,
        `INSERT INTO messages (agency_id, direction, person_id, channel_type, address, template, text, issue_id, files, unread, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        entry.agencyId,
        entry.direction,
        entry.personId,
        entry.channelType,
        entry.address,
        entry.template,
        entry.text,
        entry.issueId,
        JSON.stringify(entry.fileIds),
        Number(entry.unread ?? false),
        iso(clock.now()),
      );
    },

    /** Attaches a logged message to an issue, once the inbox routes it. */
    async attachMessage(messageId: number, issueId: number, unread: boolean) {
      await run(db, 'UPDATE messages SET issue_id = ?, unread = ? WHERE id = ?', issueId, Number(unread), messageId);
    },

    async messages(issueId: number) {
      return (await all<{ direction: 'in' | 'out'; person_id: number | null; channel_type: ChannelType; address: string; template: string | null; text: string; delivery_error: string | null; unread: number; at: string }>(
        db,
        'SELECT direction, person_id, channel_type, address, template, text, delivery_error, unread, at FROM messages WHERE issue_id = ? ORDER BY at, id',
        issueId,
      )).map((m) => ({
        direction: m.direction,
        personId: m.person_id,
        channel: m.channel_type,
        address: m.address,
        template: m.template,
        text: m.text,
        deliveryError: m.delivery_error,
        unread: !!m.unread,
        at: m.at,
      }));
    },

    /** Notes a provider's delivery failure on the latest outbound WhatsApp message to that number. */
    async recordDeliveryFailure(failure: { to: string; code: number; title: string }) {
      const row = await one<{ id: number }>(
        db,
        `SELECT id FROM messages WHERE direction = 'out' AND channel_type = 'whatsapp' AND address = ? ORDER BY at DESC, id DESC LIMIT 1`,
        normalizeAddress(failure.to),
      );
      if (!row) return;
      await run(db, 'UPDATE messages SET delivery_error = ? WHERE id = ?', `WhatsApp couldn't deliver this message (${failure.code}): ${failure.title}`, row.id);
    },

    async unreadCount(issueId: number) {
      return (await one<{ n: number }>(db, 'SELECT count(*) AS n FROM messages WHERE issue_id = ? AND unread = 1', issueId))!.n;
    },

    async markRead(agencyId: number, ticketId: number) {
      return transaction(db, async () => {
        const read = await ticketInAgency(agencyId, ticketId);
        await run(db, 'UPDATE messages SET unread = 0 WHERE issue_id = ?', read.issueId);
      });
    },

    /** Everything still open on a Property, for the classifier to relate a Tenant's message to. */
    async openItemsForProperty(propertyId: number): Promise<OpenItem[]> {
      const items: OpenItem[] = [];
      for (const i of await all<IssueRow>(
        db,
        `SELECT * FROM issues WHERE property_id = ? AND status IN (SELECT jsonb_array_elements_text(?::text::jsonb)) ORDER BY id DESC`,
        propertyId,
        JSON.stringify(IN_INTAKE),
      )) {
        items.push({ ref: `issue:${i.id}`, summary: `Reported issue (${i.status.replace('_', ' ')}): ${i.description}` });
      }
      for (const t of await all<TicketRow>(db, `SELECT * FROM tickets WHERE property_id = ? AND status = 'open' ORDER BY id DESC`, propertyId)) {
        items.push({ ref: `ticket:${t.id}`, summary: `Ticket: ${(await issue(t.issue_id)).description}` });
        for (const j of (await jobsOf(t.id)).filter((j) => j.status !== 'cancelled' && j.status !== 'done')) {
          items.push({ ref: `job:${j.id}`, summary: `${j.trade} Job (${j.status.replace('_', ' ')}) on Ticket ${t.id}` });
        }
      }
      for (const u of await all<UrgentRepairRow>(
        db,
        `SELECT * FROM urgent_repairs WHERE property_id = ? AND status = 'reminder_sent' ORDER BY id DESC`,
        propertyId,
      )) {
        items.push({ ref: `urgent_repair:${u.id}`, summary: `Urgent Repair waiting for a receipt: ${(await issue(u.issue_id)).description}` });
      }
      return items;
    },

    /** The issue an open item belongs to, with the Ticket, Job or Urgent Repair it names. */
    async resolveRef(ref: string): Promise<{ issueId: number; ticketId?: number; jobId?: number; urgentRepairId?: number } | null> {
      const [kind, rawId] = ref.split(':');
      const id = Number(rawId);
      if (!Number.isInteger(id)) return null;
      if (kind === 'issue') return await one(db, 'SELECT 1 FROM issues WHERE id = ?', id) ? { issueId: id } : null;
      if (kind === 'ticket') {
        const row = await one<TicketRow>(db, 'SELECT * FROM tickets WHERE id = ?', id);
        return row ? { issueId: row.issue_id, ticketId: row.id } : null;
      }
      if (kind === 'job') {
        const row = await one<JobRow>(db, 'SELECT * FROM jobs WHERE id = ?', id);
        return row ? { issueId: (await ticket(row.ticket_id)).issueId, ticketId: row.ticket_id, jobId: row.id } : null;
      }
      if (kind === 'urgent_repair') {
        const row = await one<UrgentRepairRow>(db, 'SELECT * FROM urgent_repairs WHERE id = ?', id);
        return row ? { issueId: row.issue_id, urgentRepairId: row.id } : null;
      }
      return null;
    },

    /** One entry per Ticket per Trade, for working out a Property's frequent issues. */
    async tradesForProperty(propertyId: number): Promise<Trade[]> {
      return (await all<{ trade: Trade }>(
        db,
        `SELECT jobs.ticket_id, jobs.trade FROM jobs JOIN tickets ON tickets.id = jobs.ticket_id
         WHERE tickets.property_id = ? AND jobs.status != 'cancelled'
         GROUP BY jobs.ticket_id, jobs.trade ORDER BY min(jobs.id)`,
        propertyId,
      )).map((r) => r.trade);
    },

    async maintenanceRequests(agencyId: number, propertyIds: number[] | null) {
      const [filter, params] = propertyFilter(propertyIds);
      return (await all<IssueRow>(
        db,
        `SELECT * FROM issues WHERE agency_id = ? AND status = 'maintenance_request'${filter} ORDER BY reported_at, id`,
        agencyId,
        ...params,
      )).map(toIssue);
    },

    /** Open Tickets, High before Routine, then oldest first. */
    async openTickets(agencyId: number, propertyIds: number[] | null) {
      const [filter, params] = propertyFilter(propertyIds);
      return (await all<TicketRow>(
        db,
        `SELECT * FROM tickets WHERE agency_id = ? AND status = 'open'${filter}
         ORDER BY CASE urgency WHEN 'high' THEN 0 ELSE 1 END, reported_at, id`,
        agencyId,
        ...params,
      )).map(toTicket);
    },

    /** Every Ticket, open or closed: Urgent before High before Routine, then the earliest reported first. */
    async list(agencyId: number, propertyIds: number[] | null) {
      const [filter, params] = propertyFilter(propertyIds);
      return (await all<TicketRow>(
        db,
        `SELECT * FROM tickets WHERE agency_id = ?${filter}
         ORDER BY CASE urgency WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, reported_at, id`,
        agencyId,
        ...params,
      )).map(toTicket);
    },

    async urgentRepairs(agencyId: number, propertyIds: number[] | null) {
      const [filter, params] = propertyFilter(propertyIds);
      return Promise.all(
        (await all<UrgentRepairRow>(
          db,
          `SELECT * FROM urgent_repairs WHERE agency_id = ?${filter} ORDER BY created_at DESC, id DESC`,
          agencyId,
          ...params,
        )).map(toUrgentRepair),
      );
    },

    /**
     * The Tenant's progress tracker. Built from statuses only: no prices, Quotes or
     * ratings. It names the Agency and the Property, and the booked stage names the
     * Tradie's business and Trade, because the Tenant needs to know who is coming.
     *
     * Each stage is `reached` once it has begun and `done` only once it has really
     * happened, never because a later stage began: Getting quotes is done once a Quote is
     * approved, a Site visit once every inspection still going ahead has taken place, and
     * Booked once the Job is done. The booked stage says whether the Tenant has confirmed
     * they'll be in (`visitConfirmed`) or asked for another time (`rescheduleRequested`).
     */
    async tracker(token: string) {
      const tracked = await this.ticketByTrackerToken(token);
      if (!tracked) notFound('Ticket');
      const events = await timeline(tracked.id);
      const first = (kind: string) => events.find((e) => e.kind === kind)?.at ?? null;
      const jobs = (await jobsOf(tracked.id)).filter((j) => j.status !== 'cancelled');
      const allDone = jobs.length > 0 && jobs.every((j) => j.status === 'done');
      const doneAt = allDone ? (events.filter((e) => e.kind === 'job_done').at(-1)?.at ?? null) : null;
      // The latest visit, preferring a Job that is still going ahead.
      type VisitEvent = { kind: string; jobId?: number; tradie?: string; visitStart?: string };
      const visits = events.filter((e) => (e.kind === 'work_order_sent' || e.kind === 'visit_moved') && !(e as { inspection?: boolean }).inspection && !(e as { siteQuote?: boolean }).siteQuote) as VisitEvent[];
      const visit = visits.findLast((e) => jobs.some((j) => j.id === e.jobId)) ?? visits.at(-1);
      const tradie = visits.findLast((e) => e.kind === 'work_order_sent' && e.jobId === visit?.jobId)?.tradie;
      const trade = jobs.find((j) => j.id === visit?.jobId)?.trade;
      const repair = visit?.jobId !== undefined ? await modules.scheduling.workOrderForJob(visit.jobId) : null;
      const booked = visit?.visitStart
        ? {
            visitStart: visit.visitStart,
            ...(tradie ? { tradie } : {}),
            ...(trade ? { trade } : {}),
            visitConfirmed: !!repair?.visitConfirmed,
            rescheduleRequested: repair?.status === 'active' && repair.rescheduleRequestedBy !== null,
            ...(repair?.status === 'active' && repair.rescheduleRequestedBy ? { rescheduleRequestedBy: repair.rescheduleRequestedBy } : {}),
            ...(repair?.status === 'active'
              ? {
                  anotherTimeLink: await anotherTimeLink(visit.jobId!),
                }
              : {}),
          }
        : {};
      const bookedDone = !!visit && jobs.some((j) => j.id === visit.jobId && j.status === 'done');
      // Site Inspections, only when a Tradie has one going ahead or done: who is coming and when,
      // and whether each has happened. Done once every one of them has.
      const inspections = (await Promise.all(jobs.map((j) => modules.scheduling.inspectionVisits(j.id)))).flat();
      const siteVisits = inspections.map((v) => ({ tradie: v.businessName, visitStart: v.start, done: v.status === 'done' }));
      const siteBooked = events.find((e) => e.kind === 'inspection_booked' || e.kind === 'site_quotes_booked');
      const siteDone = siteVisits.length > 0 && siteVisits.every((v) => v.done);
      const approvedAt = first('quote_approved');
      type Stage = {
        stage: string;
        at: string | null;
        done?: boolean;
        visitStart?: string;
        tradie?: string;
        trade?: Trade;
        visitConfirmed?: boolean;
        rescheduleRequested?: boolean;
        rescheduleRequestedBy?: string;
        anotherTimeLink?: string;
        visits?: { tradie: string; visitStart: string; done: boolean }[];
      };
      const stages: Stage[] = [
        { stage: 'reported', at: tracked.reportedAt },
        { stage: 'confirmed', at: first('confirmed') },
        { stage: 'getting_quotes', at: first('quote_requests_sent'), done: approvedAt !== null },
        ...(siteBooked && siteVisits.length ? [{ stage: 'site_visit', at: siteBooked.at, done: siteDone, visits: siteVisits }] : []),
        { stage: 'approved', at: approvedAt },
        { stage: 'booked', at: first('work_order_sent'), done: bookedDone, ...booked },
        { stage: 'done', at: doneAt },
        { stage: 'closed', at: tracked.closedAt },
      ];
      const agency = await modules.profiles.agency(tracked.agencyId);
      return {
        description: (await issue(tracked.issueId)).description,
        agencyName: agency.name,
        address: (await modules.profiles.property(tracked.propertyId)).address,
        // The Agency's zone, so the Tenant sees times as the Agency does.
        timeZone: agency.timeZone,
        // A stage that is simply an event (Reported, Repair approved...) is done once it is reached.
        stages: stages.map((s) => ({ ...s, reached: s.at !== null, done: s.at !== null && (s.done ?? true) })),
      };
    },
  };
}

export type Tickets = ReturnType<typeof createTickets>;
