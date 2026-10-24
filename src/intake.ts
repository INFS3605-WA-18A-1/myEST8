import type { Context } from './context.ts';
import { all, one, run, transaction } from './db.ts';
import { checkPhotoMetadata } from './photo-checks.ts';
import type { ChannelType, ClassifierAnswer, ClassifierQuestion, InboundMessage } from './ports.ts';
import type { Person, Property } from './profiles.ts';
import { requireClaim, type ReceiptVia } from './tickets.ts';
import { addMs, HOUR_MS, invalid, iso, notFound, TRADES, URGENCIES, type Trade, type Urgency } from './shared.ts';
import type { GuidedQuestion } from './templates.ts';

export const URGENT_REPAIR_LIMIT_CENTS = 1000_00;
const NO_PHOTOS_TIMEOUT_MS = 48 * HOUR_MS;
/** A Tenant gets at most this many missing-details messages per issue: the first ask and one re-ask. */
const MAX_MISSING_DETAILS_ASKS = 2;
export const MAX_UPLOAD_FILES = 10;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Photo formats phones produce. Not SVG, which can carry script into the Property Manager's pages. */
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/gif'];
/** What a Reimbursement Request's receipt can be: a photo of it, or the PDF the Tradie sent. */
const RECEIPT_TYPES = [...PHOTO_TYPES, 'application/pdf'];

/** What the agent is waiting for this person to answer. */
type Awaiting =
  // `question` is only on rows from when one question was asked at a time: a reply to one is read like any other.
  // `asks` counts the missing-details messages sent for the issue (a row without it is the first ask).
  | { kind: 'guided'; issueId: number; question?: GuidedQuestion; asks?: number }
  | { kind: 'fix_rating'; jobId: number }
  | { kind: 'visit'; workOrderId: number }
  | { kind: 'visit_offer'; offerId: number; options: string[] };

/** The guided questions in the order they are asked. */
const GUIDED_ORDER: GuidedQuestion[] = ['location', 'started', 'worsening', 'availability'];

