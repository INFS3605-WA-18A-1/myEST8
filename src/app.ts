import type { Context, Modules, Ports } from './context.ts';
import type { Db } from './db.ts';
import { createChannelVerification } from './channel-verification.ts';
import { createFiles } from './files.ts';
import { createGoogleRatingRefresh } from './google-ratings.ts';
import { createImports, type ImportChanges, type ImportKind } from './imports.ts';
import { createIntake, MAX_UPLOAD_FILES } from './intake.ts';
import { createNotifications } from './notifications.ts';
import { createOnboarding } from './onboarding.ts';
import type { BlobStore, ChannelType, Clock, InboundMessage } from './ports.ts';
import { createProfiles, type SignUp } from './profiles.ts';
import { createQuotes, type EstimateInput, type FirmQuoteInput } from './quotes.ts';
import { createScheduling } from './scheduling.ts';
import type { SmsNumbers } from './sms-numbers.ts';
import { DEFAULT_SETTINGS, invalid, notFound, type Role, type Settings, type Trade, type Urgency } from './shared.ts';
import { createTickets } from './tickets.ts';
import { createViews, type ListOptions } from './views.ts';
import { createWorker } from './worker.ts';

export type Upload = { filename: string; contentType: string; content: Uint8Array };

/**
 * The whole app behind its boundary: inbound messages, uploads through links,
 * Property Manager actions and the background worker.
 */
