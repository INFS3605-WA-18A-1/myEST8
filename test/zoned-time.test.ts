import { describe, expect, test } from 'vitest';
import { addDays, dayOf, daysFrom, formatWeekdayDateAndTime, mondayOf, parseDay, startOfDay, weekdayOf } from '../src/zoned-time.ts';

const SYDNEY = 'Australia/Sydney';

describe('naming a visit in a sentence', () => {
  test('the weekday, the date and the time, with the minutes only when there are some', () => {
    expect(formatWeekdayDateAndTime(new Date('2026-10-26T22:00:00Z'), SYDNEY)).toBe('Tuesday 27 October at 9 am');
    expect(formatWeekdayDateAndTime('2026-10-27T22:30:00Z', SYDNEY)).toBe('Wednesday 28 October at 9:30 am');
    expect(formatWeekdayDateAndTime('2026-12-31T14:15:00Z', SYDNEY)).toBe('Friday 1 January at 1:15 am');
  });
});

describe('calendar days in the Agency time zone', () => {
  test('an instant falls on the day the Agency clock shows, not the UTC day', () => {
    // 10:30 pm UTC on the 12th is 9:30 am on the 13th in Sydney (AEDT, +11).
    expect(dayOf(new Date('2026-10-12T22:30:00Z'), SYDNEY)).toBe('2026-10-13');
    expect(dayOf('2026-10-12T22:30:00Z', 'UTC')).toBe('2026-10-12');
  });

  test('a day starts at local midnight, on both sides of a daylight-saving change', () => {
    expect(startOfDay('2026-10-13', SYDNEY).toISOString()).toBe('2026-10-12T13:00:00.000Z'); // AEDT, +11
    expect(startOfDay('2026-09-30', SYDNEY).toISOString()).toBe('2026-09-29T14:00:00.000Z'); // AEST, +10
    // Clocks went forward on Sunday 4 October 2026: the day is 23 hours long.
    expect(startOfDay('2026-10-05', SYDNEY).getTime() - startOfDay('2026-10-04', SYDNEY).getTime()).toBe(23 * 3_600_000);
  });

  test('adding days crosses months, years and the daylight-saving change as whole days', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-03', 2)).toBe('2026-10-05');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysFrom('2026-10-30', 4)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  test('a week runs Monday to Sunday', () => {
    expect(weekdayOf('2026-10-12')).toBe(1);
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    expect(mondayOf('2026-10-14')).toBe('2026-10-12');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
  });

  test('a day from a link is used only when it is a real day', () => {
    expect(parseDay('2026-10-14')).toBe('2026-10-14');
    expect(parseDay('2026-02-30')).toBeNull();
    expect(parseDay('2026-10-1')).toBeNull();
    expect(parseDay('next week')).toBeNull();
    expect(parseDay(undefined)).toBeNull();
  });
});
