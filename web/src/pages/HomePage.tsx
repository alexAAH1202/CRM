import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { LayoutGrid } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuthUser } from '../app/useAuthUser';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { Avatar, Button, EmptyState, Skeleton } from '../components/ui';
import { APP_NAME, USE_EMULATORS } from '../config';
import { auth } from '../lib/firebase';
import { toast } from '../stores/toast';

/**
 * Phase 0 placeholder: proves Google sign-in against the Auth emulator works.
 * Phase 1 replaces this with the workspace / invite onboarding flow.
 */
export default function HomePage() {
  const state = useAuthUser();

  async function signIn() {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign-in failed');
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-3">
        <Logo />
        <div className="flex items-center gap-3">
          {USE_EMULATORS && (
            <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary">
              Emulators
            </span>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl bg-surface p-8 shadow-pop">
          {state.status === 'loading' && (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {state.status === 'signedOut' && (
            <div className="space-y-6 text-center">
              <h1 className="text-2xl font-extrabold">Welcome to {APP_NAME}</h1>
              <p className="text-sm text-muted">Sign in with your Google account to continue.</p>
              <Button onClick={signIn} className="w-full">
                Continue with Google
              </Button>
            </div>
          )}
          {state.status === 'signedIn' && (
            <EmptyState
              icon={<LayoutGrid size={28} />}
              title={`Hi ${state.user.displayName ?? state.user.email ?? 'there'}`}
              body={
                <div className="flex flex-col items-center gap-3">
                  <Avatar
                    name={state.user.displayName ?? state.user.email ?? '?'}
                    photoURL={state.user.photoURL}
                    size="lg"
                  />
                  <span>Workspaces arrive in Phase 1.</span>
                </div>
              }
              action={
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => void signOut(auth)}>
                    Sign out
                  </Button>
                  <Link
                    to="/dev/components"
                    className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold text-primary hover:bg-primary-soft"
                  >
                    Component gallery
                  </Link>
                </div>
              }
            />
          )}
        </div>
      </main>
    </div>
  );
}
