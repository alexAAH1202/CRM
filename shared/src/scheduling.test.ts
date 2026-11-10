import { describe, expect, it } from 'vitest';
import {
  describeRecurrence,
  describeTime,
  fireAtForDate,
  isValidTimeZone,
  localDateIn,
  nextOccurrence,
  parseRecurrence,
  zonedToUtcMs,
  type Schedule,
} from './scheduling';

const MEL = 'Australia/Melbourne';
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const utc = (s: string) => Date.parse(s);

describe('time zones', () => {
  it('Melbourne is +11 in summer and +10 in winter', () => {
    expect(iso(zonedToUtcMs('2026-01-15', '09:00', MEL))).toBe('2026-01-14T22:00:00.000Z');
    expect(iso(zonedToUtcMs('2026-07-15', '09:00', MEL))).toBe('2026-07-14T23:00:00.000Z');
  });
  it('handles the days clocks change (Melbourne 2026: forward Sun 4 Oct, back Sun 5 Apr)', () => {
    // Before / after the October change
    expect(iso(zonedToUtcMs('2026-10-03', '09:00', MEL))).toBe('2026-10-02T23:00:00.000Z'); // +10
    expect(iso(zonedToUtcMs('2026-10-05', '09:00', MEL))).toBe('2026-10-04T22:00:00.000Z'); // +11
    // The change day itself: 09:00 is after the 2am jump, so +11
    expect(iso(zonedToUtcMs('2026-10-04', '09:00', MEL))).toBe('2026-10-03T22:00:00.000Z');
    // April: back to +10
    expect(iso(zonedToUtcMs('2026-04-05', '09:00', MEL))).toBe('2026-04-04T23:00:00.000Z');
    expect(iso(zonedToUtcMs('2026-04-04', '09:00', MEL))).toBe('2026-04-03T22:00:00.000Z');
  });
  it('a time that does not exist (02:30 on the spring-forward day) lands after the gap, never throws', () => {
    const ms = zonedToUtcMs('2026-10-04', '02:30', MEL)!;
    expect(ms).toBeGreaterThan(utc('2026-10-03T15:00:00Z'));
    expect(ms).toBeLessThan(utc('2026-10-03T17:30:00Z'));
  });
  it('works in other zones, including half-hour ones and west of Greenwich', () => {
    expect(iso(zonedToUtcMs('2026-03-10', '12:00', 'UTC'))).toBe('2026-03-10T12:00:00.000Z');
    expect(iso(zonedToUtcMs('2026-03-10', '09:00', 'Asia/Kolkata'))).toBe(
      '2026-03-10T03:30:00.000Z',
    );
    expect(iso(zonedToUtcMs('2026-01-10', '09:00', 'America/New_York'))).toBe(
      '2026-01-10T14:00:00.000Z',
    );
  });
  it('rejects bad input', () => {
    expect(zonedToUtcMs('nope', '09:00', MEL)).toBeNull();
    expect(zonedToUtcMs('2026-03-10', '25:00', MEL)).toBeNull();
    expect(zonedToUtcMs('2026-02-30', '09:00', MEL)).toBeNull();
    expect(isValidTimeZone('Australia/Melbourne')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
  it('local date near midnight depends on the zone', () => {
    // 23:30 UTC on 9 March is already 10:30 on 10 March in Melbourne (+11)
    expect(localDateIn(utc('2026-03-09T23:30:00Z'), MEL)).toBe('2026-03-10');
    expect(localDateIn(utc('2026-03-09T23:30:00Z'), 'UTC')).toBe('2026-03-09');
  });
});

describe('date-relative fire times', () => {
  it('N days before / after, at a time of day, in the zone', () => {
    expect(iso(fireAtForDate('2026-03-20', -3, '09:00', MEL))).toBe('2026-03-16T22:00:00.000Z'); // 17 Mar 09:00 +11
    expect(iso(fireAtForDate('2026-03-20', 1, '08:30', 'UTC'))).toBe('2026-03-21T08:30:00.000Z');
    expect(iso(fireAtForDate('2026-03-01', -1, '09:00', 'UTC'))).toBe('2026-02-28T09:00:00.000Z');
    expect(fireAtForDate('bad', 0, '09:00', MEL)).toBeNull();
  });
});

describe('recurrence', () => {
  const sched = (
    recurrence: Schedule['recurrence'],
    atTime = '09:00',
    startDate = '2026-03-02',
  ): Schedule => ({ recurrence, atTime, startDate });
  const next = (s: Schedule, after: string, tz = 'UTC') => iso(nextOccurrence(s, utc(after), tz));

  it('daily and every N days (anchored at the start date)', () => {
    expect(next(sched({ kind: 'daily', every: 1 }), '2026-03-10T10:00:00Z')).toBe(
      '2026-03-11T09:00:00.000Z',
    );
    expect(next(sched({ kind: 'daily', every: 1 }), '2026-03-10T08:00:00Z')).toBe(
      '2026-03-10T09:00:00.000Z',
    );
    // every 3 days from 2 Mar: 2, 5, 8, 11
    expect(next(sched({ kind: 'daily', every: 3 }), '2026-03-09T00:00:00Z')).toBe(
      '2026-03-11T09:00:00.000Z',
    );
  });
  it('is strictly after the moment given (never fires twice for the same instant)', () => {
    const s = sched({ kind: 'daily', every: 1 });
    const first = nextOccurrence(s, utc('2026-03-10T08:00:00Z'), 'UTC')!;
    expect(nextOccurrence(s, first, 'UTC')).toBe(first + 86_400_000);
  });
  it('not before the start date', () => {
    expect(
      next(sched({ kind: 'daily', every: 1 }, '09:00', '2026-04-01'), '2026-03-10T00:00:00Z'),
    ).toBe('2026-04-01T09:00:00.000Z');
  });
  it('weekly on chosen weekdays, and every other week', () => {
    // Mon+Thu; 10 Mar 2026 is a Tuesday
    expect(
      next(sched({ kind: 'weekly', every: 1, weekdays: [1, 4] }), '2026-03-10T00:00:00Z'),
    ).toBe('2026-03-12T09:00:00.000Z');
    expect(
      next(sched({ kind: 'weekly', every: 1, weekdays: [1, 4] }), '2026-03-12T10:00:00Z'),
    ).toBe('2026-03-16T09:00:00.000Z');
    // every 2 weeks from the week of 2 Mar, on Mondays: 2 Mar, 16 Mar, 30 Mar
    expect(next(sched({ kind: 'weekly', every: 2, weekdays: [1] }), '2026-03-03T00:00:00Z')).toBe(
      '2026-03-16T09:00:00.000Z',
    );
    expect(next(sched({ kind: 'weekly', every: 2, weekdays: [1] }), '2026-03-17T00:00:00Z')).toBe(
      '2026-03-30T09:00:00.000Z',
    );
  });
  it('Sunday counts as the end of the week (Monday-first), across a year boundary', () => {
    expect(
      next(
        sched({ kind: 'weekly', every: 1, weekdays: [0] }, '09:00', '2026-12-21'),
        '2026-12-27T10:00:00Z',
      ),
    ).toBe('2027-01-03T09:00:00.000Z');
  });
  it('monthly: on the day, clamped to the last day of short months, every N months', () => {
    const m31 = sched({ kind: 'monthly', every: 1, dayOfMonth: 31 }, '09:00', '2026-01-01');
    expect(next(m31, '2026-01-31T10:00:00Z')).toBe('2026-02-28T09:00:00.000Z'); // Feb has 28
    expect(next(m31, '2026-02-28T10:00:00Z')).toBe('2026-03-31T09:00:00.000Z');
    expect(next(m31, '2026-03-31T10:00:00Z')).toBe('2026-04-30T09:00:00.000Z');
    expect(next(m31, '2028-01-31T10:00:00Z')).toBe('2028-02-29T09:00:00.000Z'); // leap year
    const quarterly = sched({ kind: 'monthly', every: 3, dayOfMonth: 15 }, '09:00', '2026-01-01');
    expect(next(quarterly, '2026-01-16T00:00:00Z')).toBe('2026-04-15T09:00:00.000Z');
  });
  it('respects the time zone, including across a daylight-saving change', () => {
    const s = sched({ kind: 'daily', every: 1 }, '09:00', '2026-10-01');
    expect(next(s, '2026-10-02T12:00:00Z', MEL)).toBe('2026-10-02T23:00:00.000Z'); // 3 Oct 09:00 (+10)
    expect(next(s, '2026-10-03T12:00:00Z', MEL)).toBe('2026-10-03T22:00:00.000Z'); // 4 Oct 09:00 (+11)
    expect(next(s, '2026-10-04T12:00:00Z', MEL)).toBe('2026-10-04T22:00:00.000Z'); // 5 Oct 09:00 (+11)
  });
  it('invalid schedules never fire (and never hang)', () => {
    expect(
      nextOccurrence(
        { recurrence: { kind: 'daily', every: 1 }, atTime: '99:00', startDate: '2026-03-02' },
        0,
        'UTC',
      ),
    ).toBeNull();
    expect(
      nextOccurrence(
        { recurrence: { kind: 'daily', every: 1 }, atTime: '09:00', startDate: 'x' },
        0,
        'UTC',
      ),
    ).toBeNull();
    // a very long interval still finds its next run (52 months on: June 2030, last day)
    expect(
      nextOccurrence(
        {
          recurrence: { kind: 'monthly', every: 52, dayOfMonth: 31 },
          atTime: '09:00',
          startDate: '2026-02-01',
        },
        utc('2026-03-01T00:00:00Z'),
        'UTC',
      ),
    ).toBe(utc('2030-06-30T09:00:00Z'));
  });
  it('parseRecurrence validates and normalises', () => {
    expect(parseRecurrence({ kind: 'daily' })).toEqual({ kind: 'daily', every: 1 });
    expect(parseRecurrence({ kind: 'daily', every: 0 })).toEqual({ kind: 'daily', every: 1 });
    expect(parseRecurrence({ kind: 'daily', every: 500 })).toEqual({ kind: 'daily', every: 1 });
    expect(parseRecurrence({ kind: 'weekly', weekdays: [5, 1, 1, 9, 'x'] })).toEqual({
      kind: 'weekly',
      every: 1,
      weekdays: [1, 5],
    });
    expect(parseRecurrence({ kind: 'weekly', weekdays: [] })).toBeNull();
    expect(parseRecurrence({ kind: 'monthly', dayOfMonth: 0 })).toBeNull();
    expect(parseRecurrence({ kind: 'monthly', dayOfMonth: 32 })).toBeNull();
    expect(parseRecurrence({ kind: 'yearly' })).toBeNull();
    expect(parseRecurrence(null)).toBeNull();
  });
  it('describes in plain language', () => {
    expect(describeRecurrence({ kind: 'daily', every: 1 })).toBe('every day');
    expect(describeRecurrence({ kind: 'daily', every: 3 })).toBe('every 3 days');
    expect(describeRecurrence({ kind: 'weekly', every: 1, weekdays: [1, 3] })).toBe(
      'every week on Mon, Wed',
    );
    expect(describeRecurrence({ kind: 'weekly', every: 2, weekdays: [0] })).toBe(
      'every 2 weeks on Sun',
    );
    expect(describeRecurrence({ kind: 'monthly', every: 1, dayOfMonth: 1 })).toBe(
      'every month on the 1st',
    );
    expect(describeRecurrence({ kind: 'monthly', every: 3, dayOfMonth: 22 })).toBe(
      'every 3 months on the 22nd',
    );
    expect(describeRecurrence({ kind: 'monthly', every: 1, dayOfMonth: 11 })).toBe(
      'every month on the 11th',
    );
    expect(describeTime('09:00')).toBe('9am');
    expect(describeTime('13:30')).toBe('1:30pm');
    expect(describeTime('00:05')).toBe('12:05am');
    expect(describeTime('12:00')).toBe('12pm');
  });
});
