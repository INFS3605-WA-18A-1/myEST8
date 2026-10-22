import { describe, expect, test } from 'vitest';
import { all } from '../src/db.ts';
import { HOUR } from './support/harness.ts';
import { upload } from './support/photos.ts';
import { KING_ST, TOM, world } from './support/world.ts';

type World = Awaited<ReturnType<typeof world>>;

const NOTES = 'Is it still dripping? Can you turn the water off at the meter?';

/** Tom reports a dripping tap and uploads a photo, so it is a Maintenance Request waiting for review. Returns its issue id. */
async function tomsRequest({ h, alice }: World, channel: 'sms' | 'whatsapp' = 'sms') {
  h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
  await h.receive(TOM, 'The kitchen tap is dripping', { channel });
  await h.answerAll(TOM, { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' }, { channel });
  await h.upload(h.messenger.last(TOM)!.data.uploadLink as string, [upload('tap.jpg')]);
  return (await alice.dashboard()).maintenanceRequests[0]!.issueId;
}

/** A Property Manager of another Agency. Returns the id, not the actions: a Proxy can't be the result of an async function. */
async function elsewhere({ h }: World) {
  const agencyId = await h.app.setup.createAgency({ name: 'Elsewhere Realty', timeZone: 'Australia/Sydney' });
  return h.app.setup.addPropertyManager(agencyId, { name: 'Eve Else', email: 'eve@elsewhere.example', password: 'correct horse battery' });
}

describe('drafting a follow-up', () => {
  test('asks the composer to write the notes up, from the facts and with the Tenant\'s words as untrusted', async () => {
    const w = await world();
    const { h, alice } = w;
    const issueId = await tomsRequest(w);

    const draft = await alice.draftFollowUp(issueId, NOTES);

    expect(draft).toEqual({ text: `Composed: ${NOTES}`, byAI: true });
    expect(h.composer.calls).toEqual([
      {
        template: 'tenant.follow_up',
        purpose: 'A Property Manager following up with the Tenant about their Maintenance Request',
        recipientRole: 'tenant',
        channel: 'sms',
        agencyName: 'Harbour Realty',
        facts: {
          tenantName: 'Tom Tran',
          propertyAddress: KING_ST,
          request: 'Summary: The kitchen tap is dripping',
          propertyManagerName: 'Alice Archer',
          notes: NOTES,
        },
        untrustedFields: ['request'],
        draft: NOTES,
        mustInclude: [],
      },
    ]);
    expect(h.messenger.to(TOM).map((m) => m.template)).not.toContain('tenant.follow_up');
  });

  test('uses the Tenant\'s channel, and their own description when there is no Summary yet', async () => {
    const w = await world();
    const { h, alice } = w;
    h.summariser.next = new Error('Claude is down');
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(TOM, 'The kitchen tap is dripping', { channel: 'whatsapp' });
    await h.answerAll(TOM, { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' }, { channel: 'whatsapp' }).catch(() => {});
    await h.upload(h.messenger.last(TOM)!.data.uploadLink as string, [upload('tap.jpg')]).catch(() => {});
    const [request] = (await alice.dashboard()).maintenanceRequests;

    await alice.draftFollowUp(request!.issueId, NOTES);

    expect(h.composer.calls.at(-1)).toMatchObject({ channel: 'whatsapp', facts: { request: 'The kitchen tap is dripping' } });
  });

  test('gives the notes back as written, not marked as AI, when there is no composer', async () => {
    const w = await world({ composer: null });
    const issueId = await tomsRequest(w);

    expect(await w.alice.draftFollowUp(issueId, NOTES)).toEqual({ text: NOTES, byAI: false });
  });

  test('gives the notes back as written, not marked as AI, when the composer throws', async () => {
    const w = await world();
    const issueId = await tomsRequest(w);
    w.h.composer.next = new Error('Claude is down');

    expect(await w.alice.draftFollowUp(issueId, NOTES)).toEqual({ text: NOTES, byAI: false });
  });

  test('refuses blank notes and notes over 1000 characters, without asking the composer', async () => {
    const w = await world();
    const { h, alice } = w;
    const issueId = await tomsRequest(w);

    await expect(alice.draftFollowUp(issueId, '  \n ')).rejects.toMatchObject({ code: 'invalid', fields: { notes: expect.stringMatching(/what you want to say/i) } });
    await expect(alice.draftFollowUp(issueId, 'a'.repeat(1001))).rejects.toMatchObject({ code: 'invalid', fields: { notes: expect.stringMatching(/1000/) } });
    await expect(alice.draftFollowUp(issueId, 'a'.repeat(1000))).resolves.toMatchObject({ byAI: true });
    expect(h.composer.calls).toHaveLength(1);
  });

  test('refuses an issue from another Agency', async () => {
    const w = await world();
    const { h } = w;
    const issueId = await tomsRequest(w);
    const eve = h.as(await elsewhere(w));

    await expect(eve.draftFollowUp(issueId, NOTES)).rejects.toMatchObject({ code: 'not_found' });
    expect(h.composer.calls).toEqual([]);
  });

  test('refuses an issue that is no longer in intake', async () => {
    const w = await world();
    const { h, alice } = w;
    const confirmed = await tomsRequest(w);
    await alice.confirmMaintenanceRequest(confirmed);
    await expect(alice.draftFollowUp(confirmed, NOTES)).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/Maintenance Request/) });

    await h.advance(HOUR);
    h.classifier.when('The bathroom light is flickering', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'electrical' });
    await h.receive(TOM, 'The bathroom light is flickering');
    await h.answerAll(TOM, { location: 'Bathroom', started: 'Last week', worsening: 'no', availability: 'weekday_mornings' });
    await h.upload(h.messenger.last(TOM)!.data.uploadLink as string, [upload('light.jpg')]);
    const [waiting] = (await alice.dashboard()).maintenanceRequests;
    await alice.rejectMaintenanceRequest(waiting!.issueId, 'The fitting is the Tenant\'s own');
    await expect(alice.draftFollowUp(waiting!.issueId, NOTES)).rejects.toMatchObject({ code: 'invalid' });

    expect(h.composer.calls).toEqual([]);
  });
});

