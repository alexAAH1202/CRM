import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { planChangeRole, planRemoveMember } from '@app/shared';
import {
  arrayUnion,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { commitOps, db, seed, WID } from './helpers';
import { createEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

const m = (uid: string) => `workspaces/${WID}/members/${uid}`;

describe('members: reading', () => {
  it('members (any role) can list members; outsiders cannot', async () => {
    for (const who of ['alice', 'bob', 'carol'] as const) {
      await assertSucceeds(getDocs(collection(db(env, who), `workspaces/${WID}/members`)));
    }
    await assertFails(getDocs(collection(db(env, 'dave'), `workspaces/${WID}/members`)));
    await assertFails(getDoc(doc(db(env, null), m('alice'))));
  });

  it('"my workspaces" collection-group query works only for my own uid', async () => {
    await assertSucceeds(
      getDocs(query(collectionGroup(db(env, 'bob'), 'members'), where('uid', '==', 'bob'))),
    );
    await assertSucceeds(
      getDocs(query(collectionGroup(db(env, 'dave'), 'members'), where('uid', '==', 'dave'))),
    );
    await assertFails(
      getDocs(query(collectionGroup(db(env, 'dave'), 'members'), where('uid', '==', 'alice'))),
    );
    await assertFails(getDocs(collectionGroup(db(env, 'dave'), 'members')));
  });
});

describe('members: role changes', () => {
  it('admin changes member <-> viewer', async () => {
    await assertSucceeds(
      commitOps(
        db(env, 'alice'),
        planChangeRole({ wid: WID, uid: 'bob', from: 'member', to: 'viewer' }),
      ),
    );
    await assertSucceeds(
      commitOps(
        db(env, 'alice'),
        planChangeRole({ wid: WID, uid: 'carol', from: 'viewer', to: 'member' }),
      ),
    );
  });

  it('admin promotes to admin only together with adminUids', async () => {
    await assertFails(updateDoc(doc(db(env, 'alice'), m('bob')), { role: 'admin' }));
    await assertSucceeds(
      commitOps(
        db(env, 'alice'),
        planChangeRole({ wid: WID, uid: 'bob', from: 'member', to: 'admin' }),
      ),
    );
  });

  it('admin demotes another admin only together with adminUids', async () => {
    await commitOps(
      db(env, 'alice'),
      planChangeRole({ wid: WID, uid: 'bob', from: 'member', to: 'admin' }),
    );
    await assertFails(updateDoc(doc(db(env, 'alice'), m('bob')), { role: 'member' }));
    await assertSucceeds(
      commitOps(
        db(env, 'alice'),
        planChangeRole({ wid: WID, uid: 'bob', from: 'admin', to: 'member' }),
      ),
    );
  });

  it('the last admin cannot demote themselves', async () => {
    await assertFails(
      commitOps(
        db(env, 'alice'),
        planChangeRole({ wid: WID, uid: 'alice', from: 'admin', to: 'member' }),
      ),
    );
  });

  it('an admin can step down when another admin remains', async () => {
    await commitOps(
      db(env, 'alice'),
      planChangeRole({ wid: WID, uid: 'bob', from: 'member', to: 'admin' }),
    );
    await assertSucceeds(
      commitOps(
        db(env, 'alice'),
        planChangeRole({ wid: WID, uid: 'alice', from: 'admin', to: 'member' }),
      ),
    );
  });

  it('members and viewers cannot change roles (including their own)', async () => {
    await assertFails(
      commitOps(
        db(env, 'bob'),
        planChangeRole({ wid: WID, uid: 'carol', from: 'viewer', to: 'member' }),
      ),
    );
    await assertFails(
      commitOps(
        db(env, 'bob'),
        planChangeRole({ wid: WID, uid: 'bob', from: 'member', to: 'admin' }),
      ),
    );
    await assertFails(updateDoc(doc(db(env, 'carol'), m('carol')), { role: 'member' }));
    await assertFails(
      updateDoc(doc(db(env, 'bob'), `workspaces/${WID}`), { adminUids: arrayUnion('bob') }),
    );
  });

  it('rejects invalid roles and other field edits by admins', async () => {
    await assertFails(updateDoc(doc(db(env, 'alice'), m('bob')), { role: 'owner' }));
    await assertFails(updateDoc(doc(db(env, 'alice'), m('bob')), { email: 'x@y.z' }));
  });

  it('a member may update only their own display name / photo', async () => {
    await assertSucceeds(updateDoc(doc(db(env, 'bob'), m('bob')), { displayName: 'Robert' }));
    await assertFails(updateDoc(doc(db(env, 'bob'), m('carol')), { displayName: 'X' }));
    await assertFails(updateDoc(doc(db(env, 'bob'), m('bob')), { uid: 'zz' }));
  });
});

describe('members: removal and leaving', () => {
  it('admin removes a member or viewer', async () => {
    await assertSucceeds(
      commitOps(db(env, 'alice'), planRemoveMember({ wid: WID, uid: 'bob', role: 'member' })),
    );
    await assertSucceeds(
      commitOps(db(env, 'alice'), planRemoveMember({ wid: WID, uid: 'carol', role: 'viewer' })),
    );
  });

  it('admin removes another admin only together with adminUids', async () => {
    await commitOps(
      db(env, 'alice'),
      planChangeRole({ wid: WID, uid: 'bob', from: 'member', to: 'admin' }),
    );
    await assertFails(commitOps(db(env, 'alice'), [{ kind: 'delete', path: m('bob') }]));
    await assertSucceeds(
      commitOps(db(env, 'alice'), planRemoveMember({ wid: WID, uid: 'bob', role: 'admin' })),
    );
  });

  it('the last admin cannot leave', async () => {
    await assertFails(
      commitOps(db(env, 'alice'), planRemoveMember({ wid: WID, uid: 'alice', role: 'admin' })),
    );
    await assertFails(commitOps(db(env, 'alice'), [{ kind: 'delete', path: m('alice') }]));
  });

  it('members and viewers can leave, but cannot remove others', async () => {
    await assertFails(
      commitOps(db(env, 'bob'), planRemoveMember({ wid: WID, uid: 'carol', role: 'viewer' })),
    );
    await assertSucceeds(
      commitOps(db(env, 'bob'), planRemoveMember({ wid: WID, uid: 'bob', role: 'member' })),
    );
    await assertSucceeds(
      commitOps(db(env, 'carol'), planRemoveMember({ wid: WID, uid: 'carol', role: 'viewer' })),
    );
  });

  it('a removed member loses access immediately', async () => {
    await commitOps(db(env, 'alice'), planRemoveMember({ wid: WID, uid: 'bob', role: 'member' }));
    await assertFails(getDoc(doc(db(env, 'bob'), `workspaces/${WID}`)));
  });
});
