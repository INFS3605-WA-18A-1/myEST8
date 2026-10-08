// STUB — the simulator pages agent replaces this file. Exported names are the contract.
import { Hono } from 'hono';
import type { WebEnv } from '../web/env.ts';
import type { DemoControls } from './controls.ts';

/** The phone simulator under /demo. Mounted behind requirePropertyManager. */
export function simulatorPages(_demo: DemoControls) {
  return new Hono<WebEnv>();
}
