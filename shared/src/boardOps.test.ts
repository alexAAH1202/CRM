import { describe, expect, it } from 'vitest';
import { makeColumn } from './columns';
import { advanceLastSynced, planSync, SYNC_MAX_AGE_MS, SYNC_SAFETY_MS } from './deltaSync';
import { cleanValues, planCreateBoard, planCreateItem, planSetCell } from './boardOps';
import { DELETE_FIELD } from './ops';
import { buildTemplate, TEMPLATES } from './templates';

describe('templates', () => {
  it.each(TEMPLATES.map((t) => t.id))('%s builds a consistent board', (id) => {
    const t = buildTemplate(id);
    const colIds = new Set(t.columns.map((c) => c.id));
    const groupIds = new Set(t.groups.map((g) => g.id));
    expect(colIds.size).toBe(t.columns.length);
    expect(t.groups.length).toBeGreaterThan(0);
    for (const it of t.items) {
      expect(groupIds.has(it.groupId)).toBe(true);
      for (const k of Object.keys(it.values)) expect(colIds.has(k)).toBe(true);
      expect(cleanValues(t.columns, it.values)).toEqual(it.values); // all sample values are valid
    }
  });

  it('ships the six agreed templates', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([
      'chores',
      'bills',
      'renewals',
      'maintenance',
      'trip',
      'blank',
    ]);
  });
});

describe('board planners', () => {
  it('creates board, view, counter and numbered items in one batch', () => {
    let n = 0;
    const template = buildTemplate('bills');
    const ops = planCreateBoard({
      wid: 'w',
      bid: 'b',
      viewId: 'v',
      uid: 'u',
      name: ' Bills ',
      visibility: 'private',
      memberIds: ['x'],
      order: 'a0',
      template,
      newItemId: () => `i${++n}`,
    });
    expect(ops).toHaveLength(3 + template.items.length);
    const board = ops[0]!;
    expect(board.kind === 'set' && board.data['memberIds']).toEqual(['u', 'x']);
    expect(board.kind === 'set' && board.data['name']).toBe('Bills');
    const counter = ops[2]!;
    expect(counter.kind === 'set' && counter.data['next']).toBe(template.items.length + 1);
    const numbers = ops.slice(3).map((o) => (o.kind === 'set' ? o.data['itemNumber'] : 0));
    expect(numbers).toEqual(template.items.map((_, i) => i + 1));
  });

  it('new item bumps the counter', () => {
    const cols = [makeColumn('people')];
    const ops = planCreateItem({
      wid: 'w',
      bid: 'b',
      iid: 'i',
      uid: 'u',
      columns: cols,
      item: {
        name: 'X',
        groupId: 'g',
        order: 'a0',
        itemNumber: 7,
        values: { [cols[0]!.id]: ['u2'] },
      },
      counterExists: true,
    });
    expect(ops[0]).toMatchObject({ kind: 'update', data: { next: 8 } });
    expect(ops[1]!.kind === 'set' && ops[1]!.data['assigneeUids']).toEqual(['u2']);
  });

  it('setting a People cell refreshes assigneeUids; clearing deletes the field', () => {
    const p = makeColumn('people');
    const t = makeColumn('text');
    const base = { wid: 'w', bid: 'b', iid: 'i', uid: 'u', columns: [p, t] };
    const [set] = planSetCell({ ...base, column: p, currentValues: {}, value: ['a'] });
    expect(set!.kind === 'update' && set!.data['assigneeUids']).toEqual(['a']);
    const [clear] = planSetCell({ ...base, column: t, currentValues: {}, value: '  ' });
    expect(clear!.kind === 'update' && clear!.data[`values.${t.id}`]).toBe(DELETE_FIELD);
    expect(clear!.kind === 'update' && 'assigneeUids' in clear!.data).toBe(false);
  });
});

describe('delta sync planning', () => {
  const now = 1_800_000_000_000;
  it('full sync when never synced, cache empty, or too old', () => {
    expect(planSync({ lastSyncedMs: null, cachedCount: 10, nowMs: now })).toEqual({ mode: 'full' });
    expect(planSync({ lastSyncedMs: now - 1000, cachedCount: 0, nowMs: now })).toEqual({
      mode: 'full',
    });
    expect(
      planSync({ lastSyncedMs: now - SYNC_MAX_AGE_MS - 1, cachedCount: 5, nowMs: now }),
    ).toEqual({ mode: 'full' });
  });
  it('delta with a safety margin otherwise', () => {
    expect(planSync({ lastSyncedMs: now - 60_000, cachedCount: 5, nowMs: now })).toEqual({
      mode: 'delta',
      sinceMs: now - 60_000 - SYNC_SAFETY_MS,
    });
  });
  it('advances only on server-confirmed timestamps', () => {
    expect(
      advanceLastSynced(100, [
        { updatedAtMs: 150, pending: false },
        { updatedAtMs: 999, pending: true },
        { updatedAtMs: null, pending: false },
      ]),
    ).toBe(150);
    expect(advanceLastSynced(200, [{ updatedAtMs: 150, pending: false }])).toBe(200);
  });
});
