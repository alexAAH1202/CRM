import { addDays, diffDays, fromDayNumber, toDayNumber, weekdayOf } from './dates';
import type { Column, Label, TimelineValue } from './columns';
import type { ItemLike } from './itemLike';
import type { LabelColor } from './palette';

// ------------------------------------------------------------------ view types

export type ViewType = 'table' | 'kanban' | 'calendar' | 'gantt' | 'workload' | 'chart';

export const VIEW_TYPE_META: Record<ViewType, { label: string; defaultName: string }> = {
  table: { label: 'Table', defaultName: 'Table' },
  kanban: { label: 'Kanban', defaultName: 'Kanban' },
  calendar: { label: 'Calendar', defaultName: 'Calendar' },
  gantt: { label: 'Gantt', defaultName: 'Timeline' },
  workload: { label: 'Workload', defaultName: 'Workload' },
  chart: { label: 'Chart', defaultName: 'Chart' },
};

export const AVAILABLE_VIEW_TYPES: readonly ViewType[] = [
  'table',
  'kanban',
  'calendar',
  'gantt',
  'workload',
  'chart',
];
export const MAX_VIEWS = 12;

export function parseViewType(v: unknown): ViewType {
  return typeof v === 'string' && v in VIEW_TYPE_META ? (v as ViewType) : 'table';
}

// ---------------------------------------------------------------------- Kanban

export interface KanbanLane {
  /** The label / option id / uid, or null for the "none" lane. */
  key: string | null;
  name: string;
  color: LabelColor;
}

export function kanbanDefaultColumn(columns: readonly Column[]): Column | undefined {
  return (
    columns.find((c) => c.type === 'status') ??
    columns.find((c) => c.type === 'dropdown') ??
    columns.find((c) => c.type === 'people')
  );
}

/** Lanes in column order, plus a final lane for items with no value. */
export function kanbanLanes(
  column: Column,
  members: ReadonlyArray<{ uid: string; name: string }>,
  colorOf: (name: string) => LabelColor,
): KanbanLane[] {
  const fromLabels = (labels: Label[]): KanbanLane[] =>
    labels.map((l) => ({ key: l.id, name: l.name, color: l.color }));
  let lanes: KanbanLane[];
  if (column.type === 'status') lanes = fromLabels(column.settings.labels ?? []);
  else if (column.type === 'dropdown') lanes = fromLabels(column.settings.options ?? []);
  else lanes = members.map((m) => ({ key: m.uid, name: m.name, color: colorOf(m.name) }));
  const none =
    column.type === 'status' ? 'No status' : column.type === 'people' ? 'Unassigned' : 'No value';
  return [...lanes, { key: null, name: none, color: 'gray' }];
}

/** Every lane key an item's value puts it in (a multi-value item appears in each). */
export function laneKeysOf(column: Column, raw: unknown): Array<string | null> {
  if (column.type === 'status') return typeof raw === 'string' ? [raw] : [null];
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.filter((x): x is string => typeof x === 'string');
  }
  return [null];
}

/** Storage key for a lane in a view's hand-picked card order (the "no value" lane has no key). */
export const NO_LANE_KEY = '__none';
export const laneStorageKey = (laneKey: string | null): string => laneKey ?? NO_LANE_KEY;

/**
 * Puts cards in their hand-picked order: those listed first (in the list's order), the rest after
 * in their existing order. Cards the list doesn't know about (new ones) never jump to the top.
 */
