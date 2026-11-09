/**
 * Calendar-date helpers. Dates are plain "YYYY-MM-DD" strings everywhere (decision D28);
 * arithmetic uses whole days since 1970-01-01 in UTC, so there are no timezone or DST surprises.
 */
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Whole days since 1970-01-01, or null if `iso` isn't a valid date. */
export function toDayNumber(iso: string): number | null {
  if (!isIsoDate(iso)) return null;
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY);
}

export function fromDayNumber(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string | null {
  const d = toDayNumber(iso);
  return d === null ? null : fromDayNumber(d + Math.trunc(n));
}

/** a − b in days (negative when a is earlier). */
export function diffDays(a: string, b: string): number | null {
  const x = toDayNumber(a);
  const y = toDayNumber(b);
  return x === null || y === null ? null : x - y;
}

/** 0 = Sunday … 6 = Saturday. (1970-01-01 was a Thursday.) */
export function weekdayOf(dayNumber: number): number {
  return (((dayNumber + 4) % 7) + 7) % 7;
}

/**
 * Number of working days (Mon–Fri) from a to b, both inclusive. Negative when b is
 * before a (counted the same way, backwards). Public holidays aren't modelled.
 */
export function workdaysBetween(a: string, b: string): number | null {
  let x = toDayNumber(a);
  let y = toDayNumber(b);
  if (x === null || y === null) return null;
  let sign = 1;
  if (y < x) {
    [x, y] = [y, x];
    sign = -1;
  }
  const total = y - x + 1;
  const fullWeeks = Math.floor(total / 7);
  let count = fullWeeks * 5;
  for (let d = x + fullWeeks * 7; d <= y; d++) {
    const w = weekdayOf(d);
    if (w !== 0 && w !== 6) count++;
  }
  return sign * count;
}

export function dateParts(iso: string): { year: number; month: number; day: number } | null {
  if (!isIsoDate(iso)) return null;
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  };
}

/** Today's date in the viewer's own timezone, as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
