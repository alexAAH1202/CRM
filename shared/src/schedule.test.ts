import { describe, expect, it } from 'vitest';
import type { DependencyValue } from './columns';
import {
  barRect,
  dayAt,
  dependencyEdges,
  dragSpan,
  ganttRange,
  ganttTicks,
  shiftPlan,
  ZOOM_PX,
} from './schedule';
import type { DateSpan } from './views';

const sp = (start: string, end: string): DateSpan => ({ start, end });

describe('gantt geometry', () => {
  it('range covers bars and today, padded, at least 120 days', () => {
    const r = ganttRange([sp('2026-03-10', '2026-03-12')], '2026-03-11');
    expect(r.start).toBe('2026-03-07');
    expect(r.days).toBe(120);
    const wide = ganttRange([sp('2026-01-01', '2026-06-30')], '2026-03-01');
    expect(wide.start).toBe('2025-12-29');
    expect(wide.days).toBe(
      Math.round((Date.parse('2026-07-14') - Date.parse('2025-12-29')) / 864e5) + 1,
    );
  });
  it('bar rect is inclusive of the end day', () => {
    expect(barRect(sp('2026-03-10', '2026-03-10'), '2026-03-08', 10)).toEqual({ x: 20, w: 10 });
    expect(barRect(sp('2026-03-10', '2026-03-12'), '2026-03-08', 10)).toEqual({ x: 20, w: 30 });
  });
  it('dayAt maps pixels back to dates', () => {
    expect(dayAt('2026-03-08', 10, 0)).toBe('2026-03-08');
    expect(dayAt('2026-03-08', 10, 29)).toBe('2026-03-10');
    expect(dayAt('2026-03-08', 10, -1)).toBe('2026-03-07');
  });
  it('dragSpan: move keeps length; resize never inverts', () => {
    const s = sp('2026-03-10', '2026-03-12');
    expect(dragSpan(s, 'move', 3)).toEqual(sp('2026-03-13', '2026-03-15'));
    expect(dragSpan(s, 'move', -11)).toEqual(sp('2026-02-27', '2026-03-01'));
    expect(dragSpan(s, 'start', -2)).toEqual(sp('2026-03-08', '2026-03-12'));
    expect(dragSpan(s, 'start', 9)).toEqual(sp('2026-03-12', '2026-03-12'));
    expect(dragSpan(s, 'end', -9)).toEqual(sp('2026-03-10', '2026-03-10'));
    expect(dragSpan(s, 'end', 2)).toEqual(sp('2026-03-10', '2026-03-14'));
    expect(dragSpan(s, 'move', 1.9)).toEqual(sp('2026-03-11', '2026-03-13'));
  });
  it('ticks per zoom', () => {
    const r = { start: '2026-03-01', days: 40 };
    expect(ganttTicks(r, 'day')).toHaveLength(40);
    expect(ganttTicks(r, 'week').map((t) => t.label)).toEqual([
      '2 Mar',
      '9 Mar',
      '16 Mar',
      '23 Mar',
      '30 Mar',
      '6 Apr',
    ]);
    expect(ganttTicks(r, 'month').map((t) => t.label)).toEqual(['Mar 2026', 'Apr 2026']);
    expect(ganttTicks(r, 'week')[1]!.x).toBe(8 * ZOOM_PX.week);
  });
});

const deps = (m: Record<string, DependencyValue[]>) => (id: string) => m[id] ?? [];

describe('dependency edges', () => {
  it('flags a dependent that starts too early (lag included)', () => {
    const spans = new Map([
      ['a', sp('2026-03-02', '2026-03-04')],
      ['b', sp('2026-03-05', '2026-03-06')],
      ['c', sp('2026-03-05', '2026-03-06')],
    ]);
    const e = dependencyEdges(deps({ b: [{ id: 'a', lag: 0 }], c: [{ id: 'a', lag: 2 }] }), spans);
    expect(e).toEqual([
      { from: 'a', to: 'b', lag: 0, violated: false },
      { from: 'a', to: 'c', lag: 2, violated: true },
    ]);
  });
  it('ignores predecessors with no dates or that no longer exist', () => {
    const spans = new Map([['b', sp('2026-03-05', '2026-03-06')]]);
    expect(dependencyEdges(deps({ b: [{ id: 'gone', lag: 0 }] }), spans)).toEqual([]);
  });
});

describe('shiftPlan', () => {
  it('pushes dependents later, keeping their length, and cascades', () => {
    const spans = new Map([
      ['a', sp('2026-03-09', '2026-03-12')], // a was moved later
      ['b', sp('2026-03-05', '2026-03-06')],
      ['c', sp('2026-03-07', '2026-03-10')],
    ]);
    const d = deps({ b: [{ id: 'a', lag: 0 }], c: [{ id: 'b', lag: 1 }] });
    const plan = shiftPlan('a', spans, d);
    expect(plan.get('b')).toEqual(sp('2026-03-13', '2026-03-14'));
    expect(plan.get('c')).toEqual(sp('2026-03-16', '2026-03-19'));
    expect(plan.has('a')).toBe(false);
  });
  it('never pulls earlier, and leaves satisfied dependents alone', () => {
    const spans = new Map([
      ['a', sp('2026-03-02', '2026-03-03')],
      ['b', sp('2026-03-20', '2026-03-21')],
    ]);
    expect(shiftPlan('a', spans, deps({ b: [{ id: 'a', lag: 0 }] })).size).toBe(0);
  });
  it('uses the latest of several predecessors', () => {
    const spans = new Map([
      ['a', sp('2026-03-02', '2026-03-10')],
      ['x', sp('2026-03-02', '2026-03-03')],
      ['b', sp('2026-03-04', '2026-03-05')],
    ]);
    const plan = shiftPlan(
      'a',
      spans,
      deps({
        b: [
          { id: 'a', lag: 0 },
          { id: 'x', lag: 0 },
        ],
      }),
    );
    expect(plan.get('b')).toEqual(sp('2026-03-11', '2026-03-12'));
  });
  it('terminates on looped data', () => {
    const spans = new Map([
      ['a', sp('2026-03-02', '2026-03-03')],
      ['b', sp('2026-03-02', '2026-03-03')],
    ]);
    const plan = shiftPlan(
      'a',
      spans,
      deps({ a: [{ id: 'b', lag: 0 }], b: [{ id: 'a', lag: 0 }] }),
    );
    expect(plan.size).toBeLessThanOrEqual(1);
  });
});
