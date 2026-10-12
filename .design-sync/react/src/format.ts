// The formatters every screen uses, from src/web/ui.ts.
import * as ui from '../../../src/web/ui.ts';

/** Cents as Australian dollars ("$1,250.00"), or an em dash for null. */
export const formatMoney: (cents: number | null) => string = ui.formatMoney;
/** A timestamp in the Agency's time zone: "Mon 12 Oct, 9:00 am". */
export const formatWhen: (iso: string | null, timeZone?: string) => string = ui.formatWhen;
/** The time of day: "9:00 am". */
export const formatTime: (iso: string | null, timeZone?: string) => string = ui.formatTime;
/** A short day: "Wed 7 Oct". */
export const formatDay: (iso: string | null, timeZone?: string) => string = ui.formatDay;
/** How long ago: "2 days ago", "1 hour ago", "just now". */
export const formatAge: (iso: string | null, now?: Date) => string = ui.formatAge;
/** "awaiting_owner" -> "Awaiting owner". */
export const humanise: (value: string) => string = ui.humanise;
/** A Job stage's label ("scheduled" is "Booked"). */
export const jobStageLabel: (status: string) => string = ui.jobStageLabel;
/** The Job stages in workflow order with their labels. */
export const JOB_STAGES: { status: string; label: string }[] = ui.JOB_STAGES;
