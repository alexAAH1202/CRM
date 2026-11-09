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
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type FirestoreError,
  type Query,
  type QuerySnapshot,
  type WriteBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { meter } from './meter';

export { meter } from './meter';

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
export async function commitOps(label: string, ops: WriteOp[]): Promise<void> {
  if (ops.length === 0) return;
  const b = createBatch(label);
  for (const op of ops) {
    const ref = doc(db, op.path);
    if (op.kind === 'delete') b.delete(ref);
    else if (op.kind === 'set') b.set(ref, resolveSentinels(op.data, sdkSentinels) as DocData);
    else b.update(ref, resolveSentinels(op.data, sdkSentinels) as DocData);
  }
  await b.commit();
}
