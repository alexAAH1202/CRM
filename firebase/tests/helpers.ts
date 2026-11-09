import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { resolveSentinels, type DocData, type WriteOp } from '@app/shared';
import {
  arrayRemove,
  arrayUnion,
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

/** Test personas. Emails are verified unless stated. */
export const U = {
  alice: { uid: 'alice', email: 'alice@example.com', role: 'admin' as const },
  bob: { uid: 'bob', email: 'bob@example.com', role: 'member' as const },
  carol: { uid: 'carol', email: 'carol@example.com', role: 'viewer' as const },
  dave: { uid: 'dave', email: 'dave@example.com' }, // signed in, not a member
  erin: { uid: 'erin', email: 'erin@example.com' }, // invited as member
  frank: { uid: 'frank', email: 'frank@example.com' }, // invited as admin
  creator: { uid: 'creator', email: 'creator@example.com' }, // on the creators allowlist
  mallory: { uid: 'mallory', email: 'erin@example.com' }, // unverified, claims erin's email
};

export type Persona = keyof typeof U;

export const WID = 'w1';
export const MAIN_BOARD = 'mainBoard';
export const PRIVATE_BOARD = 'privateBoard'; // memberIds: [bob]

export function db(env: RulesTestEnvironment, who: Persona | null): Firestore {
  if (who === null) return env.unauthenticatedContext().firestore() as unknown as Firestore;
  const p = U[who];
  return env
    .authenticatedContext(p.uid, { email: p.email, email_verified: who !== 'mallory' })
    .firestore() as unknown as Firestore;
}

const sdkSentinels = {
  serverTime: () => serverTimestamp(),
  arrayUnion: (...v: unknown[]) => arrayUnion(...v),
  arrayRemove: (...v: unknown[]) => arrayRemove(...v),
};

/** Executes planner ops exactly the way the web app does (one atomic batch). */
export function commitOps(fs: Firestore, ops: WriteOp[]): Promise<void> {
  const batch = writeBatch(fs);
  for (const op of ops) {
    const ref = doc(fs, op.path);
    if (op.kind === 'delete') batch.delete(ref);
    else if (op.kind === 'set') batch.set(ref, resolveSentinels(op.data, sdkSentinels) as DocData);
    else batch.update(ref, resolveSentinels(op.data, sdkSentinels) as DocData);
  }
  return batch.commit();
}

export function profile(who: Persona) {
  const p = U[who];
  return { uid: p.uid, email: p.email, displayName: who, photoURL: null };
}

const T0 = Timestamp.fromMillis(1_700_000_000_000);

export function memberData(who: 'alice' | 'bob' | 'carol') {
  const p = U[who];
  return {
    uid: p.uid,
    role: p.role,
    email: p.email,
    displayName: who,
    photoURL: null,
    joinedAt: T0,
  };
}

export function boardData(overrides: DocData = {}): DocData {
  return {
    name: 'Board',
    description: '',
    folderId: null,
    order: 'a0',
    visibility: 'main',
    memberIds: [],
    columns: [],
    groups: [],
    schemaVersion: 1,
    archived: false,
    createdBy: 'alice',
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function itemData(overrides: DocData = {}): DocData {
  return {
    name: 'Item',
    groupId: 'g1',
    order: 'a0',
    parentId: null,
    itemNumber: 1,
    values: {},
    assigneeUids: [],
    reminderKeys: [],
    archived: false,
    deletedAt: null,
    createdBy: 'alice',
    createdAt: T0,
    updatedBy: 'alice',
    updatedAt: T0,
    ...overrides,
  };
}

/** Seeds a workspace with admin/member/viewer, two invites, a main and a private board. */
export async function seed(env: RulesTestEnvironment): Promise<void> {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore() as unknown as Firestore;
    const w = `workspaces/${WID}`;
    await setDoc(doc(fs, 'appConfig/workspaceCreators'), {
      emails: [U.creator.email, U.alice.email],
    });
    await setDoc(doc(fs, w), {
      name: 'Team',
      createdBy: 'alice',
      createdAt: T0,
      adminUids: ['alice'],
      driveFolderId: null,
      settings: { capacityHoursPerWeek: 40, weekStart: 1, timezone: 'Australia/Melbourne' },
    });
    for (const who of ['alice', 'bob', 'carol'] as const) {
      await setDoc(doc(fs, `${w}/members/${U[who].uid}`), memberData(who));
    }
    await setDoc(doc(fs, `${w}/invites/${U.erin.email}`), {
      email: U.erin.email,
      role: 'member',
      workspaceName: 'Team',
      invitedBy: 'alice',
      createdAt: T0,
    });
    await setDoc(doc(fs, `${w}/invites/${U.frank.email}`), {
      email: U.frank.email,
      role: 'admin',
      workspaceName: 'Team',
      invitedBy: 'alice',
      createdAt: T0,
    });
    await setDoc(doc(fs, `${w}/boards/${MAIN_BOARD}`), boardData());
    await setDoc(
      doc(fs, `${w}/boards/${PRIVATE_BOARD}`),
      boardData({ name: 'Secret', visibility: 'private', memberIds: ['bob'], createdBy: 'bob' }),
    );
    for (const b of [MAIN_BOARD, PRIVATE_BOARD]) {
      await setDoc(doc(fs, `${w}/boards/${b}/items/i1`), itemData());
      await setDoc(doc(fs, `${w}/boards/${b}/meta/counter`), { next: 2 });
      await setDoc(doc(fs, `${w}/boards/${b}/views/v1`), {
        type: 'table',
        name: 'Main table',
        order: 'a0',
        config: {},
        createdBy: 'alice',
        updatedAt: T0,
      });
    }
    await setDoc(doc(fs, `${w}/notifications/bob/items/n1`), {
      type: 'mention',
      title: 'Hi',
      body: '',
      link: '',
      actor: 'alice',
      read: false,
      createdAt: T0,
    });
  });
}
