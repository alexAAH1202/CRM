import {
  isComputedType,
  normalizeValue,
  valueToText,
  type Column,
  type DependencyValue,
  type LinkValue,
  type ProgressSettings,
  type TimelineValue,
} from './columns';
import { todayIso } from './dates';
import {
  EMPTY,
  bool,
  date,
  err,
  evaluate,
  num,
  parseFormula,
  str,
  titleIndex,
  type FValue,
} from './formula';
import type { ItemLike } from './itemLike';

export interface ComputedEnv {
  /** Today (YYYY-MM-DD, viewer's timezone). */
  today: string;
  memberName: (uid: string) => string;
  itemName: (id: string) => string | undefined;
}

/** A formula that failed is stored in the transient values as `{ [FORMULA_ERROR_KEY]: message }`. */
export const FORMULA_ERROR_KEY = '__formulaError';

export function formulaErrorOf(value: unknown): string | null {
  if (value && typeof value === 'object' && FORMULA_ERROR_KEY in value) {
    const m = (value as Record<string, unknown>)[FORMULA_ERROR_KEY];
    return typeof m === 'string' ? m : 'Error';
  }
  return null;
}

function toCell(v: FValue): unknown {
  switch (v.t) {
    case 'num':
      return v.v;
    case 'str':
      return v.v === '' ? null : v.v;
    case 'bool':
      return v.v;
    case 'date':
      return v.v;
    case 'range':
      return `${v.start} – ${v.end}`;
    case 'empty':
      return null;
    case 'err':
      return { [FORMULA_ERROR_KEY]: v.msg };
  }
}

export function defaultProgressSettings(columns: readonly Column[]): ProgressSettings {
  const status = columns.find((c) => c.type === 'status');
  const labels = status?.settings.labels ?? [];
  const done = labels.find((l) => l.id === 'done') ?? labels.at(-1);
  return {
    source: 'subitems',
    statusColumnId: status?.id ?? null,
    doneLabelIds: done ? [done.id] : [],
    checkboxColumnIds: [],
  };
}

/** Percent complete (0–100), or null when there's nothing to measure. */
export function computeProgress<T extends ItemLike>(
  item: T,
  subitems: readonly T[],
  columns: readonly Column[],
  settings: ProgressSettings | undefined,
): number | null {
  const s = settings ?? defaultProgressSettings(columns);
  if (s.source === 'checkboxes') {
    const boxes = s.checkboxColumnIds
      .map((id) => columns.find((c) => c.id === id && c.type === 'checkbox'))
      .filter((c): c is Column => !!c);
    if (boxes.length === 0) return null;
    const done = boxes.filter((c) => normalizeValue(c, item.values[c.id]) === true).length;
    return (done / boxes.length) * 100;
  }
  const live = subitems.filter((k) => !k.deleted && !k.archived);
  if (live.length === 0) return null;
  const status =
    columns.find((c) => c.id === s.statusColumnId && c.type === 'status') ??
    columns.find((c) => c.type === 'status');
  if (!status) return null;
  const labels = status.settings.labels ?? [];
  const doneIds = new Set(
    s.doneLabelIds.length
      ? s.doneLabelIds
      : [(labels.find((l) => l.id === 'done') ?? labels.at(-1))?.id ?? ''],
  );
  const done = live.filter((k) =>
    doneIds.has(normalizeValue(status, k.values[status.id]) as string),
  ).length;
  return (done / live.length) * 100;
}

/**
 * Works out every computed column (formula, progress, item ID, created/updated, created by)
 * for each item and returns copies whose `values` include the results. Nothing here is ever
 * written to the database — it's recomputed whenever the board is shown (spec: "compute on
 * render, cache nothing"). Formulas see other columns by title and may refer to each other;
 * loops are reported as errors rather than hanging.
 */
export function applyComputed<T extends ItemLike>(
  items: readonly T[],
  columns: readonly Column[],
  env: ComputedEnv,
): T[] {
  const computedCols = columns.filter((c) => isComputedType(c.type));
  if (computedCols.length === 0) return items as T[];

  const byTitle = titleIndex(columns);
  const children = new Map<string, T[]>();
  for (const it of items) {
    if (!it.parentId) continue;
    const l = children.get(it.parentId) ?? [];
    l.push(it);
    children.set(it.parentId, l);
  }
  const parsed = new Map(
    columns
      .filter((c) => c.type === 'formula')
      .map((c) => [c.id, parseFormula(c.settings.formula ?? '')]),
  );
  const textCtx = { peopleName: env.memberName, itemName: env.itemName };

  return items.map((item) => {
    const memo = new Map<string, FValue>();
    const visiting = new Set<string>();

    const stored = (col: Column): FValue => {
      const v = normalizeValue(col, item.values[col.id]);
      if (v === null) return col.type === 'checkbox' ? bool(false) : EMPTY;
      switch (col.type) {
        case 'numbers':
        case 'rating':
          return num(v as number);
        case 'date':
          return date(v as string);
        case 'timeline':
          return { t: 'range', start: (v as TimelineValue).start, end: (v as TimelineValue).end };
        case 'checkbox':
          return bool(true);
        case 'link':
          return str((v as LinkValue).text || (v as LinkValue).url);
        case 'text':
        case 'longText':
        case 'email':
        case 'phone':
          return str(v as string);
        default: {
          const t = valueToText(col, v, textCtx);
          return t === '' ? EMPTY : str(t);
        }
      }
    };

    const valueOf = (col: Column): FValue => {
      const cached = memo.get(col.id);
      if (cached) return cached;
      if (visiting.has(col.id)) return err(`Circular reference: {${col.title}} depends on itself`);
      visiting.add(col.id);
      let out: FValue;
      switch (col.type) {
        case 'formula': {
          const p = parsed.get(col.id);
          if (!p) out = EMPTY;
          else if (!p.ok) out = (col.settings.formula ?? '').trim() === '' ? EMPTY : err(p.message);
          else
            out = evaluate(p.ast, {
              today: env.today,
              ref: (name) => {
                const target = byTitle.get(name.trim().toLowerCase());
                return target ? valueOf(target) : err(`Unknown column {${name}}`);
              },
            });
          break;
        }
        case 'progress': {
          const pct = computeProgress(
            item,
            children.get(item.id) ?? [],
            columns,
            col.settings.progress,
          );
          out = pct === null ? EMPTY : num(pct);
          break;
        }
        case 'itemId':
          out = item.itemNumber > 0 ? num(item.itemNumber) : EMPTY;
          break;
        case 'createdAt':
          out = item.createdAtMs ? date(todayIso(new Date(item.createdAtMs))) : EMPTY;
          break;
        case 'updatedAt':
          out = item.updatedAtMs ? date(todayIso(new Date(item.updatedAtMs))) : EMPTY;
          break;
        case 'createdBy':
          out = item.createdBy ? str(env.memberName(item.createdBy)) : EMPTY;
          break;
        default:
          out = stored(col);
      }
      visiting.delete(col.id);
      memo.set(col.id, out);
      return out;
    };

    const values: Record<string, unknown> = { ...item.values };
    for (const col of computedCols) {
      const v = valueOf(col);
      // createdBy keeps the uid (the cell renders the name); the others keep their value.
      values[col.id] = col.type === 'createdBy' ? (item.createdBy ?? null) : toCell(v);
    }
    return { ...item, values };
  });
}

/** Dependency values for an item, ready for display (dangling references are dropped). */
export function liveDependencies(
  deps: readonly DependencyValue[],
  exists: (id: string) => boolean,
): DependencyValue[] {
  return deps.filter((d) => exists(d.id));
}
