import type { ReactElement, ReactNode } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { EMPTY, HtmlHost } from '../runtime/host.tsx';

export interface SectionProps {
  /** The <h2>, in sentence case ("Needs your decision"). Leave it out for an untitled surface. */
  title?: string;
  /** Buttons or links at the right of the heading. */
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}

/**
 * The page's grouping surface: white, a 1px hairline, 8px radius, the heading on the
 * left and actions on the right, then the body. Not a card: no shadow, and dockets
 * and rows sit inside it. (ui.ts section() and card().)
 */
export function Section({ title, actions, children, id }: SectionProps): ReactElement {
  return (
    <HtmlHost
      render={(slot) => {
        const o = { actions: slot('actions', actions), body: slot('body', children) ?? EMPTY, id };
        return title ? ui.section({ ...o, title }) : ui.card(o);
      }}
    />
  );
}
