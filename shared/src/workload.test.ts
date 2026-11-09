import { describe, expect, it } from 'vitest';
import { isOver, mondayOf, workloadGrid, type WorkItem } from './workload';

const item = (
  id: string,
  start: string,
  end: string,
  people: string[],
  hours: number | null,
): WorkItem => ({
  id,
  name: id,
  span: { start, end },
  people,
  hours,
});
const base = { firstWeek: '2026-03-04', weeks: 3, capacity: 40, capacityByUid: {} };

describe('workload', () => {
  it('mondayOf', () => {
    expect(mondayOf('2026-03-04')).toBe('2026-03-02');
    expect(mondayOf('2026-03-08')).toBe('2026-03-02');
    expect(mondayOf('2026-03-02')).toBe('2026-03-02');
  });
  it('without hours, uses 8h per working day', () => {
    const g = workloadGrid({
      ...base,
      items: [item('a', '2026-03-02', '2026-03-06', ['u1'], null)],
    });
    expect(g.weekStarts).toEqual(['2026-03-02', '2026-03-09', '2026-03-16']);
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0]!.hours).toEqual([40, 0, 0]);
  });
  it('hours are spread over working days and split between weeks', () => {
    // Fri 6 Mar → Mon 9 Mar: 2 working days (Fri, Mon), 10h → 5 each
    const g = workloadGrid({ ...base, items: [item('a', '2026-03-06', '2026-03-09', ['u1'], 10)] });
    expect(g.rows[0]!.hours).toEqual([5, 5, 0]);
    expect(g.rows[0]!.total).toBe(10);
  });
  it('a weekend-only item still counts (spread over all its days)', () => {
    const g = workloadGrid({ ...base, items: [item('a', '2026-03-07', '2026-03-08', ['u1'], 6)] });
    expect(g.rows[0]!.hours[0]).toBe(6);
  });
  it('splits between assignees; unassigned is its own row, last', () => {
    const g = workloadGrid({
      ...base,
      items: [
        item('a', '2026-03-02', '2026-03-02', ['u1', 'u2'], 8),
        item('b', '2026-03-03', '2026-03-03', [], 4),
      ],
    });
    expect(g.rows.map((r) => r.key)).toEqual(['u1', 'u2', null]);
    expect(g.rows[0]!.hours[0]).toBe(4);
    expect(g.rows[2]!.hours[0]).toBe(4);
  });
  it('flags over-capacity, with per-person overrides; unassigned is never over', () => {
    const g = workloadGrid({
      ...base,
      capacityByUid: { u2: 10 },
      items: [
        item('a', '2026-03-02', '2026-03-06', ['u1'], 41),
        item('b', '2026-03-02', '2026-03-06', ['u2'], 12),
        item('c', '2026-03-02', '2026-03-06', [], 500),
      ],
    });
    const by = Object.fromEntries(g.rows.map((r) => [String(r.key), r]));
    expect(isOver(by['u1']!, by['u1']!.hours[0]!)).toBe(true);
    expect(isOver(by['u2']!, by['u2']!.hours[0]!)).toBe(true);
    expect(isOver(by['null']!, by['null']!.hours[0]!)).toBe(false);
    const exact = workloadGrid({
      ...base,
      items: [item('a', '2026-03-02', '2026-03-06', ['u1'], 40)],
    });
    expect(isOver(exact.rows[0]!, 40)).toBe(false);
  });
  it('ignores work outside the window and zero or negative hours', () => {
    const g = workloadGrid({
      ...base,
      items: [
        item('a', '2026-01-01', '2026-01-05', ['u1'], 10),
        item('b', '2026-03-02', '2026-03-02', ['u1'], 0),
      ],
    });
    expect(g.rows.every((r) => r.total === 0)).toBe(true);
  });
});
