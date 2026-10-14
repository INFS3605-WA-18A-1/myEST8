import type { Context, Modules, Ports } from './context.ts';
import type { Db } from './db.ts';
import { createFiles } from './files.ts';
import { createGmailChannel } from './gmail-channel.ts';
import type { GmailCredentials } from './gmail-credentials.ts';
import { createGoogleRatingRefresh } from './google-ratings.ts';
import { createImports, type ImportChanges, type ImportKind } from './imports.ts';
import { createIntake } from './intake.ts';
import { createNotifications } from './notifications.ts';
import { createOnboarding } from './onboarding.ts';
import type { ChannelType, Clock, InboundMessage, SmsNumbers } from './ports.ts';
import { createProfiles, type SignUp } from './profiles.ts';
import { createQuotes } from './quotes.ts';
import { createScheduling } from './scheduling.ts';
import { DEFAULT_SETTINGS, type Role, type Settings, type Trade, type Urgency } from './shared.ts';
import { createTickets } from './tickets.ts';
import { createViews } from './views.ts';
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
    /** The Agencies' Gmail connections. Without them Gmail is unavailable (docs/adr/0004). */
    gmail?: GmailCredentials | null;
    /** Buys each Agency an SMS number. Without it SMS stays simulated (docs/adr/0005). */
    smsNumbers?: SmsNumbers | null;
  },
) {
  const { db, clock } = deps;
  const settings: Settings = { ...DEFAULT_SETTINGS, ...deps.settings };
  const worker = createWorker(db, clock);
  const files = createFiles(db, clock);
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
      places: deps.places,
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
  const gmail = createGmailChannel(ctx, deps.gmail ?? null);
  const onboarding = createOnboarding(ctx, deps.smsNumbers ?? null);
  const imports = createImports(ctx, onboarding);
  const views = createViews(ctx);
  const { profiles, tickets, intake, quotes, scheduling } = modules;

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

    /** Called by the webhooks: stores the message and returns straight away. */
    receiveInbound: (message: InboundMessage) => intake.receive(message),

    /** An upload through a no-login link: issue photos or an Urgent Repair receipt. */
    upload: (token: string, uploads: Upload[]) => intake.upload(token, uploads),

    /** What a no-login upload link is for and whether it still takes files, or null for an unknown link. */
    uploadLink: (token: string) => tickets.uploadLink(token),

    /** The Tenant's progress tracker, reached by its no-login link. */
    tracker: (token: string) => tickets.tracker(token),

    /** Runs every background task that is due. */
    runWorker: () => worker.runDue(),

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
        /** The Maintenance Requests waiting for review: the Property Manager's own, or all of the Agency's. */
        requests: ({ filter = 'mine' }: { filter?: 'mine' | 'all' } = {}) => views.requests(agencyId, propertyManagerId, filter),
        /** One Maintenance Request waiting for review, or null. */
        request: (issueId: number) => views.request(agencyId, issueId),
        /** The counts on the rail, worked out once per request: Maintenance Requests to review and Quotes waiting on a Property Owner. */
        navCounts: () => views.navCounts(agencyId, propertyManagerId),
        /** Tickets by status (open by default) and optionally Urgency, most urgent first then oldest, with the counts for the filters. */
        tickets: (o: { filter?: 'mine' | 'all'; status?: 'open' | 'closed'; urgency?: Urgency | null } = {}) =>
          views.tickets(agencyId, propertyManagerId, { filter: o.filter ?? 'mine', status: o.status ?? 'open', urgency: o.urgency ?? null }),
        /** Quotes waiting on a Property Owner over the Max Repair Cost, and Urgent Repairs waiting on a receipt. */
        approvals: ({ filter = 'mine' }: { filter?: 'mine' | 'all' } = {}) => views.approvals(agencyId, propertyManagerId, filter),
        propertyOverviews: () => views.propertyOverviews(agencyId),
        property: (propertyId: number) => views.property(agencyId, propertyId),
        tradieDirectory: () => views.tradies(agencyId),
        ticket: (ticketId: number) => views.ticket(agencyId, ticketId),
        tradie: (tradieId: number) => views.tradie(agencyId, tradieId),
        /** The Dispatch map: the Agency's Properties with their open Tickets and its Tradies, each with where they are. */
        dispatch: () => views.dispatch(agencyId),
        /** Looks up again the Properties and Tradies the map couldn't place. Returns how many it placed. */
        geocodeMissing: () => profiles.geocodeMissing(agencyId),
        /** Sets where a Tradie works from, and places them on the map when the address is found. */
        setTradieAddress: (tradieId: number, address: string) => profiles.setTradieAddress(agencyId, tradieId, address),

        // Onboarding
        /** The Agency's connected channels, with when each last passed a test message. */
        channels: () => profiles.channels(agencyId),
        /** Adds a colleague as a Property Manager. Returns their id and a temporary password to pass on, shown once. */
        addColleague: (input: { name: string; email: string }) => profiles.addColleague(agencyId, input),
        connectChannel: (channelType: ChannelType, address: string) => onboarding.connectChannel(agencyId, channelType, address),
        /** Whether the Agency's Gmail is connected, needs reconnecting, or Gmail isn't set up on this server. */
        gmailStatus: () => gmail.status(agencyId),
        beginGmail: (redirectUri: string) => gmail.begin(redirectUri),
        /** Finishes the Google sign-in and connects the Agency's email channel to that Gmail address. */
        connectGmail: (o: Parameters<typeof gmail.connect>[1]) => gmail.connect(agencyId, o),
        /** Gets the Agency an SMS number of its own and connects it. Returns the number. */
        getSmsNumber: () => onboarding.getSmsNumber(agencyId),
        sendTestMessage: (channelType: ChannelType, to: string) => onboarding.sendTestMessage(agencyId, channelType, to),
        connectSimulatedChannels: (types: ChannelType[]) => onboarding.connectSimulatedChannels(agencyId, types),
        addOwner: (input: Parameters<typeof onboarding.addOwner>[1]) => onboarding.addOwner(agencyId, input),
        addBuildingManager: (input: Parameters<typeof onboarding.addBuildingManager>[1]) => onboarding.addBuildingManager(agencyId, input),
        addTenant: (input: Parameters<typeof onboarding.addTenant>[1]) => onboarding.addTenant(agencyId, input),
        addTradie: (input: Parameters<typeof onboarding.addTradie>[1]) => onboarding.addTradie(agencyId, input),
        addProperty: (input: Parameters<typeof onboarding.addProperty>[1]) => onboarding.addProperty(agencyId, input),
        /** Adds a Property with its Property Owner, any Building Manager and its Tenants, all or nothing. Returns their ids. */
        addPropertyWithPeople: (input: Parameters<typeof onboarding.addPropertyWithPeople>[1]) => onboarding.addPropertyWithPeople(agencyId, input),
        findGoogleListings: (query: string) => onboarding.findGoogleListings(query),

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
        confirmMaintenanceRequest: (issueId: number) => tickets.confirmMaintenanceRequest(agencyId, issueId),
        rejectMaintenanceRequest: (issueId: number, reason: string) => tickets.rejectMaintenanceRequest(agencyId, issueId, reason),
        changeUrgency: (target: { issueId: number } | { ticketId: number }, urgency: Urgency) =>
          tickets.changeUrgency(agencyId, target, urgency),
        setJobTrade: (jobId: number, trade: Trade) => tickets.setJobTrade(agencyId, jobId, trade),
        addJob: (ticketId: number, trade: Trade) => tickets.addJob(agencyId, ticketId, trade),
        cancelJob: (jobId: number) => tickets.cancelJob(agencyId, jobId),
        closeTicket: (ticketId: number) => tickets.closeTicket(agencyId, ticketId),
        markTicketRead: (ticketId: number) => tickets.markRead(agencyId, ticketId),

        // Quotes and approval
        sendQuoteRequests: (jobId: number, tradieIds: number[]) => quotes.sendQuoteRequests(agencyId, jobId, tradieIds),
        confirmQuote: (quoteId: number, edits?: { priceCents?: number; proposedTime?: string | null }) =>
          quotes.confirmQuote(agencyId, quoteId, edits),
        chooseQuote: (quoteId: number, reason?: string) => quotes.chooseQuote(agencyId, quoteId, reason),

        // Scheduling and completion
        calendar: (range: { from: string; to: string }) => scheduling.calendar(agencyId, range),
        freeSlots: (tradieId: number, options?: { days?: number; durationMinutes?: number }) =>
          scheduling.freeSlots(agencyId, tradieId, options),
        sendWorkOrder: (jobId: number, options?: { start?: string; durationMinutes?: number }) =>
          scheduling.sendWorkOrder(agencyId, jobId, options),
        suggestTimes: (workOrderId: number) => scheduling.suggestTimes(agencyId, workOrderId),
        acceptTime: (workOrderId: number, start: string) => scheduling.acceptTime(agencyId, workOrderId, start),
        rateTradie: (jobId: number, score: number) => scheduling.rateTradie(agencyId, jobId, score),
      };
    },
  };
}

export type App = ReturnType<typeof createApp>;
export type PropertyManagerActions = Awaited<ReturnType<App['asPropertyManager']>>;
