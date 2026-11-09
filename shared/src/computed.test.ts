import { describe, expect, it } from 'vitest';
import {
  applyComputed,
  computeProgress,
  defaultProgressSettings,
  formulaErrorOf,
  type ComputedEnv,
} from './computed';
import { makeColumn, type Column } from './columns';
import type { ItemLike } from './itemLike';
import { buildTemplate, TEMPLATES } from './templates';
import { validateFormula, renameFormulaRefs, cleanColumnTitle } from './formula';
import { findDependencyCycle, wouldCreateCycle, earliestStart } from './dependencies';
import { remapDependencies, planSetCell, cleanValues, planCreateItem } from './boardOps';
import {
  normalizeValue,
  valueToText,
  defaultItemValues,
  COLUMN_PICKER,
  COLUMN_TYPES,
  COLUMN_META,
} from './columns';
import { buildLayout, EMPTY_VIEW_CONFIG, opsFor } from './viewConfig';
import { summarize } from './summaries';
import { convertColumn } from './convert';

const env: ComputedEnv = {
  today: '2026-06-15',
  memberName: (u) => ({ u1: 'Ann Lee', u2: 'Bob Ray' })[u as 'u1'] ?? u,
  itemName: (id) => ({ i1: 'Pay rent', i2: 'Book flights' })[id as 'i1'],
};

let n = 0;
const item = (over: Partial<ItemLike> = {}): ItemLike => {
  n++;
  return {
    id: `i${n}`,
    name: `Item ${n}`,
    groupId: 'g',
    order: `a${n}`,
    parentId: null,
    itemNumber: n,
    values: {},
    archived: false,
    deleted: false,
    ...over,
  };
};
const col = (type: Parameters<typeof makeColumn>[0], title: string, settings = {}): Column => ({
  ...makeColumn(type, title, settings),
  id: title.toLowerCase().replace(/\W/g, ''),
});

