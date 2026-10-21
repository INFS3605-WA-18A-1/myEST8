import type { Db } from './db.ts';
import type { Files } from './files.ts';
import type { Intake } from './intake.ts';
import type { Notifications } from './notifications.ts';
import type { Clock, Classifier, Composer, FetchMedia, Geocoder, ImageMatcher, Messenger, PlacesLookup, QuoteReader, Summariser, TradeSuggester } from './ports.ts';
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
  places: PlacesLookup;
  geocoder: Geocoder;
  tradeSuggester: TradeSuggester;
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
