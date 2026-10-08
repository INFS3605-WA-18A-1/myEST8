import type { Context } from './context.ts';
import { all, one, run, transaction } from './db.ts';
import { checkPhotoMetadata } from './photo-checks.ts';
import type { ChannelType, ClassifierAnswer, ClassifierQuestion, InboundMessage } from './ports.ts';
import type { Person, Property } from './profiles.ts';
import { addMs, AVAILABILITY, HOUR_MS, invalid, iso, notFound, TRADES, URGENCIES, type Availability, type Trade, type Urgency } from './shared.ts';
import type { GuidedQuestion } from './templates.ts';

export const URGENT_REPAIR_LIMIT_CENTS = 1000_00;
const NO_PHOTOS_TIMEOUT_MS = 48 * HOUR_MS;
const MAX_UPLOAD_FILES = 10;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Photo formats phones produce. Not SVG, which can carry script into the Property Manager's pages. */
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/gif'];

/** What the agent is waiting for this person to answer. */
type Awaiting =
  | { kind: 'guided'; issueId: number; question: GuidedQuestion }
  | { kind: 'fix_rating'; jobId: number }
  | { kind: 'visit'; workOrderId: number };

const NEXT_QUESTION: Record<GuidedQuestion, GuidedQuestion | null> = {
  location: 'started',
  started: 'worsening',
  worsening: 'availability',
  availability: null,
};

type InboxReason = 'unknown_sender' | 'other' | 'low_confidence' | 'common_area_no_building_manager';
type Answers = Record<string, ClassifierAnswer>;

/** An inbound message once stored, with its attachments saved as files. */
interface Received {
  inboundId: number;
  agencyId: number;
  channelType: ChannelType;
  from: string;
  text: string;
  fileIds: number[];
  /** Set when the message was already logged, as when the inbox routes it. */
  messageId?: number;
}

type StoredAttachment = { filename: string; contentType: string; fileId?: number; url?: string };

const question = (id: string, options: readonly string[]): ClassifierQuestion => ({ id, options });
const URGENCY_QUESTION = question('urgency', URGENCIES);
const TRADE_QUESTION = question('trade', TRADES);

function answerOptions(awaiting: Awaiting): string[] {
  if (awaiting.kind === 'fix_rating') return ['1', '2', '3', '4', '5', 'not_an_answer'];
  if (awaiting.kind === 'visit') return ['confirm', 'reschedule', 'not_an_answer'];
  if (awaiting.question === 'worsening') return ['yes', 'no', 'not_an_answer'];
  if (awaiting.question === 'availability') return [...AVAILABILITY, 'not_an_answer'];
  return ['answer', 'not_an_answer'];
}

const firstName = (person: Person) => person.name.split(' ')[0]!;

/**
 * The intake agent: reads every inbound message, works out who sent it and what
 * it's about, and runs the conversation with a Tenant until the issue becomes a
 * Maintenance Request or an Urgent Repair. Replies from Tradies and Property
 * Owners go to the quotes and scheduling modules.
 */
