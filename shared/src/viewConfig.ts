import type { Group } from './board';
import {
  normalizeValue,
  valueToText,
  type Column,
  type ColumnType,
  type LinkValue,
  type TimelineValue,
} from './columns';
import { shortId } from './ids';
import type { ItemLike } from './itemLike';
import { byOrder } from './ordering';
import { LABEL_COLOR_NAMES, type LabelColor } from './palette';

/** Saved per view (views/{vid}.config): its own filter/sort/group/visible columns. */
export type FilterOp =
  | 'contains'
  | 'notContains'
  | 'is'
  | 'isEmpty'
  | 'notEmpty'
  | 'anyOf'
  | 'noneOf'
  | 'eq'
  | 'gt'
  | 'lt'
  | 'on'
  | 'before'
  | 'after'
  | 'overdue'
  | 'checked'
  | 'unchecked';

export interface Filter {
  id: string;
  /** A column id, or 'name' for the item name. */
  columnId: string;
  op: FilterOp;
  value?: string | number | string[];
}

export interface SortRule {
  columnId: string; // column id or 'name'
  dir: 'asc' | 'desc';
}

export interface ViewConfig {
  filters: Filter[];
  sort: SortRule[];
  groupBy: string | null; // a status / dropdown / people column id
  hiddenCols: string[];
  colWidths: Record<string, number>;
  showArchived: boolean;
}

export const NAME_COLUMN_ID = 'name';
export const GROUPABLE_TYPES: readonly ColumnType[] = ['status', 'dropdown', 'people'];
export const MIN_COL_WIDTH = 80;
export const MAX_COL_WIDTH = 600;
export const MAX_FILTERS = 12;

export const EMPTY_VIEW_CONFIG: ViewConfig = {
  filters: [],
  sort: [],
  groupBy: null,
  hiddenCols: [],
  colWidths: {},
  showArchived: false,
};

export const OP_LABELS: Record<FilterOp, string> = {
  contains: 'contains',
  notContains: 'does not contain',
  is: 'is',
  isEmpty: 'is empty',
  notEmpty: 'is not empty',
  anyOf: 'is any of',
  noneOf: 'is none of',
  eq: '=',
  gt: '>',
  lt: '<',
  on: 'is on',
  before: 'is before',
  after: 'is after',
  overdue: 'is overdue',
  checked: 'is checked',
  unchecked: 'is unchecked',
};

export function opsFor(type: ColumnType | 'name'): FilterOp[] {
  switch (type) {
    case 'name':
    case 'text':
    case 'longText':
    case 'link':
      return ['contains', 'notContains', 'is', 'isEmpty', 'notEmpty'];
    case 'status':
    case 'dropdown':
    case 'people':
      return ['anyOf', 'noneOf', 'isEmpty', 'notEmpty'];
    case 'date':
      return ['on', 'before', 'after', 'overdue', 'isEmpty', 'notEmpty'];
    case 'timeline':
      return ['on', 'overdue', 'isEmpty', 'notEmpty'];
    case 'numbers':
      return ['eq', 'gt', 'lt', 'isEmpty', 'notEmpty'];
    case 'checkbox':
      return ['checked', 'unchecked'];
  }
}

export function opNeedsValue(op: FilterOp): boolean {
  return !['isEmpty', 'notEmpty', 'overdue', 'checked', 'unchecked'].includes(op);
}

/** A filter that needs a value but has none yet is ignored (so a half-typed filter doesn't hide everything). */
export function isFilterIncomplete(f: Filter): boolean {
  if (!opNeedsValue(f.op)) return false;
  const v = f.value;
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return Number.isNaN(v);
}

export function newFilter(columns: readonly Column[]): Filter {
  const first = columns[0];
  if (!first) return { id: shortId(), columnId: NAME_COLUMN_ID, op: 'contains', value: '' };
  return { id: shortId(), columnId: first.id, op: opsFor(first.type)[0] ?? 'isEmpty' };
}

