/**
 * The ONLY module allowed to call Firestore read/write primitives directly
 * (enforced by ESLint no-restricted-imports). Every call is metered so the dev
 * usage overlay reflects real traffic.
 */
import { resolveSentinels, type DocData, type WriteOp } from '@app/shared';
import {
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  getAggregateFromServer,
  count,
  sum,
  average,
  getDocsFromCache,
  runTransaction,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type FirestoreError,
  type Query,
  type QuerySnapshot,
  type Transaction,
  type WriteBatch,
} from 'firebase/firestore';
import { USE_EMULATORS } from '../../config';
import { db } from '../firebase';
import { meter, type MeterSnapshot } from './meter';

export { meter } from './meter';

declare global {
  interface Window {
    /** Emulator-only test hooks: read and reset the usage meter (used by the quota e2e). */
    __meter?: { snapshot: () => MeterSnapshot; reset: () => void };
  }
}
if (USE_EMULATORS && typeof window !== 'undefined') {
  window.__meter = { snapshot: () => meter.getSnapshot(), reset: () => meter.reset() };
}

export async function readDoc<T = DocumentData>(
  label: string,
  ref: DocumentReference<T>,
): Promise<DocumentSnapshot<T>> {
  const snap = await getDoc(ref);
  meter.recordReads(label, 1, snap.metadata.fromCache, false);
  return snap;
}

export async function readQuery<T = DocumentData>(
  label: string,
  q: Query<T>,
): Promise<QuerySnapshot<T>> {
  const snap = await getDocs(q);
  meter.recordReads(label, snap.size, snap.metadata.fromCache, true);
  return snap;
}

export function listenDoc<T = DocumentData>(
  label: string,
  ref: DocumentReference<T>,
  onNext: (snap: DocumentSnapshot<T>) => void,
  onError?: (err: FirestoreError) => void,
): () => void {
  meter.listenerAttached(label);
  let first = true;
  const unsub = onSnapshot(
    ref,
    (snap) => {
      meter.recordListenerUpdate(label, 1, snap.metadata.fromCache, first);
      if (!snap.metadata.fromCache) first = false;
      onNext(snap);
    },
    onError,
  );
  return () => {
    unsub();
    meter.listenerDetached(label);
  };
}

export function listenQuery<T = DocumentData>(
  label: string,
  q: Query<T>,
  onNext: (snap: QuerySnapshot<T>) => void,
  onError?: (err: FirestoreError) => void,
): () => void {
  meter.listenerAttached(label);
  let first = true;
  const unsub = onSnapshot(
    q,
    (snap) => {
      meter.recordListenerUpdate(label, snap.docChanges().length, snap.metadata.fromCache, first);
      if (!snap.metadata.fromCache) first = false;
      onNext(snap);
    },
    onError,
  );
  return () => {
    unsub();
    meter.listenerDetached(label);
  };
}

/**
 * A writeBatch that counts its operations. Use for every write — even a single
 * one — so automations (Phase 6) can join the same atomic commit.
 */
export interface MeteredBatch {
  batch: WriteBatch;
  set: WriteBatch['set'];
  update: WriteBatch['update'];
  delete: WriteBatch['delete'];
  readonly size: number;
  commit(): Promise<void>;
}

export function createBatch(label: string): MeteredBatch {
  const batch = writeBatch(db);
  let writes = 0;
  let deletes = 0;
  const api: MeteredBatch = {
    batch,
    set: ((...args: Parameters<WriteBatch['set']>) => {
      writes++;
      return batch.set(...args);
    }) as WriteBatch['set'],
    update: ((...args: Parameters<WriteBatch['update']>) => {
      writes++;
      return batch.update(...args);
    }) as WriteBatch['update'],
    delete: (ref) => {
      deletes++;
      return batch.delete(ref);
    },
    get size() {
      return writes + deletes;
    },
    async commit() {
      await batch.commit();
      meter.recordWrites(label, writes, deletes);
    },
  };
  return api;
}

