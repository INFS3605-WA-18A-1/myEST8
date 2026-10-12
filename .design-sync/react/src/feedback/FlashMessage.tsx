import type { ReactElement } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { HtmlHost } from '../runtime/host.tsx';

export interface FlashMessageProps {
  /** ok for a done action, error for a refused one. */
  kind: 'ok' | 'error';
  message: string;
}

/** The one-line result of an action, shown under the top bar (AppShell's flash prop renders it for you). */
export function FlashMessage({ kind, message }: FlashMessageProps): ReactElement {
  return <HtmlHost render={() => ui.flashMessage({ kind, message })} />;
}
