import type { ReactElement, ReactNode } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { EMPTY, HtmlHost } from '../runtime/host.tsx';

export interface LaneProps {
  /** The stage, e.g. "Quoting" or "With Property Owner". */
  title: string;
  count: number;
  /** Usually Dockets, or an EmptyState. */
  children: ReactNode;
}

/** A board column on the dashboard: a heading with its count chip, and a body that scrolls inside about 300px. */
export function Lane({ title, count, children }: LaneProps): ReactElement {
  return <HtmlHost render={(slot) => ui.lane({ title, count, body: slot('body', children) ?? EMPTY })} />;
}
