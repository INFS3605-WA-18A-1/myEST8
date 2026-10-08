import type { Context, Modules, Ports } from './context.ts';
import type { Db } from './db.ts';
import { createFiles } from './files.ts';
import { createIntake } from './intake.ts';
import { createNotifications } from './notifications.ts';
import { createOnboarding } from './onboarding.ts';
import type { ChannelType, Clock, InboundMessage } from './ports.ts';
import { createProfiles } from './profiles.ts';
import { createQuotes } from './quotes.ts';
import { createScheduling } from './scheduling.ts';
import { DEFAULT_SETTINGS, type Settings, type Trade, type Urgency } from './shared.ts';
import { createTickets } from './tickets.ts';
import { createViews } from './views.ts';
import { createWorker } from './worker.ts';

export type Upload = { filename: string; contentType: string; content: Uint8Array };

/**
 * The whole app behind its boundary: inbound messages, uploads through links,
 * Property Manager actions and the background worker.
 */
export function createApp(deps: Ports & { db: Db; clock: Clock; settings: Partial<Settings> & Pick<Settings, 'baseUrl'> }) {
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
  const onboarding = createOnboarding(ctx);
  const views = createViews(ctx);
  const { profiles, tickets, intake, quotes, scheduling } = modules;

  return {
    /** Creating an Agency and its Property Managers, before anyone can sign in. */
    setup: {
      createAgency: (input: { name: string; timeZone: string }) => profiles.createAgency(input),
      addPropertyManager: (agencyId: number, input: { name: string; email: string }) => profiles.addPropertyManager(agencyId, input),
    },

    /** Called by the webhooks: stores the message and returns straight away. */
    receiveInbound: (message: InboundMessage) => intake.receive(message),

    /** An upload through a no-login link: issue photos or an Urgent Repair receipt. */
    upload: (token: string, uploads: Upload[]) => intake.upload(token, uploads),

    /** The Tenant's progress tracker, reached by its no-login link. */
    tracker: (token: string) => tickets.tracker(token),

    /** Runs every background task that is due. */
    runWorker: () => worker.runDue(),

    /** Everything a signed-in Property Manager can see and do, limited to their Agency. */
    asPropertyManager(propertyManagerId: number) {
      const { agencyId } = profiles.propertyManager(propertyManagerId);
      return {
        // Screens
        dashboard: ({ filter = 'mine' }: { filter?: 'mine' | 'all' } = {}) => views.dashboard(agencyId, propertyManagerId, filter),
        ticket: (ticketId: number) => views.ticket(agencyId, ticketId),
        tradie: (tradieId: number) => views.tradie(agencyId, tradieId),

        // Onboarding
        connectChannel: (channelType: ChannelType, address: string) => onboarding.connectChannel(agencyId, channelType, address),
        sendTestMessage: (channelType: ChannelType, to: string) => onboarding.sendTestMessage(agencyId, channelType, to),
        addOwner: (input: Parameters<typeof onboarding.addOwner>[1]) => onboarding.addOwner(agencyId, input),
        addBuildingManager: (input: Parameters<typeof onboarding.addBuildingManager>[1]) => onboarding.addBuildingManager(agencyId, input),
        addTenant: (input: Parameters<typeof onboarding.addTenant>[1]) => onboarding.addTenant(agencyId, input),
        addTradie: (input: Parameters<typeof onboarding.addTradie>[1]) => onboarding.addTradie(agencyId, input),
        addProperty: (input: Parameters<typeof onboarding.addProperty>[1]) => onboarding.addProperty(agencyId, input),
        findGoogleListings: (query: string) => onboarding.findGoogleListings(query),

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
export type PropertyManagerActions = ReturnType<App['asPropertyManager']>;
