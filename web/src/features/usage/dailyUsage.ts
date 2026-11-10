import { meter } from '../../lib/firestore/meter';

/**
 * This device's database use per day, kept in localStorage. Firebase's free limits reset at
 * midnight Pacific time, so "today" here is the Pacific date. Only what this device does is
 * counted: other people's devices and the Apps Script helper are not visible from here.
 */
export interface DayUsage {
  reads: number;
  writes: number;
  deletes: number;
}
export const FREE_LIMITS: DayUsage = { reads: 50_000, writes: 20_000, deletes: 20_000 };
const KEY = 'usage:days';
const KEEP_DAYS = 7;

export const pacificDay = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(ms);

export type UsageLog = Record<string, DayUsage>;

/** Adds a change in the session counters to the log (a counter going down means it was reset). */
export function accumulate(log: UsageLog, day: string, prev: DayUsage, next: DayUsage): UsageLog {
  const d = (k: keyof DayUsage) => (next[k] >= prev[k] ? next[k] - prev[k] : next[k]);
  const cur = log[day] ?? { reads: 0, writes: 0, deletes: 0 };
  const out: UsageLog = {
    ...log,
    [day]: {
      reads: cur.reads + d('reads'),
      writes: cur.writes + d('writes'),
      deletes: cur.deletes + d('deletes'),
    },
  };
  const days = Object.keys(out).sort().slice(-KEEP_DAYS);
  return Object.fromEntries(days.map((k) => [k, out[k] as DayUsage]));
}

export function readLog(): UsageLog {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as UsageLog;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

let started = false;
/** Starts counting (once per page). */
export function startUsageLog() {
  if (started) return;
  started = true;
  let prev: DayUsage = { reads: 0, writes: 0, deletes: 0 };
  let pending: number | null = null;
  meter.subscribe(() => {
    if (pending !== null) return;
    // batch bursts of updates into one storage write
    pending = window.setTimeout(() => {
      pending = null;
      const s = meter.getSnapshot();
      const next = { reads: s.reads, writes: s.writes, deletes: s.deletes };
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify(accumulate(readLog(), pacificDay(Date.now()), prev, next)),
        );
      } catch {
        /* storage blocked: nothing to keep */
      }
      prev = next;
    }, 1000);
  });
}
