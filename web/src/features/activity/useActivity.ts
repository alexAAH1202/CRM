import { boardPaths, type ActivityData } from '@app/shared';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../../lib/firebase';
import { listenQuery } from '../../lib/firestore';

export interface ActivityEntry {
  id: string;
  type: string;
  itemId: string | null;
  itemName: string;
  actor: string;
  data: ActivityData;
  atMs: number;
}

/**
 * Recent activity for one item (newest 30) or the whole board (newest 50). Listens only
 * while the tab/panel showing it is open.
 */
export function useActivity(wid: string, bid: string, itemId: string | null, enabled: boolean) {
  const [state, setState] = useState<{
    entries: ActivityEntry[];
    ready: boolean;
    error: string | null;
  }>({
    entries: [],
    ready: false,
    error: null,
  });
  useEffect(() => {
    if (!enabled) return;
    setState({ entries: [], ready: false, error: null });
    const col = collection(db, boardPaths.activity(wid, bid));
    const q = itemId
      ? query(col, where('itemId', '==', itemId), orderBy('at', 'desc'), limit(30))
      : query(col, orderBy('at', 'desc'), limit(50));
    return listenQuery(
      itemId ? 'activity:item' : 'activity:board',
      q,
      (snap) =>
        setState({
          ready: true,
          error: null,
          entries: snap.docs.map((d) => {
            const x = d.data({ serverTimestamps: 'estimate' });
            const ts = x['at'] as { toMillis?: () => number } | null;
            return {
              id: d.id,
              type: String(x['type'] ?? ''),
              itemId: typeof x['itemId'] === 'string' ? x['itemId'] : null,
              itemName: String(x['itemName'] ?? ''),
              actor: String(x['actor'] ?? ''),
              data: (x['data'] && typeof x['data'] === 'object' ? x['data'] : {}) as ActivityData,
              atMs: ts?.toMillis?.() ?? Date.now(),
            };
          }),
        }),
      (err) => setState({ entries: [], ready: true, error: err.message }),
    );
  }, [wid, bid, itemId, enabled]);
  return state;
}
