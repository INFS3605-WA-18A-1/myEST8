import type { ReactElement, ReactNode } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { EMPTY, HtmlHost } from '../runtime/host.tsx';
import type { HostEvents, Variant } from '../types.ts';

export interface PostButtonProps extends HostEvents {
  /** Where the form posts, e.g. "/tickets/42/approve". */
  action: string;
  children: ReactNode;
  /** Defaults to primary. */
  variant?: Variant;
  size?: 'sm' | 'md';
  /** Hidden fields posted with it. */
  fields?: Record<string, string | number>;
  /** A question to confirm first ("Cancel this Job?"); the app asks it before posting. */
  confirm?: string;
}

/** A one-click action: a small inline form with one button that POSTs, as for Confirm, Approve and Sign out. */
export function PostButton({ action, children, onClick, ...o }: PostButtonProps): ReactElement {
  return <HtmlHost onClick={onClick} render={(slot) => ui.postButton(action, slot('label', children) ?? EMPTY, o)} />;
}
