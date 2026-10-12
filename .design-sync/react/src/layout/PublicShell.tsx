import type { ReactElement, ReactNode } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { EMPTY, HtmlHost } from '../runtime/host.tsx';
import type { HostEvents } from '../types.ts';

export interface PublicShellProps extends HostEvents {
  /** The page's <h1>, above the body. */
  title: string;
  flash?: { kind: 'ok' | 'error'; message: string } | null;
  subtitle?: ReactNode;
  /** narrow (400px) for a single form, default (560px), or wide (1120px). */
  width?: 'narrow' | 'default' | 'wide';
  /** hero makes the title a 32-40px headline, for the landing page. */
  titleSize?: 'page' | 'hero';
  /** Links or buttons at the right of the logo bar. */
  headerActions?: ReactNode;
  /** Replaces the footer line for Tenants. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * A page for someone not signed in: a Tenant with an upload or tracker link, or a
 * Property Manager signing in or up. Phone first: a logo bar, one centred column,
 * a footer line, no rail.
 */
export function PublicShell({ title, flash, subtitle, width, titleSize, headerActions, footer, children, onClick }: PublicShellProps): ReactElement {
  // The app paints the page colour on <body>; the shell carries it so it looks the same in any host page.
  return (
    <div style={{ background: 'var(--page)', color: 'var(--ink)', minHeight: '100%' }}>
    <HtmlHost
      document
      onClick={onClick}
      render={(slot) =>
        ui.publicPage({
          title,
          flash,
          subtitle: slot('subtitle', subtitle),
          width,
          titleSize,
          headerActions: slot('headerActions', headerActions),
          footer: slot('footer', footer),
          body: slot('body', children) ?? EMPTY,
        })
      }
    />
    </div>
  );
}
