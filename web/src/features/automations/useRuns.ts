import { boardPaths } from '@app/shared';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../../lib/firebase';
import { listenQuery } from '../../lib/firestore';

export interface RunDoc {
  id: string;
  automationId: string;
  name: string;
  status: 'ok' | 'skipped' | 'failed';
  error: string | null;
  itemId: string | null;
  depth: number;
  actor: string;
  atMs: number;
}

export const RUNS_SHOWN = 50;

/** Newest runs (read up to 100 so we can trim anything beyond the 50 we keep). */
export function useRuns(wid: string, bid: string, enabled: boolean) {
  const [state, setState] = useState<{ runs: RunDoc[]; extraIds: string[]; ready: boolean }>({
    runs: [],
    extraIds: [],
    ready: false,
  });
  useEffect(() => {
    if (!enabled) return;
    setState({ runs: [], extraIds: [], ready: false });
    return listenQuery(
      'automationRuns',
      query(
        collection(db, boardPaths.runs(wid, bid)),
        orderBy('at', 'desc'),
        limit(RUNS_SHOWN * 2),
      ),
      (snap) => {
        const all = snap.docs.map((d) => {
          const x = d.data({ serverTimestamps: 'estimate' });
          const ts = x['at'] as { toMillis?: () => number } | null;
          return {
            id: d.id,
            automationId: String(x['automationId'] ?? ''),
            name: String(x['name'] ?? ''),
            status: (['ok', 'skipped', 'failed'].includes(String(x['status']))
              ? x['status']
              : 'ok') as RunDoc['status'],
            error: typeof x['error'] === 'string' ? x['error'] : null,
            itemId: typeof x['itemId'] === 'string' ? x['itemId'] : null,
            depth: typeof x['depth'] === 'number' ? x['depth'] : 0,
            actor: String(x['actor'] ?? ''),
            atMs: ts?.toMillis?.() ?? Date.now(),
          };
        });
        setState({
          runs: all.slice(0, RUNS_SHOWN),
          extraIds: all.slice(RUNS_SHOWN).map((r) => r.id),
          ready: true,
        });
      },
      () => setState({ runs: [], extraIds: [], ready: true }),
    );
  }, [wid, bid, enabled]);
  return state;
}
