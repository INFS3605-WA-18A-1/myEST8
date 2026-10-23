import { describe, expect, test } from 'vitest';
import { AGENCY_NUMBER } from '../support/harness.ts';
import { visible, webWorld } from '../support/web.ts';
import { BARRY, BELLA, confirmedQuotes, KING_ST, OCEAN_AVE, OLIVIA, OLIVIA_EMAIL, OSCAR, tomsTapTicket } from '../support/world.ts';

const CASEY = '+61400000199';

describe('Property Owners and Building Managers', () => {
  test('each list links the name, shows how to reach them and their Properties, and flags who has no way to be reached', async () => {
    const w = await webWorld();
    await w.alice.addBuildingManager({ name: 'Casey Court', mobile: CASEY });
    await w.alice.disconnectServerSms(AGENCY_NUMBER);
    const cookie = await w.signIn();

    const owners = await (await w.get('/owners', cookie)).text();
    expect(owners).toMatch(/<a href="\/owners" class="[^"]*" aria-current="page"/);
    for (const heading of ['Property Owner', 'Mobile', 'Email', 'Properties']) expect(owners).toContain(`>${heading}</th>`);
    expect(owners).toContain(`href="/owners/${w.ids.olivia}"`);
    expect(owners).toContain(`href="/owners/${w.ids.oscar}"`);
    expect(owners).toContain(`href="/properties/${w.ids.kingSt}"`);
    expect(owners).toContain(`href="/properties/${w.ids.oceanAve}"`);
    expect(owners).toContain(`href="tel:${OLIVIA}"`);
    expect(owners).toContain(`href="mailto:${OLIVIA_EMAIL}"`);
    expect(owners).toContain(`href="tel:${OSCAR}"`);
    expect(owners.indexOf(`/owners/${w.ids.olivia}"`)).toBeLessThan(owners.indexOf(`/owners/${w.ids.oscar}"`));
    const oscar = owners.slice(owners.indexOf(`href="/owners/${w.ids.oscar}"`), owners.indexOf('</tr>', owners.indexOf(`href="/owners/${w.ids.oscar}"`)));
    const olivia = owners.slice(owners.indexOf(`href="/owners/${w.ids.olivia}"`), owners.indexOf('</tr>', owners.indexOf(`href="/owners/${w.ids.olivia}"`)));
    expect(oscar).toContain('No way to reach');
    expect(olivia).not.toContain('No way to reach');
    expect(visible(olivia)).toContain(KING_ST);
    expect(owners).toContain('action="/setup/owners?from=list"');
    expect(owners).toContain('id="add-owner"');

    const managers = await (await w.get('/building-managers', cookie)).text();
    expect(managers).toMatch(/<a href="\/building-managers" class="[^"]*" aria-current="page"/);
    expect(managers).toContain(`href="/building-managers/${w.ids.barry}"`);
    expect(managers).toContain(`href="mailto:${BARRY}"`);
    expect(managers).toContain(`href="/properties/${w.ids.oceanAve}"`);
    const barry = managers.slice(managers.indexOf('Barry Strata'), managers.indexOf('</tr>', managers.indexOf('Barry Strata')));
    const casey = managers.slice(managers.indexOf('Casey Court'), managers.indexOf('</tr>', managers.indexOf('Casey Court')));
    expect(visible(barry)).toContain(OCEAN_AVE);
    expect(barry).not.toContain('No way to reach');
    expect(casey).toContain('No way to reach');
    expect(casey).not.toContain(`href="/properties/`);
    expect(managers).toContain('action="/setup/building-managers?from=list"');
  });

  test('adding one from the list comes back to the list', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const res = await w.post('/setup/owners?from=list', { name: 'Priya Patel', email: 'priya@example.com' }, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/owners\?ok=/);
    const after = visible(await (await w.get(res.headers.get('location')!, cookie)).text());
    expect(after).toContain('Priya Patel added as a Property Owner');
    expect(after).toContain('Priya Patel');
  });
});

