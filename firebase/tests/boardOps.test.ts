import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  boardPaths,
  buildTemplate,
  makeColumn,
  planCreateBoard,
  planCreateItem,
  planDeleteItem,
  planSetCell,
  planUpdateBoard,
  planUpdateItem,
  type WriteOp,
} from '@app/shared';
import { doc, getDoc } from 'firebase/firestore';
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
function createFromTemplate(
  uid: string,
  bid: string,
  opts: Partial<Parameters<typeof planCreateBoard>[0]> = {},
): WriteOp[] {
  return planCreateBoard({
    wid: WID,
    bid,
    viewId: 'main',
    uid,
    name: 'Bills',
    visibility: 'main',
    order: 'a1',
    template: buildTemplate('bills'),
    newItemId: () => `it${++seq}`,
    ...opts,
  });
}

describe('board planners against the rules', () => {
  it('members create a board from any template in one batch', async () => {
    for (const t of ['chores', 'bills', 'renewals', 'maintenance', 'trip', 'blank'] as const) {
      await assertSucceeds(
        commitOps(
          db(env, 'bob'),
          createFromTemplate('bob', `b-${t}`, { template: buildTemplate(t) }),
        ),
      );
    }
  });

  it('private template boards work for their creator', async () => {
    await assertSucceeds(
      commitOps(
        db(env, 'bob'),
        createFromTemplate('bob', 'pb', { visibility: 'private', memberIds: ['alice'] }),
      ),
    );
    await assertFails(getDoc(doc(db(env, 'carol'), `workspaces/${WID}/boards/pb`)));
  });

  it('viewers and outsiders cannot create boards', async () => {
    await assertFails(commitOps(db(env, 'carol'), createFromTemplate('carol', 'x1')));
    await assertFails(commitOps(db(env, 'dave'), createFromTemplate('dave', 'x2')));
  });

  it('items cannot be smuggled onto a private board you cannot see', async () => {
    const cols = [makeColumn('text')];
    const ops = planCreateItem({
      wid: WID,
      bid: PRIVATE_BOARD,
      iid: 'smuggled',
      uid: 'alice',
      columns: cols,
      item: { name: 'x', groupId: 'g1', order: 'a1', itemNumber: 2 },
      counterExists: true,
    });
    await assertSucceeds(commitOps(db(env, 'alice'), ops)); // admin: allowed
    await env.withSecurityRulesDisabled(async (ctx) => {
      await commitOps(ctx.firestore() as never, [
        { kind: 'update', path: `workspaces/${WID}/members/carol`, data: { role: 'member' } },
      ]);
    });
    const ops2 = planCreateItem({
      wid: WID,
      bid: PRIVATE_BOARD,
      iid: 'smuggled2',
      uid: 'carol',
      columns: cols,
      item: { name: 'x', groupId: 'g1', order: 'a2', itemNumber: 3 },
      counterExists: true,
    });
    await assertFails(commitOps(db(env, 'carol'), ops2));
  });

  it('create item bumps the counter; reusing an old number is rejected by the counter rule', async () => {
    const cols = [makeColumn('people')];
    const mk = (iid: string, n: number) =>
      planCreateItem({
        wid: WID,
        bid: MAIN_BOARD,
        iid,
        uid: 'bob',
        columns: cols,
        item: {
          name: 'New',
          groupId: 'g1',
          order: 'a5',
          itemNumber: n,
          values: { [cols[0]!.id]: ['bob'] },
        },
        counterExists: true,
      });
    await assertSucceeds(commitOps(db(env, 'bob'), mk('n1', 2))); // counter 2 -> 3
    await assertFails(commitOps(db(env, 'bob'), mk('n2', 1))); // would move counter backwards
    const snap = await getDoc(doc(db(env, 'bob'), boardPaths.counter(WID, MAIN_BOARD)));
    expect(snap.data()?.['next']).toBe(3);
  });

  it('cell edits, renames, moves and tombstones pass; viewers are blocked', async () => {
    const status = makeColumn('status');
    const base = {
      wid: WID,
      bid: MAIN_BOARD,
      iid: 'i1',
      columns: [status],
      column: status,
      currentValues: {},
    };
    await assertSucceeds(
      commitOps(db(env, 'bob'), planSetCell({ ...base, uid: 'bob', value: 'done' })),
    );
    await assertSucceeds(
      commitOps(db(env, 'bob'), planSetCell({ ...base, uid: 'bob', value: null })),
    );
    await assertSucceeds(
      commitOps(
        db(env, 'bob'),
        planUpdateItem(WID, MAIN_BOARD, 'i1', 'bob', { name: 'Renamed', order: 'a9' }),
      ),
    );
    await assertSucceeds(
      commitOps(db(env, 'bob'), planUpdateItem(WID, MAIN_BOARD, 'i1', 'bob', { archived: true })),
    );
    await assertFails(
      commitOps(db(env, 'carol'), planSetCell({ ...base, uid: 'carol', value: 'done' })),
    );
    await assertSucceeds(commitOps(db(env, 'bob'), planDeleteItem(WID, MAIN_BOARD, 'i1', 'bob')));
  });

  it('board edits via planner; visibility changes restricted to creator/admin', async () => {
    await commitOps(db(env, 'alice'), createFromTemplate('alice', 'ab'));
    await assertSucceeds(
      commitOps(db(env, 'bob'), planUpdateBoard(WID, 'ab', { name: 'Renamed', groups: [] })),
    );
    await assertFails(
      commitOps(
        db(env, 'bob'),
        planUpdateBoard(WID, 'ab', { visibility: 'private', memberIds: ['bob'] }),
      ),
    );
    await assertSucceeds(
      commitOps(db(env, 'alice'), planUpdateBoard(WID, 'ab', { archived: true })),
    );
  });

  it('an admin can delete a whole board with its views, counter and items in one batch', async () => {
    const del: WriteOp[] = [
      { kind: 'delete', path: `workspaces/${WID}/boards/${MAIN_BOARD}/items/i1` },
      { kind: 'delete', path: boardPaths.view(WID, MAIN_BOARD, 'v1') },
      { kind: 'delete', path: boardPaths.counter(WID, MAIN_BOARD) },
      { kind: 'delete', path: `workspaces/${WID}/boards/${MAIN_BOARD}` },
    ];
    await assertFails(commitOps(db(env, 'bob'), del));
    await assertSucceeds(commitOps(db(env, 'alice'), del));
  });
});
