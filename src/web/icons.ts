// Icons from Phosphor (MIT, https://phosphoricons.com), rendered inline so they
// take the text colour and need no extra request. Each SVG is read from
// @phosphor-icons/core once, on first use. Icons are decorative: the text
// beside them carries the meaning, so they're always hidden from screen readers.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

const require = createRequire(import.meta.url);

export type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';

const cache = new Map<string, string>();

/** The inner markup (paths) of one Phosphor icon. Throws for a name Phosphor doesn't have. */
function paths(name: string, weight: IconWeight): string {
  const key = `${weight}/${name}`;
  let body = cache.get(key);
  if (body === undefined) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error(`No Phosphor icon "${name}"`);
    let svg: string;
    try {
      const file = weight === 'regular' ? `${name}.svg` : `${name}-${weight}.svg`;
      svg = readFileSync(require.resolve(`@phosphor-icons/core/assets/${weight}/${file}`), 'utf8');
    } catch {
      throw new Error(`No Phosphor icon "${name}" (${weight})`);
    }
    body = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    cache.set(key, body);
  }
  return body;
}

/**
 * One Phosphor icon by its kebab-case name ("house", "share-network"), 20px by
 * default. `size` is a Tailwind size class; `weight` defaults to regular.
 */
export function icon(name: string, o: { weight?: IconWeight; size?: string } = {}): HtmlEscapedString {
  const body = paths(name, o.weight ?? 'regular');
  const size = o.size ?? 'size-5';
  // width/height repeat the size class's pixels: Tailwind builds its CSS in the
  // browser, so without JavaScript the class does nothing and the SVG would fill
  // its container. CSS still wins over these attributes when it runs.
  const px = pixels(size);
  const dimensions = px ? ` width="${px}" height="${px}"` : '';
  return raw(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" class="${size} shrink-0"${dimensions} aria-hidden="true" focusable="false">${body}</svg>`,
  );
}

/** The pixels of a Tailwind size class: "size-5" is 20 (4px a step), "size-[18px]" is 18. Null for anything else. */
function pixels(size: string): number | null {
  const step = /^size-(\d+(?:\.\d+)?)$/.exec(size);
  if (step) return Number(step[1]) * 4;
  const exact = /^size-\[(\d+(?:\.\d+)?)px\]$/.exec(size);
  return exact ? Number(exact[1]) : null;
}
