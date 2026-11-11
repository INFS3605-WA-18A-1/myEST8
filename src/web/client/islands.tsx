// React islands: the parts of a server-drawn page that React runs (docs/adr/0021). The server
// still renders every page with Hono; an island is an element marked `data-island="name"` (with
// its props as JSON in `data-props`), and this file mounts the matching component into it, now
// and again on the content an in-page navigation brings (app.js's `myest8:content`). Page-wide
// islands, such as the toaster, mount once into their own root at the end of <body>.
//
// Built by `npm run islands` into static/islands.js, which head() loads after app.js.

import { type ComponentType, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FlashToaster, toastFlashes } from './toaster.tsx';

/** Components a server page can place with `island(name, props)` (ui.ts). */
const ISLANDS: Record<string, ComponentType<Record<string, unknown>>> = {};

const mounted = new WeakMap<Element, Root>();

function mountIslands(root: ParentNode) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-island]')) {
    if (mounted.has(el)) continue;
    const Component = ISLANDS[el.dataset.island ?? ''];
    if (!Component) continue;
    const props = el.dataset.props ? (JSON.parse(el.dataset.props) as Record<string, unknown>) : {};
    const reactRoot = createRoot(el);
    reactRoot.render(<Component {...props} />);
    mounted.set(el, reactRoot);
  }
}

function pageRoot(id: string) {
  const el = document.createElement('div');
  el.id = id;
  document.body.append(el);
  return createRoot(el);
}

/** The toaster, then the page's flashes: the Toaster's own effect subscribes before this one runs. */
function PageToaster() {
  useEffect(() => toastFlashes(document), []);
  return <FlashToaster />;
}

pageRoot('toaster').render(<PageToaster />);
mountIslands(document);

document.addEventListener('myest8:content', (event) => {
  const root = (event as CustomEvent<ParentNode>).detail;
  if (!root) return;
  toastFlashes(root);
  mountIslands(root);
});
