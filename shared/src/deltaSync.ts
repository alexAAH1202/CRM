/**
 * Delta-sync decisions (decision D5). Pure functions so they're unit-testable;
 * the web hook wires them to Firestore.
 */
export const SYNC_SAFETY_MS = 2 * 60 * 1000; // clock / commit skew margin
export const SYNC_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // tombstones are purged after 30 days

export type SyncPlan = { mode: 'full' } | { mode: 'delta'; sinceMs: number };

export function planSync(input: {
  lastSyncedMs: number | null;
  cachedCount: number;
  nowMs: number;
}): SyncPlan {
  const { lastSyncedMs, cachedCount, nowMs } = input;
  if (lastSyncedMs === null) return { mode: 'full' };
  if (cachedCount === 0) return { mode: 'full' }; // cache evicted or a new device
  if (nowMs - lastSyncedMs > SYNC_MAX_AGE_MS) return { mode: 'full' };
  return { mode: 'delta', sinceMs: Math.max(0, lastSyncedMs - SYNC_SAFETY_MS) };
}

/** Newest server-confirmed updatedAt seen (pending local writes don't count). */
export function advanceLastSynced(
  prev: number | null,
  docs: ReadonlyArray<{ updatedAtMs: number | null; pending: boolean }>,
): number | null {
  let max = prev;
  for (const d of docs) {
    if (d.pending || d.updatedAtMs === null) continue;
    if (max === null || d.updatedAtMs > max) max = d.updatedAtMs;
  }
  return max;
}
