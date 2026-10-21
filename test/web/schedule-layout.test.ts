import { describe, expect, test } from 'vitest';
import { assignLanes, clusterOverlaps, gridRows, hourRange, layoutDay, minuteOfDay } from '../../src/web/schedule-layout.ts';

const SYDNEY = 'Australia/Sydney';
const at = (hhmm: string, day = '2026-10-13') => new Date(`${day}T${hhmm}:00+11:00`).toISOString();
const span = (from: string, to: string, id = `${from}-${to}`) => ({ id, from: toMinutes(from), to: toMinutes(to) });
function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

describe('minuteOfDay', () => {
  test("counts the minutes since the Agency's midnight on that day", () => {
    expect(minuteOfDay(at('09:30'), '2026-10-13', SYDNEY)).toBe(570);
  });

  test('clamps an instant on an earlier day to 0 and a later day to the end of the day', () => {
    expect(minuteOfDay(at('22:00', '2026-10-12'), '2026-10-13', SYDNEY)).toBe(0);
    expect(minuteOfDay(at('01:00', '2026-10-14'), '2026-10-13', SYDNEY)).toBe(24 * 60);
  });

  test('reads the wall clock, so a daylight-saving day still starts at 0 and ends at 24:00', () => {
    // Sydney moves its clocks forward at 2 am on Sunday 4 October 2026.
    expect(minuteOfDay(new Date('2026-10-04T09:00:00+11:00').toISOString(), '2026-10-04', SYDNEY)).toBe(540);
  });
});

describe('clusterOverlaps', () => {
  test('groups bookings that overlap, transitively, and keeps the rest on their own', () => {
    const a = span('09:00', '11:00', 'a');
    const b = span('10:30', '12:00', 'b'); // overlaps a
    const c = span('11:30', '13:00', 'c'); // overlaps b only, so it joins a's cluster
    const d = span('14:00', '15:00', 'd');
    expect(clusterOverlaps([d, c, a, b]).map((cl) => cl.map((x) => x.id))).toEqual([['a', 'b', 'c'], ['d']]);
  });

  test('a booking that ends as another starts does not overlap it', () => {
    expect(clusterOverlaps([span('09:00', '10:00', 'a'), span('10:00', '11:00', 'b')]).map((cl) => cl.map((x) => x.id))).toEqual([['a'], ['b']]);
  });

  test('nothing booked is no clusters', () => {
    expect(clusterOverlaps([])).toEqual([]);
  });
});

describe('assignLanes', () => {
  test('puts each booking in the first lane free at its start, so the lanes are as few as the most at once', () => {
    const a = span('09:00', '11:00', 'a');
    const b = span('10:00', '12:00', 'b');
    const c = span('11:00', '13:00', 'c'); // a has ended: c takes lane 0 again
    const d = span('10:30', '11:30', 'd'); // a and b both running: lane 2
    const { lanes, placed } = assignLanes([a, b, c, d]);
    expect(lanes).toBe(3);
    expect(Object.fromEntries(placed.map((p) => [p.item.id, p.lane]))).toEqual({ a: 0, b: 1, d: 2, c: 0 });
  });

  test('one booking is one lane', () => {
    expect(assignLanes([span('09:00', '10:00')]).lanes).toBe(1);
  });
});

describe('hourRange', () => {
  test('is 7 am to 7 pm when every booking fits in it', () => {
    expect(hourRange([span('09:00', '11:00')])).toEqual({ first: 7, last: 19 });
    expect(hourRange([])).toEqual({ first: 7, last: 19 });
  });

  test('grows to the whole hours around a booking outside it', () => {
    expect(hourRange([span('06:30', '08:00'), span('18:00', '20:15')])).toEqual({ first: 6, last: 21 });
  });
});

describe('gridRows', () => {
  const range = { first: 7, last: 19 };

  test('places a booking on 15-minute rows counted from the first hour, as CSS grid lines', () => {
    // 9:00 is 8 quarter hours after 7:00, so it starts on line 9; 11:00 ends on line 17.
    expect(gridRows(span('09:00', '11:00'), range)).toEqual({ rowStart: 9, rowEnd: 17 });
  });

  test('rounds out to whole quarter hours and is always at least one row', () => {
    expect(gridRows(span('09:05', '09:10'), range)).toEqual({ rowStart: 9, rowEnd: 10 });
    expect(gridRows(span('09:10', '09:20'), range)).toEqual({ rowStart: 9, rowEnd: 11 });
    expect(gridRows(span('09:00', '09:00'), range)).toEqual({ rowStart: 9, rowEnd: 10 });
  });

  test('clamps a booking that runs outside the hours shown', () => {
    expect(gridRows(span('05:00', '08:00'), range)).toEqual({ rowStart: 1, rowEnd: 5 });
    expect(gridRows(span('18:00', '23:00'), range)).toEqual({ rowStart: 45, rowEnd: 49 });
  });
});

describe('layoutDay', () => {
  test('lays out a day: clusters with their time span and lanes, each booking on its rows and lane', () => {
    const bookings = [
      { id: 'pete', start: at('09:00'), end: at('11:00') },
      { id: 'dana', start: at('10:00'), end: at('12:00') },
      { id: 'sam', start: at('14:00'), end: at('15:00') },
    ];
    const day = layoutDay(bookings, '2026-10-13', SYDNEY);

    expect(day.range).toEqual({ first: 7, last: 19 });
    expect(day.rows).toBe(48);
    expect(day.lanes).toBe(2);
    expect(day.clusters.map((c) => ({ ids: c.items.map((p) => p.item.id), lanes: c.lanes, rowStart: c.rowStart, rowEnd: c.rowEnd, from: c.from, to: c.to }))).toEqual([
      { ids: ['pete', 'dana'], lanes: 2, rowStart: 9, rowEnd: 21, from: 540, to: 720 },
      { ids: ['sam'], lanes: 1, rowStart: 29, rowEnd: 33, from: 840, to: 900 },
    ]);
    expect(day.clusters[0]!.items.map((p) => [p.lane, p.rowStart, p.rowEnd])).toEqual([
      [0, 9, 17],
      [1, 13, 21],
    ]);
  });

  test('takes the hour range given, so every day of a week shares one', () => {
    const day = layoutDay([{ start: at('09:00'), end: at('10:00') }], '2026-10-13', SYDNEY, { first: 6, last: 20 });
    expect(day.range).toEqual({ first: 6, last: 20 });
    expect(day.rows).toBe(56);
    expect(day.clusters[0]).toMatchObject({ rowStart: 13, rowEnd: 17 });
  });

  test('a booking that began the day before starts at midnight on this day', () => {
    const day = layoutDay([{ start: at('22:00', '2026-10-12'), end: at('08:00') }], '2026-10-13', SYDNEY);
    expect(day.range).toEqual({ first: 0, last: 19 });
    expect(day.clusters[0]).toMatchObject({ from: 0, to: 480, rowStart: 1, rowEnd: 33 });
  });
});
