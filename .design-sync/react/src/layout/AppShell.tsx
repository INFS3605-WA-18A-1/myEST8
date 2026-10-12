import type { ReactElement, ReactNode } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { EMPTY, HtmlHost } from '../runtime/host.tsx';
import type { HostEvents, NavKey } from '../types.ts';

export interface AppShellProps extends HostEvents {
  /** The page's only <h1>, in the top bar ("Dashboard", "Ticket #1042"). */
  title: string;
  /** The signed-in Property Manager. Without one there is no rail or user menu. */
  pm?: { name: string } | null;
  /** The rail section to mark current. */
  active?: NavKey;
  /** The result of the last action, under the top bar. */
  flash?: { kind: 'ok' | 'error'; message: string } | null;
  /** A line under the title. */
  subtitle?: ReactNode;
  /** Buttons beside the subtitle. */
  actions?: ReactNode;
  /** Controls in the top bar, such as the Mine/All Segmented control. */
  controls?: ReactNode;
  /** The Agency's name at the bottom of the rail. */
  agencyName?: string;
  /** Today's date in the top bar, e.g. "Sat 10 Oct". */
  today?: string;
  /** Counts beside rail links. */
  navCounts?: Partial<Record<NavKey, number>>;
  /** Whether the rail shows the Simulator link. Defaults to true. */
  demo?: boolean;
  /** The page body. Top-level children are spaced 16-24px apart. */
  children: ReactNode;
}

/**
 * A signed-in Property Manager's screen: the dark left rail (logo, Dashboard,
 * Calendar, Setup, Simulator), the top bar with the title, date and user menu, the
 * flash, then the body on the Surfmist page. Use it as the root of every desk screen.
 */
export function AppShell({ title, pm, active, flash, subtitle, actions, controls, agencyName, today, navCounts, demo, children, onClick }: AppShellProps): ReactElement {
  // The app paints the page colour on <body>; the shell carries it so it looks the same in any host page.
  return (
    <div style={{ background: 'var(--page)', color: 'var(--ink)', minHeight: '100%' }}>
    <HtmlHost
      document
      onClick={onClick}
      render={(slot) =>
        ui.page({
          title,
          pm,
          active,
          flash,
          subtitle: slot('subtitle', subtitle),
          actions: slot('actions', actions),
          controls: slot('controls', controls),
          shell: agencyName !== undefined || today !== undefined ? { agencyName: agencyName ?? '', today: today ?? '' } : undefined,
          navCounts,
          demo,
          body: slot('body', children) ?? EMPTY,
        })
      }
    />
    </div>
  );
}