/** Coerces whatever is stored in Firestore into a safe ViewConfig. */
export function parseViewConfig(raw: unknown): ViewConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const filters = (Array.isArray(r['filters']) ? r['filters'] : [])
    .filter(
      (f): f is Filter =>
        !!f && typeof f === 'object' && typeof (f as Filter).columnId === 'string',
    )
    .slice(0, MAX_FILTERS);
  const sort = (Array.isArray(r['sort']) ? r['sort'] : [])
    .filter(
      (x): x is SortRule =>
        !!x && typeof x === 'object' && typeof (x as SortRule).columnId === 'string',
    )
    .map((x) => ({
      columnId: x.columnId,
      dir: x.dir === 'desc' ? ('desc' as const) : ('asc' as const),
    }))
    .slice(0, 3);
  const widths: Record<string, number> = {};
  if (r['colWidths'] && typeof r['colWidths'] === 'object') {
    for (const [k, v] of Object.entries(r['colWidths'] as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) widths[k] = clampWidth(v);
    }
  }
  return {
    filters,
    sort,
    groupBy: typeof r['groupBy'] === 'string' ? r['groupBy'] : null,
    hiddenCols: Array.isArray(r['hiddenCols'])
      ? r['hiddenCols'].filter((x): x is string => typeof x === 'string')
      : [],
    colWidths: widths,
    showArchived: r['showArchived'] === true,
  };
}

export function clampWidth(w: number): number {
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(w)));
}

/** Drops filters/sorts/groupBy pointing at columns that no longer exist. */
export function pruneViewConfig(config: ViewConfig, columns: readonly Column[]): ViewConfig {
  const ids = new Set(columns.map((c) => c.id));
  const known = (id: string) => id === NAME_COLUMN_ID || ids.has(id);
  const groupCol = columns.find((c) => c.id === config.groupBy);
  return {
    ...config,
    filters: config.filters.filter((f) => known(f.columnId)),
    sort: config.sort.filter((s) => known(s.columnId)),
    groupBy: groupCol && GROUPABLE_TYPES.includes(groupCol.type) ? groupCol.id : null,
    hiddenCols: config.hiddenCols.filter((id) => ids.has(id)),
  };
}

export function isViewActive(config: ViewConfig, search = ''): boolean {
  return config.filters.some((f) => !isFilterIncomplete(f)) || search.trim() !== '';
}

// ---------------------------------------------------------------- filtering

export interface ViewContext {
  /** YYYY-MM-DD in the viewer's timezone. */
  today: string;
  /** Current user's uid (the "me" token in People filters). */
  me: string;
  memberName: (uid: string) => string;
}

export const ME = 'me';

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined;
}

function filterValueDate(f: Filter): string | null {
  return typeof f.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.value) ? f.value : null;
}

export function matchesFilter(
  item: ItemLike,
  columns: readonly Column[],
  f: Filter,
  ctx: ViewContext,
): boolean {
  if (f.columnId === NAME_COLUMN_ID) return matchText(item.name, f);
  const col = columns.find((c) => c.id === f.columnId);
  if (!col) return true; // filter on a deleted column is ignored
  const v = normalizeValue(col, item.values[col.id]);
  const empty = isEmptyValue(v);
  if (f.op === 'isEmpty') return empty;
  if (f.op === 'notEmpty') return !empty;

  switch (col.type) {
    case 'text':
    case 'longText':
      return matchText(typeof v === 'string' ? v : '', f);
    case 'link':
      return matchText(v ? (v as LinkValue).text || (v as LinkValue).url : '', f);
    case 'status': {
      const want = Array.isArray(f.value) ? f.value : [];
      const has = typeof v === 'string' && want.includes(v);
      return f.op === 'noneOf' ? !has : has;
    }
    case 'dropdown':
    case 'people': {
      const want = (Array.isArray(f.value) ? f.value : []).map((x) => (x === ME ? ctx.me : x));
      const have = Array.isArray(v) ? (v as string[]) : [];
      const any = have.some((x) => want.includes(x));
      return f.op === 'noneOf' ? !any : any;
    }
    case 'date': {
      if (f.op === 'overdue') return typeof v === 'string' && v < ctx.today;
      const d = filterValueDate(f);
      if (!d || typeof v !== 'string') return false;
      return f.op === 'on' ? v === d : f.op === 'before' ? v < d : v > d;
    }
    case 'timeline': {
      const t = v as TimelineValue | null;
      if (!t) return false;
      if (f.op === 'overdue') return t.end < ctx.today;
      const d = filterValueDate(f);
      return !!d && t.start <= d && d <= t.end;
    }
    case 'numbers': {
      const n = typeof f.value === 'number' ? f.value : Number(f.value);
      if (typeof v !== 'number' || Number.isNaN(n)) return false;
      return f.op === 'eq' ? v === n : f.op === 'gt' ? v > n : v < n;
    }
    case 'checkbox':
      return f.op === 'checked' ? v === true : v !== true;
  }
}

