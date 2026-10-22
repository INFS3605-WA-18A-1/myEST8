// What Postgres changes: requests now interleave. On SQLite each action ran
// synchronously, so nothing else could happen between a check and the write it
// guarded. These tests run the same thing twice at once and check it happens once.

import { describe, expect, test } from 'vitest';
import { all, one } from '../src/db.ts';
import type { InboundMessage } from '../src/ports.ts';
import { ActionError } from '../src/shared.ts';
import { AGENCY_NUMBER } from './support/harness.ts';
import { signUpFields, webWorld } from './support/web.ts';
import { confirmedQuotes, jobView, TOM, tomsTapTicket, world } from './support/world.ts';

describe('two things at once', () => {
  test('two Quotes chosen for one Job at once: one is approved, the other is refused', async () => {
    const w = await world();
    const { h, alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [finn, pete] = await confirmedQuotes(w, job, [
      [tradies.finn, 300_00],
      [tradies.pete, 420_00],
    ]);

    const results = await Promise.allSettled([alice.chooseQuote(finn!.quoteId), alice.chooseQuote(pete!.quoteId)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [refused] = results.filter((r) => r.status === 'rejected');
    expect(refused!.reason).toBeInstanceOf(ActionError);
    const view = await jobView(w, job);
    expect(view.status).toBe('approved');
    expect(view.quotes.filter((q) => q.status === 'approved')).toHaveLength(1);
    const ticket = await alice.ticket(job.ticketId);
    expect(ticket.timeline.filter((e) => e.kind === 'quote_approved')).toHaveLength(1);
    expect(ticket.repairCostCents).toBe(view.quotes.find((q) => q.status === 'approved')!.priceCents);
    // The Tradie passed over is told once.
    const notChosen = [tradies.finn, tradies.pete].flatMap((t) => h.messenger.templatesTo(t.address)).filter((t) => t === 'tradie.not_chosen');
    expect(notChosen).toHaveLength(1);
  });

  test('the same Quote chosen twice at once is approved once', async () => {
    const w = await world();
    const { alice, tradies } = w;
    const job = await tomsTapTicket(w);
    const [finn] = await confirmedQuotes(w, job, [
      [tradies.finn, 300_00],
      [tradies.pete, 420_00],
    ]);

    const results = await Promise.allSettled([alice.chooseQuote(finn!.quoteId), alice.chooseQuote(finn!.quoteId)]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const ticket = await alice.ticket(job.ticketId);
    expect(ticket.timeline.filter((e) => e.kind === 'quote_chosen')).toHaveLength(1);
    expect(ticket.timeline.filter((e) => e.kind === 'quote_approved')).toHaveLength(1);
  });

  test('two webhooks for the same message store it once and handle it once', async () => {
    const w = await world();
    const { h } = w;
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    const message: InboundMessage = {
      providerMessageId: 'SM-twice',
      agencyChannel: AGENCY_NUMBER,
      channelType: 'sms',
      from: TOM,
      text: 'The kitchen tap is dripping',
      attachments: [{ filename: 'tap.jpg', contentType: 'image/jpeg', content: new Uint8Array([1, 2, 3]) }],
      receivedAt: h.clock.now(),
    };

    await Promise.all([h.app.receiveInbound(message), h.app.receiveInbound(message), h.app.receiveInbound(message)]);
    // Two worker runs at once, as the demo's loop and a request can: neither takes the other's task.
    await Promise.all([h.drain(), h.drain()]);

    expect(await all(h.db, 'SELECT id FROM inbound_messages')).toHaveLength(1);
    expect(await all(h.db, 'SELECT id FROM files')).toHaveLength(1);
    expect(await all(h.db, `SELECT id FROM tasks WHERE kind = 'intake.process'`)).toHaveLength(1);
    expect(h.messenger.templatesTo(TOM)).toEqual(['tenant.acknowledgement', 'tenant.missing_details']);
    expect((await w.alice.dashboard({ filter: 'all' })).inbox).toEqual([]);
  });

  test('two sign-ups with one email at once: one account, and the other is told the email is taken', async () => {
    const w = await webWorld();
    const { app } = w.h;
    const input = { agencyName: 'Sunrise Realty', timeZone: 'Australia/Brisbane', name: 'Sam Sun', email: signUpFields().email, password: 'sunrise-2026' };

    const results = await Promise.allSettled([app.signUp(input), app.signUp({ ...input, agencyName: 'Sunset Realty' })]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: 'conflict', fields: { email: 'An account with that email already exists' } });
    expect(await one(w.h.db, `SELECT count(*) AS n FROM agencies WHERE name IN ('Sunrise Realty', 'Sunset Realty')`)).toEqual({ n: 1 });
  });
});
