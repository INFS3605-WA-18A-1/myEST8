import type { ReactElement, ReactNode } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { HtmlHost } from '../runtime/host.tsx';

export interface EmptyStateProps {
  /** One sentence saying what will appear here, e.g. "No Tickets need you right now." */
  text: string;
  /** The action to take, usually a Button or LinkButton. */
  action?: ReactNode;
}

/** "Nothing here yet": one centred sentence and the action to take, inside a section or lane. */
export function EmptyState({ text, action }: EmptyStateProps): ReactElement {
  return <HtmlHost render={(slot) => ui.emptyState(text, slot('action', action))} />;
}
