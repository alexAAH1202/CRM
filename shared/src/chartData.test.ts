import { describe, expect, it } from 'vitest';
import { makeColumn } from './columns';
import { chartData, categoriesOf, NONE_LABEL } from './chartData';
import type { ItemLike } from './itemLike';

const status = makeColumn('status', 'Status');
const labels = status.settings.labels!;
const people = makeColumn('people', 'Who');
const hours = makeColumn('numbers', 'Hours');
const date = makeColumn('date', 'Due');
const mk = (id: string, v: Record<string, unknown>): ItemLike => ({
  id,
  name: id,
  groupId: 'g',
  order: id,
  parentId: null,
  itemNumber: 1,
  values: v,
  archived: false,
  deleted: false,
});
const name = (u: string) => u.toUpperCase();

describe('chart data', () => {
  it('counts per status in label order, none last', () => {
    const d = chartData({
      items: [
        mk('1', { [status.id]: labels[1]!.id }),
        mk('2', { [status.id]: labels[0]!.id }),
        mk('3', { [status.id]: labels[1]!.id }),
        mk('4', {}),
      ],
      group: status,
      stack: null,
      measure: 'count',
      value: null,
      memberName: name,
    });
    expect(d.points.map((p) => [p.key, p.total])).toEqual([
      [labels[0]!.name, 1],
      [labels[1]!.name, 2],
      [NONE_LABEL, 1],
    ]);
  });
  it('sums and averages a numbers column; skips items with no number', () => {
    const items = [
      mk('1', { [status.id]: labels[0]!.id, [hours.id]: 4 }),
      mk('2', { [status.id]: labels[0]!.id, [hours.id]: 2 }),
      mk('3', { [status.id]: labels[0]!.id }),
    ];
    const base = { items, group: status, stack: null, value: hours, memberName: name } as const;
    expect(chartData({ ...base, measure: 'sum' }).points[0]!.total).toBe(6);
    expect(chartData({ ...base, measure: 'avg' }).points[0]!.total).toBe(3);
  });
  it('sum without a value column falls back to counting', () => {
    const d = chartData({
      items: [mk('1', {}), mk('2', {})],
      group: status,
      stack: null,
      measure: 'sum',
      value: null,
      memberName: name,
    });
    expect(d.points[0]!.total).toBe(2);
  });
  it('a multi-person item counts for each person; stacks are broken out', () => {
    const d = chartData({
      items: [
        mk('1', { [people.id]: ['a', 'b'], [status.id]: labels[0]!.id }),
        mk('2', { [people.id]: ['a'], [status.id]: labels[1]!.id }),
      ],
      group: people,
      stack: status,
      measure: 'count',
      value: null,
      memberName: name,
    });
    expect(d.points.map((p) => p.key)).toEqual(['A', 'B']);
    expect(d.points[0]!.parts).toEqual({ [labels[0]!.name]: 1, [labels[1]!.name]: 1 });
    expect(d.points[0]!.total).toBe(2);
    expect(d.stacks).toEqual([labels[0]!.name, labels[1]!.name]);
  });
  it('dates group by month, in order', () => {
    const d = chartData({
      items: [
        mk('1', { [date.id]: '2026-04-02' }),
        mk('2', { [date.id]: '2026-03-30' }),
        mk('3', {}),
      ],
      group: date,
      stack: null,
      measure: 'count',
      value: null,
      memberName: name,
    });
    expect(d.points.map((p) => p.key)).toEqual(['2026-03', '2026-04', NONE_LABEL]);
  });
  it('numeric strings from formulas count; junk does not', () => {
    const d = chartData({
      items: [
        mk('1', { [hours.id]: '2.5' }),
        mk('2', { [hours.id]: 'abc' }),
        mk('3', { [hours.id]: NaN }),
      ],
      group: status,
      stack: null,
      measure: 'sum',
      value: hours,
      memberName: name,
    });
    expect(d.points[0]!.total).toBe(2.5);
  });
  it('checkbox categories', () => {
    expect(categoriesOf(makeColumn('checkbox', 'x'), true, name)).toEqual(['Yes']);
    expect(categoriesOf(makeColumn('checkbox', 'x'), undefined, name)).toEqual(['No']);
  });
  it('empty board gives no points', () => {
    expect(
      chartData({
        items: [],
        group: status,
        stack: null,
        measure: 'count',
        value: null,
        memberName: name,
      }).points,
    ).toEqual([]);
  });
});
