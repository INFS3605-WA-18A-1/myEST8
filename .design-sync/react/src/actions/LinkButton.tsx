import type { ReactElement, ReactNode } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { EMPTY, HtmlHost } from '../runtime/host.tsx';
import type { HostEvents, Variant } from '../types.ts';

export interface LinkButtonProps extends HostEvents {
  children: ReactNode;
  href: string;
  /** Defaults to secondary (outlined). */
  variant?: Variant;
  size?: 'sm' | 'md';
  block?: boolean;
}

/** A link styled as a button: navigation that looks like an action ("Open Ticket", "Back to dashboard"). */
export function LinkButton({ children, href, onClick, ...o }: LinkButtonProps): ReactElement {
  return <HtmlHost onClick={onClick} render={(slot) => ui.linkButton(slot('label', children) ?? EMPTY, href, o)} />;
}