export function createApp(
  deps: Ports & {
    db: Db;
    clock: Clock;
    settings: Partial<Settings> & Pick<Settings, 'baseUrl'>;
    blobs?: BlobStore | null;
    /** Setting up an Agency's own Twilio SMS number (ADR 0005). Null where this server doesn't offer it. */
    smsNumbers?: SmsNumbers | null;
  },
) {
  const { db, clock } = deps;
  const settings: Settings = { ...DEFAULT_SETTINGS, ...deps.settings };
  const worker = createWorker(db, clock);
  const files = createFiles(db, clock, deps.blobs ?? null);
  const modules = {} as Modules;
  const ctx: Context = {
    db,
    clock,
    settings,
    worker,
    files,
    ports: {
      messenger: deps.messenger,
      classifier: deps.classifier,
      imageMatcher: deps.imageMatcher,
      quoteReader: deps.quoteReader,
      summariser: deps.summariser,
      composer: deps.composer,
      places: deps.places,
      geocoder: deps.geocoder,
      addressSuggester: deps.addressSuggester,
      tradeSuggester: deps.tradeSuggester,
      fetchMedia: deps.fetchMedia,
    },
    modules,
  };
  modules.profiles = createProfiles(ctx);
  modules.notifications = createNotifications(ctx);
  modules.tickets = createTickets(ctx);
  modules.intake = createIntake(ctx);
  modules.quotes = createQuotes(ctx);
  modules.scheduling = createScheduling(ctx);
  createGoogleRatingRefresh(ctx);
  const onboarding = createOnboarding(ctx);
  const verification = createChannelVerification(ctx);
  const imports = createImports(ctx, onboarding);
  const views = createViews(ctx);
  const { profiles, tickets, intake, quotes, scheduling } = modules;
  const smsNumbers = deps.smsNumbers ?? null;
  const sms = () => smsNumbers ?? invalid("This server doesn't set up SMS numbers");

  return {
    /** Creating an Agency and its Property Managers, before anyone can sign in. */
    setup: {
      createAgency: (input: { name: string; timeZone: string }) => profiles.createAgency(input),
      addPropertyManager: (agencyId: number, input: { name: string; email: string; password?: string }) =>
        profiles.addPropertyManager(agencyId, input),
    },

    /**
     * A new Agency signs up: creates the Agency and its first Property Manager
     * together. Refuses bad input field by field (ActionError.fields), including
     * "An account with that email already exists". Returns the Property Manager's id.
     */
    signUp: (input: SignUp) => profiles.signUp(input),

    /** Checks a Property Manager's email and password. Returns their id, or null. */
    login: (email: string, password: string) => profiles.verifyLogin(email, password),

    /** Called by the webhooks: stores the message and returns straight away. False when no Agency has the address it was sent to. */
    receiveInbound: (message: InboundMessage): Promise<boolean> => intake.receive(message),

    /** A WhatsApp delivery failure from Meta, recorded on the outbound message. */
    recordDeliveryFailure: (failure: { to: string; code: number; title: string }) => tickets.recordDeliveryFailure(failure),

    /**
     * An upload through a no-login link: issue photos, or the receipt for a
     * Reimbursement Request (photos or PDFs) with the amount the Tenant claims, if given.
     */
    upload: (token: string, uploads: Upload[], o?: { amountCents?: number | null }) => intake.upload(token, uploads, o),

    /**
     * Where a browser can send the files of a no-login upload straight to storage,
     * past the function's request size limit: one URL per file, or null when files
     * are kept in the database. Refuses a link that isn't an upload link.
     */
    async uploadSlots(token: string, count: number) {
      if (!Number.isInteger(count) || count < 1 || count > MAX_UPLOAD_FILES) invalid(`Upload between 1 and ${MAX_UPLOAD_FILES} files`);
      return files.stage(await intake.uploadAgency(token), count);
    },

    /** Finishes an upload sent to the slots from `uploadSlots`: collects the files, then handles them like `upload`. */
    async completeUpload(token: string, sent: { path: string; filename: string; contentType: string }[], o?: { amountCents?: number | null }) {
      const agencyId = await intake.uploadAgency(token);
      const uploads: Upload[] = [];
      for (const f of sent) uploads.push({ filename: f.filename, contentType: f.contentType, content: await files.take(agencyId, f.path) });
      await intake.upload(token, uploads, o);
    },

    /** What a no-login upload link is for and whether it still takes files, or null for an unknown link. */
    uploadLink: (token: string) => tickets.uploadLink(token),

    /** The Tradie's quote page, reached by the no-login link in their Quote Request: what it is for and where it stands, or null. */
    quotePage: (token: string) => quotes.quotePage(token),

    /** The Tradie's Estimate from their quote page. Refuses field by field (ActionError.fields); not_found for an unknown link. */
    async submitEstimate(token: string, input: EstimateInput) {
      const id = (await quotes.requestIdByToken(token)) ?? notFound('Quote Request');
      await quotes.submitEstimate(id, input);
    },

    /** The Tradie's Firm Quote from their quote page, with an optional PDF. Refuses field by field; not_found for an unknown link. */
    async submitFirmQuote(token: string, input: FirmQuoteInput) {
      const id = (await quotes.requestIdByToken(token)) ?? notFound('Quote Request');
      await quotes.submitFirmQuote(id, input);
    },

    /** The Tenant's progress tracker, reached by its no-login link. */
    tracker: (token: string) => tickets.tracker(token),

    /** Runs every background task that is due. */
    runWorker: (options?: { budgetMs?: number }) => worker.runDue(options),

    /** A stored file, for a signed file link (src/file-links.ts): the checked signature is the access control. */
    linkedFile: (fileId: number) => files.get(fileId),

    /**
     * Everything a signed-in Property Manager can see and do, limited to their
     * Agency. Refuses (not_found) a Property Manager who doesn't exist. Who they
     * are and their Agency are read once, here, so `me()` and `agency()` answer
     * straight away; everything else reads the database when called.
     */
    async asPropertyManager(propertyManagerId: number) {
      const me = await profiles.propertyManager(propertyManagerId);
      const { agencyId } = me;
      const agency = await profiles.agency(agencyId);
      return {
        // Screens
        me: () => me,
        /** The app's clock, which the demo can move forward. */
        now: () => clock.now(),
        agency: () => agency,
        propertyManagers: () => profiles.propertyManagers(agencyId),
        properties: () => profiles.properties(agencyId),
        people: (role?: Role) => profiles.people(agencyId, role),
        /** A photo, receipt or PDF Quote stored for the Agency, or null. */
        file: (fileId: number) => files.getInAgency(agencyId, fileId),
        dashboard: ({ filter = 'mine' }: { filter?: 'mine' | 'all' } = {}) => views.dashboard(agencyId, propertyManagerId, filter),
        /** The Maintenance Requests waiting for review: the Property Manager's own (the default) or all of the Agency's, optionally by Urgency, Trade and Property. */
        requests: (o: Partial<ListOptions> = {}) => views.requests(agencyId, propertyManagerId, { ...o, filter: o.filter ?? 'mine' }),
        /** One Maintenance Request waiting for review, or null. */
        request: (issueId: number) => views.request(agencyId, issueId),
        /** Tickets by status (open by default, or closed for the Archive), optionally by Urgency, Trade and Property. */
        tickets: (o: Partial<ListOptions> & { status?: 'open' | 'closed' } = {}) =>
          views.tickets(agencyId, propertyManagerId, { ...o, filter: o.filter ?? 'mine', status: o.status ?? 'open' }),
        /** Quotes waiting on a Property Owner over the Max Repair Cost, and every Reimbursement Request not yet reimbursed. */
        approvals: ({ filter = 'mine' }: { filter?: 'mine' | 'all' } = {}) => views.approvals(agencyId, propertyManagerId, filter),
        /** One Reimbursement Request (by its Urgent Repair's id) with its receipts, timeline and messages. Refuses (not_found) one outside the Agency. */
        reimbursement: (urgentRepairId: number) => views.reimbursement(agencyId, urgentRepairId),
        propertyOverviews: () => views.propertyOverviews(agencyId),
        property: (propertyId: number) => views.property(agencyId, propertyId),
        tradieDirectory: () => views.tradies(agencyId),
        /** The Dispatch map: the Agency's Properties with their open Tickets and its Tradies, each with where they are. */
        dispatch: () => views.dispatch(agencyId),
        /** Looks up again the Properties and Tradies the map couldn't place. Returns how many it placed. */
        geocodeMissing: () => profiles.geocodeMissing(agencyId),
        /** Sets where a Tradie works from, and places them on the map when the address is found. */
        setTradieAddress: (tradieId: number, address: string) => profiles.setTradieAddress(agencyId, tradieId, address),
        ticket: (ticketId: number) => views.ticket(agencyId, ticketId),
        tradie: (tradieId: number) => views.tradie(agencyId, tradieId),
        /** The Tenants by name, each with their Property and open Tickets: those of the Property Manager's own Properties, or all of the Agency's. */
        tenants: ({ filter = 'mine' }: { filter?: 'mine' | 'all' } = {}) => views.tenants(agencyId, propertyManagerId, filter),
        /** A Tenant's profile: their Property, contact details, Tickets, Maintenance Requests waiting and Reimbursement Requests. */
        tenant: (tenantId: number) => views.tenant(agencyId, tenantId),
        /** The counts beside Requests and Approvals in the rail. */
        navCounts: () => views.navCounts(agencyId, propertyManagerId),

        // Onboarding
        /** The Agency's connected channels. `testedAt` is when a code or a first inbound email verified the address. */
        channels: () => profiles.channels(agencyId),
        /** Adds a colleague as a Property Manager. Returns their id and a temporary password to pass on, shown once. */
        addColleague: (input: { name: string; email: string }) => profiles.addColleague(agencyId, input),
        /** Stores an address the caller has already proved: the demo seed, Gmail OAuth, or a confirmed code. */
        connectChannel: (channelType: ChannelType, address: string) => onboarding.connectChannel(agencyId, channelType, address),
        /** Sends a 6-digit code. The typed address is not stored until confirmChannelVerification. */
        startChannelVerification: (channelType: ChannelType, address: string) => verification.start(agencyId, channelType, address),
        confirmChannelVerification: (channelType: ChannelType, address: string, code: string) => verification.confirm(agencyId, channelType, address, code),
        pendingChannelVerifications: () => verification.pending(agencyId),
        ensureInboundEmail: () => verification.ensureInboundEmail(agencyId),
        sendTestMessage: (channelType: ChannelType, to: string) => onboarding.sendTestMessage(agencyId, channelType, to),

        // The Agency's own SMS number on Twilio (ADR 0005)
        /** Where the Agency's SMS number stands, or null when this server doesn't set up SMS numbers. */
        smsNumber: async () => (smsNumbers ? smsNumbers.status(agencyId) : null),
        /** Buys an Australian mobile number for the Agency on the server's Twilio account and connects it as its SMS channel. Asking again returns the same number. */
        createSmsNumber: async () => {
          const number = await sms().create(agencyId);
          await onboarding.connectChannel(agencyId, 'sms', number, { verified: true });
          return number;
        },
        /** Checks the Agency's own Twilio Account SID and Auth Token with Twilio and keeps them, encrypted. Returns how many SMS-capable numbers the account has. */
        checkTwilioAccount: (accountSid: string, authToken: string) => sms().checkAccount(agencyId, accountSid, authToken),
        /** The SMS-capable numbers on the Twilio account the Agency gave, to pick from. */
        twilioNumbers: async () => (await sms().offered(agencyId)) ?? [],
        /** Points the chosen number's incoming texts at myEST8 and connects it as the Agency's SMS channel. */
        registerTwilioNumber: async (numberSid: string) => {
          const number = await sms().register(agencyId, numberSid);
          await onboarding.connectChannel(agencyId, 'sms', number, { verified: true });
          return number;
        },
        /** Disconnects the Agency's SMS number: a created one is released on Twilio, a registered one is only unlinked. */
        releaseSmsNumber: async () => {
          const { number } = await sms().status(agencyId);
          await sms().release(agencyId);
          if (number) await onboarding.disconnectChannel(agencyId, 'sms', number.phoneNumber);
        },
        addOwner: (input: Parameters<typeof onboarding.addOwner>[1]) => onboarding.addOwner(agencyId, input),
        addBuildingManager: (input: Parameters<typeof onboarding.addBuildingManager>[1]) => onboarding.addBuildingManager(agencyId, input),
        addTenant: (input: Parameters<typeof onboarding.addTenant>[1]) => onboarding.addTenant(agencyId, input),
        /** Takes a Tenant off their Property, keeping their past Tickets. Refuses while they have an open Ticket or a waiting Maintenance Request. Returns their name. */
        removeTenant: (tenantId: number) => onboarding.removeTenant(agencyId, tenantId),
        addTradie: (input: Parameters<typeof onboarding.addTradie>[1]) => onboarding.addTradie(agencyId, input),
        addProperty: (input: Parameters<typeof onboarding.addProperty>[1]) => onboarding.addProperty(agencyId, input),
        findGoogleListings: (query: string) => onboarding.findGoogleListings(query),
        /** A Google listing's details and the Trades Jev suggests for it, to fill in the Tradie form. Stores nothing. */
        googleListing: (placeId: string) => onboarding.googleListing(placeId),
        /** Street addresses matching what was typed, for the Property form. An empty list when the lookup fails. */
        suggestAddresses: (query: string) => ctx.ports.addressSuggester.suggest(query),

        // Importing from a spreadsheet: upload, review, then add
        /** Reads an .xlsx or .csv of Property Owners, Building Managers, Tradies, Properties or Tenants and keeps it for review. Returns its token. */
        importSheet: (kind: ImportKind, upload: Upload) => imports.start(agencyId, propertyManagerId, kind, upload),
        /** The upload's columns and rows, each row ready, needing a fix, or a duplicate. Only the Property Manager who uploaded it can see it. */
        importPreview: (token: string) => imports.preview(agencyId, propertyManagerId, token),
        /** Sets what each column of the upload holds: a field, or null to ignore it. */
        remapImport: (token: string, fields: (string | null)[]) => imports.remap(agencyId, propertyManagerId, token, fields),
        /** Keeps the review's ticked rows and edited cells. */
        reviseImport: (token: string, changes: ImportChanges) => imports.revise(agencyId, propertyManagerId, token, changes),
        /** Adds the ticked rows through the add actions above, and reports the rows it couldn't add. */
        confirmImport: (token: string, changes: ImportChanges) => imports.confirm(agencyId, propertyManagerId, token, changes),
        discardImport: (token: string) => imports.discard(agencyId, propertyManagerId, token),

        // Inbox
        linkSender: (itemId: number, personId: number) => intake.linkSender(agencyId, itemId, personId),
        routeInboxItem: (itemId: number, overrides?: Record<string, string>) => intake.routeInboxItem(agencyId, itemId, overrides),
        dismissInboxItem: (itemId: number) => intake.dismissInboxItem(agencyId, itemId),

        // Maintenance Requests and Tickets
        /** Confirms a Maintenance Request into a Ticket and Job; `edits.summary`, when not blank, replaces the Summary. */
        confirmMaintenanceRequest: (issueId: number, edits?: { summary?: string }) => tickets.confirmMaintenanceRequest(agencyId, issueId, edits),
        /** Edits a Maintenance Request's or Ticket's Summary without confirming it. The model never overwrites an edit. */
        editSummary: (target: { issueId: number } | { ticketId: number }, summary: string) => tickets.editSummary(agencyId, target, summary),
        rejectMaintenanceRequest: (issueId: number, reason: string) => tickets.rejectMaintenanceRequest(agencyId, issueId, reason),
        /**
         * Writes the notes up as a message to the Maintenance Request's Tenant, from the facts and nothing else,
         * for the Property Manager to check. `byAI` is false when the model isn't there or fails and the notes
         * come back as written. Refuses (field `notes`) blank notes or over 1000 characters. Sends nothing.
         */
        draftFollowUp: (issueId: number, notes: string) => tickets.draftFollowUp(agencyId, propertyManagerId, issueId, notes),
        /** Sends the Tenant the checked follow-up, as it stands, on their usual channel. Refuses (field `text`) blank text or over 4000 characters. Returns the Tenant's name. */
        sendFollowUp: (issueId: number, text: string) => tickets.sendFollowUp(agencyId, issueId, text),
        changeUrgency: (target: { issueId: number } | { ticketId: number }, urgency: Urgency) =>
          tickets.changeUrgency(agencyId, target, urgency),
        setJobTrade: (jobId: number, trade: Trade) => tickets.setJobTrade(agencyId, jobId, trade),
        addJob: (ticketId: number, trade: Trade) => tickets.addJob(agencyId, ticketId, trade),
        cancelJob: (jobId: number) => tickets.cancelJob(agencyId, jobId),
        closeTicket: (ticketId: number) => tickets.closeTicket(agencyId, ticketId),
        markTicketRead: (ticketId: number) => tickets.markRead(agencyId, ticketId),

        // Reimbursement Requests
        /**
         * Forwards a checked receipt to the Property Owner (email when they have one, the
         * Property Manager copied in), with `amountCents` replacing the Tenant's amount.
         * From Awaiting your review, or again once forwarded.
         */
        forwardReimbursement: (urgentRepairId: number, o: { amountCents?: number | null } = {}) => intake.forwardReimbursement(agencyId, urgentRepairId, o),
        /** Records that the Property Owner paid the Tenant back, and tells the Tenant. Only once forwarded. */
        markReimbursed: (urgentRepairId: number) => intake.markReimbursed(agencyId, urgentRepairId),
        /** Sends the Tenant the receipt link again, while the receipt is still to come. */
        resendReceiptLink: (urgentRepairId: number) => intake.resendReceiptLink(agencyId, urgentRepairId),
        async markReimbursementRead(urgentRepairId: number) {
          await tickets.markIssueRead((await tickets.urgentRepairInAgency(agencyId, urgentRepairId)).issueId);
        },

        // Quotes and approval
        sendQuoteRequests: (jobId: number, tradieIds: number[]) => quotes.sendQuoteRequests(agencyId, jobId, tradieIds),
        confirmQuote: (quoteId: number, edits?: { priceCents?: number; proposedTime?: string | null }) =>
          quotes.confirmQuote(agencyId, quoteId, edits),
        /** Chooses a Firm Quote. An Estimate is refused: proceed on it instead. */
        chooseQuote: (quoteId: number, reason?: string) => quotes.chooseQuote(agencyId, quoteId, reason),
        /** Goes ahead on an Estimate with a Not-to-exceed Cap, for a routine Job whose Tradie needs no Site Inspection. */
        proceedOnEstimate: (quoteId: number, options: { capCents: number; reason?: string; confirm?: boolean }) =>
          quotes.proceedOnEstimate(agencyId, quoteId, options),
        /** Enters a Firm Quote the Tradie sent another way (a PDF by email, say), checked as one from their quote page. */
        enterFirmQuote: (quoteRequestId: number, input: FirmQuoteInput) => quotes.enterFirmQuote(agencyId, quoteRequestId, input),

        // Scheduling and completion
        calendar: (range: { from: string; to: string }) => scheduling.calendar(agencyId, range),
        freeSlots: (tradieId: number, options?: { days?: number; durationMinutes?: number }) =>
          scheduling.freeSlots(agencyId, tradieId, options),
        sendWorkOrder: (jobId: number, options?: { start?: string; durationMinutes?: number }) =>
          scheduling.sendWorkOrder(agencyId, jobId, options),
        suggestTimes: (workOrderId: number) => scheduling.suggestTimes(agencyId, workOrderId),
        acceptTime: (workOrderId: number, start: string) => scheduling.acceptTime(agencyId, workOrderId, start),
        rateTradie: (jobId: number, score: number) => scheduling.rateTradie(agencyId, jobId, score),

        // Site Inspections, one Tradie at a time
        /** For each Tradie who needs a Site Inspection not booked yet, three free one-hour slots to prefill booking it. */
        inspectionSlots: (jobId: number) => scheduling.inspectionSlots(agencyId, jobId),
        /** Books a Tradie's Site Inspection once they have given an Estimate; they and the Tenant are told. Returns the Work Order's id. */
        bookInspection: (quoteRequestId: number, options: { start: string; durationMinutes?: number }) =>
          scheduling.bookInspection(agencyId, quoteRequestId, options),
        /** Overrides whether the Tradie needs a Site Inspection before their Firm Quote. */
        setInspectionNeeded: (quoteRequestId: number, needed: boolean) => quotes.setInspectionNeeded(agencyId, quoteRequestId, needed),
        /** Marks a Site Inspection done; the Tradie is asked for their Firm Quote. */
        markInspected: (workOrderId: number) => scheduling.markInspectedForAgency(agencyId, workOrderId),
        quoteRequestRule: (jobId: number) => quotes.quoteRequestRule(agencyId, jobId),
      };
    },
  };
}

export type App = ReturnType<typeof createApp>;
export type PropertyManagerActions = Awaited<ReturnType<App['asPropertyManager']>>;
