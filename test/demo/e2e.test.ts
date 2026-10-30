import { describe, expect, test } from 'vitest';
import { createDemo } from '../../src/demo/runtime.ts';
import { closeAfter, demoEnv } from '../support/db.ts';
import { isoToLocal } from '../../src/web/forms.ts';
import { upload } from '../support/photos.ts';

/**
 * The demo script, driven the way a presenter would: through the phone simulator
 * and the Property Manager's pages, with every external API answered by the mock.
 */
async function signedInDemo() {
  const errors: Error[] = [];
  const d = await createDemo({ now: new Date('2026-10-08T09:00:00+11:00'), env: demoEnv(), logError: (e) => errors.push(e) });
  closeAfter(d);
  const login = await d.web.request('/login', {
    method: 'POST',
    body: new URLSearchParams({ email: 'alice@harbour.example', password: 'demo1234' }),
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const alice = await d.app.asPropertyManager(d.seed.ids.aliceId);
  const contact = async (name: string) => (await d.demo.contacts(d.seed.ids.aliceId)).find((c) => c.name === name)!;

  async function post(path: string, fields: Record<string, string | string[]>) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) body.append(k, one);
    const res = await d.web.request(path, { method: 'POST', body, headers: { cookie } });
    await d.runWorker();
    expect(res.status, `${path} -> ${res.headers.get('location')}`).toBe(303);
    expect(res.headers.get('location') ?? '').not.toContain('error=');
    return res;
  }
  /** Sends a message in from the simulator, as that person on that channel. */
  const say = async (name: string, text: string, channel = 'sms') => post('/demo/send', { contact: String((await contact(name)).personId), channel, text });
  const page = async (path: string) => (await d.web.request(path, { headers: { cookie } })).text();
  const lastTo = async (address: string) => (await d.demo.outbox(d.seed.ids.aliceId)).filter((m) => m.to === address).at(-1)!;
  const tokenOf = (link: string) => new URL(link.match(/https?:\/\/\S+/)![0]).pathname.split('/').at(-1)!;
  const tradieId = async (businessName: string) => (await alice.people('tradie')).find((t) => t.businessName === businessName)!.id;

  return { ...d, errors, alice, say, post, page, lastTo, tokenOf, tradieId, cookie };
}

