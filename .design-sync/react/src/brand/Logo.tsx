import type { ReactElement } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { HtmlHost } from '../runtime/host.tsx';

export interface LogoProps {
  /** sm is a 20px mark, md (default) 28px. */
  size?: 'sm' | 'md';
}

/** The myEST8 logo: a house whose door is a display-board 8, beside the wordmark. One colour (currentColor). */
export function Logo({ size }: LogoProps): ReactElement {
  return <HtmlHost render={() => ui.logo({ size })} />;
}
