import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  boardPaths,
  planActivity,
  planCreateItem,
  planSetCell,
  makeColumn,
  type WriteOp,
} from '@app/shared';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { commitOps, db, MAIN_BOARD, PRIVATE_BOARD, seed, WID } from './helpers';
import { createEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

let n = 0;
const entry = (actor: string, over: Partial<Parameters<typeof planActivity>[0]> = {}): WriteOp =>
  planActivity({
    wid: WID,
    bid: MAIN_BOARD,
    id: `a${++n}`,
    actor,
    type: 'status',
    itemId: 'i1',
    itemName: 'Item',
    data: { column: 'Status', from: 'A', to: 'B' },
    ...over,
  });

describe('activity log', () => {
  it('editors append entries as themselves; viewers and outsiders cannot', async () => {
    await assertSucceeds(commitOps(db(env, 'bob'), [entry('bob')]));
    await assertSucceeds(commitOps(db(env, 'alice'), [entry('alice')]));
    await assertFails(commitOps(db(env, 'carol'), [entry('carol')]));
    await assertFails(commitOps(db(env, 'dave'), [entry('dave')]));
  });
  it('you cannot log as someone else, with a fake time, or with unknown fields/types', async () => {
    await assertFails(commitOps(db(env, 'bob'), [entry('alice')]));
    const p = boardPaths.activityDoc(WID, MAIN_BOARD, 'raw');
    const good = {
      type: 'create',
      itemId: null,
      itemName: 'x',
      actor: 'bob',
      data: {},
      at: serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(db(env, 'bob'), p), good));
    await assertFails(setDoc(doc(db(env, 'bob'), p + '2'), { ...good, at: new Date(0) }));
    await assertFails(setDoc(doc(db(env, 'bob'), p + '3'), { ...good, extra: 1 }));
    await assertFails(setDoc(doc(db(env, 'bob'), p + '4'), { ...good, type: 'hacked' }));
    await assertFails(setDoc(doc(db(env, 'bob'), p + '5'), { ...good, itemName: 'x'.repeat(201) }));
    await assertFails(
      setDoc(doc(db(env, 'bob'), p + '6'), {
        ...good,
        data: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, 'x'])),
      }),
    );
  });
  it('entries are append-only; only admins can delete (pruning)', async () => {
    const e = entry('bob');
    await commitOps(db(env, 'bob'), [e]);
    await assertFails(updateDoc(doc(db(env, 'bob'), e.path), { itemName: 'edited' }));
    await assertFails(deleteDoc(doc(db(env, 'bob'), e.path)));
    await assertSucceeds(deleteDoc(doc(db(env, 'alice'), e.path)));
  });
  it('readable by anyone who can see the board; private boards stay private', async () => {
    const e = entry('bob');
    await commitOps(db(env, 'bob'), [e]);
    await assertSucceeds(getDoc(doc(db(env, 'carol'), e.path)));
    await assertFails(getDoc(doc(db(env, 'dave'), e.path)));
    const priv = entry('bob', { bid: PRIVATE_BOARD });
    await assertSucceeds(commitOps(db(env, 'bob'), [priv]));
    await assertFails(getDoc(doc(db(env, 'carol'), priv.path)));
    await assertSucceeds(getDoc(doc(db(env, 'alice'), priv.path))); // admins see every board
  });
  it('is written in the same batch as the change it describes', async () => {
    const col = makeColumn('status', 'Status');
    const ops: WriteOp[] = [
      ...planSetCell({
        wid: WID,
        bid: MAIN_BOARD,
        iid: 'i1',
        uid: 'bob',
        columns: [col],
        column: col,
        currentValues: {},
        value: col.settings.labels![0]!.id,
      }),
      entry('bob'),
    ];
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
    const created = planCreateItem({
      wid: WID,
      bid: MAIN_BOARD,
      iid: 'new1',
      uid: 'bob',
      columns: [col],
      counterExists: true,
      item: { name: 'N', groupId: 'g1', order: 'a9', itemNumber: 2 },
    });
    await assertSucceeds(
      commitOps(db(env, 'bob'), [...created, entry('bob', { type: 'create', itemId: 'new1' })]),
    );
  });
});
