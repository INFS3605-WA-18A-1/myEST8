import type { ReactElement, ReactNode } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { HtmlHost } from '../runtime/host.tsx';

export interface SectionHeaderProps {
  title: string;
  actions?: ReactNode;
}

/** A heading for a group of dockets or a list that isn't inside a Section, with actions on the right. */
export function SectionHeader({ title, actions }: SectionHeaderProps): ReactElement {
  return <HtmlHost render={(slot) => ui.sectionHeader(title, slot('actions', actions))} />;
}
