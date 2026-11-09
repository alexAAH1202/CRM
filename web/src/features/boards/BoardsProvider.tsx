import { byOrder, isRole, paths } from '@app/shared';
import { doc } from 'firebase/firestore';
import { collection, query, where } from 'firebase/firestore';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db } from '../../lib/firebase';
import { listenQuery } from '../../lib/firestore';
import { useCurrentUser } from '../auth/AuthProvider';
import { useWorkspace } from '../workspaces/WorkspaceProvider';
import { listenDoc } from '../../lib/firestore';
import type { BoardSummary, Folder, WorkspaceMember } from './types';

interface BoardsState {
  boards: BoardSummary[] | null; // non-archived, sorted
  archived: BoardSummary[];
  members: WorkspaceMember[] | null;
  folders: Folder[];
  favorites: ReadonlySet<string>;
  memberName: (uid: string) => string;
}

const Ctx = createContext<BoardsState | null>(null);

function toSummary(id: string, d: Record<string, unknown>): BoardSummary {
  return {
    id,
    name: String(d['name'] ?? 'Untitled'),
    visibility: d['visibility'] === 'private' ? 'private' : 'main',
    archived: d['archived'] === true,
    order: String(d['order'] ?? 'a0'),
    createdBy: String(d['createdBy'] ?? ''),
    folderId: typeof d['folderId'] === 'string' ? d['folderId'] : null,
  };
}

/**
 * Workspace-wide live data that's small and needed everywhere: the board list
 * (sidebar) and the member list (People columns). Admins use one listener;
 * others need two, because rules only allow queries constrained to what they
 * may see (main boards, or private boards that list them).
 */
export function BoardsProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const { workspace, role } = useWorkspace();
  const [main, setMain] = useState<Map<string, BoardSummary> | null>(null);
  const [mine, setMine] = useState<Map<string, BoardSummary> | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const col = collection(db, paths.boards(workspace.id));
    const toMap = (docs: Array<{ id: string; data: () => Record<string, unknown> }>) =>
      new Map(docs.map((d) => [d.id, toSummary(d.id, d.data())]));
    if (role === 'admin') {
      setMine(new Map());
      return listenQuery('boards:all', col, (s) => setMain(toMap(s.docs)));
    }
    const u1 = listenQuery('boards:main', query(col, where('visibility', '==', 'main')), (s) =>
      setMain(toMap(s.docs)),
    );
    const u2 = listenQuery(
      'boards:private',
      query(col, where('memberIds', 'array-contains', user.uid)),
      (s) => setMine(toMap(s.docs)),
    );
    return () => {
      u1();
      u2();
    };
  }, [workspace.id, role, user.uid]);

  useEffect(
    () =>
      listenQuery('members', collection(db, paths.members(workspace.id)), (s) =>
        setMembers(
          s.docs.flatMap((d) => {
            const m = d.data();
            if (!isRole(m['role'])) return [];
            return [
              {
                uid: d.id,
                role: m['role'],
                name: String(m['displayName'] || m['email'] || 'Unknown'),
                email: String(m['email'] ?? ''),
                photoURL: typeof m['photoURL'] === 'string' ? m['photoURL'] : null,
              },
            ];
          }),
        ),
      ),
    [workspace.id],
  );

  useEffect(
    () =>
      listenQuery('folders', collection(db, paths.folders(workspace.id)), (s) =>
        setFolders(
          s.docs
            .map((d) => ({
              id: d.id,
              name: String(d.data()['name'] ?? 'Folder'),
              order: String(d.data()['order'] ?? 'a0'),
            }))
            .sort(byOrder),
        ),
      ),
    [workspace.id],
  );

  // My favourite boards live on my user doc (one small listener).
  useEffect(
    () =>
      listenDoc('user:favorites', doc(db, paths.user(user.uid)), (snap) => {
        const ids = (snap.data()?.['settings'] as { favoriteBoardIds?: unknown } | undefined)
          ?.favoriteBoardIds;
        setFavorites(
          new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []),
        );
      }),
    [user.uid],
  );

  const value = useMemo<BoardsState>(() => {
    let all: BoardSummary[] | null = null;
    if (main && mine) all = [...new Map([...main, ...mine]).values()].sort(byOrder);
    const byUid = new Map((members ?? []).map((m) => [m.uid, m.name]));
    return {
      boards: all?.filter((b) => !b.archived) ?? null,
      archived: all?.filter((b) => b.archived) ?? [],
      members,
      folders,
      favorites,
      memberName: (uid) => byUid.get(uid) ?? 'Former member',
    };
  }, [main, mine, members, folders, favorites]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBoards(): BoardsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBoards outside BoardsProvider');
  return v;
}
