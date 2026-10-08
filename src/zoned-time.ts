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

/** Formats an instant for a message: "Tue 13 Oct, 9:00 am". */
export function formatVisit(at: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at));
}