const sdkSentinels = {
  serverTime: () => serverTimestamp(),
  deleteField: () => deleteField(),
  arrayUnion: (...v: unknown[]) => arrayUnion(...v),
  arrayRemove: (...v: unknown[]) => arrayRemove(...v),
};

/**
 * Executes a planner's WriteOp[] (from @app/shared) as one atomic, metered batch.
 * The rules tests run the same planners, so what ships is what's tested.
 */
interface OpTarget {
  set: (ref: ReturnType<typeof doc>, data: DocData) => unknown;
  update: (ref: ReturnType<typeof doc>, data: DocData) => unknown;
  delete: (ref: ReturnType<typeof doc>) => unknown;
}

function applyOps(target: OpTarget, ops: WriteOp[]) {
  for (const op of ops) {
    const ref = doc(db, op.path);
    if (op.kind === 'delete') target.delete(ref);
    else if (op.kind === 'set') target.set(ref, resolveSentinels(op.data, sdkSentinels) as DocData);
    else target.update(ref, resolveSentinels(op.data, sdkSentinels) as DocData);
  }
}

export async function commitOps(label: string, ops: WriteOp[]): Promise<void> {
  if (ops.length === 0) return;
  const b = createBatch(label);
  applyOps(b as unknown as OpTarget, ops);
  await b.commit();
}

/** Large op lists (e.g. deleting a board) split into <=500-op batches. */
export async function commitOpsChunked(label: string, ops: WriteOp[], size = 100): Promise<void> {
  for (let i = 0; i < ops.length; i += size) await commitOps(label, ops.slice(i, i + size));
}

/**
 * A count, total or average computed by the server (an aggregation query): billed about one read
 * per thousand matching index entries, not one per document, which is why dashboard numbers use
 * it. The meter records one read (the minimum); a very large match would cost a few more.
 */
export async function readAggregate(
  label: string,
  q: Query,
  spec: { measure: 'count' | 'sum' | 'avg'; field?: string | null },
): Promise<number> {
  const agg =
    spec.measure === 'sum' && spec.field
      ? { value: sum(spec.field) }
      : spec.measure === 'avg' && spec.field
        ? { value: average(spec.field) }
        : { value: count() };
  const snap = await getAggregateFromServer(q, agg);
  meter.recordReads(label, 1, false, false);
  const v = snap.data().value;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Number of documents matching a query: an aggregation, billed as 1 read per 1,000 entries (min 1). */
export async function readCount<T = DocumentData>(label: string, q: Query<T>): Promise<number> {
  const snap = await getCountFromServer(q);
  const n = snap.data().count;
  meter.recordReads(label, Math.max(1, Math.ceil(n / 1000)), false, false);
  return n;
}

/** Reads the local cache only (free). Throws if nothing is cached. */
export async function readQueryFromCache<T = DocumentData>(q: Query<T>): Promise<QuerySnapshot<T>> {
  return getDocsFromCache(q);
}

/**
 * Metered transaction. `body` reads with tx.get (counted) and returns the write
 * ops to apply atomically. Requires a connection (transactions don't queue offline).
 */
export async function runOpsTransaction(
  label: string,
  body: (
    get: <T = DocumentData>(ref: DocumentReference<T>) => Promise<DocumentSnapshot<T>>,
  ) => Promise<WriteOp[]>,
): Promise<void> {
  let reads = 0;
  let ops: WriteOp[] = [];
  await runTransaction(db, async (tx: Transaction) => {
    reads = 0;
    ops = await body(async (ref) => {
      reads++;
      return tx.get(ref);
    });
    applyOps(tx as unknown as OpTarget, ops);
  });
  if (reads > 0) meter.recordReads(label, reads, false, true);
  meter.recordWrites(
    label,
    ops.filter((o) => o.kind !== 'delete').length,
    ops.filter((o) => o.kind === 'delete').length,
  );
}
