import type { ReactElement, ReactNode } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { EMPTY, HtmlHost } from '../runtime/host.tsx';
import type { HostEvents } from '../types.ts';

export interface DocketProps extends HostEvents {
  /** The Ticket number, shown as #1042. */
  number: number;
  /** Makes the whole docket one link to the Ticket. Without it, a picture of a docket. */
  href?: string;
  /** urgent and high colour the stub; routine is plain. */
  urgency: 'urgent' | 'high' | 'routine' | (string & {});
  /** The full address (the hover title). */
  address: string;
  /** Shown in place of the full address, e.g. "14 Arden St". */
  street?: string;
  /** The issue, wraps to two lines. */
  issue: string;
  /** Small facts in the meta row: a StatusBadge, "Plumber", "2 days ago". */
  meta: ReactNode[];
  /** Unread messages: adds the unread dot. */
  unread?: number;
  /** large is the Ticket page's header, with a 26px number. */
  size?: 'default' | 'large';
}

/**
 * A Ticket as a work-order docket: the number and Urgency word in a stub, a dashed
 * perforation, then the address, the issue and a meta row. Only Tickets get this
 * shape; everything else is a QueueRow or plain row.
 */
export function Docket({ meta, onClick, ...o }: DocketProps): ReactElement {
  return <HtmlHost onClick={onClick} render={(slot) => ui.docket({ ...o, meta: meta.map((item, i) => slot(`m${i}`, item) ?? EMPTY) })} />;
}
