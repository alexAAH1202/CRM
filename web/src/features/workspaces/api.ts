import { requestFolderSync } from '../files/upload';
import {
  isRole,
  normalizeEmail,
  paths,
  planAcceptInvite,
  planChangeRole,
  planCreateWorkspace,
  planDeclineInvite,
  planInvite,
  planRemoveMember,
  planRevokeInvite,
  type Profile,
  type Role,
} from '@app/shared';
import type { User } from 'firebase/auth';
import { collection, collectionGroup, doc, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { commitOps, readDoc, readQuery } from '../../lib/firestore';
import { isPermissionDenied } from '../../lib/firestore/errors';

export interface MyWorkspace {
  id: string;
  name: string;
  role: Role;
}

export interface MyInvite {
  workspaceId: string;
  workspaceName: string;
  role: Role;
  email: string;
}

export function profileOf(user: User): Profile {
  return {
    uid: user.uid,
    email: normalizeEmail(user.email ?? ''),
    displayName: user.displayName ?? user.email ?? 'Unknown',
    photoURL: user.photoURL,
  };
}

/** Workspaces I belong to: 1 collection-group query + 1 read per workspace. */
export async function loadMyWorkspaces(uid: string): Promise<MyWorkspace[]> {
  const snap = await readQuery(
    'members:mine',
    query(collectionGroup(db, 'members'), where('uid', '==', uid)),
  );
  const out = await Promise.all(
    snap.docs.map(async (m) => {
      const wsRef = m.ref.parent.parent;
      const role = m.data()['role'];
      if (!wsRef || !isRole(role)) return null;
      try {
        const ws = await readDoc('workspace:name', doc(db, wsRef.path));
        return { id: wsRef.id, name: String(ws.data()?.['name'] ?? 'Household'), role };
      } catch {
        return null;
      }
    }),
  );
  return out
    .filter((w): w is MyWorkspace => w !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadMyInvites(email: string): Promise<MyInvite[]> {
  if (!email) return [];
  const snap = await readQuery(
    'invites:mine',
    query(collectionGroup(db, 'invites'), where('email', '==', normalizeEmail(email))),
  );
  return snap.docs.flatMap((d) => {
    const data = d.data();
    const wid = d.ref.parent.parent?.id;
    const role = data['role'];
    if (!wid || !isRole(role)) return [];
    return [
      { workspaceId: wid, workspaceName: String(data['workspaceName'] ?? ''), role, email: d.id },
    ];
  });
}

/** True when my email is on appConfig/workspaceCreators (rules deny the read otherwise). */
export async function checkCanCreateWorkspace(): Promise<boolean> {
  try {
    const snap = await readDoc('appConfig:creators', doc(db, paths.workspaceCreators()));
    return snap.exists();
  } catch (err) {
    if (isPermissionDenied(err)) return false;
    throw err;
  }
}

export async function createWorkspace(user: User, name: string): Promise<string> {
  const wid = doc(collection(db, 'workspaces')).id;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await commitOps(
    'workspace:create',
    planCreateWorkspace({ wid, name, creator: profileOf(user), ...(timezone ? { timezone } : {}) }),
  );
  return wid;
}

export function acceptInvite(user: User, invite: MyInvite) {
  return commitOps(
    'invite:accept',
    planAcceptInvite({ wid: invite.workspaceId, role: invite.role, me: profileOf(user) }),
  ).then(() => requestFolderSync(invite.workspaceId)); // so the new member can open files
}

export function declineInvite(invite: MyInvite) {
  return commitOps(
    'invite:decline',
    planDeclineInvite({ wid: invite.workspaceId, email: invite.email }),
  );
}

export function inviteMember(input: {
  wid: string;
  email: string;
  role: Role;
  invitedBy: string;
  workspaceName: string;
}) {
  return commitOps('invite:create', planInvite(input));
}

export function revokeInvite(wid: string, email: string) {
  return commitOps('invite:revoke', planRevokeInvite({ wid, email }));
}

export function changeInviteRole(wid: string, email: string, role: Role) {
  return commitOps('invite:role', [
    { kind: 'update', path: paths.invite(wid, email), data: { role } },
  ]);
}

export function changeRole(wid: string, uid: string, from: Role, to: Role) {
  return commitOps('member:role', planChangeRole({ wid, uid, from, to }));
}

export function removeMember(wid: string, uid: string, role: Role) {
  // Forced: access must end now, even if Drive was synced a moment ago.
  return commitOps('member:remove', planRemoveMember({ wid, uid, role })).then(() =>
    requestFolderSync(wid, true),
  );
}

export function rememberLastWorkspace(uid: string, wid: string) {
  return commitOps('users:lastWorkspace', [
    { kind: 'update', path: paths.user(uid), data: { lastWorkspaceId: wid } },
  ]);
}

export async function readLastWorkspaceId(uid: string): Promise<string | null> {
  const snap = await readDoc('users:self', doc(db, paths.user(uid)));
  const v = snap.data()?.['lastWorkspaceId'];
  return typeof v === 'string' ? v : null;
}
