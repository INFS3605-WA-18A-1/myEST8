// The Agency's Properties: the list at /properties and one Property's profile at
// /properties/:id: its open Tickets first, then the Max Repair Cost, Property Owner
// and Property Manager, its Tenants, nominated Tradies, frequent issues and closed
// Tickets. Adding a Property is the form in Setup.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { PropertyManagerActions } from '../../app.ts';
import { ActionError } from '../../shared.ts';
import type { WebEnv } from '../env.ts';
import { shellInfo } from '../shell.ts';
import { badge, emptyState, flashFrom, formatAge, formatMoney, humanise, linkButton, page, sectionHeader, statusBadge, table, ticketCell, urgencyBadge, type Html } from '../ui.ts';

type Overview = Awaited<ReturnType<PropertyManagerActions['propertyOverviews']>>[number];
type PropertyView = Awaited<ReturnType<PropertyManagerActions['property']>>;

/** Properties under /properties. */
export function propertyPages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const properties = await actions.propertyOverviews();
    return c.html(
      page({
        title: 'Properties',
        pm,
        active: 'properties',
        flash: flashFrom(c.req.url),
        shell: shellInfo(c),
        subtitle: `${properties.length} ${properties.length === 1 ? 'Property' : 'Properties'} managed by the Agency.`,
        actions: linkButton('Add a Property', '/setup#properties', { variant: 'primary', size: 'sm' }),
        body: list(properties),
      }),
    );
  });

  pages.get('/:id{[0-9]+}', async (c) => {
    const { actions, pm } = c.var;
    let property: PropertyView;
    try {
      property = await actions.property(Number(c.req.param('id')));
    } catch (error) {
      if (!(error instanceof ActionError) || error.code !== 'not_found') throw error;
      return c.html(
        page({
          title: 'Property not found',
          pm,
          active: 'properties',
          shell: shellInfo(c),
          body: emptyState('There is no such Property in your Agency.', linkButton('Back to Properties', '/properties')),
        }),
        404,
      );
    }
    const now = actions.now();
    return c.html(
      page({
        title: property.address,
        pm,
        active: 'properties',
        flash: flashFrom(c.req.url),
        shell: shellInfo(c),
        actions: linkButton('Back to Properties', '/properties', { variant: 'ghost', size: 'sm' }),
        body: html`
          ${openTickets(property, now)} ${facts(property)}
          <div class="grid gap-6 lg:grid-cols-2">${tenants(property)}${nominated(property)}</div>
          ${frequent(property)} ${closedTickets(property, now)}
        `,
      }),
    );
  });

  return pages;
}

function list(properties: Overview[]): Html {
  if (!properties.length) return emptyState('No Properties yet. Add the first one to start taking reports.', linkButton('Add a Property', '/setup#properties', { variant: 'primary' }));
  return table(
    ['Property', 'Property Owner', 'Max Repair Cost', 'Tenants', 'Open Tickets', 'Property Manager'],
    properties.map((p) => [
      html`<a class="link font-medium" href="/properties/${p.propertyId}">${p.address}</a>`,
      html`${p.ownerName}`,
      html`${formatMoney(p.maxRepairCostCents)}`,
      html`${p.tenants.length ? p.tenants.join(', ') : html`<span class="text-muted">No Tenants</span>`}`,
      html`${p.openTickets}`,
      html`${p.propertyManager}`,
    ]),
    { caption: 'Properties', align: ['left', 'left', 'right', 'left', 'right', 'left'] },
  );
}

/** A name, then the mobile number and the email to reach them on, each on its own line. */
function contact(person: { name: string; mobile: string | null; email: string | null }): Html {
  return html`<span class="property-contact">
    <span class="font-medium">${person.name}</span>
    ${person.mobile ? html`<a class="link num" href="tel:${person.mobile}">${person.mobile}</a>` : ''}
    ${person.email ? html`<a class="link break-all" href="mailto:${person.email}">${person.email}</a>` : ''}
  </span>`;
}

/** The headline facts: the Max Repair Cost first and large, then who owns and who manages the Property. */
function facts(p: PropertyView): Html {
  return html`<section class="section" aria-label="Property details">
    <dl class="property-facts">
      <div>
        <dt>Max Repair Cost</dt>
        <dd class="property-facts-money num">${formatMoney(p.maxRepairCostCents)}</dd>
      </div>
      <div>
        <dt>Property Owner</dt>
        <dd>${contact(p.owner)}</dd>
      </div>
      <div>
        <dt>Property Manager</dt>
        <dd>${p.propertyManager}</dd>
      </div>
      ${p.buildingManager
        ? html`<div>
            <dt>Building Manager</dt>
            <dd>${contact(p.buildingManager)}</dd>
          </div>`
        : ''}
    </dl>
  </section>`;
}

