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

  it('ships the agreed templates', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([
      'chores',
      'bills',
      'renewals',
      'maintenance',
      'trip',
      'purchases',
      'goals',
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

import { defaultItemValues } from './columns';
import { planApplyConversion, planDuplicateBoard, planDuplicateItems } from './boardOps';

describe('2b planners', () => {
  it('defaultItemValues combines status default and column defaults', () => {
    const s = makeColumn('status', 'Status', { defaultLabelId: 'working' });
    const t = makeColumn('text', 'Note', { defaultValue: 'hi' });
    const bad = makeColumn('numbers', 'N', { defaultValue: 'nope' });
    expect(defaultItemValues([s, t, bad])).toEqual({ [s.id]: 'working', [t.id]: 'hi' });
  });

  it('duplicate items: copies with subitems, numbered from the counter, appended per group', () => {
    let n = 0;
    const cols = [makeColumn('text')];
    const ops = planDuplicateItems({
      wid: 'w',
      bid: 'b',
      uid: 'u',
      columns: cols,
      startNumber: 10,
      counterExists: true,
      items: [
        {
          id: 'p',
          name: 'Parent',
          groupId: 'g',
          order: 'a0',
          values: {},
          subitems: [{ name: 'Sub', order: 'a0', values: {} }],
        },
      ],
      lastOrderByGroup: new Map([['g', 'a5']]),
      newId: () => `n${++n}`,
    });
    expect(ops).toHaveLength(3);
    const [parent, sub, counter] = ops;
    expect(parent!.kind === 'set' && parent!.data['name']).toBe('Parent (copy)');
    expect(parent!.kind === 'set' && (parent!.data['order'] as string) > 'a5').toBe(true);
    expect(sub!.kind === 'set' && sub!.data['parentId']).toBe('n1');
    expect(counter).toMatchObject({ kind: 'update', data: { next: 12 } });
  });

  it('duplicate board: board, views and counter come first; subitems point at the new parents', () => {
    let n = 0;
    const cols = [makeColumn('status')];
    const ops = planDuplicateBoard({
      wid: 'w',
      newBid: 'nb',
      uid: 'u',
      name: 'Copy',
      order: 'a9',
      source: {
        board: {
          description: 'd',
          visibility: 'private',
          memberIds: ['x'],
          columns: cols,
          groups: [{ id: 'g', name: 'G', color: 'blue' }],
          folderId: null,
        },
        items: [
          {
            id: 'c1',
            name: 'Child',
            groupId: 'g',
            order: 'a0',
            parentId: 'p1',
            itemNumber: 2,
            values: {},
            archived: false,
          },
          {
            id: 'p1',
            name: 'Parent',
            groupId: 'g',
            order: 'a0',
            parentId: null,
            itemNumber: 1,
            values: {},
            archived: true,
          },
        ],
        views: [],
        counterNext: 3,
      },
      newId: () => `id${++n}`,
    });
    expect(ops.map((o) => o.path.split('/').slice(-2)[0])).toEqual([
      'boards',
      'views',
      'meta',
      'items',
      'items',
    ]);
    expect(ops[0]!.kind === 'set' && ops[0]!.data['memberIds']).toEqual(['u', 'x']);
    const parentOp = ops[3]!;
    const childOp = ops[4]!;
    expect(parentOp.kind === 'set' && parentOp.data['archived']).toBe(true);
    expect(childOp.kind === 'set' && childOp.data['parentId']).toBe(parentOp.path.split('/').pop());
  });

  it('conversion replaces the column then rewrites cells, refreshing assignees when people are involved', () => {
    const t = makeColumn('text');
    const ppl = { ...makeColumn('people'), id: t.id };
    const ops = planApplyConversion({
      wid: 'w',
      bid: 'b',
      uid: 'u',
      columns: [t],
      newColumn: ppl,
      changes: [
        { id: 'i1', value: ['u1'] },
        { id: 'i2', value: null },
      ],
      itemValues: new Map(),
      touchesPeople: true,
    });
    expect(ops[0]!.kind === 'update' && ops[0]!.path).toBe('workspaces/w/boards/b');
    expect(ops[1]!.kind === 'update' && ops[1]!.data['assigneeUids']).toEqual(['u1']);
    expect(ops[2]!.kind === 'update' && ops[2]!.data[`values.${t.id}`]).toBe(DELETE_FIELD);
  });
});

describe('Group column', () => {
  it('upgrades an old list once, adding Group first and avoiding a title clash', async () => {
    const { planUpgradeBoard, withGroupColumn } = await import('./boardOps');
    const { makeColumn } = await import('./columns');
    const own = makeColumn('text', 'Group');
    const cols = withGroupColumn([own]);
    expect(cols.map((c) => [c.type, c.title])).toEqual([
      ['group', 'List group'],
      ['text', 'Group'],
    ]);
    expect(withGroupColumn(cols)).toHaveLength(2);
    expect(planUpgradeBoard('w', 'b', { columns: [], schemaVersion: 2 })).toEqual([]);
    const [op] = planUpgradeBoard('w', 'b', { columns: [] });
    expect((op as unknown as { data: { schemaVersion: number } }).data.schemaVersion).toBe(2);
  });

  it('custom groups: trimmed, de-duplicated, capped', async () => {
    const { customSections } = await import('./templates');
    expect(customSections(' A, b ,a,, B\nC').map((s) => s.name)).toEqual(['A', 'b', 'C']);
    expect(customSections(',,')).toEqual([]);
  });
});
