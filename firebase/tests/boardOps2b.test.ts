import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  boardPaths,
  convertColumn,
  makeColumn,
  paths,
  planApplyConversion,
  planArchiveItems,
  planBulkSetCell,
  planCreateItem,
  planDeleteItems,
  planDuplicateBoard,
  planDuplicateItems,
  planMoveItems,
  planRestoreItem,
  planUpdateBoard,
  SERVER_TIME,
  type Column,
  type WriteOp,
} from '@app/shared';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commitOps, db, MAIN_BOARD, PRIVATE_BOARD, seed, WID } from './helpers';
import { createEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

const text = makeColumn('text', 'Note');
const status = makeColumn('status');
const columns: Column[] = [text, status];
let seq = 0;
const newId = () => `gen${++seq}`;

/** A board with a couple of items and a subitem, written without rules. */
async function boardWithItems(bid: string, visibility: 'main' | 'private' = 'main') {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    const base = `workspaces/${WID}/boards/${bid}`;
    await setDoc(doc(fs, base), {
      name: 'Src',
      description: '',
      folderId: null,
      order: 'a5',
      visibility,
      memberIds: visibility === 'private' ? ['bob'] : [],
      columns,
      groups: [{ id: 'g1', name: 'One', color: 'blue' }],
      schemaVersion: 1,
      archived: false,
      createdBy: 'bob',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const item = (n: number, extra = {}) => ({
      name: `Item ${n}`,
      groupId: 'g1',
      order: `a${n}`,
      parentId: null,
      itemNumber: n,
      values: { [text.id]: `v${n}`, [status.id]: 'done' },
      assigneeUids: [],
      reminderKeys: [],
      archived: false,
      deletedAt: null,
      createdBy: 'bob',
      createdAt: new Date(),
      updatedBy: 'bob',
      updatedAt: new Date(),
      ...extra,
    });
    await setDoc(doc(fs, `${base}/items/p1`), item(1));
    await setDoc(doc(fs, `${base}/items/p2`), item(2));
    await setDoc(doc(fs, `${base}/items/c1`), item(3, { parentId: 'p1' }));
    await setDoc(doc(fs, `${base}/meta/counter`), { next: 4 });
    await setDoc(doc(fs, `${base}/views/main`), {
      type: 'table',
      name: 'Main',
      order: 'a0',
      config: {},
      createdBy: 'bob',
      updatedAt: new Date(),
    });
  });
}

const dupOps = (bid: string, uid: string, visibility: 'main' | 'private') =>
  planDuplicateBoard({
    wid: WID,
    newBid: `copy-${bid}`,
    uid,
    name: 'Src (copy)',
    order: 'a9',
    source: {
      board: {
        description: '',
        visibility,
        memberIds: visibility === 'private' ? ['bob'] : [],
        columns,
        groups: [{ id: 'g1', name: 'One', color: 'blue' }],
        folderId: null,
      },
      items: [
        {
          id: 'p1',
          name: 'Item 1',
          groupId: 'g1',
          order: 'a1',
          parentId: null,
          itemNumber: 1,
          values: { [text.id]: 'v1' },
          archived: false,
        },
        {
          id: 'c1',
          name: 'Item 3',
          groupId: 'g1',
          order: 'a3',
          parentId: 'p1',
          itemNumber: 3,
          values: {},
          archived: false,
        },
      ],
      views: [{ type: 'table', name: 'Main', order: 'a0', config: { filters: [] } }],
      counterNext: 4,
    },
    newId,
  });

describe('duplicate board', () => {
  it('a member duplicates a main board in one batch (board, view, counter, items)', async () => {
    await assertSucceeds(commitOps(db(env, 'bob'), dupOps(MAIN_BOARD, 'bob', 'main')));
    expect(
      (await getDoc(doc(db(env, 'bob'), paths.board(WID, `copy-${MAIN_BOARD}`)))).exists(),
    ).toBe(true);
  });

  it('works in the chunked order the app uses (board first, items in later batches)', async () => {
    const ops = dupOps(MAIN_BOARD, 'bob', 'main');
    await assertSucceeds(commitOps(db(env, 'bob'), ops.slice(0, 3)));
    await assertSucceeds(commitOps(db(env, 'bob'), ops.slice(3)));
  });

  it('an admin can duplicate a private board they are not on; they end up a member of the copy', async () => {
    const ops = dupOps(PRIVATE_BOARD, 'alice', 'private');
    await assertSucceeds(commitOps(db(env, 'alice'), ops));
    const board = await getDoc(doc(db(env, 'alice'), paths.board(WID, `copy-${PRIVATE_BOARD}`)));
    expect(board.data()?.['memberIds']).toEqual(['alice', 'bob']);
  });

  it('viewers and outsiders cannot', async () => {
    await assertFails(commitOps(db(env, 'carol'), dupOps(MAIN_BOARD, 'carol', 'main')));
    await assertFails(commitOps(db(env, 'dave'), dupOps(MAIN_BOARD, 'dave', 'main')));
  });
});

describe('bulk and tree operations', () => {
  beforeEach(() => boardWithItems('src'));

  it('bulk set value, archive, delete and restore pass for members and fail for viewers', async () => {
    const items = [
      { id: 'p1', values: {} },
      { id: 'p2', values: {} },
    ];
    const set = planBulkSetCell({
      wid: WID,
      bid: 'src',
      uid: 'bob',
      columns,
      column: text,
      items,
      value: 'x',
    });
    await assertSucceeds(commitOps(db(env, 'bob'), set));
    await assertSucceeds(
      commitOps(db(env, 'bob'), planArchiveItems(WID, 'src', 'bob', ['p1', 'c1'], true)),
    );
    await assertSucceeds(commitOps(db(env, 'bob'), planDeleteItems(WID, 'src', 'bob', ['p2'])));
    await assertSucceeds(commitOps(db(env, 'bob'), planRestoreItem(WID, 'src', 'p2', 'bob')));
    await assertFails(
      commitOps(
        db(env, 'carol'),
        planBulkSetCell({
          wid: WID,
          bid: 'src',
          uid: 'carol',
          columns,
          column: text,
          items,
          value: 'y',
        }),
      ),
    );
    await assertFails(commitOps(db(env, 'carol'), planDeleteItems(WID, 'src', 'carol', ['p2'])));
  });

  it('moving items with their subitems between groups', async () => {
    const ops = planMoveItems({
      wid: WID,
      bid: 'src',
      uid: 'bob',
      groupId: 'g1',
      moves: [{ id: 'p1', childIds: ['c1'], order: 'a9' }],
    });
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
    await assertFails(
      commitOps(
        db(env, 'carol'),
        ops.map((o) =>
          o.kind === 'update' ? { ...o, data: { ...o.data, updatedBy: 'carol' } } : o,
        ),
      ),
    );
  });

  it('subitems are created like items (parentId, shared counter)', async () => {
    const ops = planCreateItem({
      wid: WID,
      bid: 'src',
      iid: 'sub9',
      uid: 'bob',
      columns,
      counterExists: true,
      item: { name: 'Sub', groupId: 'g1', order: 'a1', itemNumber: 4, parentId: 'p1' },
    });
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
  });

  it('duplicating items advances the counter once and keeps numbers unique', async () => {
    const ops = planDuplicateItems({
      wid: WID,
      bid: 'src',
      uid: 'bob',
      columns,
      startNumber: 4,
      counterExists: true,
      items: [
        {
          id: 'p1',
          name: 'Item 1',
          groupId: 'g1',
          order: 'a1',
          values: {},
          subitems: [{ name: 'Item 3', order: 'a3', values: {} }],
        },
      ],
      lastOrderByGroup: new Map([['g1', 'a2']]),
      newId,
    });
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
    const counter = await getDoc(doc(db(env, 'bob'), boardPaths.counter(WID, 'src')));
    expect(counter.data()?.['next']).toBe(6);
  });

  it('column type conversion rewrites the column and every cell in one batch', async () => {
    const result = convertColumn(
      text,
      'numbers',
      [
        { id: 'p1', value: '12' },
        { id: 'p2', value: 'n/a' },
      ],
      { memberName: (u) => u, uidByName: () => null },
    );
    const ops = planApplyConversion({
      wid: WID,
      bid: 'src',
      uid: 'bob',
      columns,
      newColumn: result.column,
      changes: result.changes,
      itemValues: new Map(),
      touchesPeople: false,
    });
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
    await assertFails(
      commitOps(
        db(env, 'carol'),
        ops.map((o) =>
          o.kind === 'update' && o.path.includes('/items/')
            ? { ...o, data: { ...o.data, updatedBy: 'carol' } }
            : o,
        ),
      ),
    );
  });

  it('board folder moves go through the normal board update rules', async () => {
    await assertSucceeds(
      commitOps(db(env, 'bob'), planUpdateBoard(WID, 'src', { folderId: 'f1' })),
    );
    await assertFails(commitOps(db(env, 'carol'), planUpdateBoard(WID, 'src', { folderId: 'f2' })));
  });
});

describe('view settings (saved per view)', () => {
  beforeEach(() => boardWithItems('src'));
  const save = (config: unknown): WriteOp[] => [
    {
      kind: 'update',
      path: boardPaths.view(WID, 'src', 'main'),
      data: { config, updatedAt: SERVER_TIME },
    },
  ];

  it('members save filters/sort/widths; viewers cannot', async () => {
    const config = {
      filters: [{ id: 'f', columnId: 'name', op: 'contains', value: 'x' }],
      sort: [],
      groupBy: null,
      hiddenCols: [],
      colWidths: { a: 200 },
      showArchived: false,
    };
    await assertSucceeds(commitOps(db(env, 'bob'), save(config)));
    await assertFails(commitOps(db(env, 'carol'), save(config)));
    await assertFails(
      commitOps(db(env, 'bob'), [
        {
          kind: 'update',
          path: boardPaths.view(WID, 'src', 'main'),
          data: { config: 'nope', updatedAt: SERVER_TIME },
        },
      ]),
    );
  });
});

describe('favourites (users/{uid}.settings.favoriteBoardIds)', () => {
  const profile = {
    displayName: 'Bob',
    email: 'bob@example.com',
    photoURL: null,
    lastWorkspaceId: null,
    settings: {},
  };
  beforeEach(async () => {
    await setDoc(doc(db(env, 'bob'), 'users/bob'), profile);
  });
  it('saves the whole list; nobody else can touch it; the cap and shape are enforced', async () => {
    const fs = db(env, 'bob');
    await assertSucceeds(
      updateDoc(doc(fs, 'users/bob'), { 'settings.favoriteBoardIds': ['b1', 'b2'] }),
    );
    await assertSucceeds(updateDoc(doc(fs, 'users/bob'), { 'settings.favoriteBoardIds': ['b2'] }));
    expect((await getDoc(doc(fs, 'users/bob'))).data()?.['settings']).toEqual({
      favoriteBoardIds: ['b2'],
    });
    await assertFails(
      updateDoc(doc(db(env, 'alice'), 'users/bob'), { 'settings.favoriteBoardIds': ['x'] }),
    );
    await assertFails(
      updateDoc(doc(fs, 'users/bob'), {
        'settings.favoriteBoardIds': Array.from({ length: 201 }, (_, i) => `b${i}`),
      }),
    );
    await assertFails(updateDoc(doc(fs, 'users/bob'), { 'settings.somethingElse': true }));
  });
});

describe('folders', () => {
  it('members create, rename and delete folders; viewers cannot', async () => {
    const create: WriteOp[] = [
      {
        kind: 'set',
        path: paths.folder(WID, 'f1'),
        data: { name: 'Money', order: 'a0', createdBy: 'bob', createdAt: SERVER_TIME },
      },
    ];
    await assertSucceeds(commitOps(db(env, 'bob'), create));
    await assertSucceeds(
      commitOps(db(env, 'bob'), [
        { kind: 'update', path: paths.folder(WID, 'f1'), data: { name: 'Bills' } },
      ]),
    );
    await assertFails(
      commitOps(db(env, 'carol'), [
        { kind: 'update', path: paths.folder(WID, 'f1'), data: { name: 'Hacked' } },
      ]),
    );
    await assertSucceeds(
      commitOps(db(env, 'bob'), [{ kind: 'delete', path: paths.folder(WID, 'f1') }]),
    );
  });
});
