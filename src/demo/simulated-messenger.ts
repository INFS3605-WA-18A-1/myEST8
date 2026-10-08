import type { Clock, Messenger, OutboundMessage } from '../ports.ts';
import type { DemoOutboundMessage } from './controls.ts';

/** A Messenger that delivers nothing: it keeps every message in memory for the phone simulator to show. */
export class SimulatedMessenger implements Messenger {
  readonly #clock: Clock;
  readonly #messages: DemoOutboundMessage[] = [];
  readonly #onSend: ((message: DemoOutboundMessage) => void) | undefined;

  constructor(clock: Clock, onSend?: (message: DemoOutboundMessage) => void) {
    this.#clock = clock;
    this.#onSend = onSend;
  }

  async send(message: OutboundMessage) {
    const sent: DemoOutboundMessage = {
      at: this.#clock.now().toISOString(),
      to: message.to,
      cc: [...message.cc],
      channel: message.channelType,
      template: message.template,
      subject: message.subject,
      text: message.text,
      attachments: message.attachments.map((a) => a.filename),
    };
    this.#messages.push(sent);
    this.#onSend?.(sent);
  }

  /** Every message sent, oldest first. */
  messages(): DemoOutboundMessage[] {
    return [...this.#messages];
  }
}
