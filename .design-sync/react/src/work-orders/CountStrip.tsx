import type { ReactElement } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { HtmlHost } from '../runtime/host.tsx';
import type { HostEvents } from '../types.ts';

export interface CountStripProps extends HostEvents {
  /** Each count links into its queue. decision: needs the PM's decision (the hi-vis chip). */
  items: { label: string; count: number; href: string; decision?: boolean }[];
}

/** The dashboard's count strip: one 36px row of counts that link into the queues. Decision counts take the hi-vis chip. */
export function CountStrip({ items, onClick }: CountStripProps): ReactElement {
  return <HtmlHost onClick={onClick} render={() => ui.countStrip(items)} />;
}
