import { describe, expect, it } from 'vitest';
import { makeColumn } from './columns';
import {
  aggregateSpec,
  battery,
  clampLayout,
  MAX_DASHBOARD_LISTS,
  MAX_WIDGETS,
  newWidget,
  numbersFromItems,
  overdueRows,
  parseDashboard,
  parseWidgetConfig,
  parseWidgets,
  planCreateDashboard,
  planUpdateDashboard,
  tableRows,
  tasksByPerson,
  timelineBars,
  timeTrackedByPerson,
  type DashItem,
  type ListData,
  type Widget,
} from './dashboards';
import { rowsFromItems } from './timeTracking';

const status = makeColumn('status', 'Status', {
  labels: [
    { id: 'todo', name: 'To do', color: 'gray' },
    { id: 'done', name: 'Done', color: 'green' },
  ],
});
const due = makeColumn('date', 'Due date');
const amount = makeColumn('numbers', 'Amount');
const tl = makeColumn('timeline', 'Dates');
const columns = [status, due, amount, tl];
const item = (
  id: string,
  over: Partial<DashItem> & { v?: Record<string, unknown> } = {},
): DashItem => ({
  id,
  name: id,
  groupId: 'g',
  order: id,
  parentId: null,
  itemNumber: 1,
  values: over.v ?? {},
  archived: false,
  deleted: false,
  assigneeUids: [],
  ...over,
});
const list = (items: DashItem[], id = 'b1'): ListData => ({
  boardId: id,
  boardName: id.toUpperCase(),
  columns,
  items,
});

describe('parsing and limits', () => {
  it('sanitises widget settings and drops what it does not know', () => {
    const c = parseWidgetConfig(
      {
        title: '  Hello  ',
        boardId: 'b1',
        measure: 'sum',
        columnId: 'c',
        chartType: 'pie',
        columnIds: ['a', 'a', 'b', 'c', 'd', 'e', 'f'],
        limit: 99,
        weeks: 0,
        period: 'forever',
        evil: '<script>',
        onlyOpen: 'yes',
      },
      ['b1'],
    );
    expect(c).toEqual({
      title: 'Hello',
      boardId: 'b1',
      measure: 'sum',
      columnId: 'c',
      chartType: 'pie',
      columnIds: ['a', 'b', 'c', 'd', 'e'],
      limit: 25,
      weeks: 1,
    });
    // a list the dashboard doesn't have is forgotten
    expect(parseWidgetConfig({ boardId: 'other' }, ['b1']).boardId).toBeNull();
  });
  it('widgets: valid ones only, unique ids, capped, layout kept on the grid', () => {
    const many = Array.from({ length: MAX_WIDGETS + 5 }, (_, i) => ({
      id: `w${i}`,
      type: 'numbers',
      config: {},
      layout: { x: 99, y: -4, w: 50, h: 0 },
    }));
    const ws = parseWidgets(
      [...many, { id: 'w0', type: 'numbers' }, { id: 'x', type: 'nope' }, null, 3],
      [],
    );
    expect(ws).toHaveLength(MAX_WIDGETS);
    expect(ws[0]!.layout).toEqual({ x: 0, y: 0, w: 12, h: 1 });
    expect(clampLayout({ x: 11, w: 4 }, 'chart').x).toBe(8); // keeps it inside 12 columns
    expect(parseWidgets('nope', [])).toEqual([]);
  });
  it('a dashboard has at most five lists', () => {
    const d = parseDashboard({ name: 'X', boardIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'a'] });
    expect(d.boardIds).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(MAX_DASHBOARD_LISTS).toBe(5);
    expect(parseDashboard({}).name).toBe('Dashboard');
    expect(parseDashboard({ visibility: 'private' }).visibility).toBe('private');
    expect(parseDashboard({ visibility: 'x' }).visibility).toBe('main');
  });
  it('new widgets go below the existing ones', () => {
    const a = newWidget('chart', ['b1'], []);
    const b = newWidget('numbers', ['b1'], [a]);
    expect(a.layout).toMatchObject({ x: 0, y: 0 });
    expect(b.layout.y).toBe(a.layout.h);
  });
});

describe('planners', () => {
  it('creating: capped lists, the creator is on a private dashboard', () => {
    const ops = planCreateDashboard({
      wid: 'w',
      did: 'd',
      uid: 'u1',
      name: '  Home  ',
      boardIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      visibility: 'private',
      memberIds: ['u2'],
    });
    const data = (ops[0] as { data: Record<string, unknown> }).data;
    expect(ops[0]).toMatchObject({ kind: 'set', path: 'workspaces/w/dashboards/d' });
    expect(data['name']).toBe('Home');
    expect(data['boardIds']).toHaveLength(5);
    expect(data['memberIds']).toEqual(['u1', 'u2']);
    expect(data['createdBy']).toBe('u1');
    const open = planCreateDashboard({
      wid: 'w',
      did: 'd',
      uid: 'u1',
      name: '',
      boardIds: [],
      visibility: 'main',
    });
    expect((open[0] as { data: Record<string, unknown> }).data['memberIds']).toEqual([]);
    expect((open[0] as { data: Record<string, unknown> }).data['name']).toBe('Dashboard');
  });
  it('updating re-sanitises widgets against the dashboard’s lists', () => {
    const w: Widget = {
      id: 'x',
      type: 'chart',
      config: { boardId: 'gone', chartType: 'bar' },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    };
    const ops = planUpdateDashboard('w', 'd', { widgets: [w] }, ['b1']);
    const saved = (ops[0] as unknown as { data: { widgets: Widget[] } }).data.widgets[0]!;
    expect(saved.config.boardId).toBeNull();
    expect(ops[0]).toMatchObject({ kind: 'update', path: 'workspaces/w/dashboards/d' });
  });
});

