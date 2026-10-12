import type { ReactElement } from 'react';
import { icon } from '../../../../src/web/icons.ts';
import { HtmlHost } from '../runtime/host.tsx';
import type { IconWeight } from '../types.ts';

export interface IconProps {
  /** A Phosphor icon name in kebab-case: "house", "wrench", "calendar-dots", "share-network". */
  name: string;
  /** Defaults to regular; every regular icon is included. Other weights only for the icons the app uses. */
  weight?: IconWeight;
  /** A Tailwind size class; defaults to size-5 (20px). The rail uses size-[18px]. */
  size?: string;
}

/** A Phosphor icon, inline, in the text colour and hidden from screen readers: the words beside it carry the meaning. */
export function Icon({ name, weight, size }: IconProps): ReactElement {
  return <HtmlHost render={() => icon(name, { weight, size })} />;
}
