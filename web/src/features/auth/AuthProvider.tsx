import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { doc } from 'firebase/firestore';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { paths } from '@app/shared';
import { auth, db } from '../../lib/firebase';
import { commitOps, readDoc } from '../../lib/firestore';
import { useSessionStore } from '../workspaces/sessionStore';

export type AuthState =
  { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: User };

const AuthContext = createContext<AuthState>({ status: 'loading' });

/**
 * Keeps users/{uid} in step with the Google profile. One read per sign-in;
 * a write only when something changed.
 */
async function syncUserDoc(user: User) {
  const profile = {
    displayName: user.displayName ?? '',
    email: (user.email ?? '').toLowerCase(),
    photoURL: user.photoURL,
  };
  const snap = await readDoc('users:self', doc(db, paths.user(user.uid)));
  const data = snap.data();
  if (!snap.exists()) {
    await commitOps('users:create', [
      {
        kind: 'set',
        path: paths.user(user.uid),
        data: { ...profile, lastWorkspaceId: null, settings: {} },
      },
    ]);
  } else if (
    data?.['displayName'] !== profile.displayName ||
    data?.['email'] !== profile.email ||
    data?.['photoURL'] !== profile.photoURL
  ) {
    await commitOps('users:profile', [
      { kind: 'update', path: paths.user(user.uid), data: profile },
    ]);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        if (!user) {
          useSessionStore.getState().reset();
          setState({ status: 'signedOut' });
          return;
        }
        // The user document must exist before anything else writes to it (e.g. the last
        // household), so the app waits for this one read (and, the first time, one write).
        syncUserDoc(user)
          .catch((err: unknown) => console.warn('user doc sync failed', err))
          .finally(() => setState({ status: 'signedIn', user }));
      }),
    [],
  );
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** For components rendered under <RequireAuth>, where a user is guaranteed. */
export function useCurrentUser(): User {
  const state = useAuth();
  if (state.status !== 'signedIn') throw new Error('useCurrentUser used outside RequireAuth');
  return state.user;
}

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

export function signOutUser(): Promise<void> {
  return signOut(auth);
}
