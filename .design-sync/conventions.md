# myEST8: the dispatch desk

These components render the real markup of myEST8's server-side design system (`src/web/ui.ts`): daisyUI 5 classes, the "myest8" theme and tokens from `app.css`, and Tailwind v4 utilities. Loading `_ds_bundle.js` sets `data-theme="myest8"` on `<html>` and starts Tailwind's browser build, so **any Tailwind utility you write is generated at runtime**, and the token colours work as utilities (`bg-page`, `text-muted`, `border-line`, `text-urgent`, `bg-hivis`...). No provider is needed.

## Build screens like this
- A Property Manager's screen is `<AppShell title pm active ...>` (Gumleaf rail with a Wattle bar on the current item; the page header with the title, controls and user menu is the first row of the content column). A Tenant or sign-in screen is `<PublicShell title width ...>`. Top-level children of either are spaced for you.
- Group content in `<Section title actions>` (white, 1px hairline, 8px radius, no shadow). Inside: `Docket` for Tickets (only Tickets get the docket shape), `QueueRow` for requests/quotes/approvals, `Table`, `DetailsList`, `Timeline`, `ChatBubble`.
- Dashboard: `CountSentence` under the title, then a `NeedsYou` section of `QueueRow`s, then `Lane`s of `Docket`s in a 2-4 column grid.
- Status words come from the domain: `StatusBadge status="awaiting_owner"` reads "With Property Owner"; pass `job` on a Job's status. Urgency is `UrgencyBadge`. Never colour alone.
- Wattle (`--hivis`) means "needs your decision" only: the 4px bar on the left edge of `NeedsYou`, the current rail item, and `CountSentence` items with `decision`. Never text, never on a button, never a wash. "Filled in by AI" text uses `AiFilled` (`--info-bg`).
- One `Button variant="primary"` per area; `secondary` (outlined), `ghost`, `danger` for destructive. `size="sm"` in rows. Labels are sentence-case verbs, no arrows. Buttons default to `type="submit"`: pass `type="button"` outside forms.
- Links are real `href`s. For in-prototype navigation pass `onClick` and call `event.preventDefault()` (on Button, LinkButton, Docket, QueueRow, Tabs, Segmented, CountSentence, Steps, AppShell). `Field` is uncontrolled: read edits with `onInput`.
- Formatters on the bundle: `formatMoney(cents)` "$480.00", `formatWhen(iso)` "Mon 12 Oct, 9:00 am", `formatDay`, `formatTime`, `formatAge`, `humanise`, `JOB_STAGES`.

## Tokens and type (read `_ds_bundle.css` for the full set)
`--ink` text, `--page` background, `--surface` white, `--muted` secondary text, `--line` hairlines, `--control` input borders, `--action` Gum #27694B (primary, links, focus), `--hivis` Wattle #FFC233, `--info-bg`, `--urgent`/`--urgent-bg` (Rust), `--high`/`--high-bg` (Ochre), `--done`/`--done-bg` (Slate, kept off green so Gum always means act). `--ink` is Ironbark #1C2622, `--page` Gumleaf #ECEFE9. Fonts: `--font-head` Bricolage Grotesque (page titles, section headings, docket numbers, wordmark), `--font-body` Public Sans 14px (everything else). Spacing 4/8/12/16/24/32; radius 4 (badges, inputs), 6 (buttons), 8 (sections). One shadow, `--shadow-lift`, on menus and dialogs only. Sentence case; no all-caps eyebrows; tabular numbers via the `num` class.

## Example
```jsx
const { AppShell, NeedsYou, QueueRow, UrgencyBadge, StatusBadge, Button } = window.MyEST8;
<AppShell title="Requests" pm={{ name: 'Sam Carter' }} active="dashboard" agencyName="Coogee Bay Realty" today="Sat 10 Oct">
  <NeedsYou>
    <QueueRow decision title="Leaking hot water system" detail="14 Arden St, Coogee"
      badges={[<UrgencyBadge urgency="urgent" />, <StatusBadge status="maintenance_request" />]}
      meta="Reported 2 hours ago by Priya Shah"
      actions={<><Button type="button" size="sm" variant="secondary">Review</Button><Button type="button" size="sm">Confirm</Button></>} />
  </NeedsYou>
  <div className="grid grid-cols-2 gap-4 text-sm text-muted">...</div>
</AppShell>
```
