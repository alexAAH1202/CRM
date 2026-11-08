import { onAuthStateChanged, type User } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { auth } from '../lib/firebase';

export type AuthState =
  { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: User };

export function useAuthUser(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  useEffect(
    () =>
      onAuthStateChanged(auth, (user) =>
        setState(user ? { status: 'signedIn', user } : { status: 'signedOut' }),
      ),
    [],
  );
  return state;
}
