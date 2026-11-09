import { describe, expect, it } from 'vitest';
import { makeColumn } from './columns';
import { boardToCsv, csvFileName, csvField, guardCell, toCsv } from './csv';
import type { ItemLike } from './itemLike';

const status = makeColumn('status', 'Status');
const who = makeColumn('people', 'Who');
const num = makeColumn('numbers', 'Cost');
const note = makeColumn('text', 'Note');
const groups = [
  { id: 'g1', name: 'Daily', color: 'blue' as const },
  { id: 'g2', name: 'Weekly', color: 'green' as const },
];
const item = (id: string, over: Partial<ItemLike> = {}): ItemLike => ({
  id,
  name: id,
  groupId: 'g1',
  order: id,
  parentId: null,
  itemNumber: 1,
  values: {},
  archived: false,
  deleted: false,
  ...over,
});
const base = {
  columns: [status, who, num, note],
  groups,
  memberName: (u: string) => u.toUpperCase(),
};

describe('csv', () => {
  it('quotes commas, quotes and newlines (RFC 4180) and uses CRLF', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(
      toCsv([
        ['a', 'b'],
        ['1', '2'],
      ]),
    ).toBe('a,b\r\n1,2\r\n');
  });
  it('guards against spreadsheet formula injection', () => {
    for (const bad of [
      '=1+1',
      '+cmd',
      '-2+3',
      '@SUM(A1)',
      '\tx',
      '=HYPERLINK("http://evil","click")',
    ])
      expect(guardCell(bad)).toBe(`'${bad}`);
    expect(guardCell('normal')).toBe('normal');
    expect(guardCell('a=b')).toBe('a=b');
  });
  it('exports header, items by group order, subitems under parents, readable values', () => {
    const labels = status.settings.labels!;
    const csv = boardToCsv({
      ...base,
      items: [
        item('b', {
          groupId: 'g2',
          order: 'a1',
          values: { [status.id]: labels[1]!.id, [who.id]: ['bob'], [num.id]: -5 },
        }),
        item('a', { order: 'a1', values: { [note.id]: '=evil()' } }),
        item('s', { parentId: 'a', order: 'a1' }),
      ],
    });
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Item,Group,Parent,Status,Who,Cost,Note');
    expect(lines[1]).toBe("a,Daily,,,,,'=evil()");
    expect(lines[2]).toBe('s,Daily,a,,,,');
    expect(lines[3]).toBe(`b,Weekly,,${labels[1]!.name},BOB,-5,`); // a negative NUMBER is not mangled
    expect(lines).toHaveLength(4);
  });
  it('skips deleted and (unless asked) archived items', () => {
    const items = [item('x', { deleted: true }), item('y', { archived: true }), item('z')];
    expect(
      boardToCsv({ ...base, items })
        .trim()
        .split('\r\n'),
    ).toHaveLength(2);
    expect(
      boardToCsv({ ...base, items, includeArchived: true })
        .trim()
        .split('\r\n'),
    ).toHaveLength(3);
  });
  it('guards item names and column titles too; empty board is just a header', () => {
    expect(boardToCsv({ ...base, items: [item('=x')] })).toContain("'=x,Daily");
    expect(
      boardToCsv({ ...base, items: [] })
        .trim()
        .split('\r\n'),
    ).toHaveLength(1);
    expect(boardToCsv({ ...base, columns: [makeColumn('text', '=T')], items: [] })).toContain(
      "'=T",
    );
  });
  it('file names are safe', () => {
    expect(csvFileName('Household chores')).toBe('Household chores.csv');
    expect(csvFileName('../../etc/passwd')).toBe('etcpasswd.csv');
    expect(csvFileName('***')).toBe('board.csv');
    expect(csvFileName('Café 🎉 plans')).toBe('Café plans.csv');
  });
});
