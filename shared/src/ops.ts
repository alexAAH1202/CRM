/**
 * SDK-independent description of a Firestore write batch.
 *
 * Planner functions (e.g. workspaceOps.ts) return WriteOp[] instead of touching
 * the SDK, so the web app and the rules tests execute the *same* writes: the
 * tests prove the app's real batches are accepted, and that tampered ones are not.
 */
export const SERVER_TIME = Object.freeze({ __op: 'serverTime' as const });
export type ServerTime = typeof SERVER_TIME;

export interface ArrayUnion {
  __op: 'arrayUnion';
  values: unknown[];
}
export interface ArrayRemove {
  __op: 'arrayRemove';
  values: unknown[];
}

export function arrayUnion(...values: unknown[]): ArrayUnion {
  return { __op: 'arrayUnion', values };
}
export function arrayRemove(...values: unknown[]): ArrayRemove {
  return { __op: 'arrayRemove', values };
}

export type Sentinel = ServerTime | ArrayUnion | ArrayRemove;

export function isSentinel(v: unknown): v is Sentinel {
  return typeof v === 'object' && v !== null && '__op' in v;
}

export type DocData = Record<string, unknown>;

export type WriteOp =
  | { kind: 'set'; path: string; data: DocData }
  | { kind: 'update'; path: string; data: DocData }
  | { kind: 'delete'; path: string };

/**
 * Recursively replaces sentinels using the given SDK-specific factories.
 * Used by both executors (web and tests).
 */
export function resolveSentinels(
  value: unknown,
  f: {
    serverTime: () => unknown;
    arrayUnion: (...v: unknown[]) => unknown;
    arrayRemove: (...v: unknown[]) => unknown;
  },
): unknown {
  if (isSentinel(value)) {
    switch (value.__op) {
      case 'serverTime':
        return f.serverTime();
      case 'arrayUnion':
        return f.arrayUnion(...value.values);
      case 'arrayRemove':
        return f.arrayRemove(...value.values);
    }
  }
  if (Array.isArray(value)) return value.map((v) => resolveSentinels(v, f));
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: DocData = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveSentinels(v, f);
    return out;
  }
  return value;
}
