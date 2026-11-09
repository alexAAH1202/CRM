import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  paths,
  planAddUpdate,
  planAssignmentNotifications,
  planDeleteUpdate,
  planEditUpdate,
  planMarkRead,
} from '@app/shared';
import { doc, getDoc, serverTimestamp as serverTime, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commitOps, db, MAIN_BOARD, PRIVATE_BOARD, seed, WID } from './helpers';
import { createEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

let seq = 0;
const newId = () => `gen${++seq}`;
const add = (
  who: 'alice' | 'bob' | 'carol' | 'dave',
  over: Partial<Parameters<typeof planAddUpdate>[0]> = {},
) =>
  planAddUpdate({
    wid: WID,
    bid: MAIN_BOARD,
    iid: 'i1',
    uid: `u-${who}-${++seq}`,
    author: who,
    authorName: who,
    body: 'hello **team**',
    mentions: [],
    parentId: null,
    itemName: 'Item',
    newId,
    ...over,
  });
const upath = (id: string) => paths.update(WID, MAIN_BOARD, 'i1', id);

describe('updates (comments)', () => {
  it('members and admins comment; viewers and outsiders cannot', async () => {
    await assertSucceeds(commitOps(db(env, 'bob'), add('bob')));
    await assertSucceeds(commitOps(db(env, 'alice'), add('alice')));
    await assertFails(commitOps(db(env, 'carol'), add('carol')));
    await assertFails(commitOps(db(env, 'dave'), add('dave')));
  });
  it('everyone who can see the board reads comments; outsiders cannot', async () => {
    const ops = add('bob');
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
    const p = ops[0]!.path;
    await assertSucceeds(getDoc(doc(db(env, 'carol'), p)));
    await assertSucceeds(getDoc(doc(db(env, 'alice'), p)));
    await assertFails(getDoc(doc(db(env, 'dave'), p)));
  });
  it('private boards: only people on the board comment or read (admins see all)', async () => {
    const ops = planAddUpdate({
      wid: WID,
      bid: PRIVATE_BOARD,
      iid: 'i1',
      uid: 'pu1',
      author: 'bob',
      authorName: 'bob',
      body: 'secret',
      mentions: [],
      parentId: null,
      itemName: 'x',
      newId,
    });
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
    await assertFails(getDoc(doc(db(env, 'carol'), ops[0]!.path)));
    const carol = planAddUpdate({
      wid: WID,
      bid: PRIVATE_BOARD,
      iid: 'i1',
      uid: 'pu2',
      author: 'carol',
      authorName: 'c',
      body: 'x',
      mentions: [],
      parentId: null,
      itemName: 'x',
      newId,
    });
    await assertFails(commitOps(db(env, 'carol'), carol));
  });
  it('you can only comment as yourself, with a server timestamp, within size limits', async () => {
    await assertFails(commitOps(db(env, 'bob'), add('bob', { author: 'alice' })));
    await assertFails(commitOps(db(env, 'bob'), add('bob', { body: '   ' })));
    const d = doc(db(env, 'bob'), upath('raw1'));
    const good = {
      author: 'bob',
      body: 'x',
      mentions: [],
      parentId: null,
      createdAt: serverTime(),
      editedAt: null,
    };
    await assertFails(setDoc(d, { ...good, createdAt: new Date(0) }));
    await assertFails(setDoc(d, { ...good, extra: 1 }));
    await assertFails(setDoc(d, { ...good, body: 'x'.repeat(5001) }));
    await assertFails(
      setDoc(d, { ...good, mentions: Array.from({ length: 21 }, (_, i) => `u${i}`) }),
    );
    await assertFails(setDoc(d, { ...good, editedAt: serverTime() }));
  });
  it('only the author edits, and only the text', async () => {
    const ops = add('bob', { mentions: ['alice'] });
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
    const id = ops[0]!.path.split('/').pop()!;
    const edit = (who: 'alice' | 'bob', author = who) =>
      planEditUpdate({
        wid: WID,
        bid: MAIN_BOARD,
        iid: 'i1',
        uid: id,
        author,
        authorName: who,
        body: 'edited',
        mentions: ['alice'],
        previousMentions: ['alice'],
        itemName: 'Item',
        newId,
      });
    await assertSucceeds(commitOps(db(env, 'bob'), edit('bob')));
    await assertFails(commitOps(db(env, 'alice'), edit('alice')));
    // can't rewrite authorship or the timestamp
    await assertFails(
      updateDoc(doc(db(env, 'bob'), upath(id)), { author: 'alice', editedAt: serverTime() }),
    );
    await assertFails(
      updateDoc(doc(db(env, 'bob'), upath(id)), {
        createdAt: serverTime(),
        editedAt: serverTime(),
      }),
    );
    const snap = await getDoc(doc(db(env, 'bob'), upath(id)));
    expect(snap.data()?.['body']).toBe('edited');
    expect(snap.data()?.['editedAt']).not.toBeNull();
  });
  it('authors delete their own; admins delete anyone’s; others cannot', async () => {
    const a = add('bob');
    const b = add('bob');
    await commitOps(db(env, 'bob'), a);
    await commitOps(db(env, 'bob'), b);
    const idOf = (o: { path: string }) => o.path.split('/').pop()!;
    await assertFails(
      commitOps(db(env, 'carol'), planDeleteUpdate(WID, MAIN_BOARD, 'i1', idOf(a[0]!))),
    );
    await assertSucceeds(
      commitOps(db(env, 'bob'), planDeleteUpdate(WID, MAIN_BOARD, 'i1', idOf(a[0]!))),
    );
    await assertSucceeds(
      commitOps(db(env, 'alice'), planDeleteUpdate(WID, MAIN_BOARD, 'i1', idOf(b[0]!))),
    );
  });
});

describe('notifications from mentions and assignments', () => {
  it('a comment that mentions people notifies them in the same batch; they read, mark read and delete', async () => {
    const ops = add('bob', { mentions: ['alice', 'carol'] });
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
    const nPath = ops[1]!.path;
    const aliceSnap = await getDoc(doc(db(env, 'alice'), nPath));
    expect(aliceSnap.data()).toMatchObject({ type: 'mention', read: false, actor: 'bob' });
    await assertFails(getDoc(doc(db(env, 'bob'), nPath))); // not yours
    const nid = nPath.split('/').pop()!;
    await assertSucceeds(commitOps(db(env, 'alice'), planMarkRead(WID, 'alice', nid, true)));
    await assertFails(commitOps(db(env, 'bob'), planMarkRead(WID, 'alice', nid, false)));
    await assertFails(updateDoc(doc(db(env, 'alice'), nPath), { read: true, title: 'hacked' }));
  });
  it('a viewer cannot send a notification, nor can you forge someone else as the actor', async () => {
    const ops = add('bob', { mentions: ['alice'] });
    const forged = ops.map((o) =>
      o.kind === 'set' && o.path.includes('notifications')
        ? { ...o, data: { ...o.data, actor: 'carol' } }
        : o,
    );
    await assertFails(commitOps(db(env, 'bob'), forged));
    await assertFails(commitOps(db(env, 'carol'), add('carol', { mentions: ['alice'] })));
  });
  it('you cannot notify someone outside the workspace', async () => {
    await assertFails(commitOps(db(env, 'bob'), add('bob', { mentions: ['dave'] })));
  });
  it('assignment notifications are accepted', async () => {
    const ops = planAssignmentNotifications({
      wid: WID,
      bid: MAIN_BOARD,
      iid: 'i1',
      actor: 'bob',
      actorName: 'Bob',
      itemName: 'Item',
      boardName: 'Board',
      before: [],
      after: ['alice'],
      newId,
    });
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
  });
});

describe('muting notification types (users/{uid}.settings.mutedNotifications)', () => {
  const profile = {
    displayName: 'Bob',
    email: 'bob@example.com',
    photoURL: null,
    lastWorkspaceId: null,
    settings: {},
  };
  it('saves a short list, for yourself only', async () => {
    const fs = db(env, 'bob');
    await setDoc(doc(fs, 'users/bob'), profile);
    await assertSucceeds(
      updateDoc(doc(fs, 'users/bob'), { 'settings.mutedNotifications': ['due'] }),
    );
    await assertFails(
      updateDoc(doc(fs, 'users/bob'), {
        'settings.mutedNotifications': Array.from({ length: 11 }, () => 'x'),
      }),
    );
    await assertFails(updateDoc(doc(fs, 'users/bob'), { 'settings.mutedNotifications': 'due' }));
    await assertFails(
      updateDoc(doc(db(env, 'alice'), 'users/bob'), { 'settings.mutedNotifications': [] }),
    );
  });
});
