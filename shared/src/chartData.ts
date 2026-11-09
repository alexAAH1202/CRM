import type { ChartMeasure } from './viewConfig';
import type { Column } from './columns';
import type { ItemLike } from './itemLike';

export const NONE_LABEL = '(none)';

export interface ChartPoint {
  key: string;
  /** Total for the category (for pie / bar / line). */
  total: number;
  /** Per stack, for stacked bars. */
  parts: Record<string, number>;
}

export interface ChartData {
  points: ChartPoint[];
  stacks: string[];
}

/** The category labels an item falls into for a column (several for multi-value columns). */
export function categoriesOf(
  col: Column,
  raw: unknown,
  memberName: (uid: string) => string,
): string[] {
  switch (col.type) {
    case 'status': {
      const l = (col.settings.labels ?? []).find((x) => x.id === raw);
      return [l ? l.name : NONE_LABEL];
    }
    case 'dropdown': {
      const opts = col.settings.options ?? [];
      const names = (Array.isArray(raw) ? raw : [])
        .map((id) => opts.find((o) => o.id === id)?.name)
        .filter((n): n is string => !!n);
      return names.length ? names : [NONE_LABEL];
    }
    case 'people': {
      const names = (Array.isArray(raw) ? raw : [])
        .filter((u): u is string => typeof u === 'string')
        .map(memberName);
      return names.length ? names : [NONE_LABEL];
    }
    case 'date':
      return [
        typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw.slice(0, 7) : NONE_LABEL,
      ];
    case 'checkbox':
      return [raw === true ? 'Yes' : 'No'];
    default:
      return [NONE_LABEL];
  }
}

/** Category order: status/dropdown in column order, dates chronologically, others A–Z; none last. */
function orderKeys(col: Column, keys: Set<string>): string[] {
  const list = [...keys];
  let rank: (k: string) => number | string;
  if (col.type === 'status' || col.type === 'dropdown') {
    const names = (col.type === 'status' ? col.settings.labels : col.settings.options) ?? [];
    rank = (k) => {
      const i = names.findIndex((n) => n.name === k);
      return i < 0 ? 1e6 : i;
    };
  } else rank = (k) => k;
  return list.sort((a, b) => {
    if (a === NONE_LABEL) return 1;
    if (b === NONE_LABEL) return -1;
    const x = rank(a);
    const y = rank(b);
    return typeof x === 'number' && typeof y === 'number'
      ? x - y
      : String(x).localeCompare(String(y));
  });
}

function numberOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function chartData(input: {
  items: readonly ItemLike[];
  group: Column;
  stack: Column | null;
  measure: ChartMeasure;
  value: Column | null;
  memberName: (uid: string) => string;
}): ChartData {
  const { group, stack, measure, value, memberName } = input;
  // sum/avg need a number column; without one, fall back to counting
  const m: ChartMeasure = measure !== 'count' && !value ? 'count' : measure;
  const cell = new Map<string, Map<string, { sum: number; n: number }>>();
  const cats = new Set<string>();
  const stacks = new Set<string>();
  for (const it of input.items) {
    const v = m === 'count' ? 1 : numberOf(it.values[(value as Column).id]);
    if (v === null) continue;
    const gs = categoriesOf(group, it.values[group.id], memberName);
    const ss = stack ? categoriesOf(stack, it.values[stack.id], memberName) : [''];
    for (const g of gs)
      for (const s of ss) {
        cats.add(g);
        if (stack) stacks.add(s);
        const row = cell.get(g) ?? new Map();
        const c = row.get(s) ?? { sum: 0, n: 0 };
        c.sum += v;
        c.n += 1;
        row.set(s, c);
        cell.set(g, row);
      }
  }
  const stackKeys = stack ? orderKeys(stack, stacks) : [];
  const fin = (c: { sum: number; n: number }) =>
    Math.round((m === 'avg' ? c.sum / c.n : c.sum) * 100) / 100;
  const points = orderKeys(group, cats).map((key) => {
    const row = cell.get(key) as Map<string, { sum: number; n: number }>;
    const parts: Record<string, number> = {};
    let all = { sum: 0, n: 0 };
    for (const [s, c] of row) {
      all = { sum: all.sum + c.sum, n: all.n + c.n };
      if (stack) parts[s] = fin(c);
    }
    return { key, total: fin(all), parts };
  });
  return { points, stacks: stackKeys };
}
