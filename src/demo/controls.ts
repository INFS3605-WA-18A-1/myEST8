import type { Role } from '../shared.ts';
import type { ChannelType } from '../ports.ts';

/** A message myEST8 sent, as the simulator shows it on the recipient's phone or inbox. */
export interface DemoOutboundMessage {
  at: string;
  /** The Agency channel address it was sent from. */
  from: string;
  to: string;
  cc: string[];
  channel: ChannelType;
  template: string;
  subject: string;
  text: string;
  attachments: string[];
}

/** A message the simulator sent in, as someone outside the Agency. */
export interface DemoInboundMessage {
  at: string;
  from: string;
  /** The Agency channel address it was sent to. */
  to: string;
  channel: ChannelType;
  text: string;
  attachments: string[];
}

/** Someone outside the Agency the simulator can act as. */
export interface DemoContact {
  personId: number;
  name: string;
  role: Role;
  mobile: string | null;
  email: string | null;
}

/**
 * The demo's controls: the people outside an Agency, their messages, and the
 * clock. Everything but the clock is limited to the Agency of the Property
 * Manager running the simulator, named by `propertyManagerId`, so every Agency
 * that signs up to the demo has its own simulator.
 */
export interface DemoControls {
  /** Everyone outside the Agency the simulator can act as. */
  contacts(propertyManagerId: number): DemoContact[];
  /** Every message myEST8 sent from the Agency's channels, oldest first. */
  outbox(propertyManagerId: number): DemoOutboundMessage[];
  /** Every message the simulator sent in to the Agency's channels, oldest first. */
  inbound(propertyManagerId: number): DemoInboundMessage[];
  /**
   * Sends a message in as `from` (a phone number or email) to the Agency's own
   * address on `channel`, and lets the worker handle it. Refuses with an
   * ActionError when the Agency hasn't connected that channel.
   */
  sendAs(
    propertyManagerId: number,
    from: string,
    channel: ChannelType,
    text: string,
    attachments?: { filename: string; contentType: string; content: Uint8Array }[],
  ): Promise<void>;
  /** Moves the demo clock forward and runs every task that falls due. */
  advance(hours: number): Promise<void>;
  now(): Date;
}
