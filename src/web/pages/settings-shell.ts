// The frame every Settings page shares: the side tabs (Agency, Channels, Team,
// Import) beside the tab's own panel. The tab pages, their edit and remove pages
// and the spreadsheet import's review all sit in it, so a Property Manager in
// Settings always sees where they are and never lands on another part of the app.

import { html } from 'hono/html';
import { sideTabs, type Html } from '../ui.ts';

export const SETTINGS_TABS = [
  ['agency', 'Agency'],
  ['channels', 'Channels'],
  ['team', 'Team'],
  ['import', 'Import'],
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number][0];

/** A tab's address: the Agency tab is plain /settings. */
export const settingsTabHref = (tab: SettingsTab) => (tab === 'agency' ? '/settings' : `/settings?tab=${tab}`);

/** The side tabs with `tab` current, beside `body`. `wide` lets the panel take the rest of the row, for the import review's table. */
export function settingsLayout(tab: SettingsTab, body: Html, o: { wide?: boolean } = {}): Html {
  return html`<div class="settings-layout${o.wide ? ' is-wide' : ''}">
    ${sideTabs(SETTINGS_TABS.map(([key, label]) => ({ label, href: settingsTabHref(key), active: key === tab })), 'Settings')}
    <div class="settings-panel">${body}</div>
  </div>`;
}