type InboxReason = 'unknown_sender' | 'other' | 'low_confidence' | 'common_area_no_building_manager' | 'shared_address';
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
  if (awaiting.kind === 'visit_offer') return [...awaiting.options, 'not_an_answer'];
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

  const sure = (answers: Answers, id: string) => (answers[id]?.confidence ?? 0) >= settings.confidenceThreshold;
  const pick = (answers: Answers, id: string) => answers[id]?.answer ?? '';

  // --- Conversation state ---

  /** Waits for this person's answer. A person can have one question of each kind open at once. */
  async function expectAnswer(personId: number, awaiting: Awaiting) {
    await run(
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
  async function awaitingFrom(personId: number): Promise<Awaiting[]> {
    return (await all<{ awaiting: string }>(
      db,
      'SELECT awaiting FROM pending_answers WHERE person_id = ? ORDER BY asked_at DESC, seq DESC',
      personId,
    )).map((row) => JSON.parse(row.awaiting) as Awaiting);
  }

  async function stopWaiting(personId: number, kind: Awaiting['kind']) {
    await run(db, 'DELETE FROM pending_answers WHERE person_id = ? AND kind = ?', personId, kind);
  }

  /** Marks a message handled before any side effect, so a retry after a failure part-way never handles it twice. */
  async function claim(msg: Received) {
    await run(db, 'UPDATE inbound_messages SET processed = 1 WHERE id = ?', msg.inboundId);
  }

  // --- Logging and the inbox ---

  async function logInbound(msg: Received, personId: number | null, issueId: number | null, unread = false) {
    if (msg.messageId !== undefined) {
      if (issueId !== null) await modules.tickets.attachMessage(msg.messageId, issueId, unread);
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

  async function toInbox(msg: Received, personId: number | null, reason: InboxReason, answers: Answers | null) {
    const messageId = await logInbound(msg, personId, null);
    const bestGuess = answers ? Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, a.answer])) : null;
    await run(
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

  async function received(inboundId: number): Promise<Received & { processed: boolean; attachments: StoredAttachment[] }> {
    const row = await one<{ id: number; agency_id: number; channel_type: ChannelType; sender: string; text: string; attachments: string; processed: number }>(
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
  async function issueIdOf(ref: string): Promise<number | null> {
    const [kind, rawId] = ref.split(':');
    const id = Number(rawId);
    const ticketId =
      kind === 'quote_request'
        ? (await modules.quotes.quoteRequest(id))?.ticketId
        : kind === 'approval'
          ? (await modules.quotes.approval(id))?.ticketId
          : kind === 'work_order'
            ? (await modules.scheduling.workOrder(id))?.ticketId
            : undefined;
    if (ticketId !== undefined) return (await modules.tickets.ticket(ticketId)).issueId;
    return (await modules.tickets.resolveRef(ref))?.issueId ?? null;
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
    const property = await modules.profiles.property(tenant.propertyId!);
    const openItems = await modules.tickets.openItemsForProperty(property.id);
    const pending = await awaitingFrom(tenant.id);
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
    await claim(msg);

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
    const related = ref === 'none' ? null : await modules.tickets.resolveRef(ref);
    if (messageClass === 'new_issue') {
      return related ? attachDuplicate(msg, tenant, property, related.issueId) : startIssue(msg, tenant, property, answers);
    }
    if (!related) return toInbox(msg, tenant.id, 'low_confidence', answers);
    return handleTenantUpdate(msg, tenant, related, pick(answers, 'updateType'));
  }

  async function startIssue(msg: Received, tenant: Person, property: Property, answers: Answers) {
    const issueId = await modules.tickets.createIssue({
      agencyId: tenant.agencyId,
      propertyId: property.id,
      tenantId: tenant.id,
      description: msg.text,
      ...readUrgency(answers),
      ...readTrade(answers),
    });
    await logInbound(msg, tenant.id, issueId);
    if ((await modules.tickets.issue(issueId)).urgency === 'urgent') return startUrgentRepair(issueId);
    // Photos sent with the first message are the issue's photos; other attachments are ignored here.
    const arrived = await savePhotos(issueId, msg.fileIds);
    if (arrived) await modules.tickets.updateIssue(issueId, { photosOnArrival: arrived });
    // If the Tenant stops answering, the issue still reaches a Property Manager.
    await worker.schedule('intake.no_photos', { issueId, stage: 'gathering' }, addMs(clock.now(), NO_PHOTOS_TIMEOUT_MS));
    await modules.notifications.send(
      tenant.id,
      'tenant.acknowledgement',
      { tenantName: firstName(tenant), propertyAddress: property.address },
      { issueId },
    );
    await saveDetails(tenant, issueId, msg.text);
    await askForMissingDetails(tenant, issueId);
  }

  /** Saves each stored image as one of the issue's photos, with its metadata checked. Returns how many were photos. */
  async function savePhotos(issueId: number, fileIds: number[]): Promise<number> {
    const issue = await modules.tickets.issue(issueId);
    const tenant = await modules.profiles.person(issue.tenantId);
    const property = await modules.profiles.property(issue.propertyId);
    const { timeZone } = await modules.profiles.agency(issue.agencyId);
    let saved = 0;
    for (const fileId of fileIds) {
      const file = await files.get(fileId);
      if (!PHOTO_TYPES.includes(file.contentType)) continue;
      await addCheckedPhoto(issue, tenant, property, timeZone, fileId, file.content);
      saved++;
    }
    return saved;
  }

  async function addCheckedPhoto(
    issue: Awaited<ReturnType<typeof modules.tickets.issue>>,
    tenant: Person,
    property: Property,
    timeZone: string,
    fileId: number,
    content: Uint8Array,
  ) {
    const check = await checkPhotoMetadata(content, {
      reportedAt: new Date(issue.reportedAt),
      tenancyStart: tenant.tenancyStart,
      propertyLocation: property.location,
      timeZone,
      maxAgeDays: settings.photoMaxAgeDays,
      maxDistanceKm: settings.photoMaxDistanceKm,
    });
    await modules.tickets.addPhoto(issue.id, fileId, check.metadata, check.reasons);
  }

  /** The guided questions the issue has no answer to yet, in the order they are asked. */
  const missingDetails = (issue: Awaited<ReturnType<typeof modules.tickets.issue>>) => GUIDED_ORDER.filter((q) => issue.answers[q] === null);

  /** Saves what the extractor finds in `text` for the questions still missing. A failure, or no extractor, finds nothing. Returns how many it found. */
  async function saveDetails(tenant: Person, issueId: number, text: string): Promise<number> {
    const issue = await modules.tickets.issue(issueId);
    const found =
      (await ports.detailExtractor?.extract({ text, wanted: missingDetails(issue), issue: { description: issue.description } }).catch(() => null)) ?? {};
    await modules.tickets.updateIssue(issueId, found);
    if (found.availability) await modules.profiles.setAvailability(tenant.id, found.availability);
    return Object.keys(found).length;
  }

  /** Asks once, in one message, for whatever is still missing, or goes on when nothing is. `asks` is how many asks this makes. */
  async function askForMissingDetails(tenant: Person, issueId: number, asks = 1) {
    const questions = missingDetails(await modules.tickets.issue(issueId));
    if (!questions.length) return finishGuidedQuestions(issueId);
    await expectAnswer(tenant.id, { kind: 'guided', issueId, asks });
    await modules.notifications.send(tenant.id, 'tenant.missing_details', { tenantName: firstName(tenant), questions }, { issueId });
  }

  async function handleAnswer(msg: Received, tenant: Person, awaiting: Awaiting, answer: string) {
    if (awaiting.kind === 'guided') {
      const issue = await modules.tickets.issue(awaiting.issueId);
      await logInbound(msg, tenant.id, issue.id);
      await stopWaiting(tenant.id, 'guided');
      if (issue.status !== 'gathering') return;
      // Ask again only while the replies keep adding answers, and only once: after the second ask, intake goes on with the blanks.
      const added = await saveDetails(tenant, issue.id, msg.text);
      const asks = awaiting.asks ?? 1;
      return added && asks < MAX_MISSING_DETAILS_ASKS ? askForMissingDetails(tenant, issue.id, asks + 1) : finishGuidedQuestions(issue.id);
    }
    await stopWaiting(tenant.id, awaiting.kind);
    if (awaiting.kind === 'fix_rating') {
      await logInbound(msg, tenant.id, await issueIdOf(`job:${awaiting.jobId}`));
      return modules.scheduling.recordTenantRating(awaiting.jobId, Number(answer));
    }
    if (awaiting.kind === 'visit_offer') {
      await logInbound(msg, tenant.id, await modules.scheduling.visitOfferIssue(awaiting.offerId));
      return modules.scheduling.answerVisitOffer(awaiting.offerId, answer, msg.text);
    }
    const reschedule = answer === 'reschedule';
    await logInbound(msg, tenant.id, await issueIdOf(`work_order:${awaiting.workOrderId}`), reschedule);
    if (reschedule) return modules.scheduling.recordRescheduleRequest(awaiting.workOrderId, 'tenant');
    return modules.scheduling.recordVisitConfirmation(awaiting.workOrderId);
  }

  /** Classifies Urgency and Trade again with the answers in, then asks for photos or starts the Urgent path. */
  async function finishGuidedQuestions(issueId: number) {
    const issue = await modules.tickets.issue(issueId);
    const answers = await ports.classifier.classify({
      text: issue.description,
      state: { senderRole: 'tenant', answers: issue.answers },
      questions: [URGENCY_QUESTION, TRADE_QUESTION],
    });
    const urgency = readUrgency(answers);
    await modules.tickets.updateIssue(issueId, { ...urgency, ...readTrade(answers) });
    if (urgency.urgency === 'urgent') return startUrgentRepair(issueId);
    await worker.schedule('intake.summarise', { issueId });
    const have = (await modules.tickets.photos(issueId)).length;
    const uploadLink = `${settings.baseUrl}/u/${issue.photosToken}`;
    if (have > 0) {
      await modules.tickets.updateIssue(issueId, { status: 'checking' });
      await worker.schedule('intake.match_photos', { issueId });
      await modules.notifications.send(issue.tenantId, 'tenant.upload_link', { uploadLink, alreadyHave: have }, { issueId });
      return;
    }
    await modules.tickets.updateIssue(issueId, { status: 'awaiting_photos' });
    await modules.notifications.send(issue.tenantId, 'tenant.upload_link', { uploadLink }, { issueId });
    await worker.schedule('intake.no_photos', { issueId, stage: 'awaiting_photos' }, addMs(clock.now(), NO_PHOTOS_TIMEOUT_MS));
  }

  async function startUrgentRepair(issueId: number) {
    const issue = await modules.tickets.issue(issueId);
    const { receiptToken } = await modules.tickets.createUrgentRepair(issueId);
    if ((await awaitingFrom(issue.tenantId)).some((a) => a.kind === 'guided' && a.issueId === issueId)) await stopWaiting(issue.tenantId, 'guided');
    await sendReceiptReminder(issueId, receiptToken);
  }

  /** What to do now, the Property's Nominated Tradies, and the link for the receipt the Reimbursement Request needs. */
  async function sendReceiptReminder(issueId: number, receiptToken: string) {
    const issue = await modules.tickets.issue(issueId);
    const property = await modules.profiles.property(issue.propertyId);
    const nominatedTradies = (await Promise.all(property.nominatedTradieIds.map((id) => modules.profiles.person(id))))
      .filter((t) => t.mobile)
      .map((t) => ({ businessName: t.businessName ?? t.name, phone: t.mobile! }));
    await modules.notifications.send(
      issue.tenantId,
      'tenant.urgent_repair_reminder',
      { limitCents: URGENT_REPAIR_LIMIT_CENTS, nominatedTradies, receiptLink: `${settings.baseUrl}/u/${receiptToken}` },
      { issueId },
    );
  }

  /**
   * A receipt for a Reimbursement Request arrived. It waits for the Property Manager
   * to check it and forward it (the rail's Approvals count and the dashboard show
   * it); nothing goes to the Property Owner yet.
   */
  async function receiveReceipt(urgentRepairId: number, fileIds: number[], o: { amountCents?: number | null; via: ReceiptVia }) {
    await modules.tickets.addReceipt(urgentRepairId, fileIds, o);
  }

  /**
   * The Property Manager forwards a checked Reimbursement Request to the Property
   * Owner: by email where the Owner has one, with every receipt attached and the
   * Property Manager copied in. Forwarding again sends another copy.
   */
  async function forwardReimbursement(agencyId: number, urgentRepairId: number, o: { amountCents?: number | null } = {}) {
    const found = await modules.tickets.urgentRepairInAgency(agencyId, urgentRepairId);
    const property = await modules.profiles.property(found.propertyId);
    const owner = await modules.profiles.person(property.ownerId);
    const forwarded = await modules.tickets.forwardUrgentRepair(agencyId, urgentRepairId, { amountCents: o.amountCents ?? null, ownerName: owner.name });
    const issue = await modules.tickets.issue(forwarded.issueId);
    await modules.notifications.send(
      owner.id,
      'owner.urgent_repair_receipt',
      {
        propertyAddress: property.address,
        tenantName: (await modules.profiles.person(forwarded.tenantId)).name,
        description: issue.summary ?? issue.description,
        amountCents: forwarded.amountCents,
        limitCents: URGENT_REPAIR_LIMIT_CENTS,
      },
      {
        issueId: issue.id,
        attachmentFileIds: forwarded.receiptFileIds,
        preferEmail: true,
        copyPropertyManagerId: property.propertyManagerId,
      },
    );
  }

  /** The Property Owner has paid the Tenant back: the Reimbursement Request is done, and the Tenant is told. */
  async function markReimbursed(agencyId: number, urgentRepairId: number) {
    const done = await modules.tickets.markUrgentRepairReimbursed(agencyId, urgentRepairId);
    const property = await modules.profiles.property(done.propertyId);
    await modules.notifications.send(
      done.tenantId,
      'tenant.reimbursed',
      { propertyAddress: property.address, amountCents: done.amountCents },
      { issueId: done.issueId },
    );
  }

  /** Sends the Tenant the receipt link again, while the Reimbursement Request still waits for the receipt. */
  async function resendReceiptLink(agencyId: number, urgentRepairId: number) {
    const found = await modules.tickets.urgentRepairInAgency(agencyId, urgentRepairId);
    if (found.status !== 'reminder_sent') invalid('The Tenant has already sent the receipt');
    await sendReceiptReminder(found.issueId, found.receiptToken);
    await modules.tickets.recordUrgentRepairEvent(found.id, 'link_resent');
  }

  /** The files among `fileIds` that can be a receipt (a photo or a PDF). */
  async function receiptFilesAmong(fileIds: number[]) {
    if (!fileIds.length) return [];
    const rows = await all<{ id: number; content_type: string }>(
      db,
      'SELECT id, content_type FROM files WHERE id IN (SELECT value::bigint FROM jsonb_array_elements_text(?::text::jsonb) AS ids (value)) ORDER BY id',
      JSON.stringify(fileIds),
    );
    return rows.filter((f) => RECEIPT_TYPES.includes(f.content_type)).map((f) => f.id);
  }

  async function attachDuplicate(msg: Received, tenant: Person, property: Property, issueId: number) {
    await logInbound(msg, tenant.id, issueId, true);
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
    related: NonNullable<Awaited<ReturnType<typeof modules.tickets.resolveRef>>>,
    updateType: string,
  ) {
    const workOrder =
      related.jobId !== undefined
        ? await modules.scheduling.activeWorkOrderForJob(related.jobId)
        : related.ticketId !== undefined
          ? (await modules.scheduling.activeWorkOrdersForTicket(related.ticketId)).at(-1)
          : undefined;
    if (updateType === 'reschedule_request' && workOrder) {
      await logInbound(msg, tenant.id, related.issueId, true);
      return modules.scheduling.recordRescheduleRequest(workOrder.id, 'tenant');
    }
    if (updateType === 'visit_confirmed' && workOrder) {
      await logInbound(msg, tenant.id, related.issueId);
      return modules.scheduling.recordVisitConfirmation(workOrder.id);
    }
    // A receipt counts only with a photo or PDF in it; anything else waits for the Property Manager as an update.
    const receipts = updateType === 'receipt' && related.urgentRepairId !== undefined ? await receiptFilesAmong(msg.fileIds) : [];
    if (receipts.length && (await modules.tickets.urgentRepair(related.urgentRepairId!)).status !== 'reimbursed') {
      await logInbound(msg, tenant.id, related.issueId);
      return receiveReceipt(related.urgentRepairId!, receipts, { via: msg.channelType });
    }
    // A general update: logged and left unread for the Property Manager.
    await logInbound(msg, tenant.id, related.issueId, true);
  }

  async function passOnCommonArea(msg: Received, tenant: Person, property: Property) {
    if (property.buildingManagerId === null) return toInbox(msg, tenant.id, 'common_area_no_building_manager', null);
    const buildingManager = await modules.profiles.person(property.buildingManagerId);
    await logInbound(msg, tenant.id, null);
    await modules.notifications.send(buildingManager.id, 'building_manager.common_area_issue', {
      propertyAddress: property.address,
      tenantName: tenant.name,
      message: msg.text,
    });
    await modules.notifications.send(tenant.id, 'tenant.common_area_passed_on', { buildingManagerName: buildingManager.name });
  }

  // --- Tradies and Property Owners ---

  async function handleTradie(msg: Received, tradie: Person, forced?: Answers) {
    const waiting = [...(await modules.quotes.itemsWaitingOn(tradie.id)), ...(await modules.scheduling.itemsWaitingOn(tradie.id))];
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
    await claim(msg);
    if (!sure(answers, 'replyType')) return toInbox(msg, tradie.id, 'low_confidence', answers);
    const replyType = pick(answers, 'replyType');
    if (replyType === 'other') return toInbox(msg, tradie.id, 'other', answers);
    const ref = pick(answers, 'relatedItem');
    if (!sure(answers, 'relatedItem') || !waiting.some((i) => i.ref === ref)) return toInbox(msg, tradie.id, 'low_confidence', answers);
    const [kind, rawId] = ref.split(':');
    const id = Number(rawId);
    const issueId = await issueIdOf(ref);

    if (kind === 'quote_request' && (replyType === 'quote' || replyType === 'decline')) {
      // A price after the Estimate can't be a Firm Quote (a message can't carry its scope and
      // dates): the Tradie is sent their quote page once a Firm Quote is allowed, and the message is left unread.
      const afterEstimate = replyType === 'quote' && !!(await modules.quotes.quoteRequest(id))?.estimated;
      await logInbound(msg, tradie.id, issueId, afterEstimate);
      const pdf = (await Promise.all(msg.fileIds.map((fileId) => files.get(fileId)))).find((f) => f.contentType === 'application/pdf');
      await modules.quotes.recordTradieReply(id, { kind: replyType, text: msg.text, pdfFileId: pdf?.id ?? null });
      return;
    }
    if (kind === 'work_order' && replyType === 'quote') {
      // A price sent about a Site Inspection is for that request's Firm Quote, given on the quote page.
      const visit = await modules.scheduling.workOrder(id);
      if (visit?.kind !== 'inspection' || !visit.quoteRequestId) return toInbox(msg, tradie.id, 'low_confidence', answers);
      await logInbound(msg, tradie.id, issueId, true);
      await modules.quotes.recordTradieReply(visit.quoteRequestId, { kind: 'quote', text: msg.text, pdfFileId: null });
      return;
    }
    if (kind === 'work_order' && replyType === 'reschedule_request') {
      await logInbound(msg, tradie.id, issueId, true);
      return modules.scheduling.recordRescheduleRequest(id, 'tradie');
    }
    if (kind === 'work_order' && replyType === 'done') {
      // A visit is never done before it starts: the Tradie is told when it is booked for,
      // and the message is left unread for the Property Manager.
      const early = !(await modules.scheduling.hasStarted(id));
      await logInbound(msg, tradie.id, issueId, early);
      return early ? modules.scheduling.tellDoneTooEarly(id) : modules.scheduling.markDone(id);
    }
    return toInbox(msg, tradie.id, 'low_confidence', answers);
  }

  async function handleOwner(msg: Received, owner: Person, forced?: Answers) {
    const waiting = await modules.quotes.approvalsWaitingOn(owner.id);
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
    await claim(msg);
    if (!sure(answers, 'replyType')) return toInbox(msg, owner.id, 'low_confidence', answers);
    if (pick(answers, 'replyType') === 'other') return toInbox(msg, owner.id, 'other', answers);
    const ref = pick(answers, 'relatedItem');
    if (!sure(answers, 'answer') || !sure(answers, 'relatedItem') || !waiting.some((i) => i.ref === ref)) {
      return toInbox(msg, owner.id, 'low_confidence', answers);
    }
    await logInbound(msg, owner.id, await issueIdOf(ref));
    return modules.quotes.recordOwnerAnswer(Number(ref.split(':')[1]), pick(answers, 'answer') as 'yes' | 'no');
  }

  async function route(msg: Received, person: Person, forced?: Answers) {
    if (person.role === 'tenant') return handleTenant(msg, person, forced);
    if (person.role === 'tradie') return handleTradie(msg, person, forced);
    if (person.role === 'owner') return handleOwner(msg, person, forced);
    return toInbox(msg, person.id, 'other', null);
  }

  /**
   * When an address belongs to several people: the one the Agency asked most recently
   * (a pending answer, or an approval waiting on an Owner), or the Tenant when exactly
   * one of them has a Property. Otherwise the Property Manager has to pick.
   */
  async function chooseSender(people: Person[]): Promise<Person | null> {
    const waiting: { person: Person; at: string }[] = [];
    for (const person of people) {
      const at = await askedAt(person.id);
      if (at) waiting.push({ person, at });
    }
    if (waiting.length) {
      waiting.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.person.id - b.person.id));
      return waiting[0]!.person;
    }
    const tenants = people.filter((p) => p.role === 'tenant' && p.propertyId !== null);
    return tenants.length === 1 ? tenants[0]! : null;
  }

  /** When this person was last asked for a reply, if they have one waiting. */
  async function askedAt(personId: number): Promise<string | null> {
    const pending = await one<{ asked_at: string }>(
      db,
      'SELECT asked_at FROM pending_answers WHERE person_id = ? ORDER BY asked_at DESC, seq DESC LIMIT 1',
      personId,
    );
    const approval = await one<{ requested_at: string }>(
      db,
      `SELECT requested_at FROM approvals WHERE owner_id = ? AND status IN ('requested', 'reminded') ORDER BY requested_at DESC, id DESC LIMIT 1`,
      personId,
    );
    return [pending?.asked_at, approval?.requested_at].filter((at): at is string => !!at).sort().at(-1) ?? null;
  }

  // --- Background tasks ---

  worker.on<{ inboundId: number }>('intake.process', async ({ inboundId }) => {
    const msg = await received(inboundId);
    if (msg.processed) return;
    // Attachments a provider sent by URL are downloaded here, not in the webhook.
    const attachments: StoredAttachment[] = [];
    for (const a of msg.attachments) {
      if (a.fileId || !a.url) attachments.push(a);
      else attachments.push({ ...a, fileId: await files.save(msg.agencyId, { ...a, content: await ports.fetchMedia(a.url) }) });
    }
    await run(db, 'UPDATE inbound_messages SET attachments = ? WHERE id = ?', JSON.stringify(attachments), inboundId);
    msg.fileIds = attachments.map((a) => a.fileId!);

    const matches = await modules.profiles.findByAddress(msg.agencyId, msg.from);
    if (!matches.length) {
      await claim(msg);
      return toInbox(msg, null, 'unknown_sender', null);
    }
    const sender = matches.length === 1 ? matches[0]! : await chooseSender(matches);
    if (!sender) {
      await claim(msg);
      return toInbox(msg, null, 'shared_address', null);
    }
    await modules.profiles.recordInbound(sender.id, msg.channelType, msg.from, clock.now());
    // Each handler claims the message once the classifier has answered; that step alone is safe to retry.
    await route(msg, sender);
    await claim(msg);
  });

  /** Writes the Summary. A Property Manager's own edit is never overwritten. A failure throws, so the worker retries. */
  worker.on<{ issueId: number }>('intake.summarise', async ({ issueId }) => {
    const issue = await modules.tickets.issue(issueId);
    if (issue.summaryBy === 'property_manager') return;
    const { summary } = await ports.summariser.summarise({
      description: issue.description,
      answers: { location: issue.answers.location, started: issue.answers.started, worsening: issue.answers.worsening },
      trade: issue.trade,
      photoCount: (await modules.tickets.photos(issueId)).length,
    });
    // Read again: the Property Manager may have edited while the model was writing.
    if ((await modules.tickets.issue(issueId)).summaryBy === 'property_manager') return;
    await modules.tickets.updateIssue(issueId, { summary, summaryBy: 'ai' });
  });

  worker.on<{ issueId: number }>('intake.match_photos', async ({ issueId }) => {
    const issue = await modules.tickets.issue(issueId);
    if (issue.status !== 'checking' && issue.status !== 'maintenance_request') return;
    const photos = await Promise.all((await modules.tickets.photos(issueId)).map((p) => files.get(p.fileId)));
    // The check only advises the Property Manager, so a failure never holds the issue back.
    const { result, reason } = await ports.imageMatcher
      .match({ description: issue.description, photos: photos.map((p) => ({ contentType: p.contentType, content: p.content })) })
      .catch(() => ({ result: 'unclear' as const, reason: 'The photo check could not run' }));
    await modules.tickets.updateIssue(issueId, {
      imageMatch: result,
      imageMatchReason: reason,
      ...(issue.status === 'checking' ? { status: 'maintenance_request' as const } : {}),
    });
  });

  /** After 48 hours in `stage` the issue moves on marked "no photos", so nothing stalls. */
  worker.on<{ issueId: number; stage: 'gathering' | 'awaiting_photos' }>('intake.no_photos', async ({ issueId, stage }) => {
    const issue = await modules.tickets.issue(issueId);
    if (issue.status !== stage) return;
    if ((await awaitingFrom(issue.tenantId)).some((a) => a.kind === 'guided' && a.issueId === issueId)) await stopWaiting(issue.tenantId, 'guided');
    await modules.tickets.updateIssue(issueId, { status: 'maintenance_request', noPhotos: true });
  });

  // Uploads once handed their receipt over through this task, which forwarded it straight
  // to the Property Owner. A task still queued from then is now received for review.
  worker.on<{ urgentRepairId: number; fileIds: number[] }>('intake.forward_receipt', ({ urgentRepairId, fileIds }) =>
    receiveReceipt(urgentRepairId, fileIds, { via: 'upload' }),
  );

  return {
    /**
     * Stores an inbound message and leaves it for the worker. Safe to call again with the same provider message.
     * Returns false, storing nothing, when no Agency has the address the message was sent to.
     */
    async receive(message: InboundMessage): Promise<boolean> {
      const agencyId = await modules.profiles.agencyByChannel(message.channelType, message.agencyChannel);
      if (agencyId === null) return false;
      await transaction(db, async () => {
        if (await one(db, 'SELECT 1 FROM inbound_messages WHERE provider_message_id = ?', message.providerMessageId)) return;
        const attachments: StoredAttachment[] = [];
        for (const a of message.attachments) {
          attachments.push(
            'content' in a
              ? { filename: a.filename, contentType: a.contentType, fileId: await files.save(agencyId, a) }
              : { filename: a.filename, contentType: a.contentType, url: a.url },
          );
        }
        const inboundId = await run(
          db,
          `INSERT INTO inbound_messages (provider_message_id, agency_id, channel_type, sender, text, attachments, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          message.providerMessageId,
          agencyId,
          message.channelType,
          message.from,
          message.text,
          JSON.stringify(attachments),
          iso(message.receivedAt),
        );
        await worker.schedule('intake.process', { inboundId });
      });
      return true;
    },

    /** The Agency a no-login upload link belongs to; refuses a link that isn't one. */
    async uploadAgency(token: string): Promise<number> {
      const target = (await modules.tickets.issueByPhotosToken(token)) ?? (await modules.tickets.urgentRepairByToken(token));
      if (!target) notFound('Upload link');
      return target.agencyId;
    },

    /**
     * Handles photos or a receipt uploaded through a no-login link. A receipt must be
     * photos or PDFs, and may come with the amount the Tenant claims (`amountCents`,
     * ignored for photos of an issue).
     */
    async upload(token: string, uploads: { filename: string; contentType: string; content: Uint8Array }[], o: { amountCents?: number | null } = {}) {
      if (uploads.length > MAX_UPLOAD_FILES) invalid(`Upload between 1 and ${MAX_UPLOAD_FILES} files`);
      if (uploads.some((u) => u.content.byteLength > MAX_UPLOAD_BYTES)) invalid('Each file must be under 10 MB');

      const issue = await modules.tickets.issueByPhotosToken(token);
      if (issue) {
        if (!uploads.length) invalid(`Upload between 1 and ${MAX_UPLOAD_FILES} files`);
        if (!['awaiting_photos', 'checking', 'maintenance_request'].includes(issue.status)) invalid('This upload link has expired');
        if (uploads.some((u) => !PHOTO_TYPES.includes(u.contentType))) invalid('Only photos can be uploaded here (JPEG, PNG, HEIC, WebP or GIF)');
        const tenant = await modules.profiles.person(issue.tenantId);
        const property = await modules.profiles.property(issue.propertyId);
        const { timeZone } = await modules.profiles.agency(issue.agencyId);
        for (const photo of uploads) {
          await addCheckedPhoto(issue, tenant, property, timeZone, await files.save(issue.agencyId, photo), photo.content);
        }
        await modules.tickets.updateIssue(issue.id, {
          noPhotos: false,
          ...(issue.status === 'awaiting_photos' ? { status: 'checking' as const } : {}),
        });
        await worker.schedule('intake.match_photos', { issueId: issue.id });
        // New photos can change the Summary, until a Property Manager edits it.
        if (issue.summaryBy !== 'property_manager') await worker.schedule('intake.summarise', { issueId: issue.id });
        return;
      }

      const urgentRepair = await modules.tickets.urgentRepairByToken(token);
      if (!urgentRepair) notFound('Upload link');
      if (urgentRepair.status === 'reimbursed') invalid('This link has expired: the Reimbursement Request is already reimbursed');
      // The receipt is what lets the Tenant be paid back, so one must come, and only as something a person can read.
      if (!uploads.length) invalid('Add a photo or PDF of the receipt');
      if (uploads.some((u) => !RECEIPT_TYPES.includes(u.contentType))) invalid('Upload the receipt as a photo or PDF');
      if (o.amountCents != null) requireClaim(o.amountCents);
      const fileIds: number[] = [];
      for (const u of uploads) fileIds.push(await files.save(urgentRepair.agencyId, u));
      await receiveReceipt(urgentRepair.id, fileIds, { amountCents: o.amountCents ?? null, via: 'upload' });
    },

    startUrgentRepair,
    forwardReimbursement,
    markReimbursed,
    resendReceiptLink,
    expectAnswer,

    /** Stops waiting for the Tenant to confirm a visit that is no longer happening (a Site Inspection cancelled). */
    async stopWaitingOnVisit(personId: number, workOrderId: number) {
      if ((await awaitingFrom(personId)).some((a) => a.kind === 'visit' && a.workOrderId === workOrderId)) await stopWaiting(personId, 'visit');
    },

    /** Stops waiting for a pick once the offer is no longer open (the Property Manager booked, or it was superseded). */
    async stopWaitingOnVisitOffer(personId: number) {
      if ((await awaitingFrom(personId)).some((a) => a.kind === 'visit_offer')) await stopWaiting(personId, 'visit_offer');
    },

    async inbox(agencyId: number) {
      const items = await all<{ id: number; inbound_id: number; person_id: number | null; reason: InboxReason; best_guess: string | null; at: string }>(
        db,
        `SELECT * FROM inbox_items WHERE agency_id = ? AND status = 'open' ORDER BY at, id`,
        agencyId,
      );
      return Promise.all(items.map(async (item) => {
        const msg = await received(item.inbound_id);
        const candidates =
          item.reason === 'shared_address'
            ? (await modules.profiles.findByAddress(msg.agencyId, msg.from))
                .map((p) => ({ personId: p.id, name: p.name, role: p.role }))
                .sort((a, b) => a.name.localeCompare(b.name) || a.personId - b.personId)
            : [];
        return {
          itemId: item.id,
          reason: item.reason,
          from: msg.from,
          personId: item.person_id,
          personName: item.person_id === null ? null : (await modules.profiles.person(item.person_id)).name,
          text: msg.text,
          receivedAt: item.at,
          bestGuess: item.best_guess ? (JSON.parse(item.best_guess) as Record<string, string>) : null,
          candidates,
        };
      }));
    },

    /** Links an unknown sender's address to a person, so their next message is recognised. */
    async linkSender(agencyId: number, itemId: number, personId: number) {
      return transaction(db, async () => {
        const item = await openInboxItem(agencyId, itemId);
        const person = await modules.profiles.personInAgency(agencyId, personId);
        await modules.profiles.linkAddress(agencyId, person.id, (await received(item.inbound_id)).from);
        await run(db, 'UPDATE inbox_items SET person_id = ? WHERE id = ?', person.id, itemId);
      });
    },

    /** Handles an inbox message as if the classifier had given these answers: the best guess unless overridden. */
    async routeInboxItem(agencyId: number, itemId: number, overrides: Record<string, string> = {}) {
      // Resolved in a transaction before routing, so routing it twice at once handles it once.
      const item = await transaction(db, async () => {
        const item = await openInboxItem(agencyId, itemId);
        if (item.person_id === null) invalid('Link the sender to a person first');
        await run(db, `UPDATE inbox_items SET status = 'resolved' WHERE id = ?`, itemId);
        return { ...item, person_id: item.person_id };
      });
      const guesses = { ...(item.best_guess ? (JSON.parse(item.best_guess) as Record<string, string>) : {}), ...overrides };
      const forced = Object.fromEntries(Object.entries(guesses).map(([id, answer]) => [id, { answer, confidence: 1 }]));
      const msg = { ...(await received(item.inbound_id)), messageId: item.message_id };
      await route(msg, await modules.profiles.person(item.person_id), forced);
    },

    async dismissInboxItem(agencyId: number, itemId: number) {
      return transaction(db, async () => {
        await openInboxItem(agencyId, itemId);
        await run(db, `UPDATE inbox_items SET status = 'resolved' WHERE id = ?`, itemId);
      });
    },
  };

  async function openInboxItem(agencyId: number, itemId: number) {
    const item = await one<{ id: number; inbound_id: number; message_id: number; person_id: number | null; best_guess: string | null }>(
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
