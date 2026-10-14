import type { PropertyManagerActions } from '../app.ts';
import type { ChannelType } from '../ports.ts';
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

/**
 * How the Agency's channels connect on this server (docs/adr/0004). A channel with no real provider is
 * simulated: connected for the Agency when it signs up, and answered by the phone simulator. Without
 * this (tests of the older forms) the Agency types in each address itself.
 */
export interface ChannelModes {
  /** Gmail is set up: the Agency connects its email channel by signing in to Google. */
  gmail: boolean;
  /** The WhatsApp Cloud API number, when WhatsApp is set up: the Agency connects it with one button. */
  whatsappNumber?: string | undefined;
  /** Twilio can buy SMS numbers: the Agency gets one with one button (docs/adr/0005). */
  smsNumbers?: boolean | undefined;
}

/** The channels simulated for a new Agency: every one that has no real provider. */
export function simulatedChannels(modes: ChannelModes): ChannelType[] {
  return [...(modes.smsNumbers ? [] : (['sms'] as const)), ...(modes.whatsappNumber ? [] : (['whatsapp'] as const)), ...(modes.gmail ? [] : (['email'] as const))];
}
