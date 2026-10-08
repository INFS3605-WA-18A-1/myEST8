// STUB — the UX/UI agent replaces this file. Exported names are the contract.
import { Hono } from 'hono';

/** Serves /assets/*: Tailwind's browser build, daisyUI, and the app's own CSS and JS. */
export function assetRoutes() {
  return new Hono();
}
