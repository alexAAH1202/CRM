import { LIMITS } from './constants';
import { isComputedType, valueToText, type Column } from './columns';
import { shortId } from './ids';
import type { ItemLike } from './itemLike';
import { SERVER_TIME, type DocData, type WriteOp } from './ops';
import { dueDateOf, isDone, bucketOf } from './myWork';
import { paths } from './paths';
import { rowsFromItems, filterRows, groupRows, type TimesheetRow } from './timeTracking';
import type { ChartMeasure, ChartType } from './viewConfig';
import { spanOf, type DateSpan } from './views';

/**
 * Dashboards: a household page of widgets drawn from up to five of its lists.
 *
 * How each widget gets its data (this is what keeps a dashboard cheap):
 *  - "numbers" asks Firestore to count/sum/average on the server (an aggregation query), which is
 *    billed roughly one read per thousand items matched instead of one per item;
 *  - the others need the items themselves, so they share ONE read of each list's items (kept for a
 *    minute), whatever number of widgets use it;
 *  - "time tracked" reads only items that have time logged on them.
 * Nothing on a dashboard is a live listener.
 */

export const MAX_DASHBOARD_LISTS = LIMITS.MAX_DASHBOARD_BOARDS;
export const MAX_WIDGETS = 24;
export const GRID_COLS = 12;

export const WIDGET_TYPES = [
  'numbers',
  'battery',
  'chart',
  'table',
  'overdue',
  'tasksByPerson',
  'workload',
  'timeline',
  'timeTracked',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export type DataStrategy = 'aggregate' | 'items' | 'time';

export const WIDGET_META: Record<
  WidgetType,
  { label: string; description: string; strategy: DataStrategy; w: number; h: number }
> = {
  numbers: {
    label: 'Number',
    description: 'A count, total or average',
    strategy: 'aggregate',
    w: 3,
    h: 2,
  },
  battery: {
    label: 'Progress',
    description: 'How much of everything is done',
    strategy: 'items',
    w: 4,
    h: 2,
  },
  chart: {
    label: 'Chart',
    description: 'Bar, stacked, pie or line',
    strategy: 'items',
    w: 6,
    h: 4,
  },
  table: {
    label: 'Items',
    description: 'A short list of items from a list',
    strategy: 'items',
    w: 6,
    h: 4,
  },
  overdue: {
    label: 'Overdue',
    description: 'What is past its due date',
    strategy: 'items',
    w: 4,
    h: 4,
  },
  tasksByPerson: {
    label: 'Tasks by person',
    description: 'Open items for each person',
    strategy: 'items',
    w: 4,
    h: 4,
  },
  workload: {
    label: 'Workload',
    description: 'Hours per person per week',
    strategy: 'items',
    w: 6,
    h: 4,
  },
  timeline: {
    label: 'Timeline',
    description: 'Items with a start and end date',
    strategy: 'items',
    w: 8,
    h: 4,
  },
  timeTracked: {
    label: 'Time tracked',
    description: 'Hours logged by each person',
    strategy: 'time',
    w: 4,
    h: 3,
  },
};

export interface WidgetConfig {
  title?: string;
  /** The list this widget reads; null = all of the dashboard's lists (where that makes sense). */
  boardId?: string | null;
  measure?: ChartMeasure;
  /** numbers: the Numbers column to add up / average; chart: the value column. */
  columnId?: string | null;
  /** numbers: only count items whose Status is this label. */
  statusColumnId?: string | null;
  statusLabelId?: string | null;
  groupColumnId?: string | null;
  stackColumnId?: string | null;
  chartType?: ChartType;
  columnIds?: string[];
  onlyOpen?: boolean;
  limit?: number;
  period?: 'week' | 'month' | 'all';
  weeks?: number;
  /** timeline / workload: the Timeline column. */
  dateColumnId?: string | null;
}

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Widget {
  id: string;
  type: WidgetType;
  config: WidgetConfig;
  layout: WidgetLayout;
}

export type DashboardVisibility = 'main' | 'private';

export interface DashboardDoc {
  name: string;
  boardIds: string[];
  widgets: Widget[];
  visibility: DashboardVisibility;
  memberIds: string[];
}

// ------------------------------------------------------------------ parsing

const str = (v: unknown, max = 64) =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
const oneOf = <T extends string>(v: unknown, all: readonly T[]): T | undefined =>
  all.includes(v as T) ? (v as T) : undefined;
const int = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;

/** Sanitises a widget's settings; unknown or malformed fields vanish. Never throws. */
export function parseWidgetConfig(raw: unknown, boardIds: readonly string[]): WidgetConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const c: WidgetConfig = {};
  const title = typeof r['title'] === 'string' ? r['title'].trim().slice(0, 80) : '';
  if (title) c.title = title;
  if ('boardId' in r) {
    const b = str(r['boardId'], 128);
    c.boardId = b && boardIds.includes(b) ? b : null;
  }
  const measure = oneOf(r['measure'], ['count', 'sum', 'avg'] as const);
  if (measure) c.measure = measure;
  for (const k of [
    'columnId',
    'statusColumnId',
    'statusLabelId',
    'groupColumnId',
    'stackColumnId',
    'dateColumnId',
  ] as const) {
    if (k in r) c[k] = str(r[k]);
  }
  const chartType = oneOf(r['chartType'], ['bar', 'stacked', 'pie', 'line'] as const);
  if (chartType) c.chartType = chartType;
  if (Array.isArray(r['columnIds']))
    c.columnIds = [
      ...new Set((r['columnIds'] as unknown[]).map((x) => str(x)).filter((x): x is string => !!x)),
    ].slice(0, 5);
  if (typeof r['onlyOpen'] === 'boolean') c.onlyOpen = r['onlyOpen'];
  if ('limit' in r) c.limit = int(r['limit'], 1, 25, 10);
  const period = oneOf(r['period'], ['week', 'month', 'all'] as const);
  if (period) c.period = period;
  if ('weeks' in r) c.weeks = int(r['weeks'], 1, 12, 4);
  return c;
}

