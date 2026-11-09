import { zodResolver } from '@hookform/resolvers/zod';
import {
  inviteFormSchema,
  isLastAdmin,
  isRole,
  paths,
  ROLES,
  type InviteForm,
  type Role,
} from '@app/shared';
import { collection } from 'firebase/firestore';
import { Copy, LogOut, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RoleBadge, ROLE_DESCRIPTIONS, roleLabel } from '../components/RoleBadge';
import { Avatar, Button, SelectField, Skeleton, TextField } from '../components/ui';
import { useCurrentUser } from '../features/auth/AuthProvider';
import {
  changeInviteRole,
  changeRole,
  inviteMember,
  removeMember,
  revokeInvite,
} from '../features/workspaces/api';
import { useSessionStore } from '../features/workspaces/sessionStore';
import { useWorkspace } from '../features/workspaces/WorkspaceProvider';
import { db } from '../lib/firebase';
import { listenQuery } from '../lib/firestore';
import { friendlyError } from '../lib/firestore/errors';
import { toast } from '../stores/toast';

interface MemberRow {
  uid: string;
  role: Role;
  email: string;
  displayName: string;
  photoURL: string | null;
}

interface InviteRow {
  email: string;
  role: Role;
}

/** Live list of a collection, only while this page is open. */
function useLiveList<T>(
  label: string,
  path: string | null,
  map: (id: string, d: Record<string, unknown>) => T | null,
) {
  const [rows, setRows] = useState<T[] | null>(null);
  useEffect(() => {
    if (!path) {
      setRows([]);
      return;
    }
    return listenQuery(label, collection(db, path), (snap) =>
      setRows(snap.docs.map((d) => map(d.id, d.data())).filter((r): r is T => r !== null)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map is a stable module-level function
  }, [label, path]);
  return rows;
}

const toMember = (id: string, d: Record<string, unknown>): MemberRow | null =>
  isRole(d['role'])
    ? {
        uid: id,
        role: d['role'],
        email: String(d['email'] ?? ''),
        displayName: String(d['displayName'] ?? ''),
        photoURL: typeof d['photoURL'] === 'string' ? d['photoURL'] : null,
      }
    : null;

const toInvite = (id: string, d: Record<string, unknown>): InviteRow | null =>
  isRole(d['role']) ? { email: id, role: d['role'] } : null;

function inviteMessage(email: string, workspaceName: string): string {
  return (
    `You're invited to join "${workspaceName}". ` +
    `Open ${window.location.origin} and sign in with Google as ${email}.`
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  } catch {
    toast.error('Could not copy — select and copy the text manually.');
  }
}

function InvitePanel({ members, invites }: { members: MemberRow[]; invites: InviteRow[] }) {
  const user = useCurrentUser();
  const { workspace } = useWorkspace();
  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { email: '', role: 'member' },
  });

  const onSubmit = form.handleSubmit(async ({ email, role }) => {
    if (members.some((m) => m.email === email)) {
      form.setError('email', { message: 'Already a member of this workspace' });
      return;
    }
    // Clear immediately: Firestore shows the invite optimistically, and waiting for
    // the server ack before resetting would wipe whatever the admin types next.
    form.reset({ email: '', role });
    try {
      await inviteMember({
        wid: workspace.id,
        email,
        role,
        invitedBy: user.uid,
        workspaceName: workspace.name,
      });
      toast.success(`Invite created for ${email}. Let them know to sign in.`);
    } catch (err) {
      toast.error(`Couldn't invite ${email}: ${friendlyError(err)}`);
    }
  });

  return (
    <section aria-labelledby="invite-h" className="space-y-4 rounded-3xl bg-surface p-5 shadow-sm">
      <h2 id="invite-h" className="flex items-center gap-2 text-lg font-bold">
        <UserPlus size={20} aria-hidden /> Invite people
      </h2>
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
      >
        <TextField
          label="Email"
          type="email"
          placeholder="name@example.com"
          autoComplete="off"
          className="flex-1"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <SelectField label="Role" className="sm:w-36" {...form.register('role')}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </SelectField>
        <Button type="submit" className="sm:mt-7">
          Send invite
        </Button>
      </form>
      <p className="text-sm text-muted">
        They join by signing in with Google using that exact email address. Email notifications
        arrive in a later phase — for now, use “Copy message” to send them the link.
      </p>

      {invites.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-muted">Pending invitations</h3>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {invites.map((inv) => (
              <li key={inv.email} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{inv.email}</span>
                <SelectField
                  label={`Role for ${inv.email}`}
                  hideLabel
                  className="w-32"
                  value={inv.role}
                  onChange={(e) =>
                    changeInviteRole(workspace.id, inv.email, e.target.value as Role).catch(
                      (err: unknown) => toast.error(friendlyError(err)),
                    )
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </SelectField>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void copy(inviteMessage(inv.email, workspace.name))}
                >
                  <Copy size={14} aria-hidden /> Copy message
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Revoke invite for ${inv.email}`}
                  onClick={() =>
                    revokeInvite(workspace.id, inv.email).catch((err: unknown) =>
                      toast.error(friendlyError(err)),
                    )
                  }
                >
                  <Trash2 size={14} aria-hidden /> Revoke
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

type PendingAction = { kind: 'remove' | 'leave'; member: MemberRow } | null;

export default function MembersPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const { workspace, role: myRole } = useWorkspace();
  const refreshSession = useSessionStore((s) => s.refresh);
  const isAdmin = myRole === 'admin';
  const members = useLiveList('members', paths.members(workspace.id), toMember);
  const invites = useLiveList('invites', isAdmin ? paths.invites(workspace.id) : null, toInvite);
  const [pending, setPending] = useState<PendingAction>(null);

  const sorted = useMemo(
    () =>
      [...(members ?? [])].sort(
        (a, b) =>
          ROLES.indexOf(a.role) - ROLES.indexOf(b.role) ||
          (a.displayName || a.email).localeCompare(b.displayName || b.email),
      ),
    [members],
  );

  async function onRoleChange(m: MemberRow, to: Role) {
    try {
      await changeRole(workspace.id, m.uid, m.role, to);
      toast.success(`${m.displayName || m.email} is now ${roleLabel(to).toLowerCase()}`);
    } catch (err) {
      toast.error(friendlyError(err));
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-extrabold">Members</h1>
        {members && <span className="text-sm text-muted">{members.length} in this workspace</span>}
      </header>

      {isAdmin && members && invites && <InvitePanel members={members} invites={invites} />}

      <section aria-label="Workspace members" className="rounded-3xl bg-surface shadow-sm">
        {!members ? (
          <div className="space-y-3 p-5" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {sorted.map((m) => {
              const isMe = m.uid === user.uid;
              const lastAdmin = m.role === 'admin' && isLastAdmin(workspace.adminUids, m.uid);
              const name = m.displayName || m.email;
              return (
                <li key={m.uid} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Avatar name={name} photoURL={m.photoURL} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {name}
                      {isMe && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
                    </p>
                    <p className="truncate text-xs text-muted">{m.email}</p>
                  </div>
                  {isAdmin ? (
                    <SelectField
                      label={`Role for ${name}`}
                      hideLabel
                      className="w-32"
                      value={m.role}
                      disabled={lastAdmin}
                      title={
                        lastAdmin
                          ? 'A workspace needs at least one admin'
                          : ROLE_DESCRIPTIONS[m.role]
                      }
                      onChange={(e) => void onRoleChange(m, e.target.value as Role)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </SelectField>
                  ) : (
                    <RoleBadge role={m.role} />
                  )}
                  {isMe ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={lastAdmin}
                      title={lastAdmin ? 'Make someone else an admin before leaving' : undefined}
                      onClick={() => setPending({ kind: 'leave', member: m })}
                    >
                      <LogOut size={14} aria-hidden /> Leave
                    </Button>
                  ) : (
                    isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={lastAdmin}
                        aria-label={`Remove ${name}`}
                        onClick={() => setPending({ kind: 'remove', member: m })}
                      >
                        <Trash2 size={14} aria-hidden /> Remove
                      </Button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {isAdmin && workspace.adminUids.length === 1 && (
        <p className="text-sm text-muted">
          Tip: make a second person an admin so the workspace is never locked if one account is
          lost.
        </p>
      )}

      <ConfirmDialog
        open={pending !== null}
        danger
        title={pending?.kind === 'leave' ? `Leave ${workspace.name}?` : 'Remove member?'}
        confirmLabel={pending?.kind === 'leave' ? 'Leave workspace' : 'Remove'}
        body={
          pending?.kind === 'leave'
            ? "You'll lose access immediately. An admin can invite you again."
            : `${pending?.member.displayName || pending?.member.email} will lose access immediately.`
        }
        onClose={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          try {
            await removeMember(workspace.id, pending.member.uid, pending.member.role);
            if (pending.kind === 'leave') {
              await refreshSession(user);
              navigate('/', { replace: true });
            }
          } catch (err) {
            toast.error(friendlyError(err));
          }
        }}
      />
    </div>
  );
}
