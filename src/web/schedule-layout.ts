// Where the Schedule's time grid puts each booked visit on a day. Pure: it knows
// minutes and CSS grid lines, not HTML.
//
// A day is cut into 15-minute rows over the hours shown (7 am to 7 pm, grown to the
// whole hours around any visit outside them). Visits that overlap, directly or through
// another, are one cluster: the Week and Month views show a cluster as "N Jobs booked",
// and the Day view lays its visits side by side, each in the first lane free when it
// starts, so a cluster takes as many lanes as it has visits running at once.

import { dayOf, wallClock } from '../zoned-time.ts';

/** Minutes from the day's midnight: `from` inclusive, `to` exclusive. */
export interface Interval {
  from: number;
  to: number;
}

/** The whole hours shown, `first` to `last` (7 to 19 is 7 am to 7 pm). */
export interface HourRange {
  first: number;
  last: number;
}

export const DEFAULT_HOURS: HourRange = { first: 7, last: 19 };

/** Minutes in one grid row. */
export const SLOT_MINUTES = 15;

const DAY_MINUTES = 24 * 60;

/**
 * Minutes since `day`'s midnight on the Agency's wall clock: 0 for an instant on an
 * earlier day, 24:00 for one on a later day. The wall clock, not elapsed time, so a
 * daylight-saving day still runs from 0 to 24:00 on the grid.
 */
export function minuteOfDay(at: string, day: string, timeZone: string): number {
  const on = dayOf(at, timeZone);
  if (on < day) return 0;
  if (on > day) return DAY_MINUTES;
  const w = wallClock(new Date(at), timeZone);
  return w.hour * 60 + w.minute;
}

/**
 * Overlapping intervals grouped together, transitively (a overlaps b and b overlaps c
 * puts all three in one), in start order. Touching ends don't overlap.
 */
export function clusterOverlaps<T extends Interval>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => a.from - b.from || a.to - b.to);
  const clusters: T[][] = [];
  let end = -Infinity;
  for (const item of sorted) {
    if (clusters.length && item.from < end) {
      clusters.at(-1)!.push(item);
      end = Math.max(end, item.to);
    } else {
      clusters.push([item]);
      end = item.to;
    }
  }
  return clusters;
}

/** Each interval in the first lane free at its start (greedy interval colouring), in start order. */
export function assignLanes<T extends Interval>(items: T[]): { lanes: number; placed: { item: T; lane: number }[] } {
  const sorted = [...items].sort((a, b) => a.from - b.from || a.to - b.to);
  const laneEnds: number[] = [];
  const placed = sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.from);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.to;
    return { item, lane };
  });
  return { lanes: Math.max(1, laneEnds.length), placed };
}

/** The hours to show: `fallback` (7 am to 7 pm), grown to the whole hours around any interval outside it. */
export function hourRange(items: Interval[], fallback: HourRange = DEFAULT_HOURS): HourRange {
  let { first, last } = fallback;
  for (const i of items) {
    first = Math.min(first, Math.floor(i.from / 60));
    last = Math.max(last, Math.ceil(i.to / 60));
  }
  return { first: Math.max(0, first), last: Math.min(24, last) };
}

/**
 * The CSS grid lines an interval runs between, on 15-minute rows counted from the
 * range's first hour (line 1). Rounded out to whole rows, at least one row, and
 * clamped to the hours shown.
 */
export function gridRows(i: Interval, range: HourRange): { rowStart: number; rowEnd: number } {
  const rows = (range.last - range.first) * (60 / SLOT_MINUTES);
  const clamp = (n: number) => Math.min(rows, Math.max(0, n));
  const offset = range.first * 60;
  const start = clamp(Math.floor((i.from - offset) / SLOT_MINUTES));
  const end = clamp(Math.ceil((i.to - offset) / SLOT_MINUTES));
  const first = Math.min(start, rows - 1);
  return { rowStart: first + 1, rowEnd: Math.max(first + 1, end) + 1 };
}

export interface PlacedBooking<T> {
  item: T;
  from: number;
  to: number;
  lane: number;
  rowStart: number;
  rowEnd: number;
}

export interface Cluster<T> {
  items: PlacedBooking<T>[];
  from: number;
  to: number;
  lanes: number;
  rowStart: number;
  rowEnd: number;
}

export interface DayLayout<T> {
  range: HourRange;
  /** How many 15-minute rows the range is. */
  rows: number;
  /** The most lanes any cluster needs: the Day view's column count. */
  lanes: number;
  clusters: Cluster<T>[];
}

/**
 * One day's bookings laid out on the grid. `range` is the hours to show (for a week,
 * the range across all its days); left out, it is worked out from this day alone. A
 * booking that runs past midnight is cut at the day's edge.
 */
export function layoutDay<T extends { start: string; end: string }>(bookings: T[], day: string, timeZone: string, range?: HourRange): DayLayout<T> {
  const spans = bookings.map((item) => ({ item, from: minuteOfDay(item.start, day, timeZone), to: minuteOfDay(item.end, day, timeZone) }));
  const hours = range ?? hourRange(spans);
  const clusters = clusterOverlaps(spans).map((members): Cluster<T> => {
    const { lanes, placed } = assignLanes(members);
    const from = Math.min(...members.map((m) => m.from));
    const to = Math.max(...members.map((m) => m.to));
    return {
      items: placed.map(({ item, lane }) => ({ item: item.item, from: item.from, to: item.to, lane, ...gridRows(item, hours) })),
      from,
      to,
      lanes,
      ...gridRows({ from, to }, hours),
    };
  });
  return { range: hours, rows: (hours.last - hours.first) * (60 / SLOT_MINUTES), lanes: Math.max(1, ...clusters.map((c) => c.lanes)), clusters };
}
