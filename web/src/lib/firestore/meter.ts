/**
 * Dev usage meter: an *estimate* of billed Firestore operations in this session,
 * so quota regressions are visible during development (spec section 7.7).
 *
 * It counts what the client can observe. Security-rule get()/exists() lookups
 * and the full re-read Firestore bills when a listener resumes after more than
 * 30 minutes offline are invisible here; see docs/QUOTA_BUDGET.md.
 */

export interface MeterCounts {
  reads: number;
  writes: number;
  deletes: number;
  activeListeners: number;
}

export interface MeterSnapshot extends MeterCounts {
  byLabel: Record<string, MeterCounts>;
  startedAt: number;
}

type Listener = () => void;

function emptyCounts(): MeterCounts {
  return { reads: 0, writes: 0, deletes: 0, activeListeners: 0 };
}

export function createMeter() {
  let state: MeterSnapshot = { ...emptyCounts(), byLabel: {}, startedAt: Date.now() };
  const listeners = new Set<Listener>();

  function bump(label: string, delta: Partial<MeterCounts>) {
    const prev = state.byLabel[label] ?? emptyCounts();
    const next: MeterSnapshot = {
      ...state,
      byLabel: { ...state.byLabel, [label]: { ...prev } },
    };
    const target = next.byLabel[label] as MeterCounts;
    for (const key of Object.keys(delta) as Array<keyof MeterCounts>) {
      const d = delta[key] ?? 0;
      next[key] += d;
      target[key] += d;
    }
    state = next;
    listeners.forEach((l) => l());
  }

  return {
    /** Reads billed for a server result: Firestore bills at least one read per query. */
    recordReads(label: string, docCount: number, fromCache: boolean, isQuery: boolean) {
      if (fromCache) return;
      const billed = isQuery ? Math.max(1, docCount) : 1;
      bump(label, { reads: billed });
    },
    recordListenerUpdate(label: string, changedDocs: number, fromCache: boolean, initial: boolean) {
      if (fromCache) return;
      const billed = initial ? Math.max(1, changedDocs) : changedDocs;
      if (billed > 0) bump(label, { reads: billed });
    },
    recordWrites(label: string, writes: number, deletes: number) {
      bump(label, { writes, deletes });
    },
    listenerAttached(label: string) {
      bump(label, { activeListeners: 1 });
    },
    listenerDetached(label: string) {
      bump(label, { activeListeners: -1 });
    },
    reset() {
      state = { ...emptyCounts(), byLabel: {}, startedAt: Date.now() };
      listeners.forEach((l) => l());
    },
    getSnapshot(): MeterSnapshot {
      return state;
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type Meter = ReturnType<typeof createMeter>;

/** The app-wide meter instance. Counting is always on (it is cheap); only the overlay is flagged. */
export const meter = createMeter();
