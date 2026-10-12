import type { ReactElement } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { HtmlHost } from '../runtime/host.tsx';
import type { HostEvents } from '../types.ts';

export interface StepsProps extends HostEvents {
  /** The stages in order. Done ones are ticked; detail is a small line under the label. */
  items: { label: string; done: boolean; detail?: string; href?: string }[];
  /** Always vertical. By default vertical on phones and horizontal from 1024px. */
  vertical?: boolean;
  /** Always horizontal, small labels on phones: a wizard's short step names. */
  horizontal?: boolean;
  /** The stage being shown (index), when it isn't the first one not done. */
  current?: number;
}

/** Progress through stages (daisyUI steps), as on the Tenant's tracker and the setup wizard. */
export function Steps({ items, onClick, ...o }: StepsProps): ReactElement {
  return <HtmlHost onClick={onClick} render={() => ui.steps(items, o)} />;
}
