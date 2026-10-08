import type { Db } from './db.ts';
import type { Files } from './files.ts';
import type { Intake } from './intake.ts';
import type { Notifications } from './notifications.ts';
import type { Clock, Classifier, FetchMedia, ImageMatcher, Messenger, PlacesLookup, QuoteReader } from './ports.ts';
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
  places: PlacesLookup;
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