function matchText(text: string, f: Filter): boolean {
  const hay = text.toLowerCase();
  const needle = (typeof f.value === 'string' ? f.value : '').toLowerCase();
  switch (f.op) {
    case 'contains':
      return hay.includes(needle);
    case 'notContains':
      return !hay.includes(needle);
    case 'is':
      return hay === needle;
    case 'isEmpty':
      return hay === '';
    case 'notEmpty':
      return hay !== '';
    default:
      return true;
  }
}

// ------------------------------------------------------------------ sorting

type SortKey = string | number | null;

function sortKey(
  item: ItemLike,
  columns: readonly Column[],
  columnId: string,
  ctx: ViewContext,
): SortKey {
  if (columnId === NAME_COLUMN_ID) return item.name.toLowerCase();
  const col = columns.find((c) => c.id === columnId);
  if (!col) return null;
  const v = normalizeValue(col, item.values[col.id]);
  if (v === null) return null;
  switch (col.type) {
    case 'status':
      return (col.settings.labels ?? []).findIndex((l) => l.id === v);
    case 'dropdown':
      return valueToText(col, v).toLowerCase();
    case 'people':
      return valueToText(col, v, ctx.memberName).toLowerCase();
    case 'date':
      return v as string;
    case 'timeline':
      return (v as TimelineValue).start;
    case 'numbers':
      return v as number;
    case 'checkbox':
      return 1;
    case 'link':
      return ((v as LinkValue).text || (v as LinkValue).url).toLowerCase();
    default:
      return String(v).toLowerCase();
  }
}

export function compareBySort(
  a: ItemLike,
  b: ItemLike,
  columns: readonly Column[],
  sort: readonly SortRule[],
  ctx: ViewContext,
): number {
  for (const rule of sort) {
    const ka = sortKey(a, columns, rule.columnId, ctx);
    const kb = sortKey(b, columns, rule.columnId, ctx);
    if (ka === kb) continue;
    if (ka === null) return 1; // empty values always last
    if (kb === null) return -1;
    const c =
      typeof ka === 'number' && typeof kb === 'number'
        ? ka - kb
        : String(ka).localeCompare(String(kb));
    if (c !== 0) return rule.dir === 'desc' ? -c : c;
  }
  return byOrder(a, b);
}

// ------------------------------------------------------------------- layout

export interface LayoutRow<T extends ItemLike> {
  item: T;
  subitems: T[];
}

export interface LayoutGroup<T extends ItemLike> {
  key: string;
  /** Real board group id, or null for a virtual (group-by) group. */
  groupId: string | null;
  name: string;
  color: LabelColor;
  virtual: boolean;
  /** For virtual groups: the cell value a new item here should get. */
  newItemValue?: unknown;
  rows: Array<LayoutRow<T>>;
}

export interface LayoutInput<T extends ItemLike> {
  items: Iterable<T>;
  columns: readonly Column[];
  groups: readonly Group[];
  config: ViewConfig;
  search: string;
  ctx: ViewContext;
}

function colorFor(name: string): LabelColor {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return LABEL_COLOR_NAMES[h % LABEL_COLOR_NAMES.length] ?? 'blue';
}