describe('computed columns', () => {
  const budget = col('numbers', 'Budget');
  const spent = col('numbers', 'Spent');
  const left = col('formula', 'Left', { formula: '{Budget} - {Spent}' });
  const doubled = col('formula', 'Doubled', { formula: '{Left} * 2' });

  it('formulas read other columns, including other formulas', () => {
    const [a] = applyComputed(
      [item({ values: { [budget.id]: 100, [spent.id]: 30 } })],
      [budget, spent, left, doubled],
      env,
    );
    expect(a!.values[left.id]).toBe(70);
    expect(a!.values[doubled.id]).toBe(140);
  });

  it('never mutates the original items and stores nothing for stored columns', () => {
    const original = item({ values: { [budget.id]: 1 } });
    const frozen = JSON.stringify(original);
    const [out] = applyComputed([original], [budget, left], env);
    expect(JSON.stringify(original)).toBe(frozen);
    expect(out).not.toBe(original);
    expect(out!.values[budget.id]).toBe(1);
  });

  it('returns the same array untouched when there are no computed columns', () => {
    const items = [item()];
    expect(applyComputed(items, [budget], env)).toBe(items);
  });

  it('a formula that fails becomes an inline error, not an exception', () => {
    const bad = col('formula', 'Bad', { formula: '{Budget} / {Spent}' });
    const [a] = applyComputed([item({ values: { [budget.id]: 5 } })], [budget, spent, bad], env);
    expect(formulaErrorOf(a!.values[bad.id])).toBe('Division by zero');
    expect(normalizeValue(bad, a!.values[bad.id])).toBeNull(); // sorts/filters as empty
  });

  it('syntax errors and unknown columns surface as errors; a blank formula is blank', () => {
    const syntax = col('formula', 'Syn', { formula: '1 +' });
    const unknown = col('formula', 'Unk', { formula: '{Nope} + 1' });
    const blank = col('formula', 'Blank', { formula: '  ' });
    const [a] = applyComputed([item()], [syntax, unknown, blank], env);
    expect(formulaErrorOf(a!.values[syntax.id])).toContain('The formula ends too soon');
    expect(formulaErrorOf(a!.values[unknown.id])).toBe('Unknown column {Nope}');
    expect(a!.values[blank.id]).toBeNull();
  });

  it('circular formulas are errors, not infinite loops', () => {
    const a = col('formula', 'A', { formula: '{B} + 1' });
    const b = col('formula', 'B', { formula: '{A} + 1' });
    const self = col('formula', 'Self', { formula: '{Self} + 1' });
    const [out] = applyComputed([item()], [a, b, self], env);
    expect(formulaErrorOf(out!.values[a.id])).toContain('Circular reference');
    expect(formulaErrorOf(out!.values[self.id])).toContain('Circular reference');
  });

  it('column lookups are safe for odd titles', () => {
    const weird = col('formula', 'W', { formula: '{constructor} & {__proto__}' });
    const [out] = applyComputed([item()], [weird], env);
    expect(formulaErrorOf(out!.values[weird.id])).toBe('Unknown column {constructor}');
  });

  it('formulas see typed values: dates, timelines, checkboxes, status names, people names', () => {
    const due = col('date', 'Due');
    const tl = col('timeline', 'Window');
    const done = col('checkbox', 'Done');
    const st = col('status', 'State');
    const who = col('people', 'Who');
    const f = (title: string, formula: string) => col('formula', title, { formula });
    const cols = [
      due,
      tl,
      done,
      st,
      who,
      f('D', 'DAYS({Due}, TODAY())'),
      f('L', 'DAYS(END({Window}), START({Window}))'),
      f('X', 'IF({Done}, "yes", "no")'),
      f('S', '{State}'),
      f('P', '{Who}'),
    ];
    const [o] = applyComputed(
      [
        item({
          values: {
            [due.id]: '2026-06-20',
            [tl.id]: { start: '2026-01-01', end: '2026-01-11' },
            [done.id]: true,
            [st.id]: 'working',
            [who.id]: ['u1', 'u2'],
          },
        }),
      ],
      cols,
      env,
    );
    expect(o!.values['d']).toBe(5);
    expect(o!.values['l']).toBe(10);
    expect(o!.values['x']).toBe('yes');
    expect(o!.values['s']).toBe('Working on it');
    expect(o!.values['p']).toBe('Ann Lee, Bob Ray');
  });

  it('item ID, created/updated and created-by come from the item', () => {
    const id = col('itemId', 'No');
    const c = col('createdAt', 'Created');
    const u = col('updatedAt', 'Updated');
    const by = col('createdBy', 'By');
    const t = new Date(2026, 4, 3, 12).getTime();
    const [o] = applyComputed(
      [item({ itemNumber: 42, createdAtMs: t, updatedAtMs: t, createdBy: 'u1' })],
      [id, c, u, by],
      env,
    );
    expect(o!.values[id.id]).toBe(42);
    expect(o!.values[c.id]).toBe('2026-05-03');
    expect(o!.values[u.id]).toBe('2026-05-03');
    expect(o!.values[by.id]).toBe('u1');
    expect(valueToText({ ...by }, 'u1', env.memberName)).toBe('Ann Lee');
    expect(valueToText(id, 42)).toBe('#42');
  });
});

