import type { ReactElement, ReactNode } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { EMPTY, HtmlHost } from '../runtime/host.tsx';
import type { HostEvents, Variant } from '../types.ts';

export interface ButtonProps extends HostEvents {
  /** The label: a verb for what happens ("Approve quote", "Send to Tenant"). */
  children: ReactNode;
  /** Defaults to primary. Use one primary per area; danger for destructive actions. */
  variant?: Variant;
  /** Defaults to submit, as the app's buttons live in forms. Use button outside a form. */
  type?: 'submit' | 'button';
  name?: string;
  value?: string;
  /** sm for buttons in rows and toolbars. */
  size?: 'sm' | 'md';
  /** Full width, as on phone forms. */
  block?: boolean;
  disabled?: boolean;
}

/**
 * A form button (daisyUI btn): primary (Deep Ocean), secondary (outlined), danger
 * (urgent red) or ghost. Sentence-case verb labels, no trailing arrows.
 */
export function Button({ children, onClick, ...o }: ButtonProps): ReactElement {
  return <HtmlHost onClick={onClick} render={(slot) => ui.button(slot('label', children) ?? EMPTY, o)} />;
}
