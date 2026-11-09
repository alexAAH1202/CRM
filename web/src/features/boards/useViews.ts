import {
  boardPaths,
  parseViewConfig,
  parseViewType,
  type ViewConfig,
  type ViewType,
} from '@app/shared';
import { collection } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../../lib/firebase';
import { listenQuery } from '../../lib/firestore';

export interface BoardView {
  id: string;
  type: ViewType;
  name: string;
  order: string;
  config: ViewConfig;
}

/** The board's saved views (a handful of tiny docs; one listener per open board). */
export function useViews(wid: string, bid: string): { views: BoardView[] | null } {
  const [views, setViews] = useState<BoardView[] | null>(null);
  useEffect(() => {
    setViews(null);
    return listenQuery(
      'views',
      collection(db, `${boardPaths.view(wid, bid, 'x').replace(/\/x$/, '')}`),
      (snap) =>
        setViews(
          snap.docs
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                type: parseViewType(x['type']),
                name: typeof x['name'] === 'string' ? x['name'] : 'View',
                order: typeof x['order'] === 'string' ? x['order'] : 'a0',
                config: parseViewConfig(x['config']),
              };
            })
            .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)),
        ),
      () => setViews([]),
    );
  }, [wid, bid]);
  return { views };
}
