import { describe, expect, it } from 'vitest';
import { makeColumn } from './columns';
import type { ItemLike } from './itemLike';
import {
  buildLayout,
  EMPTY_VIEW_CONFIG,
  matchesFilter,
  parseViewConfig,
  pruneViewConfig,
  type ViewConfig,
  type ViewContext,
} from './viewConfig';

const status = makeColumn('status');
const people = makeColumn('people', 'Who');
const amount = makeColumn('numbers', 'Amount');
const due = makeColumn('date', 'Due');
const done = makeColumn('checkbox', 'Done');
const columns = [status, people, amount, due, done];
const groups = [
  { id: 'g1', name: 'One', color: 'blue' as const },
  { id: 'g2', name: 'Two', color: 'green' as const },
];
const ctx: ViewContext = {
  today: '2026-06-15',
  me: 'me-uid',
  memberName: (u) => (u === 'a' ? 'Ann' : u === 'b' ? 'Bob' : u),
};

let seq = 0;
function item(over: Partial<ItemLike> = {}): ItemLike {
  seq++;
  return {
    id: `i${seq}`,
    name: `Item ${seq}`,
    groupId: 'g1',
    order: `a${String(seq).padStart(3, '0')}`,
    parentId: null,
    itemNumber: seq,
    values: {},
    archived: false,
    deleted: false,
    ...over,
  };
}
const cfg = (over: Partial<ViewConfig> = {}): ViewConfig => ({ ...EMPTY_VIEW_CONFIG, ...over });
const layout = (items: ItemLike[], config = cfg(), search = '') =>
  buildLayout({ items, columns, groups, config, search, ctx });
const names = (g: { rows: Array<{ item: ItemLike }> }) => g.rows.map((r) => r.item.name);

describe('filters', () => {
  const f = (columnId: string, op: never, value?: never) => ({ id: 'f', columnId, op, value });
  it('text, status, people (incl. "me"), numbers, dates, checkbox', () => {
    const it = item({
      name: 'Pay Electricity',
      values: {
        [status.id]: 'done',
        [people.id]: ['me-uid'],
        [amount.id]: 50,
        [due.id]: '2026-06-01',
        [done.id]: true,
      },
    });
    expect(matchesFilter(it, columns, f('name', 'contains' as never, 'elec' as never), ctx)).toBe(
      true,
    );
    expect(
      matchesFilter(it, columns, f('name', 'notContains' as never, 'elec' as never), ctx),
    ).toBe(false);
    expect(matchesFilter(it, columns, f(status.id, 'anyOf' as never, ['done'] as never), ctx)).toBe(
      true,
    );
    expect(
      matchesFilter(it, columns, f(status.id, 'noneOf' as never, ['done'] as never), ctx),
    ).toBe(false);
    expect(matchesFilter(it, columns, f(people.id, 'anyOf' as never, ['me'] as never), ctx)).toBe(
      true,
    );
    expect(matchesFilter(it, columns, f(amount.id, 'gt' as never, 20 as never), ctx)).toBe(true);
    expect(matchesFilter(it, columns, f(amount.id, 'lt' as never, 20 as never), ctx)).toBe(false);
    expect(matchesFilter(it, columns, f(due.id, 'overdue' as never), ctx)).toBe(true);
    expect(
      matchesFilter(it, columns, f(due.id, 'before' as never, '2026-06-02' as never), ctx),
    ).toBe(true);
    expect(
      matchesFilter(it, columns, f(due.id, 'after' as never, '2026-06-02' as never), ctx),
    ).toBe(false);
    expect(matchesFilter(it, columns, f(done.id, 'checked' as never), ctx)).toBe(true);
    expect(matchesFilter(item(), columns, f(done.id, 'unchecked' as never), ctx)).toBe(true);
  });

  it('empty checks and ignoring filters on deleted columns', () => {
    const e = item();
    expect(matchesFilter(e, columns, f(status.id, 'isEmpty' as never), ctx)).toBe(true);
    expect(matchesFilter(e, columns, f(status.id, 'notEmpty' as never), ctx)).toBe(false);
    expect(matchesFilter(e, columns, f('gone', 'is' as never, 'x' as never), ctx)).toBe(true);
  });
});

