import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  LIMITS,
  planAcceptInvite,
  planDeclineInvite,
  planInvite,
  planRevokeInvite,
} from '@app/shared';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commitOps, db, profile, seed, U, WID } from './helpers';
import { createEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

const invite = (email: string, role: 'admin' | 'member' | 'viewer' = 'member', by = 'alice') =>
  planInvite({ wid: WID, email, role, invitedBy: by, workspaceName: 'Team' });

describe('invites: creating and managing', () => {
  it('admins invite with any role', async () => {
    await assertSucceeds(commitOps(db(env, 'alice'), invite('new@example.com', 'viewer')));
    await assertSucceeds(commitOps(db(env, 'alice'), invite('NEW2@Example.com', 'admin')));
  });

  it('members, viewers and outsiders cannot invite', async () => {
    await assertFails(commitOps(db(env, 'bob'), invite('new@example.com', 'member', 'bob')));
    await assertFails(commitOps(db(env, 'carol'), invite('new@example.com', 'viewer', 'carol')));
    await assertFails(commitOps(db(env, 'dave'), invite('dave2@example.com', 'admin', 'dave')));
  });

  it('rejects malformed invites', async () => {
    const fs = db(env, 'alice');
    const base = {
      email: 'x@example.com',
      role: 'member',
      workspaceName: 'Team',
      invitedBy: 'alice',
    };
    // id/email mismatch, uppercase id, bad role, spoofed inviter, not an email
    await assertFails(setDoc(doc(fs, `workspaces/${WID}/invites/y@example.com`), { ...base }));
    await assertFails(
      setDoc(doc(fs, `workspaces/${WID}/invites/X@example.com`), {
        ...base,
        email: 'X@example.com',
      }),
    );
    await assertFails(
      commitOps(fs, [
        { ...invite('x@example.com')[0]!, data: { ...base, role: 'owner' } } as never,
      ]),
    );
    await assertFails(commitOps(fs, invite('x@example.com', 'member', 'bob')));
    await assertFails(commitOps(fs, invite('not-an-email')));
  });

  it('admins can list, re-role and revoke invites', async () => {
    const fs = db(env, 'alice');
    const snap = await assertSucceeds(getDocs(collection(fs, `workspaces/${WID}/invites`)));
    expect(snap.size).toBe(2);
    await assertSucceeds(
      updateDoc(doc(fs, `workspaces/${WID}/invites/${U.erin.email}`), { role: 'viewer' }),
    );
    await assertSucceeds(commitOps(fs, planRevokeInvite({ wid: WID, email: U.erin.email })));
  });

  it('non-admin members cannot see the invite list', async () => {
    await assertFails(getDocs(collection(db(env, 'bob'), `workspaces/${WID}/invites`)));
    await assertFails(getDoc(doc(db(env, 'bob'), `workspaces/${WID}/invites/${U.erin.email}`)));
  });
});

describe('invites: discovery by the invitee', () => {
  it('the invitee finds their invites via a collection-group query', async () => {
    const snap = await assertSucceeds(
      getDocs(
        query(collectionGroup(db(env, 'erin'), 'invites'), where('email', '==', U.erin.email)),
      ),
    );
    expect(snap.size).toBe(1);
  });

  it("nobody can query someone else's invites", async () => {
    await assertFails(
      getDocs(
        query(collectionGroup(db(env, 'dave'), 'invites'), where('email', '==', U.erin.email)),
      ),
    );
    await assertFails(getDocs(collectionGroup(db(env, 'dave'), 'invites')));
  });

  it('an unverified account claiming the email cannot read it', async () => {
    await assertFails(getDoc(doc(db(env, 'mallory'), `workspaces/${WID}/invites/${U.erin.email}`)));
  });
});

describe('invites: accepting', () => {
  it('the invitee joins with the invited role and the invite is consumed', async () => {
    await assertSucceeds(
      commitOps(
        db(env, 'erin'),
        planAcceptInvite({ wid: WID, role: 'member', me: profile('erin') }),
      ),
    );
    await assertSucceeds(getDoc(doc(db(env, 'erin'), `workspaces/${WID}`)));
    const inv = await env.withSecurityRulesDisabled(async (ctx) => {
      const s = await getDoc(
        doc(ctx.firestore() as never, `workspaces/${WID}/invites/${U.erin.email}`),
      );
      expect(s.exists()).toBe(false);
    });
    void inv;
  });

  it('cannot accept with a higher role than invited', async () => {
    await assertFails(
      commitOps(
        db(env, 'erin'),
        planAcceptInvite({ wid: WID, role: 'admin', me: profile('erin') }),
      ),
    );
  });

  it('cannot upgrade a viewer invite to member', async () => {
    await commitOps(db(env, 'alice'), [
      {
        kind: 'update',
        path: `workspaces/${WID}/invites/${U.erin.email}`,
        data: { role: 'viewer' },
      },
    ]);
    await assertFails(
      commitOps(
        db(env, 'erin'),
        planAcceptInvite({ wid: WID, role: 'member', me: profile('erin') }),
      ),
    );
    await assertSucceeds(
      commitOps(
        db(env, 'erin'),
        planAcceptInvite({ wid: WID, role: 'viewer', me: profile('erin') }),
      ),
    );
  });

  it('cannot keep the invite around (replay)', async () => {
    const [memberOp] = planAcceptInvite({ wid: WID, role: 'member', me: profile('erin') });
    await assertFails(commitOps(db(env, 'erin'), [memberOp!]));
  });

  it('cannot accept twice / after revocation', async () => {
    await commitOps(db(env, 'alice'), planRevokeInvite({ wid: WID, email: U.erin.email }));
    await assertFails(
      commitOps(
        db(env, 'erin'),
        planAcceptInvite({ wid: WID, role: 'member', me: profile('erin') }),
      ),
    );
  });

  it("cannot use someone else's invite", async () => {
    const steal = planAcceptInvite({
      wid: WID,
      role: 'member',
      me: { ...profile('dave'), email: U.erin.email },
    });
    await assertFails(commitOps(db(env, 'dave'), steal));
  });

  it('unverified accounts cannot accept', async () => {
    const ops = planAcceptInvite({
      wid: WID,
      role: 'member',
      me: { ...profile('mallory'), email: U.erin.email },
    });
    await assertFails(commitOps(db(env, 'mallory'), ops));
  });

  it('an admin invite makes the invitee an admin (with adminUids)', async () => {
    await assertSucceeds(
      commitOps(
        db(env, 'frank'),
        planAcceptInvite({ wid: WID, role: 'admin', me: profile('frank') }),
      ),
    );
    await assertSucceeds(
      updateDoc(doc(db(env, 'frank'), `workspaces/${WID}`), { name: 'Frank was here' }),
    );
  });

  it('an admin invite cannot skip the adminUids update', async () => {
    const ops = planAcceptInvite({ wid: WID, role: 'admin', me: profile('frank') }).slice(0, 2);
    await assertFails(commitOps(db(env, 'frank'), ops));
  });

  it('a member invite cannot sneak into adminUids', async () => {
    const ops = [
      ...planAcceptInvite({ wid: WID, role: 'member', me: profile('erin') }),
      ...planAcceptInvite({ wid: WID, role: 'admin', me: profile('erin') }).slice(2),
    ];
    await assertFails(commitOps(db(env, 'erin'), ops));
  });

  it('the invitee can decline', async () => {
    await assertSucceeds(
      commitOps(db(env, 'erin'), planDeclineInvite({ wid: WID, email: U.erin.email })),
    );
  });

  it('rule caps mirror shared constants', () => {
    expect(LIMITS.MAX_WORKSPACE_NAME_LENGTH).toBe(80);
    expect(LIMITS.MAX_EMAIL_LENGTH).toBe(254);
  });
});
