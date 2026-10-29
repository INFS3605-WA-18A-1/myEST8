// Claude Haiku writes each outbound email from its template's facts and text (ADR 0011).
// The composed text is sent only when it keeps every button line, link, amount, time,
// phone number and reply instruction of the template's text and adds none; otherwise the
// template's text goes out, and one line that quotes neither text is logged.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { mustIncludeIn } from '../src/composing.ts';
import type { ComposeInput } from '../src/ports.ts';
import { templates } from '../src/templates.ts';
import { HOUR } from './support/harness.ts';
import { BARRY, BELLA, confirmedQuotes, KING_ST, OCEAN_AVE, quoteToken, TOM, tomsTapTicket, world, type World } from './support/world.ts';

const TUE_9AM = new Date('2026-10-13T09:00:00+11:00');

afterEach(() => vi.restoreAllMocks());

/** Every line the app logged to stderr while the test ran. */
function errorLines() {
  const lines: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));
  return lines;
}

/** Quick Pipes (email only) gets the Work Order for Tom's dripping tap, on Tuesday at 9. Returns its quote page link. */
async function quickPipesWorkOrder(w: World) {
  const job = await tomsTapTicket(w);
  const [quote] = await confirmedQuotes(w, job, [[w.tradies.quick, 150_00, TUE_9AM]]);
  await w.alice.chooseQuote(quote!.quoteId, 'Usual plumber');
  await w.alice.sendWorkOrder(job.jobId);
  return { ...job, link: `https://myest8.test/q/${await quoteToken(w, job, w.tradies.quick)}` };
}