export function applyLaneOrder<T extends { id: string }>(
  cards: readonly T[],
  manual: readonly string[] | undefined,
): T[] {
  if (!manual || manual.length === 0) return [...cards];
  const rank = new Map(manual.map((id, i) => [id, i]));
  const listed = cards
    .filter((c) => rank.has(c.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...listed, ...cards.filter((c) => !rank.has(c.id))];
}

/**
 * The lane's new order after dropping `movingId` before `beforeId` (null = at the end).
 * `current` is the lane as shown now. Dropping on itself changes nothing.
 */
export function placeInLane(
  current: readonly string[],
  movingId: string,
  beforeId: string | null,
): string[] {
  if (beforeId === movingId) return [...current];
  const rest = current.filter((id) => id !== movingId);
  const at = beforeId === null ? -1 : rest.indexOf(beforeId);
  if (at < 0) return [...rest, movingId];
  return [...rest.slice(0, at), movingId, ...rest.slice(at)];
}

/**
 * Where a dropped card should go: onto another card means "next to it" (below it if the card was
 * above it in the same lane, otherwise above it); onto the lane's empty space means the end.
 * Returns the id to insert before (null = end).
 */
export function dropTarget(
  laneIds: readonly string[],
  movingId: string,
  overCardId: string | null,
  sameLane: boolean,
): string | null {
  if (overCardId === null) return null;
  const from = laneIds.indexOf(movingId);
  const to = laneIds.indexOf(overCardId);
  if (sameLane && from >= 0 && to >= 0 && from < to) return laneIds[to + 1] ?? null;
  return overCardId;
}

/** The new `cardOrder` map after one lane's order changes (bounded, no empty lanes). */
export function withLaneOrder(
  cardOrder: Readonly<Record<string, string[]>>,
  laneKey: string | null,
  ids: readonly string[],
): Record<string, string[]> {
  const key = laneStorageKey(laneKey);
  const next: Record<string, string[]> = { ...cardOrder };
  const bounded = ids.slice(0, 300);
  if (bounded.length === 0) delete next[key];
  else next[key] = bounded;
  const keys = Object.keys(next);
  // Keep the lane we just set; forget the oldest others if there are too many.
  for (const k of keys.filter((k) => k !== key).slice(0, Math.max(0, keys.length - 40)))
    delete next[k];
  return next;
}

/**
 * The new cell value after a card moves from one lane to another. For multi-value columns
 * only the lane it came from is swapped, so other values on the card are kept.
 */
export function moveBetweenLanes(
  column: Column,
  current: unknown,
  from: string | null,
  to: string | null,
): unknown {
  if (column.type === 'status') return to;
  const list = Array.isArray(current)
    ? current.filter((x): x is string => typeof x === 'string')
    : [];
  const next = list.filter((x) => x !== from);
  if (to !== null && !next.includes(to)) next.push(to);
  return next.length > 0 ? next : null;
}

// -------------------------------------------------------------------- Calendar

export interface DateSpan {
  start: string;
  end: string;
}

/** Where an item sits on a calendar: a date is a one-day span, a timeline is its range. */
export function spanOf(column: Column, raw: unknown): DateSpan | null {
  if (column.type === 'date') {
    return typeof raw === 'string' && toDayNumber(raw) !== null ? { start: raw, end: raw } : null;
  }
  if (column.type === 'timeline') {
    const t = raw as Partial<TimelineValue> | null;
    if (t && typeof t.start === 'string' && typeof t.end === 'string') {
      const a = toDayNumber(t.start);
      const b = toDayNumber(t.end);
      if (a !== null && b !== null) return a <= b ? { start: t.start, end: t.end } : null;
    }
  }
  return null;
}

/** The value after moving the item so it starts on `newStart` (a timeline keeps its length). */
export function rescheduled(column: Column, raw: unknown, newStart: string): unknown {
  const span = spanOf(column, raw);
  if (!span) return raw;
  if (column.type === 'date') return newStart;
  const len = diffDays(span.end, span.start) ?? 0;
  return { start: newStart, end: addDays(newStart, len) };
}

/** Monday-first weeks covering the month containing `anchor` (always whole weeks). */
export function monthWeeks(anchor: string): string[][] {
  const first = `${anchor.slice(0, 7)}-01`;
  const n = toDayNumber(first) as number;
  const lead = (weekdayOf(n) + 6) % 7; // Monday = 0
  const dim = new Date(
    Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), 0),
  ).getUTCDate();
  const end = n + dim - 1;
  const startDay = n - lead;
  const weeks = Math.ceil((end - startDay + 1) / 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => fromDayNumber(startDay + w * 7 + d)),
  );
}

export function weekOf(anchor: string): string[] {
  const n = toDayNumber(anchor) as number;
  const start = n - ((weekdayOf(n) + 6) % 7);
  return Array.from({ length: 7 }, (_, d) => fromDayNumber(start + d));
}

/** Previous/next anchor for the calendar's arrows. */
export function stepAnchor(anchor: string, mode: 'month' | 'week', dir: 1 | -1): string {
  if (mode === 'week') return addDays(anchor, 7 * dir) as string;
  const y = Number(anchor.slice(0, 4));
  const m = Number(anchor.slice(5, 7)) - 1 + dir;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

export interface CalendarEntry<T extends ItemLike> {
  item: T;
  span: DateSpan;
}

/** Items that have a date in the chosen column, soonest first. */
export function calendarEntries<T extends ItemLike>(
  items: readonly T[],
  column: Column,
): Array<CalendarEntry<T>> {
  const out: Array<CalendarEntry<T>> = [];
  for (const item of items) {
    const span = spanOf(column, item.values[column.id]);
    if (span) out.push({ item, span });
  }
  return out.sort(
    (a, b) => a.span.start.localeCompare(b.span.start) || a.item.order.localeCompare(b.item.order),
  );
}

/** Items with no date, so the calendar can offer them for scheduling. */
export function unscheduled<T extends ItemLike>(items: readonly T[], column: Column): T[] {
  return items.filter((i) => spanOf(column, i.values[column.id]) === null);
}

export function entriesOnDay<T extends ItemLike>(
  entries: ReadonlyArray<CalendarEntry<T>>,
  day: string,
): Array<CalendarEntry<T>> {
  return entries.filter((e) => e.span.start <= day && day <= e.span.end);
}
