import { describe, expect, it } from 'vitest';
import { convertColumn } from './convert';
import { makeColumn } from './columns';
import { summarize } from './summaries';

const ctx = {
  memberName: (u: string) => (u === 'u1' ? 'Ann Lee' : u),
  uidByName: (n: string) => (n.toLowerCase() === 'ann lee' ? 'u1' : null),
};
const run = (
  from: ReturnType<typeof makeColumn>,
  to: Parameters<typeof convertColumn>[1],
  vals: unknown[],
) =>
  convertColumn(
    from,
    to,
    vals.map((value, i) => ({ id: `i${i}`, value })),
    ctx,
  );

describe('convertColumn', () => {
  it('text ↔ long text keeps values', () => {
    const r = run(makeColumn('text'), 'longText', ['a', 'b', undefined]);
    expect(r.kept).toBe(2);
    expect(r.cleared).toBe(0);
    expect(r.column.type).toBe('longText');
  });

  it('text → numbers parses what it can and counts what it clears', () => {
    const r = run(makeColumn('text'), 'numbers', ['$1,250.50', 'n/a', '12']);
    expect(r.changes.map((c) => c.value)).toEqual([1250.5, null, 12]);
    expect(r.kept).toBe(2);
    expect(r.cleared).toBe(1);
  });

  it('text → status builds labels from distinct values', () => {
    const r = run(makeColumn('text'), 'status', ['Paid', 'Due', 'Paid']);
    const labels = r.column.settings.labels!;
    expect(labels.map((l) => l.name)).toEqual(['Paid', 'Due']);
    expect(r.changes[0]!.value).toBe(labels[0]!.id);
    expect(r.changes[2]!.value).toBe(labels[0]!.id);
  });

  it('status → dropdown keeps label ids and colours; status → text uses names', () => {
    const s = makeColumn('status');
    const dd = run(s, 'dropdown', ['done', 'stuck']);
    expect(dd.column.settings.options).toEqual(s.settings.labels);
    expect(dd.changes.map((c) => c.value)).toEqual([['done'], ['stuck']]);
    expect(run(s, 'text', ['done']).changes[0]!.value).toBe('Done');
  });

  it('people → text uses names; text → people matches member names', () => {
    expect(run(makeColumn('people'), 'text', [['u1']]).changes[0]!.value).toBe('Ann Lee');
    const back = run(makeColumn('text'), 'people', ['Ann Lee', 'Stranger']);
    expect(back.changes.map((c) => c.value)).toEqual([['u1'], null]);
    expect(back.cleared).toBe(1);
  });

  it('dates: ISO and d/m/yyyy convert, others clear', () => {
    const r = run(makeColumn('text'), 'date', ['2026-03-04', '5/6/2027', 'soon']);
    expect(r.changes.map((c) => c.value)).toEqual(['2026-03-04', '2027-06-05', null]);
  });

  it('checkbox and link', () => {
    expect(run(makeColumn('text'), 'checkbox', ['yes', 'no']).changes.map((c) => c.value)).toEqual([
      true,
      null,
    ]);
    expect(
      run(makeColumn('text'), 'link', ['https://a.com', 'hello']).changes.map((c) => c.value),
    ).toEqual([{ url: 'https://a.com', text: '' }, null]);
  });

  it('the column keeps its id and title; same type is a no-op', () => {
    const c = makeColumn('text', 'Notes');
    const r = run(c, 'numbers', ['1']);
    expect(r.column.id).toBe(c.id);
    expect(r.column.title).toBe('Notes');
    expect(run(c, 'text', ['x']).changes).toEqual([]);
  });
});

describe('summaries', () => {
  const n = makeColumn('numbers', 'Cost', { unit: '$', decimals: 2 });
  it('sum/avg/min/max/count with formatting', () => {
    const vals = [10, 20.5, undefined, 'x'];
    expect(summarize(n, vals)).toEqual({ kind: 'number', op: 'sum', text: '$30.50' });
    expect(summarize({ ...n, settings: { ...n.settings, summary: 'avg' } }, vals)).toMatchObject({
      text: '$15.25',
    });
    expect(summarize({ ...n, settings: { ...n.settings, summary: 'max' } }, vals)).toMatchObject({
      text: '$20.50',
    });
    expect(summarize({ ...n, settings: { ...n.settings, summary: 'count' } }, vals)).toEqual({
      kind: 'count',
      n: 2,
    });
    expect(summarize(n, [])).toEqual({ kind: 'number', op: 'sum', text: null });
  });
  it('status distribution in label order, skipping empties', () => {
    const s = makeColumn('status');
    const d = summarize(s, ['done', 'stuck', 'done', undefined]);
    expect(d).toEqual({
      kind: 'distribution',
      total: 3,
      parts: [
        { label: 'Stuck', color: 'red', count: 1 },
        { label: 'Done', color: 'green', count: 2 },
      ],
    });
  });
  it('text has no summary by default; an invalid kind falls back', () => {
    expect(summarize(makeColumn('text'), ['a'])).toEqual({ kind: 'none' });
    expect(summarize({ ...makeColumn('text'), settings: { summary: 'sum' } }, ['a'])).toEqual({
      kind: 'none',
    });
  });
});
