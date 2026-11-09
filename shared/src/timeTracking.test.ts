import { describe, expect, it } from 'vitest';
import { makeColumn, normalizeValue, valueToText } from './columns';
import { summarize } from './summaries';
import {
  addSession,
  dayIn,
  enforceCap,
  filterRows,
  formatDuration,
  groupRows,
  MAX_SESSION_MS,
  MAX_TIME_SESSIONS,
  normalizeTimeValue,
  planStartTimer,
  planStopTimer,
  removeSession,
  replaceSession,
  rowsFromItems,
  sessionProblem,
  toHours,
  totalMs,
  totalsByUid,
  type TimeSession,
} from './timeTracking';
import { toCsv } from './csv';
import { boardToCsv } from './csv';

const H = 3_600_000;
const T0 = Date.UTC(2026, 2, 2, 9, 0, 0); // 2 Mar 2026 09:00 UTC
let n = 0;
const sess = (
  uid: string,
  startH: number,
  hours: number,
  extra: Partial<TimeSession> = {},
): TimeSession => ({
  id: `s${++n}`,
  uid,
  start: T0 + startH * H,
  end: T0 + (startH + hours) * H,
  ...extra,
});

describe('normalizing and totalling', () => {
  it('keeps valid sessions sorted, drops junk, duplicates and over-long ones', () => {
    const a = sess('u1', 0, 1);
    const v = normalizeTimeValue({
      sessions: [
        sess('u2', 5, 2),
        a,
        { ...a }, // duplicate id
        { id: 'x', uid: 'u1', start: 5, end: 3 }, // end before start
        { id: 'y', uid: 'u1', start: T0, end: T0 + MAX_SESSION_MS + 1 }, // too long
        { id: 'z', uid: '', start: T0, end: T0 + H },
        null,
        'nope',
      ],
    })!;
    expect(v.sessions.map((s) => s.uid)).toEqual(['u1', 'u2']);
    expect(normalizeTimeValue({ sessions: [] })).toBeNull();
    expect(normalizeTimeValue(null)).toBeNull();
    expect(normalizeTimeValue([1, 2])).toBeNull();
  });
  it('totals overall and per person; formats and converts durations', () => {
    const v = normalizeTimeValue({
      sessions: [sess('u1', 0, 1.5), sess('u1', 3, 0.5), sess('u2', 4, 1)],
    })!;
    expect(totalMs(v)).toBe(3 * H);
    expect(totalsByUid(v).get('u1')).toBe(2 * H);
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(30_000)).toBe('30s');
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration(H)).toBe('1h');
    expect(formatDuration(80 * 60_000)).toBe('1h 20m');
    expect(formatDuration(-5)).toBe('0m');
    expect(toHours(90 * 60_000)).toBe(1.5);
    expect(toHours(20 * 60_000)).toBe(0.33);
  });
});

describe('recording sessions', () => {
  it('refuses sessions that make no sense', () => {
    const now = T0 + 100 * H;
    expect(sessionProblem({ start: T0, end: T0 + H }, now)).toBeNull();
    expect(sessionProblem({ start: T0, end: T0 }, now)).toMatch(/after the start/);
    expect(sessionProblem({ start: T0, end: T0 + 25 * H }, now)).toMatch(/24 hours/);
    expect(sessionProblem({ start: now, end: now + H }, now)).toMatch(/future/);
    expect(sessionProblem({ start: 5, end: 10 }, now)).toMatch(/too far back/);
    expect(sessionProblem({ start: NaN, end: 1 }, now)).toMatch(/valid/);
  });
  it('add, replace and remove', () => {
    let v = addSession(null, sess('u1', 0, 1, { id: 'a' }));
    v = addSession(v, sess('u1', 2, 1, { id: 'b' }));
    expect(v.sessions.map((s) => s.id)).toEqual(['a', 'b']);
    v = replaceSession(v, { ...v.sessions[0]!, end: v.sessions[0]!.start + 2 * H })!;
    expect(totalMs(v)).toBe(3 * H);
    expect(replaceSession(v, sess('u1', 9, 1, { id: 'nope' }))).toBe(v);
    expect(removeSession(v, 'a')!.sessions.map((s) => s.id)).toEqual(['b']);
    expect(removeSession(removeSession(v, 'a'), 'b')).toBeNull();
  });
});