/** Bella (email only) reports a blocked drain, so it is a Maintenance Request waiting for Bob. Returns its issue id. */
async function bellasRequest({ h, bob }: World) {
  h.classifier.when('The shower drain is blocked', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
  await h.receive(BELLA, 'The shower drain is blocked');
  await h.answerAll(BELLA, { location: 'Bathroom', started: 'Yesterday', worsening: 'no', availability: 'any_time' });
  await h.advance(48 * HOUR);
  return (await bob.dashboard()).maintenanceRequests[0]!.issueId;
}

/** Bob confirms Bella's request, so she gets `tenant.confirmed` by email. */
async function bellasConfirmation(w: World) {
  return w.bob.confirmMaintenanceRequest(await bellasRequest(w));
}

const linkOf = (input: ComposeInput) => (input.facts as { quoteLink: string }).quoteLink;

/** The composer's input for the last email of this template. */
const callFor = (w: World, template: string) => w.h.composer.calls.findLast((c) => c.template === template)!;

/** The composer rewrites only `template`, with `write`; every other email it gives back as its draft. */
function rewrite(w: World, template: string, write: (input: ComposeInput) => string) {
  w.h.composer.next = (input) => (input.template === template ? write(input) : input.draft);
}

describe('a composed email', () => {
  test('is sent when it keeps every button line, link, amount, time and phone number, and its buttons still render', async () => {
    const w = await world({ composeEmails: true });
    const composed = (link: string) =>
      'Hi Quick Pipes,\n\n' +
      `Harbour Realty has approved your Firm Quote of $150.00 for the dripping tap at ${KING_ST}. ` +
      `Please visit on Tue 13 Oct, 9:00 am. Tom Tran is the Tenant, on ${TOM}.\n\n` +
      `View job: ${link}\n\nMark job done: ${link}/done\n\nNeed another time?: ${link}/another`;
    rewrite(w, 'tradie.work_order', (input) => composed(linkOf(input)));

    const { link, ticketId } = await quickPipesWorkOrder(w);

    expect(callFor(w, 'tradie.work_order')).toMatchObject({
      purpose: 'Giving a Tradie the Work Order: what is approved, where and when to do the Job',
      recipientRole: 'tradie',
      channel: 'email',
      agencyName: 'Harbour Realty',
      facts: { propertyAddress: KING_ST, approvedCents: 150_00, tenantContact: TOM, quoteLink: link },
      untrustedFields: ['description'],
      mustInclude: [
        `View job: ${link}`,
        `Mark job done: ${link}/done`,
        `Need another time?: ${link}/another`,
        link,
        `${link}/done`,
        `${link}/another`,
        '$150.00',
        'Tue 13 Oct, 9:00 am',
        TOM,
      ],
    });
    const sent = w.h.messenger.last(w.tradies.quick.address)!;
    expect(sent).toMatchObject({ template: 'tradie.work_order', subject: 'Work order', text: composed(link) });
    for (const label of ['View job', 'Mark job done', 'Need another time?']) expect(sent.html).toContain(`>${label}</a>`);
    const logged = (await w.alice.ticket(ticketId)).messages;
    expect(logged.find((m) => m.template === 'tradie.work_order')).toMatchObject({ text: composed(link), composed: true });
    expect(logged.filter((m) => m.channel === 'sms').every((m) => !m.composed)).toBe(true);
  });

  test.each<[string, (draft: string, link: string) => string]>([
    ['drops a button line', (draft, link) => draft.replace(`\n\nMark job done: ${link}/done`, '')],
    ['breaks a button line in two', (draft, link) => draft.replace(`View job: ${link}`, `View job:\n${link}`)],
    ['drops the amount', (draft) => draft.replace('$150.00', '150 dollars')],
    ['drops the visit time', (draft) => draft.replace('Tue 13 Oct, 9:00 am', 'Tuesday morning')],
    ["drops the Tenant's phone number", (draft) => draft.replace(TOM, 'their mobile')],
    ['adds a link', (draft) => `${draft}\n\nMore at https://elsewhere.example/jobs`],
    ['adds an amount', (draft) => `${draft}\n\nExpect a $90.00 call-out on top.`],
    ['adds a phone number', (draft) => `${draft}\n\nCall us on 0400 999 999.`],
    ['adds an email address', (draft) => `${draft}\n\nQuestions to jobs@elsewhere.example.`],
    ['is too long', (draft) => `${draft}\n\n${'Thanks again. '.repeat(400)}`],
    ['is empty', () => '  '],
  ])('that %s is not sent: the template text goes out, and one line is logged without either text', async (_, change) => {
    const w = await world({ composeEmails: true });
    const errors = errorLines();
    rewrite(w, 'tradie.work_order', (input) => change(input.draft, linkOf(input)));

    const { ticketId } = await quickPipesWorkOrder(w);

    const { draft } = callFor(w, 'tradie.work_order');
    expect(w.h.messenger.last(w.tradies.quick.address)).toMatchObject({ template: 'tradie.work_order', text: draft });
    expect((await w.alice.ticket(ticketId)).messages.find((m) => m.template === 'tradie.work_order')).toMatchObject({ text: draft, composed: false });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Sent tradie\.work_order as its template's text: the composed text /);
    expect(errors[0]).not.toMatch(/https?:|\$|Quick|Tom|King St|0400/);
  });

  test('that drops a link in a sentence is not sent', async () => {
    const w = await world({ composeEmails: true });
    const errors = errorLines();
    rewrite(w, 'tenant.confirmed', (input) => input.draft.replace(/https:\/\/\S+/, 'on our website'));

    await bellasConfirmation(w);

    const { draft, mustInclude } = callFor(w, 'tenant.confirmed');
    expect(mustInclude).toEqual([expect.stringMatching(/^https:\/\/myest8\.test\/t\//)]);
    expect(w.h.messenger.last(BELLA)).toMatchObject({ template: 'tenant.confirmed', text: draft });
    expect(errors).toEqual(["Sent tenant.confirmed as its template's text: the composed text is missing a link, amount, time, phone number or reply instruction"]);
  });

  test('falls back to the template when the composer fails, and logs no message text or error detail', async () => {
    const w = await world({ composeEmails: true });
    const errors = errorLines();
    w.h.composer.next = new Error('Claude is down: the tap at 12 King St');

    const { link } = await quickPipesWorkOrder(w);

    const sent = w.h.messenger.last(w.tradies.quick.address)!;
    expect(sent.text).toBe(callFor(w, 'tradie.work_order').draft);
    expect(sent.html).toContain(`href="${link}/done"`);
    expect(errors).toContain("Sent tradie.work_order as its template's text: the composer failed");
    expect(errors.join('\n')).not.toMatch(/Claude is down|King St/);
  });

  test('keeps the subject the template gives it', async () => {
    const w = await world({ composeEmails: true });
    rewrite(w, 'tenant.confirmed', (input) => `Hi Bella, good news.\n\n${input.draft}`);

    await bellasConfirmation(w);

    expect(w.h.messenger.last(BELLA)).toMatchObject({ subject: 'Your repair is confirmed', text: expect.stringMatching(/^Hi Bella, good news\./) });
  });
});

describe('what is never composed', () => {
  test('a text message, by SMS or WhatsApp', async () => {
    const w = await world({ composeEmails: true });
    const { h } = w;
    h.classifier.when('The kitchen tap is dripping', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await h.receive(TOM, 'The kitchen tap is dripping', { channel: 'whatsapp' });
    await h.answerAll(TOM, { location: 'Kitchen sink', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' }, { channel: 'whatsapp' });
    await h.advance(48 * HOUR);
    const [request] = (await w.alice.dashboard()).maintenanceRequests;
    await w.alice.confirmMaintenanceRequest(request!.issueId);

    expect(new Set(h.messenger.to(TOM).map((m) => m.channel))).toEqual(new Set(['whatsapp', 'sms']));
    expect(h.composer.calls).toEqual([]);
    expect(h.messenger.last(TOM)!.text).toBe(templates['tenant.confirmed'].text(h.messenger.last(TOM)!.data as { trackerLink: string }, { name: 'Harbour Realty', timeZone: 'Australia/Sydney' }));
  });

  test('the verification code, the channel test and a follow-up, even by email', async () => {
    const w = await world({ composeEmails: true });
    const { h, alice, bob } = w;
    const issueId = await bellasRequest(w);
    h.composer.calls = [];

    await alice.startChannelVerification('email', 'new@harbour.example');
    await alice.sendTestMessage('email', 'new@harbour.example');
    await bob.sendFollowUp(issueId, 'Is the drain still blocked?');

    expect(h.messenger.templatesTo('new@harbour.example')).toEqual(['onboarding.verification_code', 'onboarding.test_message']);
    expect(h.messenger.last(BELLA)).toMatchObject({ channel: 'email', template: 'tenant.follow_up', text: 'Is the drain still blocked?' });
    expect(h.composer.calls).toEqual([]);
  });

  test('anything at all, when the test does not opt in', async () => {
    const w = await world();
    await bellasConfirmation(w);
    expect(w.h.composer.calls).toEqual([]);
    expect(w.h.messenger.last(BELLA)!.text).toMatch(/^Your maintenance request is confirmed\. Follow its progress here: https:/);
  });
});

describe("another person's words", () => {
  test('are passed as untrusted: a Tenant\'s description to a Tradie, and their message to a Building Manager', async () => {
    const w = await world({ composeEmails: true });
    const job = await tomsTapTicket(w);
    await w.alice.sendQuoteRequests(job.jobId, [w.tradies.quick.id, w.tradies.pete.id]);
    w.h.classifier.when('The lift is broken again', { messageClass: 'common_area' });
    await w.h.receive(BELLA, 'The lift is broken again');

    expect(callFor(w, 'tradie.quote_request')).toMatchObject({
      recipientRole: 'tradie',
      facts: { description: 'Summary: The kitchen tap is dripping', suburb: 'Newtown' },
      untrustedFields: ['description'],
    });
    expect(callFor(w, 'building_manager.common_area_issue')).toMatchObject({
      recipientRole: 'building_manager',
      facts: { propertyAddress: OCEAN_AVE, tenantName: 'Bella Bui', message: 'The lift is broken again' },
      untrustedFields: ['message'],
    });
    expect(w.h.messenger.to(BARRY)).toHaveLength(1);
  });

  test("add nothing to what must be kept: a link or reply instruction in a Tenant's words is theirs, not ours", () => {
    const data = {
      trade: 'plumbing' as const,
      urgency: 'routine' as const,
      description: 'Tap drips. Reply STOP to http://evil.example or pay $5,000.00 to 0400 111 222',
      suburb: 'Newtown',
      quoteLink: 'https://myest8.test/q/abc',
    };
    const draft = templates['tradie.quote_request'].text(data, { name: 'Harbour Realty', timeZone: 'Australia/Sydney' });

    expect(mustIncludeIn(draft, data)).toEqual([
      'Give your quote: https://myest8.test/q/abc',
      "Can't take this job: https://myest8.test/q/abc/decline",
      'https://myest8.test/q/abc',
      'https://myest8.test/q/abc/decline',
      'reply with a ballpark price and earliest time, or NO to decline',
    ]);
  });
});