describe('progress', () => {
  const status = col('status', 'Status');
  const progress = col('progress', 'Progress');
  const parent = item();
  const kid = (st: string | null, extra: Partial<ItemLike> = {}) =>
    item({ parentId: parent.id, values: st ? { [status.id]: st } : {}, ...extra });

  it('is the share of subitems whose status is the done label', () => {
    const kids = [kid('done'), kid('working'), kid('done'), kid(null)];
    expect(computeProgress(parent, kids, [status, progress], progress.settings.progress)).toBe(50);
  });
  it('ignores archived and deleted subitems; null when there are none', () => {
    expect(
      computeProgress(
        parent,
        [kid('done'), kid('working', { archived: true }), kid('working', { deleted: true })],
        [status],
        undefined,
      ),
    ).toBe(100);
    expect(computeProgress(parent, [], [status], undefined)).toBeNull();
  });
  it('can count several labels as done, and uses the last label when there is no "done" id', () => {
    const custom = col('status', 'Custom', {
      labels: [
        { id: 'a', name: 'Open', color: 'gray' },
        { id: 'b', name: 'Closed', color: 'green' },
      ],
      defaultLabelId: null,
    });
    expect(
      computeProgress(
        parent,
        [
          item({ parentId: parent.id, values: { [custom.id]: 'b' } }),
          item({ parentId: parent.id, values: { [custom.id]: 'a' } }),
        ],
        [custom],
        undefined,
      ),
    ).toBe(50);
    expect(defaultProgressSettings([custom]).doneLabelIds).toEqual(['b']);
    const s = {
      source: 'subitems' as const,
      statusColumnId: status.id,
      doneLabelIds: ['done', 'working'],
      checkboxColumnIds: [],
    };
    expect(
      computeProgress(parent, [kid('done'), kid('working'), kid('stuck')], [status], s),
    ).toBeCloseTo(66.67, 1);
  });
  it('can count ticked checkboxes on the item itself', () => {
    const a = col('checkbox', 'A');
    const b = col('checkbox', 'B');
    const s = {
      source: 'checkboxes' as const,
      statusColumnId: null,
      doneLabelIds: [],
      checkboxColumnIds: [a.id, b.id],
    };
    expect(computeProgress(item({ values: { [a.id]: true } }), [], [a, b], s)).toBe(50);
    expect(computeProgress(item(), [], [a, b], { ...s, checkboxColumnIds: [] })).toBeNull();
  });
  it('flows through applyComputed (parents only have a value)', () => {
    const items = [parent, kid('done'), kid('working')];
    const out = applyComputed(items, [status, progress], env);
    expect(out[0]!.values[progress.id]).toBe(50);
    expect(out[1]!.values[progress.id]).toBeNull();
  });
});

describe('writing computed columns is impossible', () => {
  const f = col('formula', 'F', { formula: '1+1' });
  const t = col('text', 'T');
  it('planSetCell does nothing for a computed column', () => {
    expect(
      planSetCell({
        wid: 'w',
        bid: 'b',
        iid: 'i',
        uid: 'u',
        columns: [f, t],
        column: f,
        currentValues: {},
        value: 5,
      }),
    ).toEqual([]);
  });
  it('cleanValues and new items drop computed values even if they sneak in', () => {
    expect(cleanValues([f, t], { [f.id]: 2, [t.id]: 'x' })).toEqual({ [t.id]: 'x' });
    const ops = planCreateItem({
      wid: 'w',
      bid: 'b',
      iid: 'i',
      uid: 'u',
      columns: [f, t],
      counterExists: true,
      item: { name: 'n', groupId: 'g', order: 'a0', itemNumber: 1, values: { [f.id]: 9 } },
    });
    expect(ops[1]!.kind === 'set' && ops[1]!.data['values']).toEqual({});
    expect(defaultItemValues([{ ...f, settings: { ...f.settings, defaultValue: 3 } }])).toEqual({});
  });
});

