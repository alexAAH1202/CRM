import { addDays, diffDays, fromDayNumber, toDayNumber, weekdayOf } from './dates';

export const DEFAULT_TIMEZONE = 'Australia/Melbourne';

// ---------------------------------------------------------------------------------- time zones

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock fields in `tz` at a UTC instant. */
function wallClock(utcMs: number, tz: string) {
  const parts = formatter(tz).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return {
    y: get('year'),
    mo: get('month'),
    d: get('day'),
    h: get('hour'),
    mi: get('minute'),
    s: get('second'),
  };
}

/** How far `tz` is ahead of UTC at that instant, in ms (positive east of Greenwich). */
function offsetMs(utcMs: number, tz: string): number {
  const w = wallClock(utcMs, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(utcMs / 1000) * 1000;
}

export function isValidTime(hhmm: unknown): hhmm is string {
  return typeof hhmm === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm);
}

/**
 * The UTC instant at which the clock in `tz` reads `dateIso hh:mm`. In the hour that doesn't exist
 * when clocks go forward the result lands just after the gap; in the repeated hour when they go
 * back, the first occurrence is used.
 */
export function zonedToUtcMs(dateIso: string, hhmm: string, tz: string): number | null {
  const day = toDayNumber(dateIso);
  if (day === null || !isValidTime(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const guess = day * 86_400_000 + (h * 60 + m) * 60_000;
  let utc = guess - offsetMs(guess, tz);
  const again = offsetMs(utc, tz);
  if (again !== offsetMs(guess, tz)) utc = guess - again;
  return utc;
}

/** Today's date (YYYY-MM-DD) on the clock in `tz`. */
export function localDateIn(utcMs: number, tz: string): string {
  const w = wallClock(utcMs, tz);
  return `${String(w.y).padStart(4, '0')}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------- recurrence

export type Recurrence =
  | { kind: 'daily'; every: number }
  | { kind: 'weekly'; every: number; weekdays: number[] }
  | { kind: 'monthly'; every: number; dayOfMonth: number };

export interface Schedule {
  recurrence: Recurrence;
  atTime: string;
  /** The first day it can fire; it also anchors "every N weeks/months". */
  startDate: string;
}

export const MAX_EVERY = 52;

export function parseRecurrence(raw: unknown): Recurrence | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const every =
    typeof r['every'] === 'number' &&
    Number.isInteger(r['every']) &&
    r['every'] >= 1 &&
    r['every'] <= MAX_EVERY
      ? r['every']
      : 1;
  if (r['kind'] === 'daily') return { kind: 'daily', every };
  if (r['kind'] === 'weekly') {
    const days = (Array.isArray(r['weekdays']) ? r['weekdays'] : []).filter(
      (d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6,
    );
    const weekdays = [...new Set(days)].sort((a, b) => a - b);
    return weekdays.length ? { kind: 'weekly', every, weekdays } : null;
  }
  if (r['kind'] === 'monthly') {
    const d = r['dayOfMonth'];
    return typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 31
      ? { kind: 'monthly', every, dayOfMonth: d }
      : null;
  }
  return null;
}

const daysInMonth = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate();

function matches(rec: Recurrence, dateIso: string, startIso: string): boolean {
  const diff = diffDays(dateIso, startIso);
  if (diff === null || diff < 0) return false;
  if (rec.kind === 'daily') return diff % rec.every === 0;
  const dn = toDayNumber(dateIso) as number;
  const sn = toDayNumber(startIso) as number;
  if (rec.kind === 'weekly') {
    if (!rec.weekdays.includes(weekdayOf(dn))) return false;
    const mondayOf = (n: number) => n - ((weekdayOf(n) + 6) % 7);
    return Math.floor((mondayOf(dn) - mondayOf(sn)) / 7) % rec.every === 0;
  }
  const y = Number(dateIso.slice(0, 4));
  const m = Number(dateIso.slice(5, 7));
  const ys = Number(startIso.slice(0, 4));
  const ms = Number(startIso.slice(5, 7));
  const months = (y - ys) * 12 + (m - ms);
  if (months < 0 || months % rec.every !== 0) return false;
  // The 31st in a 30-day month fires on the 30th (the last day), not never.
  return Number(dateIso.slice(8, 10)) === Math.min(rec.dayOfMonth, daysInMonth(y, m));
}

/** The next time the schedule fires strictly after `afterMs`, or null if it never will. */
export function nextOccurrence(s: Schedule, afterMs: number, tz: string): number | null {
  if (toDayNumber(s.startDate) === null || !isValidTime(s.atTime)) return null;
  const today = toDayNumber(localDateIn(afterMs, tz)) as number;
  // start a day early so a timezone edge can't skip a fire
  for (let n = Math.max(today - 1, toDayNumber(s.startDate) as number); n < today + 800; n++) {
    const date = fromDayNumber(n);
    if (!matches(s.recurrence, date, s.startDate)) continue;
    const at = zonedToUtcMs(date, s.atTime, tz);
    if (at !== null && at > afterMs) return at;
  }
  return null;
}

// -------------------------------------------------------------------------- date-relative events

/** When "N days before/after <date> at HH:MM" fires, in the workspace's time zone. */
export function fireAtForDate(
  dateIso: string,
  offsetDays: number,
  atTime: string,
  tz: string,
): number | null {
  const d = addDays(dateIso, offsetDays);
  return d === null ? null : zonedToUtcMs(d, atTime, tz);
}

/** Events whose moment has already gone by more than this are not registered (no surprise reminders for the past). */
export const PAST_GRACE_MS = 6 * 3600 * 1000;

export const MAX_OFFSET_DAYS = 365;

export function describeTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${ap}`;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function describeRecurrence(r: Recurrence): string {
  const n = r.every;
  if (r.kind === 'daily') return n === 1 ? 'every day' : `every ${n} days`;
  if (r.kind === 'weekly')
    return `${n === 1 ? 'every week' : `every ${n} weeks`} on ${r.weekdays.map((d) => WD[d]).join(', ')}`;
  const ord = (d: number) =>
    `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`;
  return `${n === 1 ? 'every month' : `every ${n} months`} on the ${ord(r.dayOfMonth)}`;
}
