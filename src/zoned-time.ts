// Wall-clock time in an Agency's time zone, using only Intl.

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function wallClock(at: Date, timeZone: string): WallClock {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday!),
  };
}

/** The instant at which the wall clock in `timeZone` shows the given time. */
export function zonedInstant(timeZone: string, year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = asUtc - offset(new Date(asUtc), timeZone);
  instant = asUtc - offset(new Date(instant), timeZone);
  return new Date(instant);
}

function offset(at: Date, timeZone: string) {
  const w = wallClock(at, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return asUtc - Math.floor(at.getTime() / 60_000) * 60_000;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clockWords(at: Date | string, timeZone: string) {
  const w = wallClock(new Date(at), timeZone);
  const hour = w.hour % 12 || 12;
  const minute = String(w.minute).padStart(2, '0');
  return { w, time: `${hour}:${minute} ${w.hour < 12 ? 'am' : 'pm'}` };
}

/** Formats an instant for a message: "Tue 13 Oct, 9:00 am". Written out so ICU can't add a comma or "Sept". */
export function formatVisit(at: Date | string, timeZone: string) {
  const { w, time } = clockWords(at, timeZone);
  return `${WEEKDAYS[w.weekday]} ${w.day} ${MONTHS[w.month - 1]}, ${time}`;
}

/** Formats the day of an instant for a message: "Tue 13 Oct", as `formatVisit` writes it without the time. */
export function formatDay(at: Date | string, timeZone: string) {
  const w = wallClock(new Date(at), timeZone);
  return `${WEEKDAYS[w.weekday]} ${w.day} ${MONTHS[w.month - 1]}`;
}

/** The confirm-page button: "Tuesday 27 Oct, 9:00 am". The short form is formatVisit. */
export function formatVisitDay(at: Date | string, timeZone: string) {
  const { w, time } = clockWords(at, timeZone);
  return `${WEEKDAYS_LONG[w.weekday]} ${w.day} ${MONTHS[w.month - 1]}, ${time}`;
}

/** Formats an instant for a sentence: "Tuesday 27 October at 9 am", or "Tuesday 27 October at 9:30 am". */
export function formatWeekdayDateAndTime(at: Date | string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month} at ${parts.hour}${parts.minute === '00' ? '' : `:${parts.minute}`} ${parts.dayPeriod}`;
}

// Calendar days in the Agency's time zone. A day is written "2026-10-12": it sorts and
// compares as text, and the arithmetic on it is plain UTC dates, so it never meets a
// daylight-saving change. Only the instant a day starts depends on the time zone.

/** The calendar day ("2026-10-12") an instant falls on in the time zone. */
export function dayOf(at: Date | string, timeZone: string): string {
  const w = wallClock(new Date(at), timeZone);
  return dayKey(w.year, w.month, w.day);
}

/** The day `days` after (or, when negative, before) `day`. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const at = new Date(Date.UTC(year!, month! - 1, date! + days));
  return dayKey(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

/** The Monday of the week (Monday to Sunday) that `day` is in. */
export function mondayOf(day: string): string {
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

/** 0 = Sunday ... 6 = Saturday, as in WallClock. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** The instant `day` starts in the time zone. */
export function startOfDay(day: string, timeZone: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return zonedInstant(timeZone, year!, month!, date!);
}

/** `count` days in a row from `first`. */
export function daysFrom(first: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

/** "2026-10-12" from a query string or form, or null when it isn't a real day. */
export function parseDay(value: string | undefined | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null;
  return addDays(value!, 0) === value ? value : null;
}

function dayKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
