import { toDayNumber } from './dates';
import type { Column } from './columns';
import { spanOf } from './views';

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';
export const BUCKET_ORDER: readonly DueBucket[] = ['overdue', 'today', 'week', 'later', 'none'];
export const BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  later: 'Later',
  none: 'No date',
};

/**
 * The date an item is "due": a Date column whose title mentions "due" (else the first Date
 * column), otherwise the end of the first Timeline column. null if the board has neither.
 */
export function dueDateOf(
  columns: readonly Column[],
  values: Record<string, unknown>,
): string | null {
  const dates = columns.filter((c) => c.type === 'date');
  const col = dates.find((c) => /\bdue\b|deadline/i.test(c.title)) ?? dates[0];
  if (col) {
    const s = spanOf(col, values[col.id]);
    if (s) return s.start;
  }
  const tl = columns.find((c) => c.type === 'timeline');
  if (tl) return spanOf(tl, values[tl.id])?.end ?? null;
  return null;
}

const DONE = /^(done|complete|completed|finished|paid|closed|resolved)$/i;

/** Is the item finished? A Status column whose current label reads like "Done". */
export function isDone(columns: readonly Column[], values: Record<string, unknown>): boolean {
  for (const c of columns) {
    if (c.type !== 'status') continue;
    const id = values[c.id];
    const label = (c.settings.labels ?? []).find((l) => l.id === id);
    if (label && DONE.test(label.name.trim())) return true;
  }
  return false;
}

/** Week = the next 7 days after today (Mon–Sun weeks would flip on Sunday night). */
export function bucketOf(due: string | null, today: string): DueBucket {
  if (!due) return 'none';
  const d = toDayNumber(due);
  const t = toDayNumber(today);
  if (d === null || t === null) return 'none';
  if (d < t) return 'overdue';
  if (d === t) return 'today';
  return d - t <= 7 ? 'week' : 'later';
}

export interface MyWorkEntry {
  key: string;
  bid: string;
  boardName: string;
  iid: string;
  name: string;
  due: string | null;
  done: boolean;
}

export function groupMyWork(
  entries: readonly MyWorkEntry[],
  today: string,
  showDone: boolean,
): Array<{ bucket: DueBucket; label: string; entries: MyWorkEntry[] }> {
  const by = new Map<DueBucket, MyWorkEntry[]>();
  for (const e of entries) {
    if (e.done && !showDone) continue;
    const k = bucketOf(e.due, today);
    by.set(k, [...(by.get(k) ?? []), e]);
  }
  return BUCKET_ORDER.filter((b) => by.has(b)).map((b) => ({
    bucket: b,
    label: BUCKET_LABELS[b],
    entries: (by.get(b) as MyWorkEntry[]).sort(
      (x, y) => (x.due ?? '9999').localeCompare(y.due ?? '9999') || x.name.localeCompare(y.name),
    ),
  }));
}
