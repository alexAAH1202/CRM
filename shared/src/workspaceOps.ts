import { paths } from './paths';
import { arrayRemove, arrayUnion, SERVER_TIME, type WriteOp } from './ops';
import type { Role } from './roles';
import { normalizeEmail } from './validation';

export interface Profile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
}

export const DEFAULT_WORKSPACE_SETTINGS = {
  capacityHoursPerWeek: 40,
  weekStart: 1 as const,
  timezone: 'Australia/Melbourne',
};

function memberDoc(profile: Profile, role: Role) {
  return {
    uid: profile.uid,
    role,
    email: normalizeEmail(profile.email),
    displayName: profile.displayName,
    photoURL: profile.photoURL,
    joinedAt: SERVER_TIME,
  };
}

/** Creates a workspace with the creator as its first Admin (one batch). */
export function planCreateWorkspace(input: {
  wid: string;
  name: string;
  creator: Profile;
  timezone?: string;
}): WriteOp[] {
  const { wid, name, creator } = input;
  return [
    {
      kind: 'set',
      path: paths.workspace(wid),
      data: {
        name: name.trim(),
        createdBy: creator.uid,
        createdAt: SERVER_TIME,
        adminUids: [creator.uid],
        driveFolderId: null,
        settings: {
          ...DEFAULT_WORKSPACE_SETTINGS,
          timezone: input.timezone ?? DEFAULT_WORKSPACE_SETTINGS.timezone,
        },
      },
    },
    { kind: 'set', path: paths.member(wid, creator.uid), data: memberDoc(creator, 'admin') },
  ];
}

export function planInvite(input: {
  wid: string;
  email: string;
  role: Role;
  invitedBy: string;
  workspaceName: string;
}): WriteOp[] {
  const email = normalizeEmail(input.email);
  return [
    {
      kind: 'set',
      path: paths.invite(input.wid, email),
      data: {
        email,
        role: input.role,
        workspaceName: input.workspaceName,
        invitedBy: input.invitedBy,
        createdAt: SERVER_TIME,
      },
    },
  ];
}

export function planRevokeInvite(input: { wid: string; email: string }): WriteOp[] {
  return [{ kind: 'delete', path: paths.invite(input.wid, normalizeEmail(input.email)) }];
}

/**
 * Accept: create my member doc with the invited role and delete the invite,
 * atomically. Admin invites also add me to workspace.adminUids.
 */
export function planAcceptInvite(input: { wid: string; role: Role; me: Profile }): WriteOp[] {
  const { wid, role, me } = input;
  const ops: WriteOp[] = [
    { kind: 'set', path: paths.member(wid, me.uid), data: memberDoc(me, role) },
    { kind: 'delete', path: paths.invite(wid, normalizeEmail(me.email)) },
  ];
  if (role === 'admin') {
    ops.push({
      kind: 'update',
      path: paths.workspace(wid),
      data: { adminUids: arrayUnion(me.uid) },
    });
  }
  return ops;
}

export function planDeclineInvite(input: { wid: string; email: string }): WriteOp[] {
  return planRevokeInvite(input);
}

/** Changes a member's role, keeping workspace.adminUids in sync. */
export function planChangeRole(input: {
  wid: string;
  uid: string;
  from: Role;
  to: Role;
}): WriteOp[] {
  const { wid, uid, from, to } = input;
  if (from === to) return [];
  const ops: WriteOp[] = [{ kind: 'update', path: paths.member(wid, uid), data: { role: to } }];
  if (to === 'admin') {
    ops.push({ kind: 'update', path: paths.workspace(wid), data: { adminUids: arrayUnion(uid) } });
  } else if (from === 'admin') {
    ops.push({ kind: 'update', path: paths.workspace(wid), data: { adminUids: arrayRemove(uid) } });
  }
  return ops;
}

/** Removes a member (or leaves, when uid is the caller), keeping adminUids in sync. */
export function planRemoveMember(input: { wid: string; uid: string; role: Role }): WriteOp[] {
  const ops: WriteOp[] = [{ kind: 'delete', path: paths.member(input.wid, input.uid) }];
  if (input.role === 'admin') {
    ops.push({
      kind: 'update',
      path: paths.workspace(input.wid),
      data: { adminUids: arrayRemove(input.uid) },
    });
  }
  return ops;
}

/** UI guard mirroring the rules: the last Admin can't be demoted or removed. */
export function isLastAdmin(adminUids: readonly string[], uid: string): boolean {
  return adminUids.length === 1 && adminUids[0] === uid;
}