describe('sending a follow-up', () => {
  test('texts the Tenant the text as it is, with the template\'s subject, and logs it against the issue', async () => {
    const w = await world();
    const { h, alice } = w;
    const issueId = await tomsRequest(w);
    const edited = 'Hi Tom, is the tap still dripping? If you can, turn the water off at the meter.\n\nHarbour Realty';

    const name = await alice.sendFollowUp(issueId, edited);

    expect(name).toBe('Tom Tran');
    expect(h.messenger.last(TOM)).toMatchObject({ channel: 'sms', template: 'tenant.follow_up', text: edited, data: { text: edited } });
    expect(await all(h.db, `SELECT direction, channel_type, address, template, text FROM messages WHERE issue_id = ? AND template = 'tenant.follow_up'`, issueId)).toEqual([
      { direction: 'out', channel_type: 'sms', address: TOM, template: 'tenant.follow_up', text: edited },
    ]);
    expect(h.composer.calls).toEqual([]);
  });

  test('reaches the Tenant on the channel they last wrote on', async () => {
    const w = await world();
    const { h, alice } = w;
    const issueId = await tomsRequest(w, 'whatsapp');

    await alice.sendFollowUp(issueId, NOTES);

    expect(h.messenger.last(TOM)).toMatchObject({ channel: 'whatsapp', template: 'tenant.follow_up' });
  });

  test('carries the subject "About your maintenance request"', async () => {
    const w = await world();
    const issueId = await tomsRequest(w);

    await w.alice.sendFollowUp(issueId, NOTES);

    expect(w.h.messenger.last(TOM)!.subject).toBe('About your maintenance request');
  });

  test('refuses blank text and text over 4000 characters, sending nothing', async () => {
    const w = await world();
    const { h, alice } = w;
    const issueId = await tomsRequest(w);
    const before = h.messenger.sent.length;

    await expect(alice.sendFollowUp(issueId, ' \n ')).rejects.toMatchObject({ code: 'invalid', fields: { text: expect.stringMatching(/write a message/i) } });
    await expect(alice.sendFollowUp(issueId, 'a'.repeat(4001))).rejects.toMatchObject({ code: 'invalid', fields: { text: expect.stringMatching(/4000/) } });
    expect(h.messenger.sent).toHaveLength(before);

    await alice.sendFollowUp(issueId, 'a'.repeat(4000));
    expect(h.messenger.sent).toHaveLength(before + 1);
  });

  test('refuses an issue from another Agency, or one no longer in intake, sending nothing', async () => {
    const w = await world();
    const { h, alice } = w;
    const issueId = await tomsRequest(w);
    const eve = h.as(await elsewhere(w));
    const before = h.messenger.sent.length;

    await expect(eve.sendFollowUp(issueId, NOTES)).rejects.toMatchObject({ code: 'not_found' });
    await alice.confirmMaintenanceRequest(issueId);
    const afterConfirm = h.messenger.sent.length;
    await expect(alice.sendFollowUp(issueId, NOTES)).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/Maintenance Request/) });

    expect(before).toBeLessThan(afterConfirm);
    expect(h.messenger.sent).toHaveLength(afterConfirm);
  });
});
