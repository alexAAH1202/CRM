import { describe, expect, it } from 'vitest';
import { accumulate, pacificDay } from './dailyUsage';

const z = { reads: 0, writes: 0, deletes: 0 };
describe('daily usage log', () => {
  it('adds the growth since last time, and survives a counter reset', () => {
    let log = accumulate({}, '2026-11-10', z, { reads: 10, writes: 2, deletes: 0 });
    log = accumulate(
      log,
      '2026-11-10',
      { reads: 10, writes: 2, deletes: 0 },
      { reads: 15, writes: 2, deletes: 1 },
    );
    expect(log['2026-11-10']).toEqual({ reads: 15, writes: 2, deletes: 1 });
    // the session meter was reset to 0 and has counted 3 since
    log = accumulate(
      log,
      '2026-11-10',
      { reads: 15, writes: 2, deletes: 1 },
      { reads: 3, writes: 0, deletes: 0 },
    );
    expect(log['2026-11-10']!.reads).toBe(18);
  });
  it('keeps a week', () => {
    let log = {};
    for (let d = 1; d <= 10; d++)
      log = accumulate(log, `2026-11-${String(d).padStart(2, '0')}`, z, {
        reads: d,
        writes: 0,
        deletes: 0,
      });
    expect(Object.keys(log)).toHaveLength(7);
    expect(Object.keys(log)[0]).toBe('2026-11-04');
  });
  it('uses the Pacific day (when Firebase resets its limits)', () => {
    // 07:00 UTC on 10 Nov is 23:00 on 9 Nov in Los Angeles
    expect(pacificDay(Date.UTC(2026, 10, 10, 7))).toBe('2026-11-09');
  });
});
