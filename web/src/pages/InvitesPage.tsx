import { Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { Logo } from '../components/Logo';
import { RoleBadge, ROLE_DESCRIPTIONS } from '../components/RoleBadge';
import { Button, EmptyState } from '../components/ui';
import { useCurrentUser } from '../features/auth/AuthProvider';
import { acceptInvite, declineInvite, type MyInvite } from '../features/workspaces/api';
import { useSessionStore } from '../features/workspaces/sessionStore';
import { friendlyError } from '../lib/firestore/errors';
import { toast } from '../stores/toast';

export default function InvitesPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const { status, invites, workspaces, refresh } = useSessionStore();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'idle') void refresh(user);
  }, [status, user, refresh]);

  if (status !== 'ready') return <FullPageSpinner />;

  async function run(inv: MyInvite, action: 'accept' | 'decline') {
    setBusy(inv.workspaceId);
    try {
      if (action === 'accept') {
        await acceptInvite(user, inv);
        toast.success(`You joined ${inv.workspaceName}`);
        await refresh(user);
        navigate(`/w/${inv.workspaceId}`);
      } else {
        await declineInvite(inv);
        await refresh(user);
      }
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="px-6 py-4">
        <Logo />
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 space-y-4 p-6">
        <h1 className="text-2xl font-extrabold">Invitations</h1>
        {invites.length === 0 ? (
          <EmptyState
            icon={<Mail size={28} />}
            title="No pending invitations"
            action={
              <Link to="/" className="font-semibold text-primary underline underline-offset-2">
                Continue
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {invites.map((inv) => (
              <li key={inv.workspaceId} className="space-y-4 rounded-3xl bg-surface p-5 shadow-sm">
                <div className="space-y-1">
                  <p className="text-sm text-muted">You've been invited to join</p>
                  <p className="text-lg font-bold">{inv.workspaceName || 'a workspace'}</p>
                  <div className="flex items-center gap-2 text-sm text-muted">
                    as <RoleBadge role={inv.role} /> <span>· {ROLE_DESCRIPTIONS[inv.role]}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button disabled={busy !== null} onClick={() => void run(inv, 'accept')}>
                    Join workspace
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void run(inv, 'decline')}
                  >
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {workspaces.length > 0 && invites.length > 0 && (
          <p className="text-center text-sm">
            <Link
              to={`/w/${workspaces[0]!.id}`}
              className="text-primary underline underline-offset-2"
            >
              Skip for now
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}