describe('widget data', () => {
  const items = [
    item('a', {
      v: { [status.id]: 'todo', [due.id]: '2026-03-01', [amount.id]: 10 },
      assigneeUids: ['u1'],
    }),
    item('b', {
      v: { [status.id]: 'done', [due.id]: '2026-03-01', [amount.id]: 30 },
      assigneeUids: ['u1', 'u2'],
    }),
    item('c', { v: { [status.id]: 'todo', [due.id]: '2026-04-20', [amount.id]: 5 } }),
    item('d', { v: { [status.id]: 'todo', [due.id]: '2026-03-05' }, deleted: true }),
    item('e', { v: { [status.id]: 'todo', [due.id]: '2026-03-02' }, archived: true }),
    item('f', { v: { [status.id]: 'todo', [due.id]: '2026-02-01' }, parentId: 'a' }),
    item('g', { v: { [status.id]: 'todo', [due.id]: '2026-03-03' }, assigneeUids: ['u2'] }),
  ];
  const L = list(items);

  it('numbers: the server query and the plain calculation agree', () => {
    const count = aggregateSpec({}, columns);
    expect(count.measure).toBe('count');
    expect(count.filters.map((f) => f.field)).toEqual(['deletedAt', 'archived', 'parentId']);
    expect(numbersFromItems(items, {}, columns)).toBe(4); // a, b, c, g (not deleted/archived/subitem)
    const open = { statusColumnId: status.id, statusLabelId: 'todo' };
    expect(aggregateSpec(open, columns).filters).toContainEqual({
      field: `values.${status.id}`,
      value: 'todo',
    });
    expect(numbersFromItems(items, open, columns)).toBe(3);
    const sum = { measure: 'sum', columnId: amount.id } as const;
    expect(aggregateSpec(sum, columns).valueField).toBe(`values.${amount.id}`);
    expect(numbersFromItems(items, sum, columns)).toBe(45);
    expect(numbersFromItems(items, { measure: 'avg', columnId: amount.id }, columns)).toBe(15);
    // sum without a Numbers column, or a stale status label, falls back safely
    expect(aggregateSpec({ measure: 'sum', columnId: 'nope' }, columns).measure).toBe('count');
    expect(
      aggregateSpec({ statusColumnId: status.id, statusLabelId: 'gone' }, columns).filters,
    ).toHaveLength(3);
    expect(numbersFromItems([], { measure: 'avg', columnId: amount.id }, columns)).toBe(0);
  });
  it('overdue: open top-level items past their date, worst first', () => {
    const rows = overdueRows([L], '2026-03-10');
    expect(rows.map((r) => r.itemId)).toEqual(['a', 'g']); // b is done; d/e/f not counted
    expect(rows[0]!.daysLate).toBe(9);
    expect(overdueRows([L], '2026-03-10', 1)).toHaveLength(1);
    expect(overdueRows([L], '2026-02-01')).toEqual([]);
  });
  it('battery: share done, over all lists, 0 when empty', () => {
    expect(battery([L])).toEqual({ done: 1, total: 4, pct: 25 });
    expect(battery([L, list([item('z', { v: { [status.id]: 'done' } })], 'b2')])).toEqual({
      done: 2,
      total: 5,
      pct: 40,
    });
    expect(battery([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
  it('tasks by person: open items, with overdue counted, unassigned last', () => {
    const rows = tasksByPerson([L], '2026-03-10');
    expect(rows).toEqual([
      { uid: 'u1', open: 1, overdue: 1 }, // a (b is done)
      { uid: 'u2', open: 1, overdue: 1 }, // g
      { uid: null, open: 1, overdue: 0 }, // c
    ]);
  });
  it('items table: chosen columns as text, open ones by default, limited', () => {
    const t = tableRows(L, { columnIds: [status.id, amount.id, 'nope'], limit: 2 }, (u) => u);
    expect(t.headers).toEqual(['Status', 'Amount']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]).toMatchObject({ id: 'a', cells: ['To do', '10'] });
    const all = tableRows(L, { columnIds: [], onlyOpen: false, limit: 25 }, (u) => u);
    expect(all.rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'g']);
  });
  it('timeline: items with a range, earliest first, none without the column', () => {
    const t = list([
      item('x', { v: { [tl.id]: { start: '2026-05-01', end: '2026-05-04' } } }),
      item('y', { v: { [tl.id]: { start: '2026-04-01', end: '2026-04-02' } } }),
      item('z', {}),
    ]);
    expect(timelineBars(t, tl.id).map((b) => b.id)).toEqual(['y', 'x']);
    expect(timelineBars({ ...t, columns: [status] }, null)).toEqual([]);
  });
  it('time tracked: hours per person in a period', () => {
    const H = 3_600_000;
    const T0 = Date.UTC(2026, 2, 2, 9);
    const rows = rowsFromItems(
      [
        {
          id: 'i',
          name: 'i',
          values: {
            t: {
              sessions: [
                { id: '1', uid: 'u1', start: T0, end: T0 + 2 * H },
                { id: '2', uid: 'u2', start: T0 + 48 * H, end: T0 + 49 * H },
              ],
            },
          },
        },
      ],
      'b',
      ['t'],
    );
    expect(timeTrackedByPerson(rows, { tz: 'UTC' })).toEqual([
      { uid: 'u1', ms: 2 * H },
      { uid: 'u2', ms: H },
    ]);
    expect(timeTrackedByPerson(rows, { tz: 'UTC', from: '2026-03-04' })).toEqual([
      { uid: 'u2', ms: H },
    ]);
  });
});
