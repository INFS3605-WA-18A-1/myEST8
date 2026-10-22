import type { ChannelType } from '../ports.ts';

// What the onboarding pages can connect, as configured on this server (ADR 0004):
// an Agency's Gmail by OAuth. Built in the runtime from environment variables and passed down
// to the pages; null where the provider isn't configured.

/** Connecting an Agency's Gmail: the OAuth round trip and the connection's state. */
export interface GmailConnector {
  /** Google's consent page for this server's OAuth client, carrying `state` back to the callback. */
  authUrl(state: string): string;
  /** Exchanges the callback's code, stores the encrypted refresh token and returns the mailbox address. */
  connect(agencyId: number, code: string): Promise<{ address: string }>;
  /** Forgets the Agency's mailbox (myEST8 stops reading and sending as it). */
  disconnect(agencyId: number): Promise<void>;
  /** The Agency's mailbox, or null: `reconnect` when Google refused the stored token. */
  status(agencyId: number): Promise<{ address: string; status: 'connected' | 'reconnect' } | null>;
}

export interface ChannelConnectors {
  gmail: GmailConnector | null;
  /**
   * Channels this server can't deliver on (hosted with no SMS provider, no inbound email),
   * decided in the runtime where providers are chosen. The pages don't offer them.
   */
  unavailable: ChannelType[];
  /**
   * Whether a Tenant's text to the Agency's own verified mobile number reaches myEST8:
   * only in the demo, where the phone simulator stands in. Hosted, inbound SMS arrives at the
   * provider's number, so a typed number only proves who the Agency is.
   */
  smsInbound: 'simulator' | 'none';
  /**
   * The server's one SMS phone (textbee, ADR 0013), E.164, or null when this server
   * has none. The Channels pages offer Connect SMS for it and don't read the environment.
   * While it is set, the typed number and code and the Twilio panel are not offered.
   */
  smsPhone: string | null;
}

/** Nothing connectable, and every channel assumed deliverable: the default for tests and the plain web app. */
export const NO_CONNECTORS: ChannelConnectors = { gmail: null, unavailable: [], smsInbound: 'simulator', smsPhone: null };
