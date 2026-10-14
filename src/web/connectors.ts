// What the onboarding pages can connect, as configured on this server (ADR 0004):
// an Agency's Gmail by OAuth, and the WhatsApp Cloud API number this server
// receives on. Built in the runtime from environment variables and passed down
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
  /** The WhatsApp Cloud API business number (E.164) this server receives on, or null. */
  whatsappNumber: string | null;
}

export const NO_CONNECTORS: ChannelConnectors = { gmail: null, whatsappNumber: null };
