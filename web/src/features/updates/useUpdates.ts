import { paths } from '@app/shared';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../../lib/firebase';
import { listenQuery } from '../../lib/firestore';

export interface UpdateDoc {
  id: string;
  author: string;
  body: string;
  mentions: string[];
  parentId: string | null;
  createdAtMs: number;
  edited: boolean;
}

export const UPDATES_LIMIT = 100;

/**
 * Comments for one item. Only listens while the item panel is open on this tab, and only
 * for the newest 100 (the cache makes reopening free).
 */
export function useUpdates(wid: string, bid: string, iid: string, enabled: boolean) {
  const [state, setState] = useState<{
    updates: UpdateDoc[];
    ready: boolean;
    error: string | null;
  }>({
    updates: [],
    ready: false,
    error: null,
  });
  useEffect(() => {
    if (!enabled) return;
    setState({ updates: [], ready: false, error: null });
    return listenQuery(
      'updates',
      query(
        collection(db, paths.updates(wid, bid, iid)),
        orderBy('createdAt', 'desc'),
        limit(UPDATES_LIMIT),
      ),
      (snap) =>
        setState({
          ready: true,
          error: null,
          updates: snap.docs.map((d) => {
            const x = d.data({ serverTimestamps: 'estimate' });
            const ts = x['createdAt'] as { toMillis?: () => number } | null;
            return {
              id: d.id,
              author: String(x['author'] ?? ''),
              body: String(x['body'] ?? ''),
              mentions: Array.isArray(x['mentions']) ? (x['mentions'] as string[]) : [],
              parentId: typeof x['parentId'] === 'string' ? x['parentId'] : null,
              createdAtMs: ts?.toMillis?.() ?? Date.now(),
              edited: x['editedAt'] != null,
            };
          }),
        }),
      (err) => setState({ updates: [], ready: true, error: err.message }),
    );
  }, [wid, bid, iid, enabled]);
  return state;
}