/**
 * Turns raw items into what the table shows: filtered, sorted, grouped, with
 * subitems nested under their parent. Pure, so Kanban/Calendar can reuse it.
 */
export function buildLayout<T extends ItemLike>(input: LayoutInput<T>): Array<LayoutGroup<T>> {
  const { columns, groups, config, ctx } = input;
  const q = input.search.trim().toLowerCase();
  const visible = (i: T) => !i.deleted && (config.showArchived || !i.archived);

  const children = new Map<string, T[]>();
  const parents: T[] = [];
  for (const it of input.items) {
    if (!visible(it)) continue;
    if (it.parentId) {
      const list = children.get(it.parentId) ?? [];
      list.push(it);
      children.set(it.parentId, list);
    } else parents.push(it);
  }

  const activeFilters = config.filters.filter((f) => !isFilterIncomplete(f));
  const passes = (it: T) =>
    activeFilters.every((f) => matchesFilter(it, columns, f, ctx)) &&
    (!q || it.name.toLowerCase().includes(q));
  const cmp = (a: T, b: T) => compareBySort(a, b, columns, config.sort, ctx);

  const rows: Array<LayoutRow<T>> = [];
  for (const p of parents) {
    const subs = (children.get(p.id) ?? []).sort(cmp);
    const parentOk = passes(p);
    const matchingSubs = subs.filter(passes);
    if (!parentOk && matchingSubs.length === 0) continue;
    rows.push({ item: p, subitems: parentOk ? subs : matchingSubs });
  }
  rows.sort((a, b) => cmp(a.item, b.item));

  const filtering = activeFilters.length > 0 || q !== '';
  const groupCol = columns.find((c) => c.id === config.groupBy && GROUPABLE_TYPES.includes(c.type));

  if (!groupCol) {
    const firstId = groups[0]?.id;
    const byGroup = new Map<string, Array<LayoutRow<T>>>();
    for (const r of rows) {
      const gid = groups.some((g) => g.id === r.item.groupId)
        ? r.item.groupId
        : (firstId ?? r.item.groupId);
      const list = byGroup.get(gid) ?? [];
      list.push(r);
      byGroup.set(gid, list);
    }
    return groups
      .map((g) => ({
        key: g.id,
        groupId: g.id,
        name: g.name,
        color: g.color,
        virtual: false,
        rows: byGroup.get(g.id) ?? [],
      }))
      .filter((g) => !filtering || g.rows.length > 0);
  }

  // Group by a column: items with several values sit under their first value.
  const buckets = new Map<string, LayoutGroup<T>>();
  const order: string[] = [];
  const ensure = (key: string, name: string, color: LabelColor, newItemValue: unknown) => {
    if (!buckets.has(key)) {
      buckets.set(key, { key, groupId: null, name, color, virtual: true, newItemValue, rows: [] });
      order.push(key);
    }
    return buckets.get(key)!;
  };
  if (groupCol.type === 'status')
    for (const l of groupCol.settings.labels ?? []) ensure(l.id, l.name, l.color, l.id);
  if (groupCol.type === 'dropdown')
    for (const o of groupCol.settings.options ?? []) ensure(o.id, o.name, o.color, [o.id]);
  for (const r of rows) {
    const v = normalizeValue(groupCol, r.item.values[groupCol.id]);
    let key = '__empty';
    if (typeof v === 'string') key = v;
    else if (Array.isArray(v) && v[0]) key = v[0] as string;
    if (key === '__empty') ensure(key, `No ${groupCol.title.toLowerCase()}`, 'gray', null);
    else if (groupCol.type === 'people')
      ensure(key, ctx.memberName(key), colorFor(ctx.memberName(key)), [key]);
    buckets.get(key)?.rows.push(r);
  }
  const keys = [
    ...order.filter((k) => k !== '__empty'),
    ...(buckets.has('__empty') ? ['__empty'] : []),
  ];
  return keys.map((k) => buckets.get(k)!).filter((g) => g.rows.length > 0);
}
