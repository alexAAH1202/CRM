import { advanceLastSynced, paths, planSync, boardPaths, type BoardDoc } from '@app/shared';
import {
  collection,
  doc,
  query,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../../lib/firebase';
import { listenDoc, listenQuery, readQueryFromCache } from '../../lib/firestore';
import type { Board, BoardItem } from './types';

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; data: T };

export function useBoardDoc(wid: string, bid: string): Loadable<Board> {
  const [state, setState] = useState<Loadable<Board>>({ status: 'loading' });
  useEffect(() => {
    setState({ status: 'loading' });
    return listenDoc(
      'board',
      doc(db, paths.board(wid, bid)),
      (snap) => {
        const d = snap.data() as BoardDoc | undefined;
        setState(d ? { status: 'ready', data: { ...d, id: snap.id } } : { status: 'missing' });
      },
      (err) =>
        setState(
          err.code === 'permission-denied'
            ? { status: 'missing' }
            : { status: 'error', message: err.message },
        ),
    );
  }, [wid, bid]);
  return state;
}

function toItem(d: QueryDocumentSnapshot<DocumentData>): BoardItem {
  const x = d.data({ serverTimestamps: 'estimate' });
  const ts = x['updatedAt'];
  return {
    id: d.id,
    name: String(x['name'] ?? ''),
    groupId: String(x['groupId'] ?? ''),
    order: String(x['order'] ?? 'a0'),
    parentId: typeof x['parentId'] === 'string' ? x['parentId'] : null,
    itemNumber: typeof x['itemNumber'] === 'number' ? x['itemNumber'] : 0,
    values: (x['values'] as Record<string, unknown>) ?? {},
    assigneeUids: Array.isArray(x['assigneeUids']) ? (x['assigneeUids'] as string[]) : [],
    acceptance:
      x['acceptance'] && typeof x['acceptance'] === 'object'
        ? (x['acceptance'] as BoardItem['acceptance'])
        : {},
    onCalendar: x['onCalendar'] === true,
    archived: x['archived'] === true,
    deleted: x['deletedAt'] != null,
    deletedAtMs: x['deletedAt'] instanceof Timestamp ? x['deletedAt'].toMillis() : null,
    createdBy: String(x['createdBy'] ?? ''),
    createdAtMs: x['createdAt'] instanceof Timestamp ? x['createdAt'].toMillis() : null,
    updatedAtMs: ts instanceof Timestamp ? ts.toMillis() : null,
  };
}

function confirmedMs(d: QueryDocumentSnapshot<DocumentData>): {
  updatedAtMs: number | null;
  pending: boolean;
} {
  const ts = d.data({ serverTimestamps: 'none' })['updatedAt'];
  return {
    updatedAtMs: ts instanceof Timestamp ? ts.toMillis() : null,
    pending: d.metadata.hasPendingWrites,
  };
}

const syncKey = (wid: string, bid: string) => `sync:${wid}:${bid}`;
function readLastSynced(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeLastSynced(key: string, ms: number | null) {
  try {
    if (ms) localStorage.setItem(key, String(ms));
  } catch {
    /* ignore */
  }
}

/**
 * Delta sync (decision D5): render from the IndexedDB cache, then listen only
 * to items changed since the last sync. A full listener is used on first open,
 * after cache eviction, or when the last sync is over 30 days old.
 */
export function useBoardItems(wid: string, bid: string): Loadable<Map<string, BoardItem>> {
  const [state, setState] = useState<Loadable<Map<string, BoardItem>>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let unsub: () => void = () => undefined;
    const key = syncKey(wid, bid);
    const col = collection(db, boardPaths.items(wid, bid));
    const items = new Map<string, BoardItem>();
    setState({ status: 'loading' });

    (async () => {
      let cachedCount = 0;
      try {
        const cached = await readQueryFromCache(col);
        cached.docs.forEach((d) => items.set(d.id, toItem(d)));
        cachedCount = cached.size;
      } catch {
        /* nothing cached */
      }
      if (cancelled) return;
      if (cachedCount > 0) setState({ status: 'ready', data: new Map(items) });

      const plan = planSync({ lastSyncedMs: readLastSynced(key), cachedCount, nowMs: Date.now() });
      let last = plan.mode === 'delta' ? readLastSynced(key) : null;
      const q =
        plan.mode === 'full'
          ? col
          : query(col, where('updatedAt', '>', Timestamp.fromMillis(plan.sinceMs)));

      unsub = listenQuery(
        `items:${plan.mode}`,
        q,
        (snap) => {
          if (plan.mode === 'full' && !snap.metadata.fromCache) {
            // Authoritative full result: drop anything no longer on the server.
            const ids = new Set(snap.docs.map((d) => d.id));
            for (const id of items.keys()) if (!ids.has(id)) items.delete(id);
          }
          for (const ch of snap.docChanges()) {
            // In delta mode a "removed" change only means the doc left the
            // updatedAt window (e.g. a pending server timestamp) — keep it.
            if (ch.type === 'removed' && plan.mode === 'full') items.delete(ch.doc.id);
            else items.set(ch.doc.id, toItem(ch.doc));
          }
          if (!snap.metadata.fromCache) {
            last = advanceLastSynced(
              last,
              snap.docChanges().map((c) => confirmedMs(c.doc)),
            );
            if (plan.mode === 'full' && last === null && snap.size === 0) last = Date.now();
            writeLastSynced(key, last);
          }
          setState({ status: 'ready', data: new Map(items) });
        },
        (err) => setState({ status: 'error', message: err.message }),
      );
    })();

    return () => {
      cancelled = true;
      unsub();
    };
  }, [wid, bid]);

  return state;
}
