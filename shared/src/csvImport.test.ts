import { describe, expect, it } from 'vitest';
import { makeColumn, type Label } from './columns';
import {
  buildImport,
  convertCell,
  IMPORT_MAX_ROWS,
  parseCsv,
  parseImportDate,
  parseImportNumber,
  planImportChunk,
  suggestMapping,
} from './csvImport';
import { toCsv } from './csv';
import { buildTemplate } from './templates';

const L = (id: string, name: string): Label => ({ id, name, color: 'blue' });
const status = makeColumn('status', 'Status', {
  labels: [L('todo', 'To do'), L('done', 'Done')],
  defaultLabelId: 'todo',
});
const tags = makeColumn('tags', 'Tags', { options: [L('t1', 'Urgent'), L('t2', 'Home')] });
const dd = makeColumn('dropdown', 'Kind', { options: [L('k1', 'Weekly'), L('k2', 'Monthly')] });
const who = makeColumn('people', 'Who');
const members = [
  { uid: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
  { uid: 'u2', name: 'Bob', email: 'bob@example.com' },
];

describe('parseCsv', () => {
  it('reads quotes, doubled quotes, commas and newlines inside quotes, CRLF, BOM, blank lines', () => {
    const r = parseCsv('﻿Name,Note\r\n"Smith, J","He said ""hi""\nbye"\r\n\r\nplain,x\r\n');
    expect(r.error).toBeNull();
    expect(r.rows).toEqual([
      ['Name', 'Note'],
      ['Smith, J', 'He said "hi"\nbye'],
      ['plain', 'x'],
    ]);
  });
  it('round-trips what the exporter writes', () => {
    const rows = [
      ['a', 'b,c', 'd"e', 'line\nbreak'],
      ['', 'x', '', 'y'],
    ];
    expect(parseCsv(toCsv(rows)).rows).toEqual(rows);
  });
  it('copes with semicolon and tab separated files', () => {
    expect(parseCsv('a;b;c\n1;2;3').rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('a\tb\n1\t2').rows[1]).toEqual(['1', '2']);
  });
  it('refuses unusable files with a reason', () => {
    expect(parseCsv('').error).toMatch(/empty/);
    expect(parseCsv('a,b\n"oops').error).toMatch(/quote/);
    expect(parseCsv('x\n'.repeat(IMPORT_MAX_ROWS + 5)).error).toMatch(/more than/);
    expect(parseCsv(Array.from({ length: 70 }, (_, i) => i).join(',')).error).toMatch(/columns/);
    expect(parseCsv('a,' + 'x'.repeat(6000)).error).toMatch(/too long/);
    expect(parseCsv('x'.repeat(1_100_000)).error).toMatch(/too big/);
  });
});

describe('dates and numbers', () => {
  it('dates: ISO, day-first, names, two-digit years; rejects impossible dates', () => {
    expect(parseImportDate('2026-03-17')).toBe('2026-03-17');
    expect(parseImportDate('17/3/2026')).toBe('2026-03-17');
    expect(parseImportDate('3/4/2026')).toBe('2026-04-03'); // day first
    expect(parseImportDate('17.03.26')).toBe('2026-03-17');
    expect(parseImportDate('17 Mar 2026')).toBe('2026-03-17');
    expect(parseImportDate('March 17, 2026')).toBe('2026-03-17');
    expect(parseImportDate('1st April 2026')).toBe('2026-04-01');
    expect(parseImportDate('31/2/2026')).toBeNull();
    expect(parseImportDate('13/13/2026')).toBeNull();
    expect(parseImportDate('soon')).toBeNull();
  });
  it('numbers: currency, thousands, percent, brackets; rejects junk', () => {
    expect(parseImportNumber('$1,234.50')).toBe(1234.5);
    expect(parseImportNumber('(20)')).toBe(-20);
    expect(parseImportNumber('15%')).toBe(15);
    expect(parseImportNumber('-3')).toBe(-3);
    expect(parseImportNumber('1e3')).toBeNull();
    expect(parseImportNumber('abc')).toBeNull();
    expect(parseImportNumber('')).toBeNull();
  });
});

describe('convertCell', () => {
  it('matches labels, options, people (by name or email) case-insensitively', () => {
    expect(convertCell(status, 'DONE', members)).toEqual({ value: 'done', problem: null });
    expect(convertCell(status, 'Maybe', members).problem).toMatch(/no status/);
    expect(convertCell(dd, 'monthly', members).value).toEqual(['k2']);
    expect(convertCell(tags, 'urgent; home', members).value).toEqual(['t1', 't2']);
    expect(convertCell(tags, 'urgent, nope', members).problem).toMatch(/nope/);
    expect(convertCell(who, 'ada@example.com, Bob', members).value).toEqual(['u1', 'u2']);
    expect(convertCell(who, 'Zed', members).problem).toMatch(/Zed/);
  });
  it('checkbox, rating, email, phone, link; empty stays empty', () => {
    const cb = makeColumn('checkbox', 'Paid');
    expect(convertCell(cb, 'Yes', []).value).toBe(true);
    expect(convertCell(cb, 'no', []).value).toBeNull();
    expect(convertCell(cb, 'maybe', []).problem).toBeTruthy();
    expect(convertCell(makeColumn('rating', 'R'), '4', []).value).toBe(4);
    expect(convertCell(makeColumn('rating', 'R'), '9', []).problem).toBeTruthy();
    expect(convertCell(makeColumn('email', 'E'), 'a@b.co', []).value).toBe('a@b.co');
    expect(convertCell(makeColumn('email', 'E'), 'nope', []).problem).toBeTruthy();
    expect(convertCell(makeColumn('link', 'L'), 'example.com/x', []).value).toMatchObject({
      url: expect.stringContaining('example.com/x'),
    });
    expect(convertCell(makeColumn('link', 'L'), 'javascript:alert(1)', []).problem).toBeTruthy();
    expect(convertCell(makeColumn('text', 'T'), '   ', []).value).toBeNull();
  });
  it('columns that can’t be imported say so', () => {
    expect(convertCell(makeColumn('files', 'F'), 'x', []).problem).toMatch(/can’t be imported/);
    expect(convertCell(makeColumn('formula', 'F'), 'x', []).problem).toMatch(/can’t be imported/);
  });
});

describe('mapping and plan', () => {
  const board = buildTemplate('bills');
  const col = (t: string) => board.columns.find((c) => c.title === t)!;

  it('suggests a mapping from header names, each column used once', () => {
    const m = suggestMapping(
      ['Name', 'Amount', 'due date', 'Amount', 'Group', 'Mystery', ''],
      board.columns,
    );
    expect(m[0]).toEqual({ kind: 'name' });
    expect(m[1]).toEqual({ kind: 'column', id: col('Amount').id });
    expect(m[2]).toEqual({ kind: 'column', id: col('Due date').id });
    expect(m[3]).toBeNull();
    expect(m[4]).toEqual({ kind: 'group' });
    expect(m[5]).toBeNull();
    expect(m[6]).toBeNull();
  });

  it('builds items, reports every unusable cell with its row, skips nameless rows', () => {
    const headers = ['Name', 'Amount', 'Due date', 'Group'];
    const plan = buildImport({
      headers,
      rows: [
        ['Water', '$80.50', '17/3/2026', 'Utilities'],
        ['Netflix', 'cheap', '2026-04-01', 'Nowhere'],
        ['', '5', '', ''],
        ['Gym', '30', 'someday', ''],
      ],
      mapping: suggestMapping(headers, board.columns),
      columns: board.columns,
      groups: board.groups,
      defaultGroupId: board.groups[1]!.id,
      members: [],
    });
    expect(plan.items.map((i) => i.name)).toEqual(['Water', 'Netflix', 'Gym']);
    expect(plan.skipped).toBe(1);
    expect(plan.items[0]).toMatchObject({
      groupId: board.groups.find((g) => g.name === 'Utilities')!.id,
      values: { [col('Amount').id]: 80.5, [col('Due date').id]: '2026-03-17' },
    });
    expect(plan.items[1]!.groupId).toBe(board.groups[1]!.id); // unknown group → default
    expect(plan.problems.map((p) => [p.row, p.column])).toEqual([
      [3, 'Group'],
      [3, 'Amount'],
      [5, 'Due date'],
    ]);
    // the bad cell is left empty, the rest of the row still comes in
    expect(plan.items[1]!.values).toEqual({ [col('Due date').id]: '2026-04-01' });
  });

  it('plans a batch: numbered from the counter, ordered after what is there, per group', () => {
    let n = 0;
    const g1 = board.groups[0]!.id;
    const g2 = board.groups[1]!.id;
    const r = planImportChunk({
      wid: 'w',
      bid: 'b',
      uid: 'u',
      columns: board.columns,
      counterExists: true,
      startNumber: 10,
      lastOrderByGroup: new Map([[g1, 'a5']]),
      newItemId: () => `i${++n}`,
      items: [
        { name: 'A', groupId: g1, values: {} },
        { name: 'B', groupId: g2, values: {} },
        { name: 'C', groupId: g1, values: {} },
      ],
    });
    expect(r.ops[0]).toEqual({
      kind: 'update',
      path: 'workspaces/w/boards/b/meta/counter',
      data: { next: 13 },
    });
    const docs = r.ops.slice(1).map((o) => (o as { data: Record<string, unknown> }).data);
    expect(docs.map((d) => d['itemNumber'])).toEqual([10, 11, 12]);
    const [a, , c] = docs as Array<{ order: string }>;
    expect(a!.order > 'a5').toBe(true);
    expect(c!.order > a!.order).toBe(true);
    expect(r.lastOrderByGroup.get(g1)).toBe(c!.order);
  });
});
