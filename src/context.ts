import type { Db } from './db.ts';
import type { Files } from './files.ts';
import type { Intake } from './intake.ts';
import type { Notifications } from './notifications.ts';
import type { Clock, Classifier, Composer, DetailExtractor, FetchMedia, Geocoder, AddressSuggester, ImageMatcher, JobFitJudge, Messenger, PlacesLookup, QuoteReader, RequestJudge, Summariser, TradeSuggester } from './ports.ts';
import type { Profiles } from './profiles.ts';
import type { Quotes } from './quotes.ts';
import type { Scheduling } from './scheduling.ts';
import type { Settings } from './shared.ts';
import type { Tickets } from './tickets.ts';
import type { Worker } from './worker.ts';

export interface Ports {
  messenger: Messenger;
  classifier: Classifier;
  imageMatcher: ImageMatcher;
  quoteReader: QuoteReader;
  summariser: Summariser;
  /** Writes the Property Manager's follow-up from their notes; null when no model is configured, and the notes stand as written. */
  composer: Composer | null;
  /**
   * Writes each outbound email from its template's facts and text (ADR 0011, `src/composing.ts`);
   * null when no model is configured, and every email is its template's text. The same model as
   * `composer` in production; a separate port so tests send template text unless they opt in.
   */
  emailComposer: Composer | null;
  /** Reads the guided details a Tenant's message states; null when no model is configured, and intake finds nothing in it (ADR 0014). */
  detailExtractor: DetailExtractor | null;
  places: PlacesLookup;
  geocoder: Geocoder;
  /** Street addresses to offer while a Property's address is typed. */
  addressSuggester: AddressSuggester;
  tradeSuggester: TradeSuggester;
  /** How well each Tradie's record fits a Job, for ranking recommendations (ADR 0016). */
  jobFitJudge: JobFitJudge;
  /**
   * How minor a Maintenance Request is, and whether the Tenant may have caused it (ADR 0018).
   * Null when no model is configured: the profile read uses only the counts code can see.
   */
  requestJudge: RequestJudge | null;
  fetchMedia: FetchMedia;
}

/** The modules, reached through their interfaces. Filled in once every module is created. */
export interface Modules {
  profiles: Profiles;
  notifications: Notifications;
  tickets: Tickets;
  intake: Intake;
  quotes: Quotes;
  scheduling: Scheduling;
}

export interface Context {
  db: Db;
  clock: Clock;
  settings: Settings;
  worker: Worker;
  files: Files;
  ports: Ports;
  modules: Modules;
}