describe('the session cap rolls up the oldest, losing no time', () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      sess(i % 2 ? 'u1' : 'u2', i * 30, 0.5, { id: `m${i}` }),
    );
  it('does nothing at or under the cap', () => {
    expect(enforceCap(many(MAX_TIME_SESSIONS))).toHaveLength(MAX_TIME_SESSIONS);
  });
  it('folds the oldest 100 into one entry per person per month, keeping every total', () => {
    const all = many(MAX_TIME_SESSIONS + 1);
    const before = totalMs({ sessions: all });
    const byBefore = totalsByUid({ sessions: all });
    const after = enforceCap(all);
    expect(after.length).toBeLessThan(MAX_TIME_SESSIONS);
    expect(totalMs({ sessions: after })).toBe(before);
    for (const [uid, ms] of byBefore) expect(totalsByUid({ sessions: after }).get(uid)).toBe(ms);
    const rolled = after.filter((s) => s.rolled);
    expect(rolled.length).toBeGreaterThan(0);
    expect(rolled.every((s) => s.id.startsWith('r-'))).toBe(true);
    // newest sessions are untouched
    expect(after.some((s) => s.id === `m${MAX_TIME_SESSIONS}`)).toBe(true);
    // and it survives being stored and read back
    expect(totalMs(normalizeTimeValue({ sessions: after }))).toBe(before);
  });
  it('rolling up again merges into the same month entries', () => {
    let v = addSession(null, sess('u1', 0, 1, { id: 'first' }));
    let expected = H;
    for (let i = 0; i < 500; i++) {
      const s = sess('u1', 1 + i, 0.25, { id: `k${i}` });
      expected += 0.25 * H;
      v = addSession(v, s);
    }
    expect(v.sessions.length).toBeLessThanOrEqual(MAX_TIME_SESSIONS);
    expect(totalMs(v)).toBe(expected);
    const ids = v.sessions.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the running timer', () => {
  const base = { wid: 'w', uid: 'u1', newId: () => 'sid' };
  const timer = { boardId: 'b', itemId: 'i', columnId: 'c', startedAtMs: T0 };
  it('start writes only the person’s own timer doc (one per person)', () => {
    const ops = planStartTimer({ wid: 'w', uid: 'u1', bid: 'b', iid: 'i', columnId: 'c' });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'set', path: 'workspaces/w/timers/u1' });
  });
  it('stop adds the session to the cell and deletes the timer, together', () => {
    const r = planStopTimer({ ...base, timer, nowMs: T0 + 2 * H, current: null });
    expect(r.session).toMatchObject({ id: 'sid', uid: 'u1', start: T0, end: T0 + 2 * H });
    expect(r.ops).toHaveLength(2);
    const upd = r.ops[0] as { kind: string; path: string; data: Record<string, unknown> };
    expect(upd.path).toBe('workspaces/w/boards/b/items/i');
    expect(totalMs(upd.data['values.c'] as never)).toBe(2 * H);
    expect(r.ops[1]).toEqual({ kind: 'delete', path: 'workspaces/w/timers/u1' });
  });
  it('stop keeps what was already logged', () => {
    const current = { sessions: [sess('u2', -10, 1, { id: 'old' })] };
    const r = planStopTimer({ ...base, timer, nowMs: T0 + H, current });
    const v = (r.ops[0] as { data: Record<string, unknown> }).data['values.c'] as never;
    expect(totalMs(v)).toBe(2 * H);
  });
  it('a forgotten timer is recorded as 24 hours; a blip under a second records nothing', () => {
    const long = planStopTimer({ ...base, timer, nowMs: T0 + 30 * H, current: null });
    expect(long.session!.end - long.session!.start).toBe(MAX_SESSION_MS);
    const blip = planStopTimer({ ...base, timer, nowMs: T0 + 400, current: null });
    expect(blip.session).toBeNull();
    expect(blip.ops).toEqual([{ kind: 'delete', path: 'workspaces/w/timers/u1' }]);
  });
});