describe('a Property Owner profile', () => {
  const PEN = (id: number) => `href="/owners/${id}?edit=details#details"`;
  const detailsOf = (page: string) => page.slice(page.indexOf('id="details"'), page.indexOf('</section>', page.indexOf('id="details"')));

  test('shows their contact and Properties, with a pen that opens the form, and their approvals', async () => {
    const w = await webWorld();
    const job = await tomsTapTicket(w);
    const [quote] = await confirmedQuotes(w, job, [
      [w.tradies.pete, 600_00],
      [w.tradies.dana, 700_00],
    ]);
    await w.alice.chooseQuote(quote!.quoteId);
    const cookie = await w.signIn();

    const page = await (await w.get(`/owners/${w.ids.olivia}`, cookie)).text();
    expect(page).toContain('<h1');
    expect(visible(page)).toContain('Olivia Owens');
    expect(detailsOf(page)).toContain(`<a ${PEN(w.ids.olivia)} class="icon-btn" aria-label="Edit details" title="Edit details">`);
    expect(page).toContain(`href="tel:${OLIVIA}"`);
    expect(page).toContain(`href="mailto:${OLIVIA_EMAIL}"`);
    expect(page).toContain(`href="/properties/${w.ids.kingSt}"`);
    expect(visible(page)).toContain(KING_ST);
    expect(page).toContain('<h2 class="section-title">Approvals</h2>');
    expect(page).toContain(`href="/tickets/${job.ticketId}"`);
    expect(visible(page)).toContain('Requested');
    expect(page).toContain('href="/owners"');
  });

  test('?edit=details shows Save and Cancel, a save comes back saved, and a refused save names the field', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const open = await (await w.get(`/owners/${w.ids.olivia}?edit=details`, cookie)).text();
    const form = detailsOf(open);
    expect(form).toContain(`<form method="post" action="/owners/${w.ids.olivia}/details"`);
    expect(form).toMatch(/<input[^>]* name="name"[^>]* value="Olivia Owens"/);
    expect(form).toMatch(/<input[^>]* name="email"[^>]* value="olivia@example.com"/);
    expect(form).toMatch(/<button type="submit"[^>]*>Save<\/button>/);
    expect(form).toContain(`<a href="/owners/${w.ids.olivia}" class="btn btn-ghost">Cancel</a>`);
    expect(form).not.toContain('aria-label="Edit details"');

    const cancel = await (await w.get(`/owners/${w.ids.olivia}`, cookie)).text();
    expect(cancel).not.toContain(`action="/owners/${w.ids.olivia}/details"`);

    const saved = await w.post(`/owners/${w.ids.olivia}/details`, { name: 'Olivia Owen', mobile: OLIVIA, email: 'Olivia.Owen@example.com' }, cookie);
    expect(saved.status).toBe(303);
    expect(saved.headers.get('location')).toMatch(new RegExp(`^/owners/${w.ids.olivia}\\?ok=`));
    const after = await (await w.get(saved.headers.get('location')!, cookie)).text();
    expect(visible(after)).toContain('Details saved.');
    expect(after).toContain('href="mailto:olivia.owen@example.com"');

    const refused = await w.post(`/owners/${w.ids.olivia}/details`, { name: 'Olivia Owen', mobile: OLIVIA, email: 'hana@example.com' }, cookie);
    expect(refused.status).toBe(400);
    expect(detailsOf(await refused.text())).toMatch(/<p id="owner-email-error" class="field-error">hana@example.com already belongs to someone else<\/p>/);
  });

  test('Remove asks first, and is refused while they own a Property, naming it', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = await (await w.get(`/owners/${w.ids.olivia}`, cookie)).text();
    expect(page).toContain(`action="/owners/${w.ids.olivia}/remove"`);
    expect(page.replaceAll('&#39;', "'")).toContain(
      `data-confirm="Olivia Owens won't be asked to approve repairs. Their past approvals stay on the Tickets they belong to."`,
    );
    expect(page).toContain('btn-danger');
    expect(page.indexOf('Remove Property Owner')).toBeLessThan(page.indexOf('Back to Property Owners'));

    const res = await w.post(`/owners/${w.ids.olivia}/remove`, {}, cookie);
    expect(res.headers.get('location')).toMatch(new RegExp(`^/owners/${w.ids.olivia}\\?error=`));
    expect(visible(await (await w.get(res.headers.get('location')!, cookie)).text())).toContain(
      `Olivia Owens owns ${KING_ST}. Give it another Property Owner first.`,
    );
    expect(await (await w.get('/owners', cookie)).text()).toContain(`href="/owners/${w.ids.olivia}"`);
  });
});

