import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  newWidget,
  planCreateDashboard,
  planDeleteDashboard,
  planUpdateDashboard,
  type Widget,
  type WriteOp,
} from '@app/shared';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { commitOps, db, MAIN_BOARD, seed, WID, type Persona } from './helpers';
import { createEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

const path = (id: string) => `workspaces/${WID}/dashboards/${id}`;
const create = (
  who: Persona,
  id: string,
  visibility: 'main' | 'private' = 'main',
  members: string[] = [],
) =>
  commitOps(
    db(env, who),
    planCreateDashboard({
      wid: WID,
      did: id,
      uid: who,
      name: 'Home',
      boardIds: [MAIN_BOARD],
      visibility,
      memberIds: members,
    }),
  );
const update = (who: Persona, id: string, widgets: Widget[], lists = [MAIN_BOARD]) =>
  commitOps(db(env, who), planUpdateDashboard(WID, id, { widgets }, lists));

describe('dashboards: who can make, see, change and remove them', () => {
  it('editors create; viewers and outsiders cannot', async () => {
    await assertSucceeds(create('bob', 'd1'));
    await assertSucceeds(create('alice', 'd2'));
    await assertFails(create('carol', 'd3'));
    await assertFails(create('dave', 'd4'));
  });
  it('a main dashboard is readable by the whole household, not by outsiders', async () => {
    await create('bob', 'd1');
    for (const who of ['alice', 'bob', 'carol'] as const)
      await assertSucceeds(getDoc(doc(db(env, who), path('d1'))));
    await assertFails(getDoc(doc(db(env, 'dave'), path('d1'))));
  });
  it('a private dashboard is for the people named, plus admins', async () => {
    await assertSucceeds(create('bob', 'p1', 'private', []));
    await assertSucceeds(getDoc(doc(db(env, 'bob'), path('p1'))));
    await assertSucceeds(getDoc(doc(db(env, 'alice'), path('p1')))); // admin
    await assertFails(getDoc(doc(db(env, 'carol'), path('p1'))));
    // a private one has to include its creator; a main one can't carry a member list
    await assertFails(
      setDoc(doc(db(env, 'bob'), path('p2')), {
        name: 'x',
        boardIds: [],
        widgets: [],
        visibility: 'private',
        memberIds: ['alice'],
        createdBy: 'bob',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db(env, 'bob'), path('p3')), {
        name: 'x',
        boardIds: [],
        widgets: [],
        visibility: 'main',
        memberIds: ['alice'],
        createdBy: 'bob',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
  it('only the creator or an admin changes who can see it', async () => {
    await create('alice', 'd1');
    const hide = (who: Persona) =>
      commitOps(db(env, who), [
        {
          kind: 'update',
          path: path('d1'),
          data: { visibility: 'private', memberIds: [who], updatedAt: serverTimestamp() },
        } as unknown as WriteOp,
      ]);
    await assertFails(hide('bob'));
    await assertSucceeds(hide('alice'));
  });

  it('widgets and layout are saved by any editor; viewers cannot', async () => {
    await create('bob', 'd1');
    const w = newWidget('numbers', [MAIN_BOARD], [], { boardId: MAIN_BOARD });
    await assertSucceeds(update('alice', 'd1', [w]));
    await assertSucceeds(update('bob', 'd1', [w, newWidget('chart', [MAIN_BOARD], [w])]));
    await assertFails(update('carol', 'd1', [w]));
    await assertFails(update('dave', 'd1', [w]));
    // private: another editor who isn't named can't change it
    await create('bob', 'p1', 'private', []);
    await assertFails(
      updateDoc(doc(db(env, 'carol'), path('p1')), { name: 'mine', updatedAt: serverTimestamp() }),
    );
  });
  it('shape is enforced: how many widgets, that each is a typed object, lists, no extra fields, owner never changes', async () => {
    await create('bob', 'd1');
    const w = newWidget('numbers', [MAIN_BOARD], []);
    const fs = db(env, 'bob');
    const touch = (data: Record<string, unknown>) =>
      commitOps(fs, [
        {
          kind: 'update',
          path: path('d1'),
          data: { ...data, updatedAt: serverTimestamp() },
        } as unknown as WriteOp,
      ]);
    await assertFails(touch({ widgets: Array.from({ length: 25 }, () => w) }));
    await assertFails(touch({ widgets: ['not a widget'] }));
    await assertFails(touch({ widgets: [{ nothing: 1 }] })); // no type
    await assertFails(touch({ boardIds: ['a', 'b', 'c', 'd', 'e', 'f'] }));
    await assertFails(touch({ boardIds: [1] }));
    await assertFails(touch({ name: '' }));
    await assertFails(touch({ visibility: 'public' }));
    await assertFails(touch({ createdBy: 'alice' }));
    await assertFails(touch({ surprise: true }));
    await assertSucceeds(touch({ boardIds: ['a', 'b', 'c', 'd', 'e'] }));
  });
  it('24 widgets are fine', async () => {
    await create('bob', 'd1');
    const w = newWidget('numbers', [MAIN_BOARD], []);
    await assertSucceeds(
      commitOps(db(env, 'bob'), [
        {
          kind: 'update',
          path: path('d1'),
          data: { widgets: Array.from({ length: 24 }, () => w), updatedAt: serverTimestamp() },
        } as unknown as WriteOp,
      ]),
    );
  });
  it('the creator or an admin deletes; another member cannot', async () => {
    await create('bob', 'd1');
    await create('bob', 'd2');
    await assertFails(commitOps(db(env, 'carol'), planDeleteDashboard(WID, 'd1')));
    await assertSucceeds(commitOps(db(env, 'bob'), planDeleteDashboard(WID, 'd1')));
    await assertSucceeds(commitOps(db(env, 'alice'), planDeleteDashboard(WID, 'd2')));
    await create('alice', 'd3');
    await assertFails(commitOps(db(env, 'bob'), planDeleteDashboard(WID, 'd3')));
  });
});
