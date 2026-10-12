import type { ReactElement, ReactNode } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { EMPTY, HtmlHost } from '../runtime/host.tsx';
import type { HostEvents } from '../types.ts';

export interface QueueRowProps extends HostEvents {
  /** Makes the title a link. */
  href?: string;
  /** A small photo, e.g. <img src=... alt="" />. */
  thumb?: ReactNode;
  title: string;
  /** One line under the title. */
  detail?: string;
  badges?: ReactNode[];
  /** Muted facts, e.g. "Requested 2 hours ago by Priya Shah". */
  meta?: string;
  /** Buttons, e.g. Review and Confirm (size sm). */
  actions?: ReactNode;
  /** Needs the Property Manager's decision: the 4px hi-vis stripe on the left. Only for decisions. */
  decision?: boolean;
}

/** A compact row in a queue (requests, quotes, approvals): thumb, title, detail, badges, meta and actions. */
export function QueueRow({ thumb, badges, actions, onClick, ...o }: QueueRowProps): ReactElement {
  return (
    <HtmlHost
      onClick={onClick}
      render={(slot) =>
        ui.queueRow({
          ...o,
          thumb: slot('thumb', thumb),
          badges: badges?.map((badge, i) => slot(`b${i}`, badge) ?? EMPTY),
          actions: slot('actions', actions),
        })
      }
    />
  );
}