describe('layout', () => {
  it('groups by board group and keeps manual order', () => {
    const a = item({ order: 'a2' });
    const b = item({ order: 'a1' });
    const c = item({ groupId: 'g2' });
    const l = layout([a, b, c]);
    expect(l.map((g) => g.groupId)).toEqual(['g1', 'g2']);
    expect(names(l[0]!)).toEqual([b.name, a.name]);
  });

  it('hides deleted and (by default) archived items; archived can be shown', () => {
    const live = item();
    const arch = item({ archived: true });
    const gone = item({ deleted: true });
    expect(names(layout([live, arch, gone])[0]!)).toEqual([live.name]);
    expect(names(layout([live, arch, gone], cfg({ showArchived: true }))[0]!)).toEqual([
      live.name,
      arch.name,
    ]);
  });

  it('nests subitems under their parent and keeps them out of the top level', () => {
    const p = item();
    const s1 = item({ parentId: p.id, order: 'a2' });
    const s2 = item({ parentId: p.id, order: 'a1' });
    const l = layout([p, s1, s2]);
    expect(l[0]!.rows).toHaveLength(1);
    expect(l[0]!.rows[0]!.subitems.map((s) => s.id)).toEqual([s2.id, s1.id]);
  });

  it('a parent that fails the filter still shows when a subitem matches (with only matching subitems)', () => {
    const p = item({ values: { [status.id]: 'done' } });
    const s1 = item({ parentId: p.id, values: { [status.id]: 'stuck' } });
    const s2 = item({ parentId: p.id, values: { [status.id]: 'done' } });
    const config = cfg({
      filters: [{ id: 'f', columnId: status.id, op: 'anyOf', value: ['stuck'] }],
    });
    const l = layout([p, s1, s2], config);
    expect(l[0]!.rows[0]!.subitems.map((s) => s.id)).toEqual([s1.id]);
  });

  it('filters, searches, and hides groups left empty', () => {
    const a = item({ name: 'Water bill', groupId: 'g1', values: { [status.id]: 'done' } });
    const b = item({ name: 'Rates', groupId: 'g2', values: { [status.id]: 'stuck' } });
    const filtered = layout(
      [a, b],
      cfg({ filters: [{ id: 'f', columnId: status.id, op: 'anyOf', value: ['done'] }] }),
    );
    expect(filtered.map((g) => g.groupId)).toEqual(['g1']);
    expect(layout([a, b], cfg(), 'rate').map((g) => g.groupId)).toEqual(['g2']);
    expect(layout([a, b]).map((g) => g.groupId)).toEqual(['g1', 'g2']); // no filter: empty groups stay
  });

  it('sorts by number desc with empty values last; ties fall back to manual order', () => {
    const a = item({ values: { [amount.id]: 5 } });
    const b = item({ values: { [amount.id]: 50 } });
    const c = item();
    const d = item({ values: { [amount.id]: 5 } });
    const l = layout([a, b, c, d], cfg({ sort: [{ columnId: amount.id, dir: 'desc' }] }));
    expect(l[0]!.rows.map((r) => r.item.id)).toEqual([b.id, a.id, d.id, c.id]);
  });

  it('sorts by status label order and by name', () => {
    const a = item({ name: 'b', values: { [status.id]: 'done' } });
    const b = item({ name: 'a', values: { [status.id]: 'not_started' } });
    const byStatus = layout([a, b], cfg({ sort: [{ columnId: status.id, dir: 'asc' }] }));
    expect(byStatus[0]!.rows.map((r) => r.item.name)).toEqual(['a', 'b']);
    const byName = layout([a, b], cfg({ sort: [{ columnId: 'name', dir: 'asc' }] }));
    expect(byName[0]!.rows.map((r) => r.item.name)).toEqual(['a', 'b']);
  });

  it('group-by status makes virtual groups in label order, hides empty ones, and tells new items their value', () => {
    const a = item({ values: { [status.id]: 'done' } });
    const b = item({ values: { [status.id]: 'stuck' } });
    const c = item();
    const l = layout([a, b, c], cfg({ groupBy: status.id }));
    expect(l.map((g) => g.name)).toEqual(['Stuck', 'Done', 'No status']);
    expect(l.every((g) => g.virtual && g.groupId === null)).toBe(true);
    expect(l[0]!.newItemValue).toBe('stuck');
    expect(l[2]!.newItemValue).toBeNull();
  });

  it('group-by people uses the first assignee and member names', () => {
    const a = item({ values: { [people.id]: ['b', 'a'] } });
    const l = layout([a], cfg({ groupBy: people.id }));
    expect(l.map((g) => g.name)).toEqual(['Bob']);
    expect(l[0]!.newItemValue).toEqual(['b']);
  });

  it('orphans from a deleted group fall into the first group', () => {
    const o = item({ groupId: 'zzz' });
    expect(layout([o])[0]!.groupId).toBe('g1');
  });
});

