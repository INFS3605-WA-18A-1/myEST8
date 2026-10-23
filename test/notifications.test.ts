import { describe, expect, test } from 'vitest';
import { renderEmail } from '../src/email-layout.ts';
import { UndeliverableError } from '../src/ports.ts';
import { AGENCY_NUMBER, HOUR } from './support/harness.ts';
import { upload } from './support/photos.ts';
import { BELLA, HANA, HANA_EMAIL, OSCAR, TOM, world } from './support/world.ts';

describe('choosing the channel', () => {
  test('a Tenant who messaged on WhatsApp gets replies on WhatsApp for 24 hours, then by SMS', async () => {
    const { h, alice } = await world();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(TOM, 'The kitchen tap is dripping', { channel: 'whatsapp' });
    await h.answerAll(TOM, { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' }, { channel: 'whatsapp' });
    expect(new Set(h.messenger.to(TOM).map((m) => m.channel))).toEqual(new Set(['whatsapp']));

    await h.advance(48 * HOUR);
    const [request] = (await alice.dashboard()).maintenanceRequests;
    await alice.confirmMaintenanceRequest(request!.issueId);

    expect(h.messenger.last(TOM)).toMatchObject({ channel: 'sms', template: 'tenant.confirmed' });
  });

  test('a Tenant with a mobile who emailed gets email replies for 24 hours, then SMS', async () => {
    const { h, alice } = await world();
    h.classifier.when('The bathroom fan is rattling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'electrical' });
    await h.receive(HANA_EMAIL, 'The bathroom fan is rattling');
    await h.answerAll(HANA_EMAIL, { location: 'Bathroom', started: 'Last week', worsening: 'no', availability: 'weekday_afternoons' });
    expect(h.messenger.to(HANA_EMAIL).map((m) => m.channel)).toEqual(['email', 'email', 'email']);

    await h.advance(48 * HOUR);
    const [request] = (await alice.dashboard()).maintenanceRequests;
    await alice.confirmMaintenanceRequest(request!.issueId);

    expect(h.messenger.last(HANA)).toMatchObject({ channel: 'sms', template: 'tenant.confirmed' });
  });

  test('a Tenant with no mobile number always gets email', async () => {
    const { h, bob } = await world();
    h.classifier.when('The shower drain is blocked', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(BELLA, 'The shower drain is blocked');
    await h.answerAll(BELLA, { location: 'Bathroom', started: 'Yesterday', worsening: 'no', availability: 'any_time' });
    await h.advance(48 * HOUR);
    const [request] = (await bob.dashboard()).maintenanceRequests;
    await bob.confirmMaintenanceRequest(request!.issueId);

    expect(new Set(h.messenger.to(BELLA).map((m) => m.channel))).toEqual(new Set(['email']));
    expect(h.messenger.last(BELLA)!.template).toBe('tenant.confirmed');
  });

  test('a receipt for a Property Owner with no email goes by SMS, and the Property Manager gets their own copy by email', async () => {
    const { h, bob } = await world();
    h.classifier.when('Gas smell in the kitchen', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'urgent', trade: 'plumbing' });
    await h.receive(BELLA, 'Gas smell in the kitchen');
    const reminder = h.messenger.last(BELLA)!;
    expect(reminder.data.nominatedTradies).toEqual([]);

    await h.upload(reminder.data.receiptLink as string, [{ filename: 'receipt.jpg', contentType: 'image/jpeg', content: new Uint8Array([1]) }]);
    const [received] = (await bob.dashboard()).urgentRepairs;
    await bob.forwardReimbursement(received!.urgentRepairId, { amountCents: 300_00 });

    expect(h.messenger.to(OSCAR)).toMatchObject([{ channel: 'sms', template: 'owner.urgent_repair_receipt', attachments: ['receipt.jpg'], cc: [] }]);
    expect(h.messenger.to('bob@harbour.example')).toMatchObject([{ channel: 'email', template: 'owner.urgent_repair_receipt', attachments: ['receipt.jpg'] }]);
    expect((await bob.dashboard()).urgentRepairs).toMatchObject([{ status: 'receipt_forwarded' }]);
  });
});

describe('choosing the channel when the Agency has no SMS channel', () => {
  test('a Tenant with a mobile and an email gets email', async () => {
    const { h, alice } = await world();
    h.classifier.when('The bathroom fan is rattling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'electrical' });
    await h.receive(HANA_EMAIL, 'The bathroom fan is rattling');
    await h.answerAll(HANA_EMAIL, { location: 'Bathroom', started: 'Last week', worsening: 'no', availability: 'weekday_afternoons' });
    await h.advance(48 * HOUR);
    const [request] = (await alice.dashboard()).maintenanceRequests;
    await alice.disconnectServerSms(AGENCY_NUMBER);

    await alice.confirmMaintenanceRequest(request!.issueId);

    expect(h.messenger.last(HANA_EMAIL)).toMatchObject({ channel: 'email', template: 'tenant.confirmed' });
    expect(h.messenger.to(HANA)).toEqual([]);
  });

  test('a Tenant with only a mobile can not be reached, and the error says why', async () => {
    const { h, alice } = await world();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(TOM, 'The kitchen tap is dripping');
    await h.answerAll(TOM, { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' });
    await h.advance(48 * HOUR);
    const [request] = (await alice.dashboard()).maintenanceRequests;
    await alice.disconnectServerSms(AGENCY_NUMBER);

    const error = await alice.confirmMaintenanceRequest(request!.issueId).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UndeliverableError);
    expect((error as UndeliverableError).message).toContain("can't reach Tom Tran: no SMS channel is connected and they have no email address");
    expect((error as UndeliverableError).userReason).toBe('no SMS channel is connected and they have no email address');
  });

  test('the channel a Tradie is asked on is the one the photos are attached for', async () => {
    const { h, alice, tradies } = await world();
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(TOM, 'The kitchen tap is dripping');
    await h.answerAll(TOM, { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' });
    await h.upload(h.messenger.last(TOM)!.data.uploadLink as string, [upload('tap-1.jpg')]);
    const [request] = (await alice.dashboard()).maintenanceRequests;
    const ticketId = await alice.confirmMaintenanceRequest(request!.issueId);
    const [job] = (await alice.ticket(ticketId)).jobs;
    const penny = await alice.addTradie({ name: 'Penny Pipe', businessName: 'Pipe Dreams', mobile: '+61400000300', email: 'penny@pipedreams.example', trades: ['plumbing'], startingRating: 4, notOnGoogle: true });
    await alice.disconnectServerSms(AGENCY_NUMBER);

    await alice.sendQuoteRequests(job!.jobId, [penny, tradies.quick.id]);

    expect(h.messenger.to('penny@pipedreams.example')).toMatchObject([{ channel: 'email', template: 'tradie.quote_request', attachments: ['tap-1.jpg'] }]);
    expect(h.messenger.to('+61400000300')).toEqual([]);
  });
});

describe('onboarding', () => {
  test('each channel is tested with a test message', async () => {
    const { h, alice } = await world();

    await alice.sendTestMessage('whatsapp', TOM);
    await alice.sendTestMessage('email', 'alice@harbour.example');

    expect(h.messenger.sent).toMatchObject([
      { to: TOM, channel: 'whatsapp', template: 'onboarding.test_message' },
      { to: 'alice@harbour.example', channel: 'email', template: 'onboarding.test_message' },
    ]);
  });
});

describe('branded email', () => {
  const TEST_TEXT = 'This is a test message from Harbour Realty on myEST8. This channel is working.';

  test('an email carries the renderer\'s HTML for its text, and an SMS or WhatsApp message carries none', async () => {
    const { h, alice } = await world();

    await alice.sendTestMessage('email', 'alice@harbour.example');
    await alice.sendTestMessage('sms', TOM);
    await alice.sendTestMessage('whatsapp', TOM);

    const [email, sms, whatsapp] = h.messenger.sent;
    expect(email).toMatchObject({ channel: 'email', text: TEST_TEXT });
    expect(email!.html).toBe(renderEmail({ agencyName: 'Harbour Realty', subject: 'Test message', text: TEST_TEXT }));
    expect(email!.html).toContain('lang="en-AU"');
    expect(sms).toMatchObject({ channel: 'sms', text: TEST_TEXT });
    expect(sms).not.toHaveProperty('html');
    expect(whatsapp).toMatchObject({ channel: 'whatsapp', text: TEST_TEXT });
    expect(whatsapp).not.toHaveProperty('html');
  });

  test('a Tenant\'s acknowledgement by email is branded with the Agency\'s name, and by SMS is plain', async () => {
    const { h } = await world();
    h.classifier.when('The bathroom fan is rattling', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'electrical' });
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });

    await h.receive(HANA_EMAIL, 'The bathroom fan is rattling');
    await h.receive(TOM, 'The kitchen tap is dripping');

    const byEmail = h.messenger.to(HANA_EMAIL).find((m) => m.template === 'tenant.acknowledgement')!;
    expect(byEmail.html).toBe(renderEmail({ agencyName: 'Harbour Realty', subject: 'We got your message', text: byEmail.text }));
    expect(byEmail.text).toBe("Hi Hana, this is Harbour Realty. Thanks for letting us know about an issue at 12 King St, Newtown NSW 2042. We've got your message.");
    const bySms = h.messenger.to(TOM).find((m) => m.template === 'tenant.acknowledgement')!;
    expect(bySms).not.toHaveProperty('html');
  });

  test('a verification code by email is branded and by SMS is not', async () => {
    const { h, alice } = await world();

    await alice.startChannelVerification('email', 'new@harbour.example');
    await alice.startChannelVerification('sms', '+61 2 9000 1111');

    const byEmail = h.messenger.last('new@harbour.example')!;
    expect(byEmail.template).toBe('onboarding.verification_code');
    expect(byEmail.html).toBe(renderEmail({ agencyName: 'Harbour Realty', subject: 'Your myEST8 code', text: byEmail.text }));
    expect(byEmail.html).toContain(String(byEmail.data.code));
    expect(h.messenger.last('+61290001111')).not.toHaveProperty('html');
  });
});
