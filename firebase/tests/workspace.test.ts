import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { planCreateWorkspace } from '@app/shared';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { commitOps, db, profile, U, WID } from './helpers';
import { seed } from './helpers';
import { createEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

describe('users/{uid}', () => {
  const data = {
    displayName: 'Dave',
    email: 'dave@example.com',
    photoURL: null,
    lastWorkspaceId: null,
    settings: {},
  };
  it('owner can create, read and update their own doc', async () => {
    const fs = db(env, 'dave');
    await assertSucceeds(setDoc(doc(fs, 'users/dave'), data));
    await assertSucceeds(getDoc(doc(fs, 'users/dave')));
    await assertSucceeds(updateDoc(doc(fs, 'users/dave'), { lastWorkspaceId: WID }));
  });
  it('nobody else can read or write it', async () => {
    await assertSucceeds(setDoc(doc(db(env, 'dave'), 'users/dave'), data));
    await assertFails(getDoc(doc(db(env, 'alice'), 'users/dave')));
    await assertFails(setDoc(doc(db(env, 'alice'), 'users/dave'), data));
    await assertFails(getDoc(doc(db(env, null), 'users/dave')));
  });
  it('rejects unknown fields', async () => {
    await assertFails(setDoc(doc(db(env, 'dave'), 'users/dave'), { ...data, role: 'admin' }));
  });
});

describe('appConfig/workspaceCreators', () => {
  it('allowlisted users can read it; others cannot; nobody can write', async () => {
    await assertSucceeds(getDoc(doc(db(env, 'creator'), 'appConfig/workspaceCreators')));
    await assertFails(getDoc(doc(db(env, 'dave'), 'appConfig/workspaceCreators')));
    await assertFails(getDoc(doc(db(env, null), 'appConfig/workspaceCreators')));
    await assertFails(
      setDoc(doc(db(env, 'creator'), 'appConfig/workspaceCreators'), { emails: ['x@y.z'] }),
    );
    await assertFails(setDoc(doc(db(env, 'dave'), 'appConfig/other'), { a: 1 }));
  });
});

describe('workspace creation', () => {
  it('an allowlisted, verified user creates a workspace as its first admin', async () => {
    const ops = planCreateWorkspace({ wid: 'new', name: 'New team', creator: profile('creator') });
    await assertSucceeds(commitOps(db(env, 'creator'), ops));
    await assertSucceeds(getDoc(doc(db(env, 'creator'), 'workspaces/new')));
  });

  it('a user not on the allowlist cannot', async () => {
    const ops = planCreateWorkspace({ wid: 'new', name: 'New team', creator: profile('dave') });
    await assertFails(commitOps(db(env, 'dave'), ops));
  });

  it('cannot create the workspace without the matching admin member doc', async () => {
    const [ws] = planCreateWorkspace({ wid: 'new', name: 'X', creator: profile('creator') });
    await assertFails(commitOps(db(env, 'creator'), [ws!]));
  });

  it('cannot seed extra admins or a foreign creator', async () => {
    const ops = planCreateWorkspace({ wid: 'new', name: 'X', creator: profile('creator') });
    const tampered = ops.map((o) =>
      o.kind === 'set' && o.path === 'workspaces/new'
        ? { ...o, data: { ...o.data, adminUids: ['creator', 'dave'] } }
        : o,
    );
    await assertFails(commitOps(db(env, 'creator'), tampered));
    const foreign = ops.map((o) =>
      o.kind === 'set' && o.path === 'workspaces/new'
        ? { ...o, data: { ...o.data, createdBy: 'dave' } }
        : o,
    );
    await assertFails(commitOps(db(env, 'creator'), foreign));
  });

  it('cannot hijack an existing workspace via the bootstrap path', async () => {
    const ops = planCreateWorkspace({ wid: WID, name: 'Mine now', creator: profile('creator') });
    await assertFails(commitOps(db(env, 'creator'), ops));
    await assertFails(commitOps(db(env, 'creator'), ops.slice(1)));
  });

  it('cannot set driveFolderId from the client', async () => {
    const ops = planCreateWorkspace({ wid: 'new', name: 'X', creator: profile('creator') });
    const tampered = ops.map((o) =>
      o.kind === 'set' && o.path === 'workspaces/new'
        ? { ...o, data: { ...o.data, driveFolderId: 'abc' } }
        : o,
    );
    await assertFails(commitOps(db(env, 'creator'), tampered));
  });
});

describe('workspaces/{wid}', () => {
  const ws = (who: Parameters<typeof db>[1]) => doc(db(env, who), `workspaces/${WID}`);

  it('all members can read; outsiders and anonymous cannot', async () => {
    for (const who of ['alice', 'bob', 'carol'] as const) await assertSucceeds(getDoc(ws(who)));
    await assertFails(getDoc(ws('dave')));
    await assertFails(getDoc(ws(null)));
  });

  it('only admins can rename or change settings', async () => {
    await assertSucceeds(updateDoc(ws('alice'), { name: 'Renamed' }));
    await assertSucceeds(updateDoc(ws('alice'), { 'settings.capacityHoursPerWeek': 32 }));
    await assertFails(updateDoc(ws('bob'), { name: 'Nope' }));
    await assertFails(updateDoc(ws('carol'), { name: 'Nope' }));
    await assertFails(updateDoc(ws('dave'), { name: 'Nope' }));
  });

  it('validates settings and protected fields', async () => {
    await assertFails(updateDoc(ws('alice'), { 'settings.capacityHoursPerWeek': 500 }));
    await assertFails(updateDoc(ws('alice'), { 'settings.weekStart': 3 }));
    await assertFails(updateDoc(ws('alice'), { createdBy: 'bob' }));
    await assertFails(updateDoc(ws('alice'), { driveFolderId: 'x' }));
    await assertFails(updateDoc(ws('alice'), { name: '' }));
  });

  it('adminUids cannot be edited without the matching member role', async () => {
    await assertFails(updateDoc(ws('alice'), { adminUids: ['alice', 'bob'] }));
    await assertFails(updateDoc(ws('alice'), { adminUids: [] }));
  });

  it('nobody can delete a workspace from the client', async () => {
    await assertFails(deleteDoc(ws('alice')));
  });

  it('the creator allowlist email check is case-insensitive', async () => {
    const fs = env
      .authenticatedContext('creator', {
        email: U.creator.email.toUpperCase(),
        email_verified: true,
      })
      .firestore();
    const ops = planCreateWorkspace({ wid: 'new2', name: 'Caps', creator: profile('creator') });
    await assertSucceeds(commitOps(fs as never, ops));
  });
});
