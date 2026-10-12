import type { ReactElement } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { HtmlHost } from '../runtime/host.tsx';
import type { HostEvents } from '../types.ts';

export interface TabsProps extends HostEvents {
  /** Links between views of one page; count shows a quiet count chip. */
  items: { label: string; href: string; active: boolean; count?: number }[];
  /** The nav's accessible name. Defaults to "Views". */
  label?: string;
}

/** Links that switch between views of one page (daisyUI tabs, border style). For Mine/All in the top bar use Segmented. */
export function Tabs({ items, label, onClick }: TabsProps): ReactElement {
  return <HtmlHost onClick={onClick} render={() => ui.tabs(items, label)} />;
}
