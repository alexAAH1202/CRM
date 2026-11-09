import type { User } from 'firebase/auth';
import { create } from 'zustand';
import {
  checkCanCreateWorkspace,
  loadMyInvites,
  loadMyWorkspaces,
  type MyInvite,
  type MyWorkspace,
} from './api';

interface SessionState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  workspaces: MyWorkspace[];
  invites: MyInvite[];
  canCreate: boolean;
  error: string | null;
  /** Loads memberships, invites and the create-permission (one-shot reads, cached). */
  refresh: (user: User) => Promise<void>;
  reset: () => void;
}

const initial = {
  status: 'idle' as const,
  workspaces: [],
  invites: [],
  canCreate: false,
  error: null,
};

export const useSessionStore = create<SessionState>()((set) => ({
  ...initial,
  refresh: async (user) => {
    set({ status: 'loading', error: null });
    try {
      const [workspaces, invites, canCreate] = await Promise.all([
        loadMyWorkspaces(user.uid),
        loadMyInvites(user.email ?? ''),
        checkCanCreateWorkspace(),
      ]);
      set({ status: 'ready', workspaces, invites, canCreate });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },
  reset: () => set(initial),
}));