export function createIntake({ db, clock, settings, worker, files, ports, modules }: Context) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbound_messages (
      id INTEGER PRIMARY KEY,
      provider_message_id TEXT NOT NULL UNIQUE,
      agency_id INTEGER NOT NULL,
      channel_type TEXT NOT NULL,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      attachments TEXT NOT NULL,
      received_at TEXT NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS pending_answers (
      person_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      awaiting TEXT NOT NULL,
      asked_at TEXT NOT NULL,
      PRIMARY KEY (person_id, kind)
    );
    CREATE TABLE IF NOT EXISTS inbox_items (
      id INTEGER PRIMARY KEY,
      agency_id INTEGER NOT NULL,
      inbound_id INTEGER NOT NULL REFERENCES inbound_messages(id),
      message_id INTEGER NOT NULL,
      person_id INTEGER,
      reason TEXT NOT NULL,
      best_guess TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      at TEXT NOT NULL
    );
  `);

  const sure = (answers: Answers, id: string) => (answers[id]?.confidence ?? 0) >= settings.confidenceThreshold;
  const pick = (answers: Answers, id: string) => answers[id]?.answer ?? '';

  // --- Conversation state ---

  /** Waits for this person's answer. A person can have one question of each kind open at once. */
  function expectAnswer(personId: number, awaiting: Awaiting) {
    run(
      db,
      `INSERT INTO pending_answers (person_id, kind, awaiting, asked_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (person_id, kind) DO UPDATE SET awaiting = excluded.awaiting, asked_at = excluded.asked_at`,
      personId,
      awaiting.kind,
      JSON.stringify(awaiting),
      iso(clock.now()),
    );
  }

  /** The questions waiting on this person, newest first. */
  function awaitingFrom(personId: number): Awaiting[] {
    return all<{ awaiting: string }>(
      db,
      'SELECT awaiting FROM pending_answers WHERE person_id = ? ORDER BY asked_at DESC, rowid DESC',
      personId,
    ).map((row) => JSON.parse(row.awaiting) as Awaiting);
  }

  function stopWaiting(personId: number, kind: Awaiting['kind']) {
    run(db, 'DELETE FROM pending_answers WHERE person_id = ? AND kind = ?', personId, kind);
  }

  /** Marks a message handled before any side effect, so a retry after a failure part-way never handles it twice. */
  function claim(msg: Received) {
    run(db, 'UPDATE inbound_messages SET processed = 1 WHERE id = ?', msg.inboundId);
  }

  // --- Logging and the inbox ---

  function logInbound(msg: Received, personId: number | null, issueId: number | null, unread = false) {
    if (msg.messageId !== undefined) {
      if (issueId !== null) modules.tickets.attachMessage(msg.messageId, issueId, unread);
      return msg.messageId;
    }
    return modules.tickets.logMessage({
      agencyId: msg.agencyId,
      direction: 'in',
      personId,
      channelType: msg.channelType,
      address: msg.from,
      template: null,
      text: msg.text,
      issueId,
      fileIds: msg.fileIds,
      unread,
    });
  }

  function toInbox(msg: Received, personId: number | null, reason: InboxReason, answers: Answers | null) {
    const messageId = logInbound(msg, personId, null);
    const bestGuess = answers ? Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, a.answer])) : null;
    run(
      db,
      `INSERT INTO inbox_items (agency_id, inbound_id, message_id, person_id, reason, best_guess, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      msg.agencyId,
      msg.inboundId,
      messageId,
      personId,
      reason,
      bestGuess && JSON.stringify(bestGuess),
      iso(clock.now()),
    );
  }

  function received(inboundId: number): Received & { processed: boolean; attachments: StoredAttachment[] } {
    const row = one<{ id: number; agency_id: number; channel_type: ChannelType; sender: string; text: string; attachments: string; processed: number }>(
      db,
      'SELECT * FROM inbound_messages WHERE id = ?',
      inboundId,
    );
    if (!row) throw new Error(`Inbound message ${inboundId} not found`);
    const attachments = JSON.parse(row.attachments) as StoredAttachment[];
    return {
      inboundId: row.id,
      agencyId: row.agency_id,
      channelType: row.channel_type,
      from: row.sender,
      text: row.text,
      fileIds: attachments.flatMap((a) => (a.fileId ? [a.fileId] : [])),
      attachments,
      processed: !!row.processed,
    };
  }

  /** The issue a related item belongs to, whichever module owns the item. */
  function issueIdOf(ref: string): number | null {
    const [kind, rawId] = ref.split(':');
    const id = Number(rawId);
    const ticketId =
      kind === 'quote_request'
        ? modules.quotes.quoteRequest(id)?.ticketId
        : kind === 'approval'
          ? modules.quotes.approval(id)?.ticketId
          : kind === 'work_order'
            ? modules.scheduling.workOrder(id)?.ticketId
            : undefined;
    if (ticketId !== undefined) return modules.tickets.ticket(ticketId).issueId;
    return modules.tickets.resolveRef(ref)?.issueId ?? null;
  }

  // --- Urgency and Trade ---

  function readUrgency(answers: Answers): { urgency: Urgency; checkUrgency: boolean } {
    // An unsure Urgency is treated as High and flagged, never as Urgent.
    return sure(answers, 'urgency') ? { urgency: pick(answers, 'urgency') as Urgency, checkUrgency: false } : { urgency: 'high', checkUrgency: true };
  }

  function readTrade(answers: Answers): { trade: Trade; checkTrade: boolean } {
    return { trade: pick(answers, 'trade') as Trade, checkTrade: !sure(answers, 'trade') };
  }

  // --- Tenants ---

  async function handleTenant(msg: Received, tenant: Person, forced?: Answers) {
    const property = modules.profiles.property(tenant.propertyId!);
    const openItems = modules.tickets.openItemsForProperty(property.id);
    const pending = awaitingFrom(tenant.id);
    const questions = [
      question('messageClass', ['new_issue', 'update', 'common_area', 'other']),
      question('relatedItem', [...openItems.map((i) => i.ref), 'none']),
      URGENCY_QUESTION,
      TRADE_QUESTION,
      question('updateType', ['general', 'reschedule_request', 'visit_confirmed', 'receipt']),
      ...pending.map((awaiting) => question(`answer:${awaiting.kind}`, answerOptions(awaiting))),
    ];
    const answers =
      forced ??
      (await ports.classifier.classify({
        text: msg.text,
        state: { senderRole: 'tenant', hasAttachments: msg.fileIds.length > 0, waitingForAnswers: pending, openItems },
        questions,
      }));
    claim(msg);

    const isAnswer = (awaiting: Awaiting) => {
      const id = `answer:${awaiting.kind}`;
      return sure(answers, id) && pick(answers, id) !== 'not_an_answer';
    };
    const answered = pending.find(isAnswer);
    if (answered) return handleAnswer(msg, tenant, answered, pick(answers, `answer:${answered.kind}`));
    if (!sure(answers, 'messageClass')) return toInbox(msg, tenant.id, 'low_confidence', answers);
    const messageClass = pick(answers, 'messageClass');
    if (messageClass === 'other') return toInbox(msg, tenant.id, 'other', answers);
    if (messageClass === 'common_area') return passOnCommonArea(msg, tenant, property);
    if (!sure(answers, 'relatedItem')) return toInbox(msg, tenant.id, 'low_confidence', answers);
    const ref = pick(answers, 'relatedItem');
    const related = ref === 'none' ? null : modules.tickets.resolveRef(ref);
    if (messageClass === 'new_issue') {
      return related ? attachDuplicate(msg, tenant, property, related.issueId) : startIssue(msg, tenant, property, answers);
    }
    if (!related) return toInbox(msg, tenant.id, 'low_confidence', answers);
    return handleTenantUpdate(msg, tenant, related, pick(answers, 'updateType'));
  }

  async function startIssue(msg: Received, tenant: Person, property: Property, answers: Answers) {
    const issueId = modules.tickets.createIssue({
      agencyId: tenant.agencyId,
      propertyId: property.id,
      tenantId: tenant.id,
      description: msg.text,
      ...readUrgency(answers),
      ...readTrade(answers),
    });
    logInbound(msg, tenant.id, issueId);
    if (modules.tickets.issue(issueId).urgency === 'urgent') return startUrgentRepair(issueId);
    // If the Tenant stops answering, the issue still reaches a Property Manager.
    worker.schedule('intake.no_photos', { issueId, stage: 'gathering' }, addMs(clock.now(), NO_PHOTOS_TIMEOUT_MS));
    await modules.notifications.send(
      tenant.id,
      'tenant.acknowledgement',
      { tenantName: firstName(tenant), propertyAddress: property.address },
      { issueId },
    );
    await askGuidedQuestion(tenant.id, issueId, 'location');
  }

  async function askGuidedQuestion(tenantId: number, issueId: number, next: GuidedQuestion) {
    expectAnswer(tenantId, { kind: 'guided', issueId, question: next });
    await modules.notifications.send(tenantId, 'tenant.guided_question', { question: next }, { issueId });
  }

  async function handleAnswer(msg: Received, tenant: Person, awaiting: Awaiting, answer: string) {
    if (awaiting.kind === 'guided') {
      const issue = modules.tickets.issue(awaiting.issueId);
      logInbound(msg, tenant.id, issue.id);
      stopWaiting(tenant.id, 'guided');
      if (issue.status !== 'gathering') return;
      const value = awaiting.question === 'location' || awaiting.question === 'started' ? msg.text.trim() : answer;
      modules.tickets.updateIssue(issue.id, { [awaiting.question]: value });
      if (awaiting.question === 'availability') modules.profiles.setAvailability(tenant.id, answer as Availability);
      const next = NEXT_QUESTION[awaiting.question];
      return next ? askGuidedQuestion(tenant.id, issue.id, next) : finishGuidedQuestions(issue.id);
    }
    stopWaiting(tenant.id, awaiting.kind);
    if (awaiting.kind === 'fix_rating') {
      logInbound(msg, tenant.id, issueIdOf(`job:${awaiting.jobId}`));
      return modules.scheduling.recordTenantRating(awaiting.jobId, Number(answer));
    }
    const reschedule = answer === 'reschedule';
    logInbound(msg, tenant.id, issueIdOf(`work_order:${awaiting.workOrderId}`), reschedule);
    if (reschedule) return modules.scheduling.recordRescheduleRequest(awaiting.workOrderId, 'tenant');
    return modules.scheduling.recordVisitConfirmation(awaiting.workOrderId);
  }

  /** Classifies Urgency and Trade again with the answers in, then asks for photos or starts the Urgent path. */
  async function finishGuidedQuestions(issueId: number) {
    const issue = modules.tickets.issue(issueId);
    const answers = await ports.classifier.classify({
      text: issue.description,
      state: { senderRole: 'tenant', answers: issue.answers },
      questions: [URGENCY_QUESTION, TRADE_QUESTION],
    });
    const urgency = readUrgency(answers);
    modules.tickets.updateIssue(issueId, { ...urgency, ...readTrade(answers) });
    if (urgency.urgency === 'urgent') return startUrgentRepair(issueId);
    modules.tickets.updateIssue(issueId, { status: 'awaiting_photos' });
    await modules.notifications.send(
      issue.tenantId,
      'tenant.upload_link',
      { uploadLink: `${settings.baseUrl}/u/${issue.photosToken}` },
      { issueId },
    );
    worker.schedule('intake.no_photos', { issueId, stage: 'awaiting_photos' }, addMs(clock.now(), NO_PHOTOS_TIMEOUT_MS));
  }

  async function startUrgentRepair(issueId: number) {
    const issue = modules.tickets.issue(issueId);
    const property = modules.profiles.property(issue.propertyId);
    const { receiptToken } = modules.tickets.createUrgentRepair(issueId);
    if (awaitingFrom(issue.tenantId).some((a) => a.kind === 'guided' && a.issueId === issueId)) stopWaiting(issue.tenantId, 'guided');
    const nominatedTradies = property.nominatedTradieIds
      .map((id) => modules.profiles.person(id))
      .filter((t) => t.mobile)
      .map((t) => ({ businessName: t.businessName ?? t.name, phone: t.mobile! }));
    await modules.notifications.send(
      issue.tenantId,
      'tenant.urgent_repair_reminder',
      { limitCents: URGENT_REPAIR_LIMIT_CENTS, nominatedTradies, receiptLink: `${settings.baseUrl}/u/${receiptToken}` },
      { issueId },
    );
  }

  async function forwardReceipt(urgentRepairId: number, fileIds: number[]) {
    const urgentRepair = modules.tickets.urgentRepair(urgentRepairId);
    modules.tickets.addReceipt(urgentRepairId, fileIds);
    const issue = modules.tickets.issue(urgentRepair.issueId);
    const property = modules.profiles.property(urgentRepair.propertyId);
    await modules.notifications.send(
      property.ownerId,
      'owner.urgent_repair_receipt',
      {
        propertyAddress: property.address,
        tenantName: modules.profiles.person(urgentRepair.tenantId).name,
        description: issue.description,
        limitCents: URGENT_REPAIR_LIMIT_CENTS,
      },
      {
        issueId: issue.id,
        attachmentFileIds: fileIds,
        preferEmail: true,
        copyPropertyManagerId: property.propertyManagerId,
      },
    );
    modules.tickets.setUrgentRepairStatus(urgentRepairId, 'receipt_forwarded');
  }

  async function attachDuplicate(msg: Received, tenant: Person, property: Property, issueId: number) {
    logInbound(msg, tenant.id, issueId, true);
    await modules.notifications.send(
      tenant.id,
      'tenant.acknowledgement',
      { tenantName: firstName(tenant), propertyAddress: property.address },
      { issueId },
    );
  }

  async function handleTenantUpdate(
    msg: Received,
    tenant: Person,
    related: NonNullable<ReturnType<typeof modules.tickets.resolveRef>>,
    updateType: string,
  ) {
    const workOrder =
      related.jobId !== undefined
        ? modules.scheduling.activeWorkOrderForJob(related.jobId)
        : related.ticketId !== undefined
          ? modules.scheduling.activeWorkOrdersForTicket(related.ticketId).at(-1)
          : undefined;
    if (updateType === 'reschedule_request' && workOrder) {
      logInbound(msg, tenant.id, related.issueId, true);
      return modules.scheduling.recordRescheduleRequest(workOrder.id, 'tenant');
    }
    if (updateType === 'visit_confirmed' && workOrder) {
      logInbound(msg, tenant.id, related.issueId);
      return modules.scheduling.recordVisitConfirmation(workOrder.id);
    }
    if (updateType === 'receipt' && related.urgentRepairId !== undefined && msg.fileIds.length) {
      logInbound(msg, tenant.id, related.issueId);
      return forwardReceipt(related.urgentRepairId, msg.fileIds);
    }
    // A general update: logged and left unread for the Property Manager.
    logInbound(msg, tenant.id, related.issueId, true);
  }

  async function passOnCommonArea(msg: Received, tenant: Person, property: Property) {
    if (property.buildingManagerId === null) return toInbox(msg, tenant.id, 'common_area_no_building_manager', null);
    const buildingManager = modules.profiles.person(property.buildingManagerId);
    logInbound(msg, tenant.id, null);
    await modules.notifications.send(buildingManager.id, 'building_manager.common_area_issue', {
      propertyAddress: property.address,
      tenantName: tenant.name,
      message: msg.text,
    });
    await modules.notifications.send(tenant.id, 'tenant.common_area_passed_on', { buildingManagerName: buildingManager.name });
  }

  // --- Tradies and Property Owners ---

  async function handleTradie(msg: Received, tradie: Person, forced?: Answers) {
    const waiting = [...modules.quotes.itemsWaitingOn(tradie.id), ...modules.scheduling.itemsWaitingOn(tradie.id)];
    const answers =
      forced ??
      (await ports.classifier.classify({
        text: msg.text,
        state: { senderRole: 'tradie', hasAttachments: msg.fileIds.length > 0, waitingItems: waiting },
        questions: [
          question('replyType', ['quote', 'decline', 'reschedule_request', 'done', 'other']),
          question('relatedItem', [...waiting.map((i) => i.ref), 'none']),
        ],
      }));
    claim(msg);
    if (!sure(answers, 'replyType')) return toInbox(msg, tradie.id, 'low_confidence', answers);
    const replyType = pick(answers, 'replyType');
    if (replyType === 'other') return toInbox(msg, tradie.id, 'other', answers);
    const ref = pick(answers, 'relatedItem');
    if (!sure(answers, 'relatedItem') || !waiting.some((i) => i.ref === ref)) return toInbox(msg, tradie.id, 'low_confidence', answers);
    const [kind, rawId] = ref.split(':');
    const id = Number(rawId);
    const issueId = issueIdOf(ref);

    if (kind === 'quote_request' && (replyType === 'quote' || replyType === 'decline')) {
      logInbound(msg, tradie.id, issueId);
      const pdf = msg.fileIds.map((fileId) => files.get(fileId)).find((f) => f.contentType === 'application/pdf');
      return modules.quotes.recordTradieReply(id, { kind: replyType, text: msg.text, pdfFileId: pdf?.id ?? null });
    }
    if (kind === 'work_order' && replyType === 'reschedule_request') {
      logInbound(msg, tradie.id, issueId, true);
      return modules.scheduling.recordRescheduleRequest(id, 'tradie');
    }
    if (kind === 'work_order' && replyType === 'done') {
      logInbound(msg, tradie.id, issueId);
      return modules.scheduling.markDone(id);
    }
    return toInbox(msg, tradie.id, 'low_confidence', answers);
  }

  async function handleOwner(msg: Received, owner: Person, forced?: Answers) {
    const waiting = modules.quotes.approvalsWaitingOn(owner.id);
    const answers =
      forced ??
      (await ports.classifier.classify({
        text: msg.text,
        state: { senderRole: 'property_owner', waitingItems: waiting },
        questions: [
          question('replyType', ['approval_answer', 'other']),
          question('answer', ['yes', 'no']),
          question('relatedItem', [...waiting.map((i) => i.ref), 'none']),
        ],
      }));
    claim(msg);
    if (!sure(answers, 'replyType')) return toInbox(msg, owner.id, 'low_confidence', answers);
    if (pick(answers, 'replyType') === 'other') return toInbox(msg, owner.id, 'other', answers);
    const ref = pick(answers, 'relatedItem');
    if (!sure(answers, 'answer') || !sure(answers, 'relatedItem') || !waiting.some((i) => i.ref === ref)) {
      return toInbox(msg, owner.id, 'low_confidence', answers);
    }
    logInbound(msg, owner.id, issueIdOf(ref));
    return modules.quotes.recordOwnerAnswer(Number(ref.split(':')[1]), pick(answers, 'answer') as 'yes' | 'no');
  }

  async function route(msg: Received, person: Person, forced?: Answers) {
    if (person.role === 'tenant') return handleTenant(msg, person, forced);
    if (person.role === 'tradie') return handleTradie(msg, person, forced);
    if (person.role === 'owner') return handleOwner(msg, person, forced);
    return toInbox(msg, person.id, 'other', null);
  }

  // --- Background tasks ---

  worker.on<{ inboundId: number }>('intake.process', async ({ inboundId }) => {
    const msg = received(inboundId);
    if (msg.processed) return;
    // Attachments a provider sent by URL are downloaded here, not in the webhook.
    const attachments: StoredAttachment[] = [];
    for (const a of msg.attachments) {
      if (a.fileId || !a.url) attachments.push(a);
      else attachments.push({ ...a, fileId: files.save(msg.agencyId, { ...a, content: await ports.fetchMedia(a.url) }) });
    }
    run(db, 'UPDATE inbound_messages SET attachments = ? WHERE id = ?', JSON.stringify(attachments), inboundId);
    msg.fileIds = attachments.map((a) => a.fileId!);

    const sender = modules.profiles.findByAddress(msg.agencyId, msg.from);
    if (!sender) {
      claim(msg);
      return toInbox(msg, null, 'unknown_sender', null);
    }
    modules.profiles.recordInbound(sender.personId, msg.channelType, msg.from, clock.now());
    // Each handler claims the message once the classifier has answered; that step alone is safe to retry.
    await route(msg, modules.profiles.person(sender.personId));
    claim(msg);
  });

  worker.on<{ issueId: number }>('intake.match_photos', async ({ issueId }) => {
    const issue = modules.tickets.issue(issueId);
    if (issue.status !== 'checking' && issue.status !== 'maintenance_request') return;
    const photos = modules.tickets.photos(issueId).map((p) => files.get(p.fileId));
    // The check only advises the Property Manager, so a failure never holds the issue back.
    const { result, reason } = await ports.imageMatcher
      .match({ description: issue.description, photos: photos.map((p) => ({ contentType: p.contentType, content: p.content })) })
      .catch(() => ({ result: 'unclear' as const, reason: 'The photo check could not run' }));
    modules.tickets.updateIssue(issueId, {
      imageMatch: result,
      imageMatchReason: reason,
      ...(issue.status === 'checking' ? { status: 'maintenance_request' as const } : {}),
    });
  });

  /** After 48 hours in `stage` the issue moves on marked "no photos", so nothing stalls. */
  worker.on<{ issueId: number; stage: 'gathering' | 'awaiting_photos' }>('intake.no_photos', ({ issueId, stage }) => {
    const issue = modules.tickets.issue(issueId);
    if (issue.status !== stage) return;
    if (awaitingFrom(issue.tenantId).some((a) => a.kind === 'guided' && a.issueId === issueId)) stopWaiting(issue.tenantId, 'guided');
    modules.tickets.updateIssue(issueId, { status: 'maintenance_request', noPhotos: true });
  });

  worker.on<{ urgentRepairId: number; fileIds: number[] }>('intake.forward_receipt', ({ urgentRepairId, fileIds }) =>
    forwardReceipt(urgentRepairId, fileIds),
  );

  return {
    /** Stores an inbound message and leaves it for the worker. Safe to call again with the same provider message. */
    receive(message: InboundMessage) {
      const agencyId = modules.profiles.agencyByChannel(message.channelType, message.agencyChannel);
      if (agencyId === null) return;
      transaction(db, () => {
        if (one(db, 'SELECT 1 FROM inbound_messages WHERE provider_message_id = ?', message.providerMessageId)) return;
        const attachments: StoredAttachment[] = message.attachments.map((a) =>
          'content' in a
            ? { filename: a.filename, contentType: a.contentType, fileId: files.save(agencyId, a) }
            : { filename: a.filename, contentType: a.contentType, url: a.url },
        );
        const inboundId = run(
          db,
          `INSERT INTO inbound_messages (provider_message_id, agency_id, channel_type, sender, text, attachments, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          message.providerMessageId,
          agencyId,
          message.channelType,
          message.from,
          message.text,
          JSON.stringify(attachments),
          iso(message.receivedAt),
        );
        worker.schedule('intake.process', { inboundId });
      });
    },

    /** Handles photos or a receipt uploaded through a no-login link. */
    async upload(token: string, uploads: { filename: string; contentType: string; content: Uint8Array }[]) {
      if (!uploads.length || uploads.length > MAX_UPLOAD_FILES) invalid(`Upload between 1 and ${MAX_UPLOAD_FILES} files`);
      if (uploads.some((u) => u.content.byteLength > MAX_UPLOAD_BYTES)) invalid('Each file must be under 10 MB');

      const issue = modules.tickets.issueByPhotosToken(token);
      if (issue) {
        if (!['awaiting_photos', 'checking', 'maintenance_request'].includes(issue.status)) invalid('This upload link has expired');
        if (uploads.some((u) => !PHOTO_TYPES.includes(u.contentType))) invalid('Only photos can be uploaded here (JPEG, PNG, HEIC, WebP or GIF)');
        const tenant = modules.profiles.person(issue.tenantId);
        const property = modules.profiles.property(issue.propertyId);
        const { timeZone } = modules.profiles.agency(issue.agencyId);
        for (const photo of uploads) {
          const fileId = files.save(issue.agencyId, photo);
          const check = await checkPhotoMetadata(photo.content, {
            reportedAt: new Date(issue.reportedAt),
            tenancyStart: tenant.tenancyStart,
            propertyLocation: property.location,
            timeZone,
            maxAgeDays: settings.photoMaxAgeDays,
            maxDistanceKm: settings.photoMaxDistanceKm,
          });
          modules.tickets.addPhoto(issue.id, fileId, check.metadata, check.reasons);
        }
        modules.tickets.updateIssue(issue.id, {
          noPhotos: false,
          ...(issue.status === 'awaiting_photos' ? { status: 'checking' as const } : {}),
        });
        worker.schedule('intake.match_photos', { issueId: issue.id });
        return;
      }

      const urgentRepair = modules.tickets.urgentRepairByToken(token);
      if (!urgentRepair) notFound('Upload link');
      if (uploads.some((u) => !PHOTO_TYPES.includes(u.contentType) && u.contentType !== 'application/pdf')) {
        invalid('Upload the receipt as a photo or PDF');
      }
      const fileIds = uploads.map((u) => files.save(urgentRepair.agencyId, u));
      worker.schedule('intake.forward_receipt', { urgentRepairId: urgentRepair.id, fileIds });
    },

    startUrgentRepair,
    expectAnswer,

    inbox(agencyId: number) {
      return all<{ id: number; inbound_id: number; person_id: number | null; reason: InboxReason; best_guess: string | null; at: string }>(
        db,
        `SELECT * FROM inbox_items WHERE agency_id = ? AND status = 'open' ORDER BY at, id`,
        agencyId,
      ).map((item) => {
        const msg = received(item.inbound_id);
        return {
          itemId: item.id,
          reason: item.reason,
          from: msg.from,
          personId: item.person_id,
          personName: item.person_id === null ? null : modules.profiles.person(item.person_id).name,
          text: msg.text,
          receivedAt: item.at,
          bestGuess: item.best_guess ? (JSON.parse(item.best_guess) as Record<string, string>) : null,
        };
      });
    },

    /** Links an unknown sender's address to a person, so their next message is recognised. */
    linkSender(agencyId: number, itemId: number, personId: number) {
      const item = openInboxItem(agencyId, itemId);
      const person = modules.profiles.personInAgency(agencyId, personId);
      modules.profiles.linkAddress(agencyId, person.id, received(item.inbound_id).from);
      run(db, 'UPDATE inbox_items SET person_id = ? WHERE id = ?', person.id, itemId);
    },

    /** Handles an inbox message as if the classifier had given these answers: the best guess unless overridden. */
    async routeInboxItem(agencyId: number, itemId: number, overrides: Record<string, string> = {}) {
      const item = openInboxItem(agencyId, itemId);
      if (item.person_id === null) invalid('Link the sender to a person first');
      const guesses = { ...(item.best_guess ? (JSON.parse(item.best_guess) as Record<string, string>) : {}), ...overrides };
      const forced = Object.fromEntries(Object.entries(guesses).map(([id, answer]) => [id, { answer, confidence: 1 }]));
      run(db, `UPDATE inbox_items SET status = 'resolved' WHERE id = ?`, itemId);
      const msg = { ...received(item.inbound_id), messageId: item.message_id };
      await route(msg, modules.profiles.person(item.person_id), forced);
    },

    dismissInboxItem(agencyId: number, itemId: number) {
      openInboxItem(agencyId, itemId);
      run(db, `UPDATE inbox_items SET status = 'resolved' WHERE id = ?`, itemId);
    },
  };

  function openInboxItem(agencyId: number, itemId: number) {
    const item = one<{ id: number; inbound_id: number; message_id: number; person_id: number | null; best_guess: string | null }>(
      db,
      `SELECT * FROM inbox_items WHERE id = ? AND agency_id = ? AND status = 'open'`,
      itemId,
      agencyId,
    );
    if (!item) notFound('Inbox message');
    return item;
  }
}

export type Intake = ReturnType<typeof createIntake>;