describe('the demo script', () => {
  test('a dripping tap goes from a text message to a closed Ticket, as docs/demo.md describes', async () => {
    const d = await signedInDemo();
    const TOM = '+61400000001';

    await d.say('Tom Tran', 'The kitchen tap is dripping');
    expect((await d.demo.outbox(d.seed.ids.aliceId)).filter((m) => m.to === TOM).map((m) => m.template)).toEqual(['tenant.acknowledgement', 'tenant.missing_details']);
    // "The kitchen tap" already says where, so he is asked about the other three, and answers them in one reply.
    expect((await d.lastTo(TOM)).text).toBe(
      'Thanks, Tom. To get this sorted we just need:\n1. When did it start?\n2. Is it getting worse? (yes or no)\n3. When are you usually home: weekday mornings, weekday afternoons, Saturdays or any time?',
    );
    await d.say('Tom Tran', "Since Monday. It isn't getting worse, and I'm home weekday mornings.");
    expect((await d.lastTo(TOM)).template).toBe('tenant.upload_link');

    const form = new FormData();
    form.append('files', new File([upload('tap.jpg', { takenAt: '2026:10:08 08:30:00' }).content], 'tap.jpg', { type: 'image/jpeg' }));
    const uploaded = await d.web.request(`/u/${d.tokenOf((await d.lastTo(TOM)).text)}`, { method: 'POST', body: form });
    expect(uploaded.status).toBe(303);
    await d.runWorker();

    expect(await d.page('/')).toContain('The kitchen tap is dripping');
    const [request] = (await d.alice.dashboard()).maintenanceRequests;
    expect(request).toMatchObject({
      urgency: 'routine',
      trade: 'plumbing',
      photos: [{ metadata: 'ok' }],
      answers: { location: 'kitchen tap', started: 'Since Monday', worsening: 'no', availability: 'weekday_mornings' },
    });
    const confirmed = await d.post(`/requests/${request!.issueId}/confirm`, {});
    const ticketPath = confirmed.headers.get('location')!.split('?')[0]!;
    const ticketId = Number(ticketPath.split('/').at(-1));
    const jobId = (await d.alice.ticket(ticketId)).jobs[0]!.jobId;

    await d.post(`${ticketPath}/jobs/${jobId}/quote-requests`, {
      tradieIds: [await d.tradieId("Pete's Plumbing"), await d.tradieId('Flow Bros Plumbing'), await d.tradieId("Nina's Plumbing")].map(String),
    });
    await d.post('/demo/advance', { hours: '48' });
    for (const tradie of ['+61400000200', '+61400000203', '+61400000204']) expect((await d.lastTo(tradie)).template).toBe('tradie.quote_reminder');

    await d.say('Pete Park', '$650, Tue 9am');
    await d.say('Finn Flow', '$380 Wednesday 10am');
    await d.say('Nina Nguyen', 'No thanks, too busy');

    const { timeZone } = d.alice.agency();
    for (const quote of (await d.alice.ticket(ticketId)).jobs[0]!.quotes) {
      await d.post(`${ticketPath}/quotes/${quote.quoteId}/confirm`, {
        price: String(quote.priceCents! / 100),
        proposedTime: quote.proposedTime ? isoToLocal(quote.proposedTime, timeZone) : '',
      });
    }
    const estimate = (await d.alice.ticket(ticketId)).jobs[0]!.quotes.find((q) => q.businessName === "Pete's Plumbing")!;
    expect(estimate).toMatchObject({ stage: 'estimate', priceCents: 650_00, proposedTime: new Date('2026-10-13T09:00:00+11:00').toISOString(), confirmed: true });

    // Pete gives his Firm Quote on the quote page his Quote Request linked to.
    const quoteRequest = (await d.demo.outbox(d.seed.ids.aliceId)).find((m) => m.to === '+61400000200' && m.template === 'tradie.quote_request')!;
    const quotePath = new URL(/https?:\/\/\S+\/q\/[\w-]+/.exec(quoteRequest.text)![0]).pathname;
    const firm = new FormData();
    for (const [name, value] of Object.entries({ price: '650', scopeOfWork: 'Replace the tap cartridge and washer', durationDays: '1', availableTimes: '2026-10-13', proposedTime: '2026-10-13T09:00' })) firm.set(name, value);
    // The Estimate came by SMS, so the page asks for the Firm Quote next.
    expect(await (await d.web.request(quotePath)).text()).not.toContain('Give your Estimate');
    expect((await d.web.request(`${quotePath}/firm`, { method: 'POST', body: firm })).status).toBe(303);
    await d.runWorker();
    const pete = (await d.alice.ticket(ticketId)).jobs[0]!.quotes.find((q) => q.businessName === "Pete's Plumbing" && q.stage === 'firm')!;
    expect(pete).toMatchObject({ priceCents: 650_00, scopeOfWork: 'Replace the tap cartridge and washer', confirmed: true });

    // $650 is over King St's $500 Max Repair Cost, so Olivia must approve.
    await d.post(`${ticketPath}/quotes/${pete.quoteId}/choose`, { reason: 'Finn only gave an Estimate' });
    expect((await d.lastTo('+61400000100')).template).toBe('owner.approval_request');
    await d.say('Olivia Owens', 'YES');
    expect((await d.alice.ticket(ticketId)).jobs[0]!.status).toBe('approved');

    await d.post(`${ticketPath}/jobs/${jobId}/work-order`, { start: '', hours: '2' });
    expect((await d.lastTo('+61400000200')).template).toBe('tradie.work_order');
    expect((await d.lastTo(TOM)).template).toBe('tenant.visit_time');
    await d.say('Tom Tran', 'Yes that works');
    expect((await d.alice.ticket(ticketId)).jobs[0]!.workOrder).toMatchObject({ visitConfirmed: true });

    // A visit is never done before it starts: Pete is told so, then the clock moves past it.
    await d.say('Pete Park', 'All done, washer replaced');
    expect((await d.lastTo('+61400000200')).template).toBe('tradie.done_too_early');
    const visitStart = (await d.alice.ticket(ticketId)).jobs[0]!.workOrder!.start;
    await d.post('/demo/advance', { hours: String(Math.ceil((Date.parse(visitStart) - d.demo.now().getTime()) / 3_600_000) + 1) });
    await d.say('Pete Park', 'All done, washer replaced');
    expect((await d.lastTo(TOM)).template).toBe('tenant.fixed_properly');
    await d.say('Tom Tran', '5');
    await d.post(`${ticketPath}/jobs/${jobId}/rate`, { score: '5' });
    await d.post(`${ticketPath}/close`, {});

    expect((await d.lastTo(TOM)).template).toBe('tenant.ticket_closed');
    const trackerLink = (await d.demo.outbox(d.seed.ids.aliceId)).find((m) => m.to === TOM && m.template === 'tenant.confirmed')!.text;
    const tracker = await (await d.web.request(`/t/${d.tokenOf(trackerLink)}`)).text();
    expect(tracker).toContain('Fixed');
    expect(tracker).not.toContain('$');
    expect(d.errors).toEqual([]);
  });

  test('a gas smell is an Urgent Repair, and a broken lift goes to the Building Manager', async () => {
    const d = await signedInDemo();

    await d.say('Tom Tran', 'There is a gas smell in the kitchen');
    expect((await d.lastTo('+61400000001')).template).toBe('tenant.urgent_repair_reminder');

    await d.say('Bella Bui', 'The lift is broken again', 'email');
    expect((await d.lastTo('barry@strata.example')).template).toBe('building_manager.common_area_issue');
    expect((await d.lastTo('bella@example.com')).template).toBe('tenant.common_area_passed_on');

    expect(await d.page('/?filter=all')).toContain('There is a gas smell in the kitchen');
    expect(d.errors).toEqual([]);
  });
});