export function clampLayout(raw: unknown, type: WidgetType): WidgetLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const meta = WIDGET_META[type];
  const w = int(r['w'], 2, GRID_COLS, meta.w);
  return {
    w,
    h: int(r['h'], 1, 12, meta.h),
    x: int(r['x'], 0, GRID_COLS - w, 0),
    y: int(r['y'], 0, 500, 0),
  };
}

/** Widgets from stored data: valid ones only, unique ids, at most MAX_WIDGETS. */
export function parseWidgets(raw: unknown, boardIds: readonly string[]): Widget[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Widget[] = [];
  for (const w of raw as unknown[]) {
    const r = w as Partial<Widget> | null;
    const id = str(r?.id);
    const type = oneOf(r?.type, WIDGET_TYPES);
    if (!id || !type || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      type,
      config: parseWidgetConfig(r?.config, boardIds),
      layout: clampLayout(r?.layout, type),
    });
    if (out.length >= MAX_WIDGETS) break;
  }
  return out;
}

export function parseDashboard(raw: Record<string, unknown>): DashboardDoc {
  const boardIds = (Array.isArray(raw['boardIds']) ? (raw['boardIds'] as unknown[]) : [])
    .map((b) => str(b, 128))
    .filter((b): b is string => !!b)
    .slice(0, MAX_DASHBOARD_LISTS);
  return {
    name: str(raw['name'], 200) ?? 'Dashboard',
    boardIds: [...new Set(boardIds)],
    widgets: parseWidgets(raw['widgets'], boardIds),
    visibility: raw['visibility'] === 'private' ? 'private' : 'main',
    memberIds: (Array.isArray(raw['memberIds']) ? (raw['memberIds'] as unknown[]) : [])
      .map((m) => str(m, 128))
      .filter((m): m is string => !!m)
      .slice(0, LIMITS.MAX_BOARD_MEMBERS),
  };
}

/** A new widget placed below the existing ones. */
export function newWidget(
  type: WidgetType,
  boardIds: readonly string[],
  existing: readonly Widget[],
  config: WidgetConfig = {},
): Widget {
  const meta = WIDGET_META[type];
  const bottom = existing.reduce((m, w) => Math.max(m, w.layout.y + w.layout.h), 0);
  return {
    id: shortId(),
    type,
    config: parseWidgetConfig(config, boardIds),
    layout: { x: 0, y: bottom, w: meta.w, h: meta.h },
  };
}

// ------------------------------------------------------------------ planners

const dashPath = (wid: string, did: string) => `${paths.workspace(wid)}/dashboards/${did}`;

