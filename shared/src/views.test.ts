import { describe, expect, it } from 'vitest';
import { makeColumn } from './columns';
import type { ItemLike } from './itemLike';
import {
  calendarEntries,
  entriesOnDay,
  kanbanLanes,
  laneKeysOf,
  monthWeeks,
  moveBetweenLanes,
  rescheduled,
  spanOf,
  stepAnchor,
  unscheduled,
  weekOf,
} from './views';

const status = makeColumn('status', 'Status');
const people = makeColumn('people', 'Who');
const dropdown = makeColumn('dropdown', 'Kind');
const date = makeColumn('date', 'Due');
const timeline = makeColumn('timeline', 'When');
const item = (id: string, values: Record<string, unknown>): ItemLike => ({
  id,
  name: id,
  groupId: 'g',
  order: id,
  parentId: null,
  itemNumber: 1,
  values,
  archived: false,
  deleted: false,
});

describe('kanban', () => {
  it('has a lane per label plus a "none" lane last', () => {
    const lanes = kanbanLanes(status, [], () => 'blue');
    expect(lanes.length).toBe((status.settings.labels ?? []).length + 1);
    expect(lanes.at(-1)).toMatchObject({ key: null, name: 'No status' });
  });
  it('people lanes come from the members', () => {
    const lanes = kanbanLanes(people, [{ uid: 'a', name: 'Ann' }], () => 'blue');
    expect(lanes.map((l) => l.name)).toEqual(['Ann', 'Unassigned']);
  });
  it('laneKeysOf: status, multi, and empty', () => {
    expect(laneKeysOf(status, 's1')).toEqual(['s1']);
    expect(laneKeysOf(status, undefined)).toEqual([null]);
    expect(laneKeysOf(people, ['a', 'b'])).toEqual(['a', 'b']);
    expect(laneKeysOf(people, [])).toEqual([null]);
  });
  it('moving a status card sets the new label, or clears it', () => {
    expect(moveBetweenLanes(status, 'a', 'a', 'b')).toBe('b');
    expect(moveBetweenLanes(status, 'a', 'a', null)).toBeNull();
  });
  it('moving a multi-value card swaps only its own lane', () => {
    expect(moveBetweenLanes(people, ['a', 'b'], 'a', 'c')).toEqual(['b', 'c']);
    expect(moveBetweenLanes(people, ['a', 'b'], 'a', 'b')).toEqual(['b']);
    expect(moveBetweenLanes(people, ['a'], 'a', null)).toBeNull();
    expect(moveBetweenLanes(dropdown, undefined, null, 'x')).toEqual(['x']);
  });
});

describe('calendar', () => {
  it('spans: date, timeline, invalid', () => {
    expect(spanOf(date, '2026-03-05')).toEqual({ start: '2026-03-05', end: '2026-03-05' });
    expect(spanOf(timeline, { start: '2026-03-05', end: '2026-03-08' })).toEqual({
      start: '2026-03-05',
      end: '2026-03-08',
    });
    expect(spanOf(timeline, { start: '2026-03-09', end: '2026-03-08' })).toBeNull();
    expect(spanOf(date, 'nope')).toBeNull();
    expect(spanOf(date, undefined)).toBeNull();
  });
  it('rescheduling keeps a timeline length (across month and leap day)', () => {
    expect(rescheduled(date, '2026-03-05', '2026-03-09')).toBe('2026-03-09');
    expect(rescheduled(timeline, { start: '2028-02-27', end: '2028-03-01' }, '2028-03-10')).toEqual(
      { start: '2028-03-10', end: '2028-03-13' },
    );
    expect(rescheduled(date, undefined, '2026-03-09')).toBeUndefined();
  });
  it('month grid is whole Monday-first weeks', () => {
    // March 2026 starts on a Sunday → Monday 23 Feb leads, 5 weeks → 6 weeks
    const w = monthWeeks('2026-03-15');
    expect(w[0]![0]).toBe('2026-02-23');
    expect(w[0]![6]).toBe('2026-03-01');
    expect(w.every((r) => r.length === 7)).toBe(true);
    expect(w.flat()).toContain('2026-03-31');
    // Feb 2027 starts on Monday and has 28 days: exactly 4 weeks
    expect(monthWeeks('2027-02-10')).toHaveLength(4);
    expect(monthWeeks('2027-02-10')[0]![0]).toBe('2027-02-01');
  });
  it('week and stepping', () => {
    expect(weekOf('2026-03-04')[0]).toBe('2026-03-02');
    expect(weekOf('2026-03-04')[6]).toBe('2026-03-08');
    expect(stepAnchor('2026-01-31', 'month', 1)).toBe('2026-02-01');
    expect(stepAnchor('2026-01-15', 'month', -1)).toBe('2025-12-01');
    expect(stepAnchor('2026-03-04', 'week', -1)).toBe('2026-02-25');
  });
  it('entries and unscheduled', () => {
    const items = [
      item('b', { [date.id]: '2026-03-05' }),
      item('a', { [date.id]: '2026-03-02' }),
      item('c', {}),
    ];
    const entries = calendarEntries(items, date);
    expect(entries.map((e) => e.item.id)).toEqual(['a', 'b']);
    expect(unscheduled(items, date).map((i) => i.id)).toEqual(['c']);
    expect(entriesOnDay(entries, '2026-03-05').map((e) => e.item.id)).toEqual(['b']);
  });
  it('a timeline item appears on every day it covers', () => {
    const e = calendarEntries(
      [item('t', { [timeline.id]: { start: '2026-03-02', end: '2026-03-04' } })],
      timeline,
    );
    expect(
      ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'].map(
        (d) => entriesOnDay(e, d).length,
      ),
    ).toEqual([0, 1, 1, 1, 0]);
  });
});
