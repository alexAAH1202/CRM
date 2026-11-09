import { SERVER_TIME, type WriteOp } from './ops';
import { paths } from './paths';

/**
 * Time tracking: a "Time tracking" column holds the work sessions people logged on an item.
 * Sessions are small objects stored inline on the item (no extra reads); once an item has more
 * than MAX_TIME_SESSIONS the oldest are rolled up into one entry per person per month, so totals
 * stay exact and the document stays small.
 */

export interface TimeSession {
  id: string;
  uid: string;
  /** Epoch milliseconds. */
  start: number;
  end: number;
  note?: string;
  /** Set on entries that stand for many older sessions (one per person per month). */
  rolled?: true;
}

export interface TimeValue {
  sessions: TimeSession[];
}

export const MAX_TIME_SESSIONS = 200;
/** How many of the oldest sessions are folded away when the cap is passed. */
export const ROLLUP_BATCH = 100;
/** No single session may be longer than this (a forgotten timer is capped, and can be edited). */
export const MAX_SESSION_MS = 24 * 3_600_000;
const MIN_START = Date.UTC(2000, 0, 1);
const MAX_NOTE = 200;
const HOUR = 3_600_000;

const isSession = (s: unknown): s is TimeSession => {
  const t = s as Partial<TimeSession> | null;
  return (
    !!t &&
    typeof t.id === 'string' &&
    t.id.length > 0 &&
    t.id.length <= 64 &&
    typeof t.uid === 'string' &&
    t.uid.length > 0 &&
    t.uid.length <= 128 &&
    typeof t.start === 'number' &&
    typeof t.end === 'number' &&
    Number.isFinite(t.start) &&
    Number.isFinite(t.end) &&
    t.start >= MIN_START &&
    t.end > t.start
  );
};

/** Coerces stored data into a TimeValue (null when there are no valid sessions). Never throws. */
export function normalizeTimeValue(v: unknown): TimeValue | null {
  const raw = (v as { sessions?: unknown } | null)?.sessions;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: TimeSession[] = [];
  for (const s of raw) {
    if (!isSession(s) || seen.has(s.id)) continue;
    // A rolled-up entry may span a month of work; a normal session is at most a day.
    if (!s.rolled && s.end - s.start > MAX_SESSION_MS) continue;
    seen.add(s.id);
    const clean: TimeSession = {
      id: s.id,
      uid: s.uid,
      start: Math.trunc(s.start),
      end: Math.trunc(s.end),
    };
    if (typeof s.note === 'string' && s.note.trim()) clean.note = s.note.trim().slice(0, MAX_NOTE);
    if (s.rolled === true) clean.rolled = true;
    out.push(clean);
    if (out.length >= MAX_TIME_SESSIONS + ROLLUP_BATCH) break;
  }
  return out.length ? { sessions: out.sort((a, b) => a.start - b.start) } : null;
}

export const durationOf = (s: TimeSession) => s.end - s.start;

export function totalMs(v: TimeValue | null | undefined): number {
  return (v?.sessions ?? []).reduce((n, s) => n + durationOf(s), 0);
}

/** Milliseconds per person. */
export function totalsByUid(v: TimeValue | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of v?.sessions ?? []) m.set(s.uid, (m.get(s.uid) ?? 0) + durationOf(s));
  return m;
}

/** "1h 20m", "45m", "30s", "0m" (rounded to the minute from a minute up). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return total === 0 ? '0m' : `${total}s`;
  const minutes = Math.round(total / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Hours as a decimal for spreadsheets and charts (2 places). */
export const toHours = (ms: number) => Math.round((ms / HOUR) * 100) / 100;

/** Why a session can't be recorded (null = fine). `nowMs` is a little leniency for clock drift. */
export function sessionProblem(s: { start: number; end: number }, nowMs: number): string | null {
  if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) return 'That time isn’t valid.';
  if (s.end <= s.start) return 'The end has to be after the start.';
  if (s.end - s.start > MAX_SESSION_MS) return 'A single session can be up to 24 hours.';
  if (s.start < MIN_START) return 'That date is too far back.';
  if (s.end > nowMs + 5 * 60_000) return 'That session ends in the future.';
  return null;
}

const monthKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthStart = (key: string) => {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return Date.UTC(y, m - 1, 1);
};

/**
 * Keeps an item's sessions within the cap: when there are more than MAX_TIME_SESSIONS, the oldest
 * ROLLUP_BATCH are replaced by one entry per person per month (start = that month's first moment,
 * length = their total in it). Totals per person and per month are preserved exactly.
 */
export function enforceCap(sessions: readonly TimeSession[]): TimeSession[] {
  const sorted = [...sessions].sort((a, b) => a.start - b.start);
  if (sorted.length <= MAX_TIME_SESSIONS) return sorted;
  const old = sorted.slice(0, ROLLUP_BATCH);
  const keep = sorted.slice(ROLLUP_BATCH);
  const buckets = new Map<string, { uid: string; month: string; ms: number }>();
  for (const s of old) {
    const key = `${s.uid}|${monthKey(s.start)}`;
    const b = buckets.get(key) ?? { uid: s.uid, month: monthKey(s.start), ms: 0 };
    b.ms += durationOf(s);
    buckets.set(key, b);
  }
  const rolled: TimeSession[] = [...buckets.values()].map((b) => ({
    id: `r-${b.uid}-${b.month}`.slice(0, 64),
    uid: b.uid,
    start: monthStart(b.month),
    end: monthStart(b.month) + b.ms,
    rolled: true,
  }));
  // Merge with rolled entries that already exist for the same person and month.
  const merged = new Map<string, TimeSession>();
  for (const s of [...rolled, ...keep.filter((k) => k.rolled)]) {
    const prev = merged.get(s.id);
    merged.set(s.id, prev ? { ...prev, end: prev.end + durationOf(s) } : { ...s });
  }
  const plain = keep.filter((k) => !k.rolled);
  return [...merged.values(), ...plain].sort((a, b) => a.start - b.start);
}