export function planCreateDashboard(input: {
  wid: string;
  did: string;
  uid: string;
  name: string;
  boardIds: readonly string[];
  visibility: DashboardVisibility;
  memberIds?: readonly string[];
}): WriteOp[] {
  const boardIds = [...new Set(input.boardIds)].slice(0, MAX_DASHBOARD_LISTS);
  const memberIds =
    input.visibility === 'private'
      ? [...new Set([input.uid, ...(input.memberIds ?? [])])].slice(0, LIMITS.MAX_BOARD_MEMBERS)
      : [];
  return [
    {
      kind: 'set',
      path: dashPath(input.wid, input.did),
      data: {
        name: input.name.trim().slice(0, 200) || 'Dashboard',
        boardIds,
        widgets: [],
        visibility: input.visibility,
        memberIds,
        createdBy: input.uid,
        createdAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
      },
    },
  ];
}

export function planUpdateDashboard(
  wid: string,
  did: string,
  patch: Partial<Pick<DashboardDoc, 'name' | 'boardIds' | 'widgets' | 'visibility' | 'memberIds'>>,
  /** The dashboard's lists once this change is made (a widget may only point at one of them). */
  lists: readonly string[],
): WriteOp[] {
  const data: DocData = { updatedAt: SERVER_TIME };
  if (patch.name !== undefined) data['name'] = patch.name.trim().slice(0, 200) || 'Dashboard';
  if (patch.boardIds !== undefined)
    data['boardIds'] = [...new Set(patch.boardIds)].slice(0, MAX_DASHBOARD_LISTS);
  if (patch.widgets !== undefined) {
    data['widgets'] = patch.widgets.slice(0, MAX_WIDGETS).map((w) => ({
      id: w.id,
      type: w.type,
      config: parseWidgetConfig(w.config, lists),
      layout: clampLayout(w.layout, w.type),
    }));
  }
  if (patch.visibility !== undefined) data['visibility'] = patch.visibility;
  if (patch.memberIds !== undefined)
    data['memberIds'] = patch.memberIds.slice(0, LIMITS.MAX_BOARD_MEMBERS);
  return [{ kind: 'update', path: dashPath(wid, did), data }];
}

export const planDeleteDashboard = (wid: string, did: string): WriteOp[] => [
  { kind: 'delete', path: dashPath(wid, did) },
];

// ------------------------------------------------------------------ data helpers

export interface DashItem extends ItemLike {
  assigneeUids?: string[];
}

export interface ListData {
  boardId: string;
  boardName: string;
  columns: Column[];
  items: DashItem[];
}

/** Top-level items that are neither deleted nor archived: what "the work" means on a dashboard. */
export const liveTopLevel = (items: readonly DashItem[]): DashItem[] =>
  items.filter((i) => !i.deleted && !i.archived && !i.parentId);

/** The filter an aggregation query would use for a "numbers" widget (all equality tests). */
export interface AggregateSpec {
  filters: Array<{ field: string; value: unknown }>;
  measure: 'count' | 'sum' | 'avg';
  /** Field to add up / average (a Numbers column), if any. */
  valueField: string | null;
}

export function aggregateSpec(config: WidgetConfig, columns: readonly Column[]): AggregateSpec {
  const filters: AggregateSpec['filters'] = [
    { field: 'deletedAt', value: null },
    { field: 'archived', value: false },
    { field: 'parentId', value: null },
  ];
  const status = columns.find((c) => c.id === config.statusColumnId && c.type === 'status');
  if (
    status &&
    config.statusLabelId &&
    (status.settings.labels ?? []).some((l) => l.id === config.statusLabelId)
  )
    filters.push({ field: `values.${status.id}`, value: config.statusLabelId });
  const col = columns.find((c) => c.id === config.columnId && c.type === 'numbers');
  const measure = config.measure && config.measure !== 'count' && col ? config.measure : 'count';
  return { filters, measure, valueField: measure === 'count' || !col ? null : `values.${col.id}` };
}

/** The same answer computed from loaded items (used in tests as the oracle for the server query). */
export function numbersFromItems(
  items: readonly DashItem[],
  config: WidgetConfig,
  columns: readonly Column[],
): number {
  const spec = aggregateSpec(config, columns);
  const rows = liveTopLevel(items).filter((it) =>
    spec.filters.every((f) => {
      if (f.field === 'deletedAt' || f.field === 'archived' || f.field === 'parentId') return true;
      const key = f.field.replace(/^values\./, '');
      return it.values[key] === f.value;
    }),
  );
  if (spec.measure === 'count' || !spec.valueField) return rows.length;
  const key = spec.valueField.replace(/^values\./, '');
  const nums = rows.map((r) => r.values[key]).filter((v): v is number => typeof v === 'number');
  if (nums.length === 0) return 0;
  const sum = nums.reduce((a, b) => a + b, 0);
  return spec.measure === 'sum' ? sum : sum / nums.length;
}