/** "1 Jan 2025" from a date like 2025-01-01. */
function formatDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return date;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace('Sept', 'Sep');
}

function tenants(p: PropertyView): Html {
  return html`<section class="section min-w-0" aria-label="Tenants">
    ${sectionHeader('Tenants')}
    ${p.tenants.length
      ? table(
          ['Tenant', 'Mobile', 'Email'],
          p.tenants.map((t) => [
            html`<span class="font-medium">${t.name}</span>${t.tenancyStart ? html`<br /><span class="text-xs text-muted">Since ${formatDate(t.tenancyStart)}</span>` : ''}`,
            html`${t.mobile ? html`<a class="link num" href="tel:${t.mobile}">${t.mobile}</a>` : '—'}`,
            html`${t.email ? html`<a class="link break-all" href="mailto:${t.email}">${t.email}</a>` : '—'}`,
          ]),
          { caption: 'Tenants' },
        )
      : emptyState('No Tenants yet.')}
  </section>`;
}

function nominated(p: PropertyView): Html {
  return html`<section class="section min-w-0" aria-label="Nominated Tradies">
    ${sectionHeader('Nominated Tradies')}
    ${p.nominatedTradies.length
      ? table(
          ['Tradie', 'Trades'],
          p.nominatedTradies.map((t) => [
            html`<a class="link font-medium" href="/tradies/${t.tradieId}">${t.businessName ?? t.name}</a>`,
            html`<span class="flex flex-wrap gap-1">${t.trades.map((trade) => badge(humanise(trade), 'info'))}</span>`,
          ]),
          { caption: 'Nominated Tradies for Urgent Repairs' },
        )
      : emptyState('No Nominated Tradie. Tenants arrange Urgent Repairs themselves.')}
  </section>`;
}

function frequent(p: PropertyView): Html {
  return html`<section class="section" aria-label="Frequent issues">
    ${sectionHeader('Frequent issues')}
    ${p.frequentIssues.length
      ? html`<ul class="flex flex-wrap gap-2" role="list">${p.frequentIssues.map((i) => html`<li>${badge(`${humanise(i.trade)}: ${i.tickets} ${i.tickets === 1 ? 'Ticket' : 'Tickets'}`, 'neutral')}</li>`)}</ul>`
      : emptyState('No Tickets on this Property yet.')}
  </section>`;
}

/** What is happening at the Property now: the open Tickets, issue first, with their Jobs' stages. */
function openTickets(p: PropertyView, now: Date): Html {
  return html`<section class="section" aria-label="Open Tickets">
    ${sectionHeader('Open Tickets')}
    ${p.openTickets.length
      ? table(
          ['Issue', 'Urgency', 'Jobs', 'Reported'],
          p.openTickets.map((t) => [
            ticketCell({ ticketId: t.ticketId, issue: t.description, unread: t.unreadMessages }),
            urgencyBadge(t.urgency),
            html`<span class="flex flex-wrap gap-1">${t.jobs.map((j) => html`<span class="whitespace-nowrap">${humanise(j.trade)} ${statusBadge(j.status, { job: true })}</span>`)}</span>`,
            html`<span class="text-muted whitespace-nowrap">${formatAge(t.reportedAt, now)}</span>`,
          ]),
          { caption: 'Open Tickets, most urgent first', stack: true },
        )
      : emptyState('No open Tickets.')}
  </section>`;
}

/** The Property's history: closed Tickets, most recently closed first. */
function closedTickets(p: PropertyView, now: Date): Html {
  return html`<section class="section" aria-label="Closed Tickets">
    ${sectionHeader('Closed Tickets')}
    ${p.closedTickets.length
      ? table(
          ['Issue', 'Trades', 'Closed'],
          p.closedTickets.map((t) => [
            ticketCell({ ticketId: t.ticketId, issue: t.description }),
            html`<span class="flex flex-wrap gap-1">${[...new Set(t.jobs.map((j) => j.trade))].map((trade) => badge(humanise(trade), 'neutral'))}</span>`,
            html`<span class="text-muted whitespace-nowrap">Closed ${formatAge(t.closedAt, now)}</span>`,
          ]),
          { caption: 'Closed Tickets, most recently closed first', stack: true },
        )
      : emptyState('No closed Tickets yet.')}
  </section>`;
}
