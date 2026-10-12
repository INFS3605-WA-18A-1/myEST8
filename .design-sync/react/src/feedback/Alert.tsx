import type { ReactElement, ReactNode } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { EMPTY, HtmlHost } from '../runtime/host.tsx';
import type { Tone } from '../types.ts';

export interface AlertProps {
  children: ReactNode;
  /** Defaults to info. warning and error are announced as alerts. */
  tone?: Tone;
  /** A bold first line. */
  title?: string;
}

/** A message inside a page (daisyUI alert, soft style): a flag to check, a refused action, an expired link. Icon and words, never colour alone. */
export function Alert({ children, tone, title }: AlertProps): ReactElement {
  return <HtmlHost render={(slot) => ui.alert(slot('body', children) ?? EMPTY, tone, { title })} />;
}
