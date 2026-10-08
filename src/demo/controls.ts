import type { Role } from '../shared.ts';
import type { ChannelType } from '../ports.ts';

/** A message myEST8 sent, as the simulator shows it on the recipient's phone or inbox. */
export interface DemoOutboundMessage {
  at: string;
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

/** The demo's controls: the people outside the Agency, their messages, and the clock. */
export interface DemoControls {
  contacts(): DemoContact[];
  /** Every message myEST8 sent, oldest first. */
  outbox(): DemoOutboundMessage[];
  /** Every message the simulator sent in, oldest first. */
  inbound(): DemoInboundMessage[];
  /** Sends a message in as `from` (a phone number or email) and lets the worker handle it. */
  sendAs(
    from: string,
    channel: ChannelType,
    text: string,
    attachments?: { filename: string; contentType: string; content: Uint8Array }[],
  ): Promise<void>;
  /** Moves the demo clock forward and runs every task that falls due. */
  advance(hours: number): Promise<void>;
  now(): Date;
}
