import type { ReactElement } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { HtmlHost } from '../runtime/host.tsx';
import type { HostEvents } from '../types.ts';

export interface SegmentedProps extends HostEvents {
  items: { label: string; href: string; active: boolean }[];
}

/** The Mine/All control for AppShell's controls: links with the current one filled. */
export function Segmented({ items, onClick }: SegmentedProps): ReactElement {
  return <HtmlHost onClick={onClick} render={() => ui.segmented(items)} />;
}