describe('the time column', () => {
  const col = makeColumn('time', 'Time');
  const value = { sessions: [sess('u1', 0, 1.5)] };
  it('is a real column: normalised, shown as a duration, summed in the footer, exported as hours', () => {
    expect(normalizeValue(col, value)).toEqual(normalizeTimeValue(value));
    expect(normalizeValue(col, 'junk')).toBeNull();
    expect(valueToText(col, value)).toBe('1h 30m');
    const sum = summarize(col, [value, { sessions: [sess('u2', 3, 0.5)] }, null]);
    expect(sum).toMatchObject({ kind: 'number', op: 'sum', text: '2h' });
    const csv = boardToCsv({
      columns: [col],
      groups: [{ id: 'g', name: 'G', color: 'blue' }],
      items: [
        {
          id: 'i',
          name: 'Dishes',
          groupId: 'g',
          order: 'a',
          parentId: null,
          values: { [col.id]: value },
        } as never,
      ],
      memberName: (u) => u,
    });
    expect(csv.split('\r\n')[1]).toContain(',1.5');
    void toCsv;
  });
});

describe('timesheet', () => {
  const items = [
    {
      id: 'i1',
      name: 'Dishes',
      values: { c: { sessions: [sess('u1', 0, 1), sess('u2', 24, 2)] } },
    },
    { id: 'i2', name: 'Bins', values: { c: { sessions: [sess('u1', 48, 3)] } } },
    { id: 'i3', name: 'Gone', deleted: true, values: { c: { sessions: [sess('u1', 0, 9)] } } },
  ];
  const rows = rowsFromItems(items, 'b1', ['c']);
  it('flattens sessions, ignoring deleted items', () => {
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.itemName).sort()).toEqual(['Bins', 'Dishes', 'Dishes']);
  });
  it('filters by person, list and date range in the household time zone', () => {
    const tz = 'Australia/Melbourne';
    expect(filterRows(rows, { tz, uids: new Set(['u2']) })).toHaveLength(1);
    expect(filterRows(rows, { tz, boardIds: new Set(['other']) })).toHaveLength(0);
    // 09:00 UTC on 2 Mar is 20:00 on 2 Mar in Melbourne
    expect(dayIn(T0, tz)).toBe('2026-03-02');
    expect(filterRows(rows, { tz, from: '2026-03-03', to: '2026-03-03' })).toHaveLength(1);
    expect(filterRows(rows, { tz, from: '2026-03-04' })).toHaveLength(1);
    expect(filterRows(rows, { tz, to: '2026-03-02' })).toHaveLength(1);
    // a session that starts 13:00 UTC is already the next day in Melbourne (+11)
    const late = rowsFromItems(
      [{ id: 'x', name: 'x', values: { c: { sessions: [sess('u1', 4, 1)] } } }],
      'b',
      ['c'],
    );
    expect(dayIn(late[0]!.session.start, tz)).toBe('2026-03-03');
    expect(dayIn(late[0]!.session.start, 'UTC')).toBe('2026-03-02');
  });
  it('groups by person or item, biggest first', () => {
    const byPerson = groupRows(rows, 'person');
    expect(byPerson.map((g) => [g.key, g.ms / H])).toEqual([
      ['u1', 4],
      ['u2', 2],
    ]);
    const byItem = groupRows(rows, 'item');
    expect(byItem.map((g) => [g.key, g.ms / H])).toEqual([
      ['b1/i1', 3],
      ['b1/i2', 3],
    ]);
  });
});
