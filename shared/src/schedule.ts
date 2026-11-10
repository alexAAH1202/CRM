import type { DependencyValue } from './columns';
import { addDays, diffDays, earliestStartOf } from './scheduleDates';
import type { DateSpan } from './views';

export type Zoom = 'day' | 'week' | 'month';
/** Pixels per day at each zoom. */
export const ZOOM_PX: Record<Zoom, number> = { day: 36, week: 14, month: 5 };

/** Wide enough to fill a screen at any zoom, so there's always room to drag bars later. */
export const MIN_DAYS = 120;
const MAX_SPAN_DAYS = 5 * 366;

export interface GanttRange {
  start: string;
  days: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The visible date range: every bar and today, padded, and at least 120 days wide. */
export function ganttRange(spans: readonly DateSpan[], today: string): GanttRange {
  let min = today;
  let max = today;
  for (const s of spans) {
    if (s.start < min) min = s.start;
    if (s.end > max) max = s.end;
  }
  // A mistyped year (2205 for 2025) mustn't make a chart tens of thousands of days wide:
  // keep to five years either side of today (bars beyond are simply off the chart).
  const floor = addDays(today, -MAX_SPAN_DAYS) as string;
  const ceil = addDays(today, MAX_SPAN_DAYS) as string;
  if (min < floor) min = floor;
  if (max > ceil) max = ceil;
  const start = addDays(min, -3) as string;
  const end = addDays(max, 14) as string;
  const days = Math.max(MIN_DAYS, (diffDays(end, start) ?? 0) + 1);
  return { start, days };
}

/** Where a bar sits, in pixels from the left edge of the chart. */
export function barRect(span: DateSpan, rangeStart: string, px: number): { x: number; w: number } {
  const x = (diffDays(span.start, rangeStart) ?? 0) * px;
  const w = ((diffDays(span.end, span.start) ?? 0) + 1) * px;
  return { x, w };
}

/** The date under a pixel offset. */
export function dayAt(rangeStart: string, px: number, x: number): string {
  return addDays(rangeStart, Math.floor(x / px)) as string;
}

export type DragMode = 'move' | 'start' | 'end';

/** The span after dragging by `delta` whole days. Resizing can shrink to one day, never invert. */
export function dragSpan(span: DateSpan, mode: DragMode, delta: number): DateSpan {
  const d = Math.trunc(delta);
  if (mode === 'move')
    return { start: addDays(span.start, d) as string, end: addDays(span.end, d) as string };
  if (mode === 'start') {
    const s = addDays(span.start, d) as string;
    return { start: s > span.end ? span.end : s, end: span.end };
  }
  const e = addDays(span.end, d) as string;
  return { start: span.start, end: e < span.start ? span.start : e };
}

export interface Tick {
  x: number;
  label: string;
  major: boolean;
}

/** Header ticks: days (with weekday starts marked), week starts, or month starts. */
export function ganttTicks(range: GanttRange, zoom: Zoom): Tick[] {
  const px = ZOOM_PX[zoom];
  const out: Tick[] = [];
  for (let i = 0; i < range.days; i++) {
    const iso = addDays(range.start, i) as string;
    const dom = Number(iso.slice(8, 10));
    const month = MONTHS[Number(iso.slice(5, 7)) - 1] as string;
    const mon = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7 === 0;
    if (zoom === 'day')
      out.push({
        x: i * px,
        label: dom === 1 || i === 0 ? `${dom} ${month}` : String(dom),
        major: mon,
      });
    else if (zoom === 'week') {
      if (mon) out.push({ x: i * px, label: `${dom} ${month}`, major: dom <= 7 });
    } else if (dom === 1 || i === 0) {
      out.push({ x: i * px, label: `${month} ${iso.slice(0, 4)}`, major: true });
    }
  }
  return out;
}

export interface Edge {
  from: string;
  to: string;
  lag: number;
  /** The dependent starts before its predecessor allows. */
  violated: boolean;
}

/** Finish-to-start arrows between items that both have dates. */
export function dependencyEdges(
  depsOf: (id: string) => readonly DependencyValue[],
  spans: ReadonlyMap<string, DateSpan>,
): Edge[] {
  const out: Edge[] = [];
  for (const [to, span] of spans) {
    for (const d of depsOf(to)) {
      const pred = spans.get(d.id);
      if (!pred) continue;
      const required = addDays(pred.end, d.lag + 1) as string;
      out.push({ from: d.id, to, lag: d.lag, violated: span.start < required });
    }
  }
  return out;
}

/**
 * After `changedId` moved, which dependents must move (keeping their length) so every
 * finish-to-start constraint holds again? Cascades through dependents of dependents.
 * Only pushes later, never pulls earlier. The changed item itself is not in the result.
 */
export function shiftPlan(
  changedId: string,
  spans: ReadonlyMap<string, DateSpan>,
  depsOf: (id: string) => readonly DependencyValue[],
): Map<string, DateSpan> {
  const successors = new Map<string, string[]>();
  for (const id of spans.keys())
    for (const d of depsOf(id)) {
      const list = successors.get(d.id) ?? [];
      list.push(id);
      successors.set(d.id, list);
    }
  const now = new Map(spans);
  const moved = new Map<string, DateSpan>();
  const queue = [changedId];
  let guard = spans.size * spans.size + 10; // a loop in bad data must not hang the page
  while (queue.length > 0 && guard-- > 0) {
    const cur = queue.shift() as string;
    for (const sid of successors.get(cur) ?? []) {
      const span = now.get(sid);
      if (!span || sid === changedId) continue;
      const need = earliestStartOf(depsOf(sid), (id) => now.get(id)?.end ?? null);
      if (need && span.start < need) {
        const by = diffDays(need, span.start) as number;
        const next = { start: need, end: addDays(span.end, by) as string };
        now.set(sid, next);
        moved.set(sid, next);
        queue.push(sid);
      }
    }
  }
  return moved;
}
