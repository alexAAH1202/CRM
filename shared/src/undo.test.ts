import { describe, expect, it } from 'vitest';
import { makeColumn } from './columns';
import { History, MAX_HISTORY, planCellReversal } from './undo';

describe('History', () => {
  const e = (label: string) => ({ label });
  it('undo, redo, and a new action wipes what could have been redone', () => {
    const h = new History();
    h.record(e('a'));
    h.record(e('b'));
    expect(h.undoLabel).toBe('b');
    const b = h.takeUndo()!;
    h.doneUndo(b);
    expect(h.undoLabel).toBe('a');
    expect(h.redoLabel).toBe('b');
    const again = h.takeRedo()!;
    h.doneRedo(again);
    expect(h.undoLabel).toBe('b');
    expect(h.redoLabel).toBeNull();
    // undo, then do something new: redo is gone
    h.doneUndo(h.takeUndo()!);
    h.record(e('c'));
    expect(h.redoLabel).toBeNull();
    expect(h.undoLabel).toBe('c');
  });
  it('forgets an entry whose action failed to save, wherever it is', () => {
    const h = new History();
    const a = e('a');
    const b = e('b');
    h.record(a);
    h.record(b);
    h.discard(b);
    expect(h.undoLabel).toBe('a');
    h.doneUndo(h.takeUndo()!);
    h.discard(a);
    expect(h.redoLabel).toBeNull();
  });
  it('is bounded, empty-safe, and can put an entry back after a transient failure', () => {
    const h = new History();
    expect(h.takeUndo()).toBeUndefined();
    expect(h.takeRedo()).toBeUndefined();
    for (let i = 0; i < MAX_HISTORY + 10; i++) h.record(e(`x${i}`));
    let n = 0;
    while (h.takeUndo()) n++;
    expect(n).toBe(MAX_HISTORY);
    h.record(e('k'));
    const k = h.takeUndo()!;
    h.putBackUndo(k);
    expect(h.undoLabel).toBe('k');
  });
});

describe('planCellReversal', () => {
  const status = makeColumn('status', 'Status', {
    labels: [
      { id: 'todo', name: 'To do', color: 'gray' },
      { id: 'done', name: 'Done', color: 'green' },
    ],
  });
  const who = makeColumn('people', 'Who');
  const base = { wid: 'w', bid: 'b', uid: 'u', columns: [status, who] };
  const items = (m: Record<string, { v: Record<string, unknown>; deleted?: boolean }>) =>
    new Map(Object.entries(m).map(([id, x]) => [id, { values: x.v, deleted: x.deleted ?? false }]));

  it('reverses only the cells still as the edit left them', () => {
    const r = planCellReversal({
      ...base,
      column: status,
      changes: [
        { id: 'i1', from: 'done', to: 'todo' },
        { id: 'i2', from: 'done', to: 'todo' }, // someone changed it since
        { id: 'i3', from: 'done', to: 'todo' }, // deleted since
        { id: 'i4', from: 'done', to: 'todo' }, // never existed
      ],
      items: items({
        i1: { v: { [status.id]: 'done' } },
        i2: { v: { [status.id]: 'todo' } },
        i3: { v: { [status.id]: 'done' }, deleted: true },
      }),
    });
    expect(r.applied).toEqual(['i1']);
    expect(r.skipped).toEqual([
      { id: 'i2', reason: 'changed' },
      { id: 'i3', reason: 'gone' },
      { id: 'i4', reason: 'gone' },
    ]);
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0]).toMatchObject({ kind: 'update', path: 'workspaces/w/boards/b/items/i1' });
    expect((r.ops[0] as { data: Record<string, unknown> }).data[`values.${status.id}`]).toBe(
      'todo',
    );
  });

  it('treats empty values alike (undefined, null, "")', () => {
    const r = planCellReversal({
      ...base,
      column: status,
      changes: [{ id: 'i1', from: null, to: 'done' }],
      items: items({ i1: { v: {} } }),
    });
    expect(r.applied).toEqual(['i1']);
  });

  it('putting a value back clears the cell when it was empty, and keeps assignees in step', () => {
    const r = planCellReversal({
      ...base,
      column: who,
      changes: [{ id: 'i1', from: ['u1'], to: null }],
      items: items({ i1: { v: { [who.id]: ['u1'] } } }),
    });
    const data = (r.ops[0] as { data: Record<string, unknown> }).data;
    expect(data['assigneeUids']).toEqual([]);
    expect(JSON.stringify(data[`values.${who.id}`])).toContain('deleteField');
  });
});
