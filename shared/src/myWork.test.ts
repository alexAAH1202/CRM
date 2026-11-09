import { describe, expect, it } from 'vitest';
import { makeColumn } from './columns';
import { bucketOf, dueDateOf, groupMyWork, isDone, type MyWorkEntry } from './myWork';

const status = makeColumn('status', 'Status', {
  labels: [
    { id: 'a', name: 'Working', color: 'blue' },
    { id: 'b', name: 'Done', color: 'green' },
  ],
  defaultLabelId: 'a',
});
const due = makeColumn('date', 'Due date');
const other = makeColumn('date', 'Last done');
const tl = makeColumn('timeline', 'When');

describe('dueDateOf / isDone', () => {
  it('prefers a date column called due, else the first date, else a timeline end', () => {
    expect(dueDateOf([other, due], { [other.id]: '2026-01-01', [due.id]: '2026-02-02' })).toBe(
      '2026-02-02',
    );
    expect(dueDateOf([other], { [other.id]: '2026-01-01' })).toBe('2026-01-01');
    expect(dueDateOf([tl], { [tl.id]: { start: '2026-03-01', end: '2026-03-09' } })).toBe(
      '2026-03-09',
    );
    expect(dueDateOf([due], {})).toBeNull();
    expect(dueDateOf([], {})).toBeNull();
  });
  it('done means the status label reads like done', () => {
    expect(isDone([status], { [status.id]: 'b' })).toBe(true);
    expect(isDone([status], { [status.id]: 'a' })).toBe(false);
    expect(isDone([status], {})).toBe(false);
    expect(isDone([], {})).toBe(false);
  });
});

describe('buckets', () => {
  const today = '2026-03-10';
  it('overdue / today / week / later / none', () => {
    expect(bucketOf('2026-03-09', today)).toBe('overdue');
    expect(bucketOf('2026-03-10', today)).toBe('today');
    expect(bucketOf('2026-03-17', today)).toBe('week');
    expect(bucketOf('2026-03-18', today)).toBe('later');
    expect(bucketOf(null, today)).toBe('none');
    expect(bucketOf('garbage', today)).toBe('none');
  });
  const e = (iid: string, d: string | null, done = false): MyWorkEntry => ({
    key: iid,
    bid: 'b',
    boardName: 'B',
    iid,
    name: iid,
    due: d,
    done,
  });
  it('groups in order, sorted by date, hides done unless asked', () => {
    const rows = [
      e('c', '2026-04-01'),
      e('a', '2026-03-01'),
      e('d', null),
      e('z', '2026-03-10', true),
      e('b', '2026-03-10'),
    ];
    const g = groupMyWork(rows, today, false);
    expect(g.map((x) => x.bucket)).toEqual(['overdue', 'today', 'later', 'none']);
    expect(g[1]!.entries.map((x) => x.iid)).toEqual(['b']);
    const all = groupMyWork(rows, today, true);
    expect(all[1]!.entries.map((x) => x.iid).sort()).toEqual(['b', 'z']);
    expect(groupMyWork([], today, false)).toEqual([]);
  });
});
