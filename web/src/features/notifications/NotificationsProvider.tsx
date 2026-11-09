import { MUTABLE_NOTIFICATION_TYPES, paths } from '@app/shared';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db } from '../../lib/firebase';
import { listenQuery } from '../../lib/firestore';
import { useCurrentUser } from '../auth/AuthProvider';
import { useBoards } from '../boards/BoardsProvider';
import { useWorkspace } from '../workspaces/WorkspaceProvider';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAtMs: number;
}

interface State {
  /** Newest first, after removing the types I've muted. */
  items: AppNotification[];
  unread: number;
}

const Ctx = createContext<State>({ items: [], unread: 0 });
export const NOTIFICATIONS_LIMIT = 30;

/**
 * One small listener on my own inbox (newest 30) for the open workspace. Muted types are
 * filtered here, on my side, so nobody else needs to read my settings before notifying me.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const { workspace } = useWorkspace();
  const { muted } = useBoards();
  const [all, setAll] = useState<AppNotification[]>([]);

  useEffect(
    () =>
      listenQuery(
        'notifications',
        query(
          collection(db, paths.notifications(workspace.id, user.uid)),
          orderBy('createdAt', 'desc'),
          limit(NOTIFICATIONS_LIMIT),
        ),
        (snap) =>
          setAll(
            snap.docs.map((d) => {
              const x = d.data({ serverTimestamps: 'estimate' });
              const ts = x['createdAt'] as { toMillis?: () => number } | null;
              return {
                id: d.id,
                type: String(x['type'] ?? 'system'),
                title: String(x['title'] ?? ''),
                body: String(x['body'] ?? ''),
                link: String(x['link'] ?? ''),
                read: x['read'] === true,
                createdAtMs: ts?.toMillis?.() ?? Date.now(),
              };
            }),
          ),
        () => setAll([]),
      ),
    [workspace.id, user.uid],
  );

  const value = useMemo<State>(() => {
    const items = all.filter(
      (n) =>
        !(MUTABLE_NOTIFICATION_TYPES as readonly string[]).includes(n.type) || !muted.has(n.type),
    );
    return { items, unread: items.filter((n) => !n.read).length };
  }, [all, muted]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications(): State {
  return useContext(Ctx);
}
