import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  boardData,
  db,
  itemData,
  MAIN_BOARD,
  PRIVATE_BOARD,
  seed,
  WID,
  type Persona,
} from './helpers';
import { createEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

const B = `workspaces/${WID}/boards`;
const now = () => serverTimestamp();

function newBoard(uid: string, extra: Record<string, unknown> = {}) {
  return boardData({ createdBy: uid, createdAt: now(), updatedAt: now(), ...extra });
}
function newItem(uid: string, extra: Record<string, unknown> = {}) {
  return itemData({ createdBy: uid, updatedBy: uid, createdAt: now(), updatedAt: now(), ...extra });
}

describe('boards: visibility (main vs private; admins see all, D2)', () => {
  const cases: Array<[Persona, boolean, boolean]> = [
    // persona, can read main, can read private (memberIds: [bob])
    ['alice', true, true],
    ['bob', true, true],
    ['carol', true, false],
    ['dave', false, false],
  ];
  it.each(cases)('%s: main=%s private=%s', async (who, main, priv) => {
    const fs = db(env, who);
    await (main ? assertSucceeds : assertFails)(getDoc(doc(fs, `${B}/${MAIN_BOARD}`)));
    await (priv ? assertSucceeds : assertFails)(getDoc(doc(fs, `${B}/${PRIVATE_BOARD}`)));
    await (priv ? assertSucceeds : assertFails)(getDoc(doc(fs, `${B}/${PRIVATE_BOARD}/items/i1`)));
    await (priv ? assertSucceeds : assertFails)(getDoc(doc(fs, `${B}/${PRIVATE_BOARD}/views/v1`)));
  });

  it('sidebar queries: non-admins must constrain to main or memberIds', async () => {
    const carol = db(env, 'carol');
    await assertFails(getDocs(collection(carol, B)));
    const main = await assertSucceeds(
      getDocs(query(collection(carol, B), where('visibility', '==', 'main'))),
    );
    expect(main.size).toBe(1);
    const mine = await assertSucceeds(
      getDocs(query(collection(carol, B), where('memberIds', 'array-contains', 'carol'))),
    );
    expect(mine.size).toBe(0);
    const bobs = await assertSucceeds(
      getDocs(query(collection(db(env, 'bob'), B), where('memberIds', 'array-contains', 'bob'))),
    );
    expect(bobs.size).toBe(1);
    const all = await assertSucceeds(getDocs(collection(db(env, 'alice'), B)));
    expect(all.size).toBe(2);
  });

  it('items of a private board cannot be listed by non-members', async () => {
    await assertFails(getDocs(collection(db(env, 'carol'), `${B}/${PRIVATE_BOARD}/items`)));
    await assertSucceeds(getDocs(collection(db(env, 'carol'), `${B}/${MAIN_BOARD}/items`)));
  });
});

describe('boards: writing', () => {
  it('admins and members create boards; viewers and outsiders cannot', async () => {
    await assertSucceeds(setDoc(doc(db(env, 'alice'), `${B}/b2`), newBoard('alice')));
    await assertSucceeds(setDoc(doc(db(env, 'bob'), `${B}/b3`), newBoard('bob')));
    await assertFails(setDoc(doc(db(env, 'carol'), `${B}/b4`), newBoard('carol')));
    await assertFails(setDoc(doc(db(env, 'dave'), `${B}/b5`), newBoard('dave')));
  });

  it('validates board docs', async () => {
    const fs = db(env, 'bob');
    await assertFails(setDoc(doc(fs, `${B}/x`), newBoard('alice'))); // spoofed creator
    await assertFails(setDoc(doc(fs, `${B}/x`), newBoard('bob', { visibility: 'secret' })));
    await assertFails(setDoc(doc(fs, `${B}/x`), newBoard('bob', { name: '' })));
    await assertFails(setDoc(doc(fs, `${B}/x`), newBoard('bob', { extra: 1 })));
    await assertFails(setDoc(doc(fs, `${B}/x`), newBoard('bob', { updatedAt: new Date() })));
    // a private board must include its creator
    await assertFails(
      setDoc(doc(fs, `${B}/x`), newBoard('bob', { visibility: 'private', memberIds: ['carol'] })),
    );
    await assertSucceeds(
      setDoc(doc(fs, `${B}/x`), newBoard('bob', { visibility: 'private', memberIds: ['bob'] })),
    );
  });

  it('only creator or admin can change who sees a board', async () => {
    const upd = { visibility: 'private', memberIds: ['bob'], updatedAt: now() };
    await setDoc(doc(db(env, 'alice'), `${B}/b2`), newBoard('alice'));
    await assertFails(updateDoc(doc(db(env, 'bob'), `${B}/b2`), upd));
    await assertSucceeds(
      updateDoc(doc(db(env, 'bob'), `${B}/b2`), { name: 'Renamed', updatedAt: now() }),
    );
    await assertSucceeds(updateDoc(doc(db(env, 'alice'), `${B}/b2`), upd));
  });

  it('members cannot edit private boards they are not on; admins can', async () => {
    await assertFails(
      updateDoc(doc(db(env, 'carol'), `${B}/${PRIVATE_BOARD}`), { name: 'x', updatedAt: now() }),
    );
    await assertSucceeds(
      updateDoc(doc(db(env, 'alice'), `${B}/${PRIVATE_BOARD}`), { name: 'x', updatedAt: now() }),
    );
  });

  it('viewers cannot edit boards', async () => {
    await assertFails(
      updateDoc(doc(db(env, 'carol'), `${B}/${MAIN_BOARD}`), { name: 'x', updatedAt: now() }),
    );
  });

  it('delete: admins or the creator', async () => {
    await setDoc(doc(db(env, 'bob'), `${B}/b3`), newBoard('bob'));
    await assertFails(deleteDoc(doc(db(env, 'bob'), `${B}/${MAIN_BOARD}`)));
    await assertSucceeds(deleteDoc(doc(db(env, 'bob'), `${B}/b3`)));
    await assertSucceeds(deleteDoc(doc(db(env, 'alice'), `${B}/${MAIN_BOARD}`)));
  });
});

describe('items', () => {
  const I = (b: string, i = 'i2') => `${B}/${b}/items/${i}`;

  it('editors create items on boards they can see; viewers cannot', async () => {
    await assertSucceeds(setDoc(doc(db(env, 'bob'), I(MAIN_BOARD)), newItem('bob')));
    await assertSucceeds(setDoc(doc(db(env, 'bob'), I(PRIVATE_BOARD)), newItem('bob')));
    await assertSucceeds(setDoc(doc(db(env, 'alice'), I(PRIVATE_BOARD, 'i3')), newItem('alice')));
    await assertFails(setDoc(doc(db(env, 'carol'), I(MAIN_BOARD)), newItem('carol')));
    await assertFails(setDoc(doc(db(env, 'dave'), I(MAIN_BOARD)), newItem('dave')));
  });

  it('members cannot write items on private boards they are not on', async () => {
    await commitAsAdminMakeCarolMember();
    await assertSucceeds(setDoc(doc(db(env, 'carol'), I(MAIN_BOARD)), newItem('carol')));
    await assertFails(setDoc(doc(db(env, 'carol'), I(PRIVATE_BOARD)), newItem('carol')));
  });

  it('every write must stamp updatedAt = server time and updatedBy = me (delta sync)', async () => {
    const ref = doc(db(env, 'bob'), `${B}/${MAIN_BOARD}/items/i1`);
    await assertFails(updateDoc(ref, { name: 'x' }));
    await assertFails(updateDoc(ref, { name: 'x', updatedBy: 'bob', updatedAt: new Date() }));
    await assertFails(updateDoc(ref, { name: 'x', updatedBy: 'alice', updatedAt: now() }));
    await assertSucceeds(updateDoc(ref, { name: 'x', updatedBy: 'bob', updatedAt: now() }));
  });

  it('protects immutable fields and validates shape', async () => {
    const ref = doc(db(env, 'bob'), `${B}/${MAIN_BOARD}/items/i1`);
    const stamp = { updatedBy: 'bob', updatedAt: now() };
    await assertFails(updateDoc(ref, { createdBy: 'bob', ...stamp }));
    await assertFails(updateDoc(ref, { itemNumber: 99, ...stamp }));
    await assertFails(updateDoc(ref, { values: 'nope', ...stamp }));
    await assertFails(updateDoc(ref, { hacked: true, ...stamp }));
    await assertFails(
      setDoc(doc(db(env, 'bob'), I(MAIN_BOARD)), newItem('bob', { createdBy: 'alice' })),
    );
    await assertFails(
      setDoc(doc(db(env, 'bob'), I(MAIN_BOARD)), newItem('bob', { deletedAt: now() })),
    );
  });

  it('soft delete (tombstone) by editors; hard delete only by admins', async () => {
    const ref = (who: Persona) => doc(db(env, who), `${B}/${MAIN_BOARD}/items/i1`);
    await assertSucceeds(
      updateDoc(ref('bob'), { deletedAt: now(), updatedBy: 'bob', updatedAt: now() }),
    );
    await assertFails(deleteDoc(ref('bob')));
    await assertSucceeds(deleteDoc(ref('alice')));
  });
});

describe('views and item counter', () => {
  const V = `${B}/${MAIN_BOARD}/views`;
  const view = (uid: string) => ({
    type: 'kanban',
    name: 'Kanban',
    order: 'a1',
    config: {},
    createdBy: uid,
    updatedAt: now(),
  });

  it('editors manage views; viewers read only', async () => {
    await assertSucceeds(setDoc(doc(db(env, 'bob'), `${V}/v2`), view('bob')));
    await assertFails(setDoc(doc(db(env, 'carol'), `${V}/v3`), view('carol')));
    await assertSucceeds(getDoc(doc(db(env, 'carol'), `${V}/v1`)));
    await assertFails(
      setDoc(doc(db(env, 'bob'), `${V}/v4`), { ...view('bob'), type: 'spreadsheet' }),
    );
    await assertFails(
      updateDoc(doc(db(env, 'bob'), `${V}/v1`), { createdBy: 'bob', updatedAt: now() }),
    );
  });

  it('counter stays sane: at least 1, at most +500 (stale writes allowed for retries)', async () => {
    const ref = doc(db(env, 'bob'), `${B}/${MAIN_BOARD}/meta/counter`);
    await assertSucceeds(updateDoc(ref, { next: 3 }));
    await assertSucceeds(updateDoc(ref, { next: 1 }));
    await assertFails(updateDoc(ref, { next: 0 }));
    await assertFails(updateDoc(ref, { next: 10_000 }));
    await assertFails(
      updateDoc(doc(db(env, 'carol'), `${B}/${MAIN_BOARD}/meta/counter`), { next: 4 }),
    );
  });
});

async function commitAsAdminMakeCarolMember() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore() as never, `workspaces/${WID}/members/carol`), {
      role: 'member',
    });
  });
}
