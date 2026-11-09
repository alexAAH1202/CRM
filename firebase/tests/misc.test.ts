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
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { db, MAIN_BOARD, seed, WID } from './helpers';
import { createEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

const W = `workspaces/${WID}`;
const now = () => serverTimestamp();

describe('notifications', () => {
  const n = (actor: string) => ({
    type: 'mention',
    title: 'You were mentioned',
    body: '',
    link: '/x',
    actor,
    read: false,
    createdAt: now(),
  });

  it('recipient reads, marks read and deletes; nobody else can read', async () => {
    await assertSucceeds(getDocs(collection(db(env, 'bob'), `${W}/notifications/bob/items`)));
    await assertFails(getDocs(collection(db(env, 'alice'), `${W}/notifications/bob/items`)));
    await assertSucceeds(
      updateDoc(doc(db(env, 'bob'), `${W}/notifications/bob/items/n1`), { read: true }),
    );
    await assertFails(
      updateDoc(doc(db(env, 'bob'), `${W}/notifications/bob/items/n1`), { title: 'edited' }),
    );
    await assertFails(
      updateDoc(doc(db(env, 'alice'), `${W}/notifications/bob/items/n1`), { read: true }),
    );
    await assertSucceeds(deleteDoc(doc(db(env, 'bob'), `${W}/notifications/bob/items/n1`)));
  });

  it('editors can notify members; not viewers, outsiders, or non-members as recipients', async () => {
    await assertSucceeds(
      setDoc(doc(db(env, 'alice'), `${W}/notifications/bob/items/n2`), n('alice')),
    );
    await assertFails(setDoc(doc(db(env, 'alice'), `${W}/notifications/bob/items/n3`), n('bob'))); // spoofed actor
    await assertFails(
      setDoc(doc(db(env, 'alice'), `${W}/notifications/dave/items/n4`), n('alice')),
    );
    await assertFails(setDoc(doc(db(env, 'carol'), `${W}/notifications/bob/items/n5`), n('carol')));
    await assertFails(setDoc(doc(db(env, 'dave'), `${W}/notifications/bob/items/n6`), n('dave')));
    await assertFails(
      setDoc(doc(db(env, 'alice'), `${W}/notifications/bob/items/n7`), {
        ...n('alice'),
        read: true,
      }),
    );
  });
});

describe('timers (one per user per workspace)', () => {
  const t = { boardId: MAIN_BOARD, itemId: 'i1', columnId: 'time', startedAt: now() };
  it('owner (editor) manages their own timer only', async () => {
    await assertSucceeds(setDoc(doc(db(env, 'bob'), `${W}/timers/bob`), t));
    await assertSucceeds(getDoc(doc(db(env, 'bob'), `${W}/timers/bob`)));
    await assertFails(setDoc(doc(db(env, 'bob'), `${W}/timers/alice`), t));
    await assertFails(getDoc(doc(db(env, 'alice'), `${W}/timers/bob`)));
    await assertFails(setDoc(doc(db(env, 'carol'), `${W}/timers/carol`), t));
    await assertFails(
      setDoc(doc(db(env, 'bob'), `${W}/timers/bob`), { ...t, startedAt: new Date(0) }),
    );
    await assertSucceeds(deleteDoc(doc(db(env, 'bob'), `${W}/timers/bob`)));
  });
});

describe('folders', () => {
  const f = (uid: string) => ({ name: 'Marketing', order: 'a0', createdBy: uid, createdAt: now() });
  it('editors write, all members read, viewers/outsiders cannot write', async () => {
    await assertSucceeds(setDoc(doc(db(env, 'bob'), `${W}/folders/f1`), f('bob')));
    await assertSucceeds(getDoc(doc(db(env, 'carol'), `${W}/folders/f1`)));
    await assertFails(getDoc(doc(db(env, 'dave'), `${W}/folders/f1`)));
    await assertFails(setDoc(doc(db(env, 'carol'), `${W}/folders/f2`), f('carol')));
    await assertFails(setDoc(doc(db(env, 'bob'), `${W}/folders/f3`), f('alice')));
    await assertSucceeds(updateDoc(doc(db(env, 'alice'), `${W}/folders/f1`), { name: 'Sales' }));
  });
});

describe('collections reserved for later phases are denied to everyone', () => {
  const paths = [
    `${W}/boards/${MAIN_BOARD}/items/i1/updates/u1`,
    `${W}/boards/${MAIN_BOARD}/automations/a1`,
    `${W}/boards/${MAIN_BOARD}/automationRuns/r1`,
    `${W}/boards/${MAIN_BOARD}/activity/x1`,
    `${W}/scheduledEvents/e1`,
    `${W}/dashboards/d1`,
    `${W}/timeEntries/t1`,
    `${W}/somethingElse/x`,
  ];
  it.each(paths)('%s', async (p) => {
    await assertFails(getDoc(doc(db(env, 'alice'), p)));
    await assertFails(setDoc(doc(db(env, 'alice'), p), { a: 1 }));
  });
});
