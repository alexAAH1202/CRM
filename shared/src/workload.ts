import { toDayNumber, fromDayNumber, weekdayOf, addDays } from './dates';
import type { DateSpan } from './views';

export const HOURS_PER_WORKDAY = 8;

export interface WorkItem {
  id: string;
  name: string;
  span: DateSpan;
  /** Hours for the whole item; null = use the dates (8h per workday). */
  hours: number | null;
  /** Assignees; empty = unassigned. The hours are split equally between them. */
  people: readonly string[];
}

export interface WorkloadRow {
  key: string | null;
  hours: number[];
  total: number;
  capacity: number;
}

export interface WorkloadGrid {
  weekStarts: string[];
  rows: WorkloadRow[];
}

/** Monday on or before `iso`. */
export function mondayOf(iso: string): string {
  const n = toDayNumber(iso) as number;
  return fromDayNumber(n - ((weekdayOf(n) + 6) % 7));
}

/** The days an item's hours are spread over: its working days, or all days if it has none. */
function spreadDays(span: DateSpan): number[] {
  const a = toDayNumber(span.start) as number;
  const b = toDayNumber(span.end) as number;
  const all: number[] = [];
  for (let n = a; n <= b; n++) all.push(n);
  const work = all.filter((n) => {
    const w = weekdayOf(n);
    return w !== 0 && w !== 6;
  });
  return work.length ? work : all;
}

export function workloadGrid(input: {
  items: readonly WorkItem[];
  firstWeek: string;
  weeks: number;
  capacity: number;
  capacityByUid: Readonly<Record<string, number>>;
}): WorkloadGrid {
  const first = toDayNumber(mondayOf(input.firstWeek)) as number;
  const weekStarts = Array.from({ length: input.weeks }, (_, i) => fromDayNumber(first + i * 7));
  const rows = new Map<string | null, number[]>();
  const row = (k: string | null) => {
    if (!rows.has(k)) rows.set(k, new Array<number>(input.weeks).fill(0));
    return rows.get(k) as number[];
  };
  for (const it of input.items) {
    const days = spreadDays(it.span);
    const total = it.hours ?? days.length * HOURS_PER_WORKDAY;
    if (!(total > 0)) continue;
    const owners: Array<string | null> = it.people.length ? [...new Set(it.people)] : [null];
    const perDayPerOwner = total / days.length / owners.length;
    for (const n of days) {
      const w = Math.floor((n - first) / 7);
      if (w < 0 || w >= input.weeks) continue;
      for (const o of owners) row(o)[w] = (row(o)[w] as number) + perDayPerOwner;
    }
  }
  const out: WorkloadRow[] = [...rows.entries()].map(([key, hours]) => {
    const rounded = hours.map((h) => Math.round(h * 10) / 10);
    return {
      key,
      hours: rounded,
      total: Math.round(rounded.reduce((a, b) => a + b, 0) * 10) / 10,
      capacity: key === null ? Infinity : (input.capacityByUid[key] ?? input.capacity),
    };
  });
  // people first (busiest first), "unassigned" last
  out.sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : b.total - a.total));
  return { weekStarts, rows: out };
}

export function isOver(row: WorkloadRow, hours: number): boolean {
  return Number.isFinite(row.capacity) && hours > row.capacity + 1e-9;
}

export function nextWeek(iso: string, dir: 1 | -1, n = 1): string {
  return addDays(iso, 7 * dir * n) as string;
}