export interface OverdueRow {
  boardId: string;
  boardName: string;
  itemId: string;
  name: string;
  due: string;
  daysLate: number;
}

/** Open items past their due date, most overdue first. */
export function overdueRows(lists: readonly ListData[], today: string, limit = 25): OverdueRow[] {
  const out: OverdueRow[] = [];
  for (const l of lists)
    for (const it of liveTopLevel(l.items)) {
      if (isDone(l.columns, it.values)) continue;
      const due = dueDateOf(l.columns, it.values);
      if (!due || bucketOf(due, today) !== 'overdue') continue;
      out.push({
        boardId: l.boardId,
        boardName: l.boardName,
        itemId: it.id,
        name: it.name,
        due,
        daysLate: Math.round(
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000,
        ),
      });
    }
  return out
    .sort((a, b) => b.daysLate - a.daysLate || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export interface Battery {
  done: number;
  total: number;
  /** 0–100, rounded; 0 when there is nothing. */
  pct: number;
}

/** Share of items marked done (items on a list with no Status column count as not done). */
export function battery(lists: readonly ListData[]): Battery {
  let done = 0;
  let total = 0;
  for (const l of lists)
    for (const it of liveTopLevel(l.items)) {
      total++;
      if (isDone(l.columns, it.values)) done++;
    }
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export interface PersonLoad {
  uid: string | null;
  open: number;
  overdue: number;
}

/** Open items per person (an item with several people counts for each); unassigned last. */
export function tasksByPerson(lists: readonly ListData[], today: string): PersonLoad[] {
  const m = new Map<string | null, PersonLoad>();
  for (const l of lists)
    for (const it of liveTopLevel(l.items)) {
      if (isDone(l.columns, it.values)) continue;
      const owners: Array<string | null> = it.assigneeUids?.length ? it.assigneeUids : [null];
      const late = bucketOf(dueDateOf(l.columns, it.values), today) === 'overdue';
      for (const o of owners) {
        const p = m.get(o) ?? { uid: o, open: 0, overdue: 0 };
        p.open++;
        if (late) p.overdue++;
        m.set(o, p);
      }
    }
  return [...m.values()].sort((a, b) =>
    a.uid === null
      ? 1
      : b.uid === null
        ? -1
        : b.open - a.open || String(a.uid).localeCompare(String(b.uid)),
  );
}

export interface TableRow {
  id: string;
  name: string;
  cells: string[];
}

/** A short table of a list's items with the chosen columns shown as text. */
export function tableRows(
  list: ListData,
  config: WidgetConfig,
  memberName: (uid: string) => string,
): { headers: string[]; rows: TableRow[] } {
  const cols = (config.columnIds ?? [])
    .map((id) => list.columns.find((c) => c.id === id))
    .filter((c): c is Column => !!c && !isComputedType(c.type));
  const open = config.onlyOpen !== false;
  const items = liveTopLevel(list.items)
    .filter((it) => !open || !isDone(list.columns, it.values))
    .sort((a, b) => a.order.localeCompare(b.order))
    .slice(0, config.limit ?? 10);
  return {
    headers: cols.map((c) => c.title),
    rows: items.map((it) => ({
      id: it.id,
      name: it.name,
      cells: cols.map((c) => valueToText(c, it.values[c.id], memberName)),
    })),
  };
}

export interface TimelineBar {
  id: string;
  name: string;
  span: DateSpan;
}

/** Items that have a timeline, earliest first. */
export function timelineBars(list: ListData, columnId: string | null, limit = 12): TimelineBar[] {
  const col =
    list.columns.find((c) => c.id === columnId && c.type === 'timeline') ??
    list.columns.find((c) => c.type === 'timeline');
  if (!col) return [];
  const out: TimelineBar[] = [];
  for (const it of liveTopLevel(list.items)) {
    const span = spanOf(col, it.values[col.id]);
    if (span) out.push({ id: it.id, name: it.name, span });
  }
  return out.sort((a, b) => a.span.start.localeCompare(b.span.start)).slice(0, limit);
}

/** Time logged per person in a period (the same rows the timesheet uses). */
export function timeTrackedByPerson(
  rows: readonly TimesheetRow[],
  range: { from?: string | null; to?: string | null; tz: string },
): Array<{ uid: string; ms: number }> {
  return groupRows(filterRows(rows, range), 'person').map((g) => ({
    uid: (g.rows[0] as TimesheetRow).uid,
    ms: g.ms,
  }));
}

export { rowsFromItems };