describe('a Building Manager profile', () => {
  test('the pen saves an email, Cancel leaves the profile, and a bad mobile is refused under the field', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const plain = await (await w.get(`/building-managers/${w.ids.barry}`, cookie)).text();
    expect(plain).toContain(`href="/building-managers/${w.ids.barry}?edit=details#details"`);
    expect(plain).toContain(`href="mailto:${BARRY}"`);
    expect(plain).toContain(`href="/properties/${w.ids.oceanAve}"`);
    expect(plain).not.toContain('<h2 class="section-title">Approvals</h2>');

    const editing = await (await w.get(`/building-managers/${w.ids.barry}?edit=details`, cookie)).text();
    expect(editing).toContain(`<a href="/building-managers/${w.ids.barry}" class="btn btn-ghost">Cancel</a>`);

    const saved = await w.post(`/building-managers/${w.ids.barry}/details`, { name: 'Barry Strata', mobile: '0412 000 880', email: BARRY }, cookie);
    expect(saved.headers.get('location')).toMatch(new RegExp(`^/building-managers/${w.ids.barry}\\?ok=`));
    expect(await (await w.get(saved.headers.get('location')!, cookie)).text()).toContain('href="tel:+61412000880"');

    const refused = await w.post(`/building-managers/${w.ids.barry}/details`, { name: 'Barry Strata', mobile: '12', email: BARRY }, cookie);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('id="building-manager-mobile-error"');
  });

  test('Remove asks first, and is refused while they look after a Property', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const page = await (await w.get(`/building-managers/${w.ids.barry}`, cookie)).text();
    expect(page.replaceAll('&#39;', "'")).toContain(`data-confirm="Barry Strata won't be listed for Common Area issues. Their record stays."`);
    expect(page.indexOf('Remove Building Manager')).toBeLessThan(page.indexOf('Back to Building Managers'));

    const res = await w.post(`/building-managers/${w.ids.barry}/remove`, {}, cookie);
    expect(visible(await (await w.get(res.headers.get('location')!, cookie)).text())).toContain(
      `Barry Strata looks after ${OCEAN_AVE}. Give it another Building Manager first.`,
    );
  });
});

describe('where a Property names its Owner and Building Manager', () => {
  test('the Property and the Ticket link each name, and the approval step says when the Owner cannot be reached', async () => {
    const w = await webWorld();
    const cookie = await w.signIn();

    const king = await (await w.get(`/properties/${w.ids.kingSt}`, cookie)).text();
    expect(king).toContain(`href="/owners/${w.ids.olivia}"`);
    expect(visible(king)).toContain('Olivia Owens');
    const ocean = await (await w.get(`/properties/${w.ids.oceanAve}`, cookie)).text();
    expect(ocean).toContain(`href="/building-managers/${w.ids.barry}"`);
    expect(visible(ocean)).toContain('Barry Strata');

    const tom = await tomsTapTicket(w);
    const toms = await (await w.get(`/tickets/${tom.ticketId}`, await w.signIn())).text();
    expect(toms).toContain(`href="/owners/${w.ids.olivia}"`);
    expect(toms).not.toContain("can't be reached");

    w.h.classifier.when('The shower drain is blocked', { messageClass: 'new_issue', relatedItem: 'none', urgency: 'routine', trade: 'plumbing' });
    await w.h.receive(BELLA, 'The shower drain is blocked');
    await w.h.answerAll(BELLA, { location: 'Bathroom', started: 'Yesterday', worsening: 'no', availability: 'any_time' });
    await w.h.advance(48 * 3_600_000);
    const [request] = (await w.bob.dashboard()).maintenanceRequests;
    const ticketId = await w.bob.confirmMaintenanceRequest(request!.issueId);
    const job = { ticketId, jobId: (await w.bob.ticket(ticketId)).jobs[0]!.jobId };
    await confirmedQuotes(w, job, [
      [w.tradies.pete, 900_00],
      [w.tradies.dana, 1_000_00],
    ]);
    await w.alice.disconnectServerSms(AGENCY_NUMBER);

    const page = await (await w.get(`/tickets/${ticketId}`, await w.signIn('bob@harbour.example'))).text();
    expect(page).toContain(`href="/owners/${w.ids.oscar}"`);
    expect(page).toContain(`href="/building-managers/${w.ids.barry}"`);
    const note = "Oscar Ortiz can't be reached: no SMS channel is connected and they have no email address.";
    expect(visible(page)).toContain(note);
    expect(page).toContain(`href="/owners/${w.ids.oscar}?edit=details#details"`);
    expect(visible(page)).toContain('Add an email');
    const at = page.indexOf("can't be reached");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(page.indexOf('Choose this Firm Quote'));
  });
});
