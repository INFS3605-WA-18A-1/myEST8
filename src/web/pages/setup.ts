// STUB — a page agent replaces this file. Exported names are the contract.
import { Hono } from 'hono';
import type { WebEnv } from '../env.ts';

/** Onboarding under /setup: channels and test messages, Properties, people and Tradies. */
export function setupPages() {
  return new Hono<WebEnv>();
}
