// Renders the HTML that src/web/ui.ts builds, unchanged, inside React. Props that
// take React content become slots: a <ds-slot> placeholder in the HTML that the
// React children are portalled into, so they stay live (state, handlers).

import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type * as React from 'react';
import { createPortal } from 'react-dom';
import { raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { HostEvents } from '../types.ts';

/**
 * Puts `node` into the HTML: text is escaped, anything else gets a slot. Nothing
 * (null, undefined, booleans) is undefined, so ui.ts leaves the part out.
 */
export type SlotFn = (key: string, node: ReactNode) => HtmlEscapedString | undefined;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
/** No content, for a required part. */
export const EMPTY: HtmlEscapedString = raw('');

export function HtmlHost(props: {
  render: (slot: SlotFn) => HtmlEscapedString | Promise<HtmlEscapedString> | string;
  /** Take the markup inside <body> (for ui.ts layouts that build a whole document). */
  document?: boolean;
  onClick?: HostEvents['onClick'];
  onInput?: (event: React.FormEvent<HTMLElement>) => void;
}): ReactElement {
  const host = useId();
  const slots = new Map<string, ReactNode>();
  const slot: SlotFn = (key, node) => {
    if (node === null || node === undefined || node === false || node === true) return undefined;
    if (typeof node === 'string' || typeof node === 'number') return raw(escape(String(node)));
    slots.set(key, node);
    return raw(`<ds-slot data-host="${host}" data-slot="${key}" style="display:contents"></ds-slot>`);
  };
  let markup = String(props.render(slot));
  if (props.document) markup = new DOMParser().parseFromString(markup, 'text/html').body.innerHTML;

  const ref = useRef<HTMLSpanElement>(null);
  const [targets, setTargets] = useState<Map<string, Element>>(() => new Map());
  useLayoutEffect(() => {
    const found = new Map<string, Element>();
    for (const el of ref.current?.querySelectorAll<HTMLElement>('ds-slot') ?? []) {
      if (el.dataset.host === host && el.dataset.slot) found.set(el.dataset.slot, el);
    }
    setTargets(found);
  }, [markup, host]);

  return (
    <Fragment>
      <span ref={ref} style={{ display: 'contents' }} onClick={props.onClick} onInput={props.onInput} dangerouslySetInnerHTML={{ __html: markup }} />
      {[...slots].map(([key, node]) => {
        const target = targets.get(key);
        return target ? <Fragment key={key}>{createPortal(node, target)}</Fragment> : null;
      })}
    </Fragment>
  );
}
