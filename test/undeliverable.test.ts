import { describe, expect, test } from 'vitest';
import { one } from '../src/db.ts';
import { UndeliverableError, type OutboundMessage } from '../src/ports.ts';
import { HOUR, type Harness } from './support/harness.ts';
import { TOM, world } from './support/world.ts';

const intakeTask = (h: Harness) =>
  one<{ status: string; attempts: number; last_error: string }>(h.db, `SELECT status, attempts, last_error FROM tasks WHERE kind = 'intake.process' ORDER BY id DESC LIMIT 1`);

describe('a recipient the provider refuses', () => {
  test('fails the task at once, with a clear error, instead of retrying it', async () => {
    const { h } = await world();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    const send = h.messenger.send.bind(h.messenger);
    h.messenger.send = async (message: OutboundMessage) => {
      if (message.to !== TOM) return send(message);
      throw new UndeliverableError(message.channelType, message.to, "Twilio 21614 'To' number is not a valid mobile number");
    };

    await expect(h.receive(TOM, 'The kitchen tap is dripping')).rejects.toThrow(
      "Undeliverable sms message to +61400000001: Twilio 21614 'To' number is not a valid mobile number",
    );
    expect(await intakeTask(h)).toMatchObject({ status: 'failed', attempts: 1, last_error: expect.stringContaining('UndeliverableError') });
  });

  test('a provider outage leaves the task to be retried', async () => {
    const { h } = await world();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    h.messenger.failures = 1;

    await expect(h.receive(TOM, 'The kitchen tap is dripping')).rejects.toThrow('provider unavailable');
    expect(await intakeTask(h)).toMatchObject({ status: 'pending', attempts: 1 });
    await h.advance(HOUR);
    expect(await intakeTask(h)).toMatchObject({ status: 'done' });
  });
});
