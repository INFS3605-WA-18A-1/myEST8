// Closed Tickets at /archive, the most recently closed first, with the same Mine/All,
// filter bar and table as Tickets: each row's Jobs show how they ended.

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { WebEnv } from '../env.ts';
import { listFilterOf, listFilterQuery } from '../list-filter.ts';
import { shellInfo } from '../shell.ts';
import { emptyState, flashFrom, linkButton, page, section } from '../ui.ts';
import { countBadge, filtered, listFilterBar, listOptions, scopeControl, ticketTable } from './ticket-list.ts';

export function archivePages() {
  const pages = new Hono<WebEnv>();

  pages.get('/', async (c) => {
    const { actions, pm } = c.var;
    const f = listFilterOf(c);
    const [closed, properties] = await Promise.all([actions.tickets({ ...listOptions(f), status: 'closed' }), actions.properties()]);
    const mine = f.scope === 'mine';
    const list = closed.length
      ? ticketTable(closed, { all: !mine, now: actions.now(), closed: { timeZone: actions.agency().timeZone } })
      : emptyState(
          filtered(f)
            ? `No closed Tickets match these filters${mine ? ' on your Properties' : ''}.`
            : `No closed Tickets${mine ? ' on your Properties' : ''} yet. A Ticket comes here once you close it.`,
          mine ? linkButton('Show all closed Tickets', `/archive${listFilterQuery({ ...f, scope: 'all' })}`) : undefined,
        );
    return c.html(
      page({
        title: 'Archive',
        pm,
        active: 'archive',
        flash: flashFrom(c.req.url),
        shell: await shellInfo(c),
        subtitle: 'Closed Tickets, the most recently closed first.',
        controls: scopeControl('/archive', f),
        body: html`${listFilterBar('/archive', f, properties)} ${section({ title: 'Closed Tickets', id: 'closed', actions: countBadge(closed.length), body: list })}`,
      }),
    );
  });

  return pages;
}
