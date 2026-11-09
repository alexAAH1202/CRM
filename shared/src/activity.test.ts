import { describe, expect, it } from 'vitest';
import { activityTypeForColumn, cellActivity, describeActivity, planActivity } from './activity';
import { makeColumn } from './columns';

const status = makeColumn('status', 'Status');
const labels = status.settings.labels!;
const people = makeColumn('people', 'Who');
const text = makeColumn('text', 'Notes');
const date = makeColumn('date', 'Due');
const name = (u: string) => u.toUpperCase();

describe('activity', () => {
  it('only meaningful columns are logged', () => {
    expect(activityTypeForColumn(status)).toBe('status');
    expect(activityTypeForColumn(people)).toBe('people');
    expect(activityTypeForColumn(date)).toBe('date');
    expect(activityTypeForColumn(makeColumn('timeline', 't'))).toBe('date');
    expect(activityTypeForColumn(text)).toBeNull();
    expect(cellActivity({ column: text, before: 'a', after: 'b', memberName: name })).toBeNull();
  });
  it('a status change records readable from/to', () => {
    const a = cellActivity({
      column: status,
      before: labels[0]!.id,
      after: labels[1]!.id,
      memberName: name,
    })!;
    expect(a.type).toBe('status');
    expect(a.data).toEqual({ column: 'Status', from: labels[0]!.name, to: labels[1]!.name });
    expect(describeActivity({ type: a.type, data: a.data })).toBe(
      `changed Status from “${labels[0]!.name}” to “${labels[1]!.name}”`,
    );
  });
  it('people use names; no change means no entry', () => {
    const a = cellActivity({
      column: people,
      before: undefined,
      after: ['bob'],
      memberName: name,
    })!;
    expect(a.data.to).toBe('BOB');
    expect(describeActivity(a)).toContain('from empty to “BOB”');
    expect(
      cellActivity({ column: people, before: ['bob'], after: ['bob'], memberName: name }),
    ).toBeNull();
    expect(
      cellActivity({ column: date, before: undefined, after: undefined, memberName: name }),
    ).toBeNull();
  });
  it('planActivity builds a capped, server-timestamped entry', () => {
    const op = planActivity({
      wid: 'w',
      bid: 'b',
      id: 'a1',
      actor: 'me',
      type: 'move',
      itemId: 'i',
      itemName: 'x'.repeat(500),
      data: { group: 'g'.repeat(500), count: 2.7 },
    });
    expect(op).toMatchObject({ kind: 'set', path: 'workspaces/w/boards/b/activity/a1' });
    const d = (op as unknown as { data: { itemName: string; data: { group: string; count: number } } }).data;
    expect(d.itemName).toHaveLength(200);
    expect(d.data.group).toHaveLength(200);
    expect(d.data.count).toBe(2);
  });
  it('describes the simple types', () => {
    expect(describeActivity({ type: 'create', data: {} })).toBe('created this item');
    expect(describeActivity({ type: 'move', data: { group: 'Done' } })).toBe('moved this to Done');
    expect(describeActivity({ type: 'bulk', data: { text: 'set Status', count: 5 } })).toBe(
      'set Status on 5 items',
    );
  });
});