export function addSession(v: TimeValue | null, s: TimeSession): TimeValue {
  return { sessions: enforceCap([...(v?.sessions ?? []), s]) };
}

export function removeSession(v: TimeValue | null, id: string): TimeValue | null {
  const next = (v?.sessions ?? []).filter((s) => s.id !== id);
  return next.length ? { sessions: next } : null;
}

export function replaceSession(v: TimeValue | null, s: TimeSession): TimeValue | null {
  const cur = v?.sessions ?? [];
  if (!cur.some((x) => x.id === s.id)) return v;
  return { sessions: enforceCap(cur.map((x) => (x.id === s.id ? s : x))) };
}

// ------------------------------------------------------------------ the running timer

export interface RunningTimer {
  boardId: string;
  itemId: string;
  columnId: string;
  startedAtMs: number;
}

/** One running timer per person per household: the document is named after the person. */
export function planStartTimer(input: {
  wid: string;
  uid: string;
  bid: string;
  iid: string;
  columnId: string;
}): WriteOp[] {
  return [
    {
      kind: 'set',
      path: `${paths.workspace(input.wid)}/timers/${input.uid}`,
      data: {
        boardId: input.bid,
        itemId: input.iid,
        columnId: input.columnId,
        startedAt: SERVER_TIME,
      },
    },
  ];
}

/**
 * Stops the timer: adds the session to the item's cell and deletes the timer, in one batch (so a
 * session is never lost or counted twice). A timer left running for more than a day is recorded
 * as exactly 24 hours (and can be edited).
 */
export function planStopTimer(input: {
  wid: string;
  uid: string;
  timer: RunningTimer;
  nowMs: number;
  /** The cell's current value (null if empty). */
  current: unknown;
  newId: () => string;
  note?: string;
}): { ops: WriteOp[]; session: TimeSession | null } {
  const { wid, uid, timer, nowMs } = input;
  const end = Math.min(nowMs, timer.startedAtMs + MAX_SESSION_MS);
  const ops: WriteOp[] = [{ kind: 'delete', path: `${paths.workspace(wid)}/timers/${uid}` }];
  // Under a second isn't worth recording (an accidental start/stop).
  if (end - timer.startedAtMs < 1000) return { ops, session: null };
  const session: TimeSession = {
    id: input.newId(),
    uid,
    start: timer.startedAtMs,
    end,
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, MAX_NOTE) } : {}),
  };
  const value = addSession(normalizeTimeValue(input.current), session);
  ops.unshift({
    kind: 'update',
    path: `${paths.board(wid, timer.boardId)}/items/${timer.itemId}`,
    data: { [`values.${timer.columnId}`]: value, updatedBy: uid, updatedAt: SERVER_TIME },
  });
  return { ops, session };
}

// ------------------------------------------------------------------ timesheet

export interface TimesheetRow {
  uid: string;
  boardId: string;
  itemId: string;
  itemName: string;
  columnId: string;
  session: TimeSession;
}

export interface TimesheetFilter {
  uids?: ReadonlySet<string> | null;
  boardIds?: ReadonlySet<string> | null;
  /** YYYY-MM-DD, inclusive, in the given time zone. */
  from?: string | null;
  to?: string | null;
  tz: string;
}

/** The calendar day a moment falls on in a time zone. */
export function dayIn(ms: number, tz: string): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);
  return p;
}

export function filterRows(rows: readonly TimesheetRow[], f: TimesheetFilter): TimesheetRow[] {
  return rows.filter((r) => {
    if (f.uids && f.uids.size > 0 && !f.uids.has(r.uid)) return false;
    if (f.boardIds && f.boardIds.size > 0 && !f.boardIds.has(r.boardId)) return false;
    const day = dayIn(r.session.start, f.tz);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    return true;
  });
}

export interface TimesheetGroup {
  key: string;
  ms: number;
  rows: TimesheetRow[];
}

/** Groups rows by person or by item, biggest first, each with its total. */
export function groupRows(rows: readonly TimesheetRow[], by: 'person' | 'item'): TimesheetGroup[] {
  const m = new Map<string, TimesheetGroup>();
  for (const r of rows) {
    const key = by === 'person' ? r.uid : `${r.boardId}/${r.itemId}`;
    const g = m.get(key) ?? { key, ms: 0, rows: [] };
    g.ms += durationOf(r.session);
    g.rows.push(r);
    m.set(key, g);
  }
  for (const g of m.values()) g.rows.sort((a, b) => b.session.start - a.session.start);
  return [...m.values()].sort((a, b) => b.ms - a.ms || a.key.localeCompare(b.key));
}

/** Every session on the given items, flattened (the timesheet's raw material). */
export function rowsFromItems(
  items: ReadonlyArray<{
    id: string;
    name: string;
    values: Record<string, unknown>;
    deleted?: boolean;
    parentId?: string | null;
  }>,
  boardId: string,
  timeColumnIds: readonly string[],
): TimesheetRow[] {
  const out: TimesheetRow[] = [];
  for (const it of items) {
    if (it.deleted) continue;
    for (const columnId of timeColumnIds) {
      const v = normalizeTimeValue(it.values[columnId]);
      for (const session of v?.sessions ?? [])
        out.push({
          uid: session.uid,
          boardId,
          itemId: it.id,
          itemName: it.name,
          columnId,
          session,
        });
    }
  }
  return out;
}
