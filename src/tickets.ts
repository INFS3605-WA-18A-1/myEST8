import type { Context } from './context.ts';
import { all, one, run, transaction, type Param } from './db.ts';
import type { ChannelType, ImageMatchResult } from './ports.ts';
import { invalid, iso, newToken, notFound, TRADES, URGENCIES, type Availability, type Trade, type Urgency } from './shared.ts';

export type IssueStatus = 'gathering' | 'awaiting_photos' | 'checking' | 'maintenance_request' | 'confirmed' | 'rejected' | 'urgent';
export const IN_INTAKE: IssueStatus[] = ['gathering', 'awaiting_photos', 'checking', 'maintenance_request'];

export type JobStatus = 'quoting' | 'awaiting_owner' | 'approved' | 'scheduled' | 'done' | 'cancelled';
export type UrgentRepairStatus = 'reminder_sent' | 'receipt_received' | 'receipt_forwarded';
export type PhotoMetadata = 'ok' | 'flagged' | 'no_metadata';

export interface Issue {
  id: number;
  agencyId: number;
  propertyId: number;
  tenantId: number;
  status: IssueStatus;
  description: string;
  answers: { location: string | null; started: string | null; worsening: string | null; availability: Availability | null };
  urgency: Urgency;
  checkUrgency: boolean;
  trade: Trade;
  checkTrade: boolean;
  noPhotos: boolean;
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
  createdAt: string;
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
  created_at: string;
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
  answers: { location: r.location, started: r.started, worsening: r.worsening, availability: r.availability },
  urgency: r.urgency,
  checkUrgency: !!r.check_urgency,
  trade: r.trade,
  checkTrade: !!r.check_trade,
  noPhotos: !!r.no_photos,
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

/** Restricts a dashboard query to some Properties, or to none when `propertyIds` is null. */
function propertyFilter(propertyIds: number[] | null): [string, Param[]] {
  return propertyIds === null ? ['', []] : [' AND property_id IN (SELECT value::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS ids (value))', [JSON.stringify(propertyIds)]];
}

/** Issues in intake, Maintenance Requests, Tickets, Jobs, Urgent Repairs, the message log and the Ticket timeline. */
export function createTickets({ db, clock, settings, modules }: Context) {

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
      createdAt: r.created_at,
    };
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

    async photos(issueId: number) {
      return (await all<{ id: number; file_id: number; metadata: PhotoMetadata; reasons: string }>(
        db,
        'SELECT id, file_id, metadata, reasons FROM photos WHERE issue_id = ? ORDER BY id',
        issueId,
      )).map((p) => ({ photoId: p.id, fileId: p.file_id, metadata: p.metadata, reasons: JSON.parse(p.reasons) as string[] }));
    },

    async confirmMaintenanceRequest(agencyId: number, issueId: number) {
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
        return { id, receiptToken };
      });
    },

    urgentRepair,

    async urgentRepairByToken(token: string): Promise<UrgentRepair | null> {
      const row = await one<UrgentRepairRow>(db, 'SELECT * FROM urgent_repairs WHERE receipt_token = ?', token);
      return row ? toUrgentRepair(row) : null;
    },

    async addReceipt(urgentRepairId: number, fileIds: number[]) {
      await transaction(db, async () => {
        for (const fileId of fileIds) {
          await run(db, 'INSERT INTO urgent_repair_receipts (urgent_repair_id, file_id) VALUES (?, ?)', urgentRepairId, fileId);
        }
        await run(db, `UPDATE urgent_repairs SET status = 'receipt_received' WHERE id = ?`, urgentRepairId);
      });
    },

    async setUrgentRepairStatus(urgentRepairId: number, status: UrgentRepairStatus) {
      await run(db, 'UPDATE urgent_repairs SET status = ? WHERE id = ?', status, urgentRepairId);
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
      return transaction(db, async () => {
        const cancelled = await jobInAgency(agencyId, jobId);
        if (cancelled.status === 'done' || cancelled.status === 'cancelled') invalid(`This Job is already ${cancelled.status}`);
        await run(db, `UPDATE jobs SET status = 'cancelled' WHERE id = ?`, jobId);
        await modules.quotes.jobCancelled(jobId);
        await modules.scheduling.jobCancelled(jobId);
        await recordEvent(cancelled.ticketId, 'job_cancelled', { jobId });
      });
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
      return (await all<{ direction: 'in' | 'out'; person_id: number | null; channel_type: ChannelType; address: string; template: string | null; text: string; unread: number; at: string }>(
        db,
        'SELECT direction, person_id, channel_type, address, template, text, unread, at FROM messages WHERE issue_id = ? ORDER BY at, id',
        issueId,
      )).map((m) => ({
        direction: m.direction,
        personId: m.person_id,
        channel: m.channel_type,
        address: m.address,
        template: m.template,
        text: m.text,
        unread: !!m.unread,
        at: m.at,
      }));
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

    /** The Tenant's progress tracker. Built from statuses only: no prices, Quotes or ratings. */
    async tracker(token: string) {
      const tracked = await this.ticketByTrackerToken(token);
      if (!tracked) notFound('Ticket');
      const events = await timeline(tracked.id);
      const first = (kind: string) => events.find((e) => e.kind === kind)?.at ?? null;
      const visits = events.filter((e) => e.kind === 'work_order_sent' || e.kind === 'visit_moved') as { visitStart?: string }[];
      const jobs = (await jobsOf(tracked.id)).filter((j) => j.status !== 'cancelled');
      const allDone = jobs.length > 0 && jobs.every((j) => j.status === 'done');
      const doneAt = allDone ? (events.filter((e) => e.kind === 'job_done').at(-1)?.at ?? null) : null;
      const stages: { stage: string; at: string | null; visitStart?: string }[] = [
        { stage: 'reported', at: tracked.reportedAt },
        { stage: 'confirmed', at: first('confirmed') },
        { stage: 'getting_quotes', at: first('quote_requests_sent') },
        { stage: 'approved', at: first('quote_approved') },
        { stage: 'booked', at: first('work_order_sent'), ...(visits.length ? { visitStart: visits.at(-1)!.visitStart } : {}) },
        { stage: 'done', at: doneAt },
        { stage: 'closed', at: tracked.closedAt },
      ];
      return {
        description: (await issue(tracked.issueId)).description,
        // The Agency's zone, so the Tenant sees times as the Agency does.
        timeZone: (await modules.profiles.agency(tracked.agencyId)).timeZone,
        stages: stages.map((s) => ({ ...s, reached: s.at !== null })),
      };
    },
  };
}

export type Tickets = ReturnType<typeof createTickets>;
