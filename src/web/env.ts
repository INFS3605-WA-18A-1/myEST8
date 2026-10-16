import type { PropertyManagerActions } from '../app.ts';
import type { PropertyManager } from '../profiles.ts';

/** What a signed-in request carries: the Property Manager and their actions, limited to their Agency. */
export type WebEnv = {
  Variables: {
    pm: PropertyManager;
    actions: PropertyManagerActions;
    /** The rail's counts, read once per request by `loadNavCounts` (src/web/shell.ts). */
    navCounts?: { requests: number; approvals: number };
  };
};
