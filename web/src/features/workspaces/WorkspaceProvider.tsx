import { isRole, paths, type Role, type WorkspaceSettings } from '@app/shared';
import { doc } from 'firebase/firestore';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { db } from '../../lib/firebase';
import { listenDoc } from '../../lib/firestore';
import { useCurrentUser } from '../auth/AuthProvider';
import { rememberLastWorkspace } from './api';

export interface WorkspaceInfo {
  id: string;
  name: string;
  adminUids: string[];
  settings: WorkspaceSettings | null;
}

export type WorkspaceState =
  | { status: 'loading' }
  | { status: 'noAccess' }
  | { status: 'error'; message: string }
  | { status: 'ready'; workspace: WorkspaceInfo; role: Role };

const Ctx = createContext<WorkspaceState>({ status: 'loading' });

/**
 * Two small live listeners while a workspace is open: the workspace doc and my
 * own member doc (so role changes / removal apply instantly).
 */
export function WorkspaceProvider({ wid, children }: { wid: string; children: ReactNode }) {
  const user = useCurrentUser();
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [role, setRole] = useState<Role | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWorkspace(null);
    setRole(undefined);
    setError(null);
    const unsubMember = listenDoc(
      'member:self',
      doc(db, paths.member(wid, user.uid)),
      (snap) => {
        const r = snap.data()?.['role'];
        if (snap.exists() && isRole(r)) setRole(r);
        // "Not a member" is only trusted from the server, not an empty local cache.
        else if (!snap.metadata.fromCache) setRole(null);
      },
      () => setRole(null),
    );
    const unsubWs = listenDoc(
      'workspace',
      doc(db, paths.workspace(wid)),
      (snap) => {
        const d = snap.data();
        if (!d) return;
        setWorkspace({
          id: wid,
          name: String(d['name'] ?? ''),
          adminUids: Array.isArray(d['adminUids']) ? (d['adminUids'] as string[]) : [],
          settings: (d['settings'] as WorkspaceSettings | undefined) ?? null,
        });
      },
      (err) => {
        // permission-denied here just means "not a member" — handled via role.
        if (err.code !== 'permission-denied') setError(err.message);
      },
    );
    return () => {
      unsubMember();
      unsubWs();
    };
  }, [wid, user.uid]);

  // Remember the last workspace — one write only when it actually changes.
  useEffect(() => {
    if (!role) return;
    const key = `lastWorkspace:${user.uid}`;
    let known: string | null = null;
    try {
      known = localStorage.getItem(key);
    } catch {
      /* storage unavailable */
    }
    if (known === wid) return;
    rememberLastWorkspace(user.uid, wid)
      .then(() => {
        try {
          localStorage.setItem(key, wid);
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined);
  }, [role, user.uid, wid]);

  let state: WorkspaceState;
  if (error) state = { status: 'error', message: error };
  else if (role === null) state = { status: 'noAccess' };
  else if (!workspace || role === undefined) state = { status: 'loading' };
  else state = { status: 'ready', workspace, role };

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useWorkspaceState(): WorkspaceState {
  return useContext(Ctx);
}

/** For components rendered inside a ready workspace. */
export function useWorkspace(): { workspace: WorkspaceInfo; role: Role } {
  const s = useContext(Ctx);
  if (s.status !== 'ready') throw new Error('useWorkspace used before the workspace is ready');
  return s;
}