describe('new stored column types', () => {
  it('rating, email, phone', () => {
    const r = col('rating', 'R');
    expect([1, 5, 3].map((v) => normalizeValue(r, v))).toEqual([1, 5, 3]);
    expect([0, 6, 2.5, '3', null].map((v) => normalizeValue(r, v))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    const e = col('email', 'E');
    expect(normalizeValue(e, ' a@b.co ')).toBe('a@b.co');
    expect(['a@b', 'no spaces@x.com', '', 5].map((v) => normalizeValue(e, v))).toEqual([
      null,
      null,
      null,
      null,
    ]);
    const p = col('phone', 'P');
    expect(normalizeValue(p, '+61 (3) 9999-1234')).toBe('+61 (3) 9999-1234');
    expect(['12', 'abc', '<script>'].map((v) => normalizeValue(p, v))).toEqual([null, null, null]);
  });
  it('tags behave like dropdown options', () => {
    const t = col('tags', 'T', {
      options: [
        { id: 'a', name: 'Urgent', color: 'red' },
        { id: 'b', name: 'Later', color: 'gray' },
      ],
    });
    expect(normalizeValue(t, ['b', 'zzz', 'b', 'a'])).toEqual(['b', 'a']);
    expect(valueToText(t, ['a', 'b'])).toBe('Urgent, Later');
  });
  it('files keep safe links only, de-duplicate, name themselves, and cap at 20', () => {
    const f = col('files', 'F');
    expect(
      normalizeValue(f, [
        { name: ' Lease ', url: 'drive.google.com/x' },
        { name: 'dup', url: 'https://drive.google.com/x' },
        { name: 'bad', url: 'javascript:alert(1)' },
        { url: 'https://example.com/a.pdf' },
        null,
        { name: 5, url: 'https://e.com' },
      ]),
    ).toEqual([
      { name: 'Lease', url: 'https://drive.google.com/x' },
      { name: 'example.com/a.pdf', url: 'https://example.com/a.pdf' },
      { name: 'e.com', url: 'https://e.com' },
    ]);
    expect(
      (
        normalizeValue(
          f,
          Array.from({ length: 30 }, (_, i) => ({ url: `https://e.com/${i}` })),
        ) as unknown[]
      ).length,
    ).toBe(20);
  });
  it('dependencies keep ids and a clamped whole-number lag, de-duplicated', () => {
    const d = col('dependency', 'D');
    expect(
      normalizeValue(d, [
        'a',
        { id: 'b', lag: 2.7 },
        { id: 'a', lag: 9 },
        { id: 'c', lag: 9999 },
        { id: 'd', lag: -9999 },
        { id: '', lag: 1 },
        5,
      ]),
    ).toEqual([
      { id: 'a', lag: 0 },
      { id: 'b', lag: 2 },
      { id: 'c', lag: 365 },
      { id: 'd', lag: -365 },
    ]);
    expect(
      valueToText(
        d,
        [
          { id: 'i1', lag: 0 },
          { id: 'gone', lag: 0 },
          { id: 'i2', lag: 1 },
        ],
        { itemName: env.itemName },
      ),
    ).toBe('Pay rent, Book flights');
  });
});

describe('dependency graph', () => {
  const preds = (edges: Record<string, string[]>) => (id: string) => edges[id] ?? [];
  it('rejects self-dependency and direct/indirect loops, allows diamonds', () => {
    const g = preds({ b: ['a'], c: ['b'], d: ['b', 'c'] });
    expect(wouldCreateCycle(g, 'a', ['a'])).toBe('a');
    expect(wouldCreateCycle(g, 'a', ['c'])).toBe('c'); // c → b → a, so a depending on c is a loop
    expect(wouldCreateCycle(g, 'a', ['b'])).toBe('b');
    expect(wouldCreateCycle(g, 'd', ['a'])).toBeNull();
    expect(wouldCreateCycle(g, 'e', ['a', 'd'])).toBeNull(); // unrelated item
    expect(wouldCreateCycle(g, 'b', ['d'])).toBe('d');
  });
  it('terminates on pre-existing loops', () => {
    const g = preds({ a: ['b'], b: ['a'] });
    expect(wouldCreateCycle(g, 'z', ['a'])).toBeNull();
  });
  it('finds an existing loop in board data, ignoring references to deleted items', () => {
    const d = col('dependency', 'Dep');
    const mk = (id: string, ...p: string[]) => ({
      id,
      values: { [d.id]: p.map((x) => ({ id: x, lag: 0 })) },
    });
    expect(findDependencyCycle([mk('a'), mk('b', 'a'), mk('c', 'b', 'gone')], d)).toBeNull();
    const loop = findDependencyCycle([mk('a', 'c'), mk('b', 'a'), mk('c', 'b')], d);
    expect(loop && [...loop].sort()).toEqual(['a', 'b', 'c']);
  });
  it('earliest start is the day after the latest finish plus lag', () => {
    const fin: Record<string, string> = { a: '2026-06-10', b: '2026-06-12' };
    expect(
      earliestStart(
        [
          { id: 'a', lag: 0 },
          { id: 'b', lag: 2 },
        ],
        (id) => fin[id] ?? null,
      ),
    ).toBe('2026-06-15');
    expect(earliestStart([{ id: 'x', lag: 0 }], () => null)).toBeNull();
  });
  it('copying a board re-points dependencies at the copied items and drops dangling ones', () => {
    const d = col('dependency', 'Dep');
    const out = remapDependencies(
      [d],
      {
        [d.id]: [
          { id: 'old1', lag: 1 },
          { id: 'zzz', lag: 0 },
        ],
      },
      new Map([['old1', 'new1']]),
    );
    expect(out[d.id]).toEqual([{ id: 'new1', lag: 1 }]);
    expect(
      remapDependencies([d], { [d.id]: [{ id: 'zzz', lag: 0 }] }, new Map())[d.id],
    ).toBeUndefined();
  });
});

describe('formula validation and renaming', () => {
  const cols = [
    { id: 'a', title: 'Budget' },
    { id: 'b', title: 'Spent' },
    { id: 'f', title: 'Left', formula: '{Budget} - {Spent}' },
    { id: 'g', title: 'Twice', formula: '{Left} * 2' },
  ];
  it('accepts good formulas and reports syntax and unknown-column problems with positions', () => {
    expect(validateFormula('{Budget} * 2', cols, null)).toBeNull();
    expect(validateFormula('{Budget} *', cols, null)?.message).toContain('ends too soon');
    const unknown = validateFormula('{Budjet} * 2', cols, null);
    expect(unknown?.message).toBe("There's no column called {Budjet}");
    expect(unknown?.pos).toBe(0);
  });
  it('refuses self-reference and circles between formula columns', () => {
    expect(validateFormula('{Left} + 1', cols, 'f')?.message).toContain(
      "can't refer to its own column",
    );
    expect(validateFormula('{Twice} + 1', cols, 'f')?.message).toBe(
      'This would go in a circle: {Twice} → {Left}',
    );
    expect(validateFormula('{Budget} + 1', cols, 'f')).toBeNull();
  });
  it('renaming a column updates references everywhere (not text in quotes)', () => {
    const full = [
      { id: 'a', title: 'Budget', type: 'numbers', settings: {} },
      {
        id: 'f',
        title: 'Left',
        type: 'formula',
        settings: { formula: '{budget} - {Spent} & "{Budget}"' },
      },
    ];
    const out = renameFormulaRefs(full, 'Budget', 'Plan');
    expect(out[1]!.settings.formula).toBe('{Plan} - {Spent} & "{Budget}"');
    expect(out[0]).toBe(full[0]);
    expect(renameFormulaRefs(full, 'Nothing', 'X')[1]).toBe(full[1]);
  });
  it('column titles cannot contain braces', () => {
    expect(cleanColumnTitle(' {Cost} ($) ')).toBe('Cost ($)');
  });
});

describe('the new types in views, summaries and conversion', () => {
  const rating = col('rating', 'Rating');
  const progress = col('progress', 'Progress');
  const formula = col('formula', 'Total', { formula: '{Rating} * 10' });
  const tags = col('tags', 'Tags', { options: [{ id: 't1', name: 'Home', color: 'blue' }] });
  const columns = [rating, progress, formula, tags];
  const ctx = { today: env.today, me: 'u1', memberName: env.memberName };
  const items = [
    item({ values: { [rating.id]: 2, [tags.id]: ['t1'] } }),
    item({ values: { [rating.id]: 5 } }),
    item(),
  ];

  it('every column type has filter operators, picker metadata and a width', () => {
    for (const t of COLUMN_TYPES) {
      expect(opsFor(t).length, t).toBeGreaterThan(0);
      expect(COLUMN_META[t].width, t).toBeGreaterThan(60);
    }
    expect(COLUMN_PICKER.map((p) => p.key)).toContain('priority');
    expect(COLUMN_PICKER.find((p) => p.key === 'priority')!.make().type).toBe('status');
    expect(new Set(COLUMN_PICKER.map((p) => p.key)).size).toBe(COLUMN_PICKER.length);
  });

  it('computed columns can be sorted, filtered and summarised like stored ones', () => {
    const computed = applyComputed(items, columns, env);
    const sorted = buildLayout({
      items: computed,
      columns,
      groups: [{ id: 'g', name: 'G', color: 'blue' }],
      config: { ...EMPTY_VIEW_CONFIG, sort: [{ columnId: formula.id, dir: 'desc' }] },
      search: '',
      ctx,
    });
    expect(sorted[0]!.rows.map((r) => r.item.values[formula.id])).toEqual([50, 20, 0]); // a blank rating counts as 0 in arithmetic, like a spreadsheet
    const filtered = buildLayout({
      items: computed,
      columns,
      groups: [{ id: 'g', name: 'G', color: 'blue' }],
      config: {
        ...EMPTY_VIEW_CONFIG,
        filters: [{ id: 'f', columnId: formula.id, op: 'gt', value: 30 }],
      },
      search: '',
      ctx,
    });
    expect(filtered[0]!.rows).toHaveLength(1);
    const tagged = buildLayout({
      items: computed,
      columns,
      groups: [{ id: 'g', name: 'G', color: 'blue' }],
      config: {
        ...EMPTY_VIEW_CONFIG,
        filters: [{ id: 'f', columnId: tags.id, op: 'anyOf', value: ['t1'] }],
      },
      search: '',
      ctx,
    });
    expect(tagged[0]!.rows).toHaveLength(1);
    expect(
      summarize(
        { ...formula, settings: { ...formula.settings, summary: 'sum' } },
        computed.map((i) => i.values[formula.id]),
      ),
    ).toMatchObject({ text: '70' });
    expect(
      summarize(
        { ...rating, settings: { ...rating.settings, summary: 'avg' } },
        computed.map((i) => i.values[rating.id]),
      ),
    ).toMatchObject({ text: '3.5 / 5' });
  });

  it('conversion handles the new types and refuses computed ones', () => {
    const text = col('text', 'T');
    const ctxC = { memberName: (u: string) => u, uidByName: () => null };
    const r = convertColumn(
      text,
      'rating',
      [
        { id: 'a', value: '4' },
        { id: 'b', value: '9' },
        { id: 'c', value: 'x' },
      ],
      ctxC,
    );
    expect(r.changes.map((c) => c.value)).toEqual([4, null, null]);
    const e = convertColumn(
      text,
      'email',
      [
        { id: 'a', value: 'me@x.com' },
        { id: 'b', value: 'nope' },
      ],
      ctxC,
    );
    expect(e.changes.map((c) => c.value)).toEqual(['me@x.com', null]);
    const tg = convertColumn(
      text,
      'tags',
      [
        { id: 'a', value: 'Home' },
        { id: 'b', value: 'Work' },
        { id: 'c', value: 'Home' },
      ],
      ctxC,
    );
    expect(tg.column.settings.options?.map((o) => o.name)).toEqual(['Home', 'Work']);
    expect(convertColumn(text, 'formula', [{ id: 'a', value: 'x' }], ctxC).changes).toEqual([]);
    expect(convertColumn(formula, 'text', [{ id: 'a', value: 5 }], ctxC).changes).toEqual([]);
  });
});

describe('templates with formula columns', () => {
  it.each(TEMPLATES.map((t) => t.id))(
    '%s: every formula is valid against its own columns',
    (id) => {
      const t = buildTemplate(id);
      const info = t.columns.map((c) => ({
        id: c.id,
        title: c.title,
        formula: c.settings.formula,
      }));
      for (const c of t.columns.filter((x) => x.type === 'formula')) {
        expect(
          validateFormula(c.settings.formula ?? '', info, c.id),
          `${id}/${c.title}`,
        ).toBeNull();
      }
    },
  );
  it('the bills template shows days until each due date', () => {
    const t = buildTemplate('bills');
    const due = t.columns.find((c) => c.title === 'Due date')!;
    const days = t.columns.find((c) => c.type === 'formula')!;
    const items = t.items
      .slice(0, 2)
      .map((it, i) =>
        item({ values: { ...it.values, ...(i === 0 ? { [due.id]: '2026-06-20' } : {}) } }),
      );
    const out = applyComputed(items, t.columns, env);
    expect(out[0]!.values[days.id]).toBe(5);
    expect(out[1]!.values[days.id]).toBeNull();
  });
});
