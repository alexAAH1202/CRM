import { normalizeValue, type Column, type DependencyValue } from './columns';
import { addDays } from './dates';

/**
 * Dependencies are finish-to-start: an item can't start until its predecessors finish
 * (plus an optional lag in days). The data is `[{ id, lag }]` on the dependent item.
 */
export function predecessorsOf(column: Column, values: Record<string, unknown>): DependencyValue[] {
  const v = normalizeValue(column, values[column.id]);
  return Array.isArray(v) ? (v as DependencyValue[]) : [];
}

/**
 * Would giving `itemId` these predecessors create a loop? Returns the predecessor that
 * causes it, or null if it's fine. A loop means some chosen predecessor already depends
 * (directly or through others) on `itemId`.
 */
export function wouldCreateCycle(
  predecessorIds: (id: string) => readonly string[],
  itemId: string,
  newPredecessors: readonly string[],
): string | null {
  for (const start of newPredecessors) {
    if (start === itemId) return start;
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop() as string;
      for (const next of predecessorIds(cur)) {
        if (next === itemId) return start;
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
  }
  return null;
}

/** Finds an existing loop in a board's data (for repair/diagnostics). Returns the ids in the loop. */
export function findDependencyCycle(
  items: Iterable<{ id: string; values: Record<string, unknown> }>,
  column: Column,
): string[] | null {
  const preds = new Map<string, string[]>();
  for (const it of items)
    preds.set(
      it.id,
      predecessorsOf(column, it.values).map((d) => d.id),
    );
  const state = new Map<string, 0 | 1 | 2>(); // 1 = on the current path, 2 = finished
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return path.slice(path.indexOf(id));
    state.set(id, 1);
    path.push(id);
    for (const p of preds.get(id) ?? []) {
      if (!preds.has(p)) continue; // refers to a deleted item
      const hit = visit(p);
      if (hit) return hit;
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of preds.keys()) {
    const hit = visit(id);
    if (hit) return hit;
  }
  return null;
}

/**
 * The earliest an item may start given its predecessors' finish dates (finish-to-start + lag):
 * the day after the latest (finish + lag). Used by the schedule views in Phase 4.
 */
export function earliestStart(
  deps: readonly DependencyValue[],
  finishOf: (id: string) => string | null,
): string | null {
  let latest: string | null = null;
  for (const d of deps) {
    const f = finishOf(d.id);
    if (!f) continue;
    const ready = addDays(f, d.lag + 1);
    if (ready && (latest === null || ready > latest)) latest = ready;
  }
  return latest;
}