describe('incomplete filters', () => {
  it('are ignored until they have a value', () => {
    const a = item({ values: { [amount.id]: 5 } });
    const b = item();
    const half = cfg({
      filters: [
        { id: 'f1', columnId: amount.id, op: 'eq' }, // no number yet
        { id: 'f2', columnId: status.id, op: 'anyOf', value: [] }, // nothing picked
        { id: 'f3', columnId: 'name', op: 'contains', value: '  ' },
      ],
    });
    expect(layout([a, b], half)[0]!.rows).toHaveLength(2);
    const filled = cfg({ filters: [{ id: 'f1', columnId: amount.id, op: 'eq', value: 5 }] });
    expect(layout([a, b], filled)[0]!.rows.map((r) => r.item.id)).toEqual([a.id]);
  });
  it('empty/checked style filters need no value', () => {
    const c = item({ values: { [done.id]: true } });
    const f = cfg({ filters: [{ id: 'f', columnId: done.id, op: 'checked' }] });
    expect(layout([c, item()], f)[0]!.rows).toHaveLength(1);
  });
});

describe('view config sanitising', () => {
  it('parses junk safely and clamps widths', () => {
    const c = parseViewConfig({
      filters: [{ columnId: 1 }, { id: 'x', columnId: 'c', op: 'is' }],
      sort: [{ columnId: 'a', dir: 'weird' }],
      colWidths: { a: 5, b: 99999, c: 'x' },
      hiddenCols: ['a', 3],
      showArchived: 'yes',
    });
    expect(c.filters).toHaveLength(1);
    expect(c.sort).toEqual([{ columnId: 'a', dir: 'asc' }]);
    expect(c.colWidths).toEqual({ a: 80, b: 600 });
    expect(c.hiddenCols).toEqual(['a']);
    expect(c.showArchived).toBe(false);
    expect(parseViewConfig(undefined)).toEqual(EMPTY_VIEW_CONFIG);
  });

  it('prunes references to deleted columns and non-groupable group-by', () => {
    const c = pruneViewConfig(
      cfg({
        filters: [
          { id: 'f', columnId: 'gone', op: 'is' },
          { id: 'g', columnId: 'name', op: 'contains' },
        ],
        sort: [{ columnId: 'gone', dir: 'asc' }],
        groupBy: amount.id,
        hiddenCols: ['gone', status.id],
      }),
      columns,
    );
    expect(c.filters.map((f) => f.columnId)).toEqual(['name']);
    expect(c.sort).toEqual([]);
    expect(c.groupBy).toBeNull();
    expect(c.hiddenCols).toEqual([status.id]);
  });
});
