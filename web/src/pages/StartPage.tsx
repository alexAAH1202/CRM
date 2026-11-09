import { MailQuestion } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { Logo } from '../components/Logo';
import { Button, EmptyState } from '../components/ui';
import { signOutUser, useCurrentUser } from '../features/auth/AuthProvider';
import { readLastWorkspaceId } from '../features/workspaces/api';
import { useSessionStore } from '../features/workspaces/sessionStore';

/** Decides where a signed-in user lands: invites → last workspace → create → "ask for an invite". */
export default function StartPage() {
  const user = useCurrentUser();
  const { status, workspaces, invites, canCreate, error, refresh } = useSessionStore();
  const [lastWid, setLastWid] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void refresh(user);
    readLastWorkspaceId(user.uid)
      .then(setLastWid)
      .catch(() => setLastWid(null));
  }, [user, refresh]);

  if (status === 'error') {
    return (
      <EmptyState
        title="Couldn't load your households"
        body={error}
        action={<Button onClick={() => void refresh(user)}>Try again</Button>}
      />
    );
  }
  if (status !== 'ready' || lastWid === undefined)
    return <FullPageSpinner label="Loading your households" />;

  if (invites.length > 0) return <Navigate to="/invites" replace />;
  if (workspaces.length > 0) {
    const target = workspaces.find((w) => w.id === lastWid) ?? workspaces[0];
    return <Navigate to={`/w/${target!.id}`} replace />;
  }
  if (canCreate) return <Navigate to="/new" replace />;

  return (
    <div className="flex min-h-full flex-col">
      <header className="px-6 py-4">
        <Logo />
      </header>
      <EmptyState
        icon={<MailQuestion size={28} />}
        title="You're not in a household yet"
        body={
          <>
            Ask a household admin to invite <strong className="text-fg">{user.email}</strong>, then
            come back and refresh this page.
          </>
        }
        action={
          <div className="flex gap-2">
            <Button onClick={() => void refresh(user)}>Check again</Button>
            <Button variant="ghost" onClick={() => void signOutUser()}>
              Use a different account
            </Button>
          </div>
        }
      />
    </div>
  );
}
