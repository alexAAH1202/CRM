import {
  boardPaths,
  buildTemplate,
  convertColumn,
  defaultItemValues,
  planApplyConversion,
  planArchiveItems,
  planAssignmentNotifications,
  planActivity,
  normalizeValue,
  isComputedType,
  cleanValues,
  type EngineItem,
  cellActivity,
  type ActivityData,
  type ActivityType,
  planBulkSetCell,
  planDeleteItems,
  planDuplicateBoard,
  planDuplicateItems,
  planMoveItems,
  planRestoreItem,
  SERVER_TIME,
  type ConversionResult,
  type DuplicableItem,
  type ViewConfig,
  type ViewType,
  VIEW_TYPE_META,
  shortId,
  keyBetween,
  paths,
  planCreateBoard,
  planCreateItem,
  planDeleteItem,
  planSetCell,
  planUpdateBoard,
  planUpdateItem,
  type BoardVisibility,
  type Column,
  type Group,
  type TemplateId,
  type WriteOp,
} from '@app/shared';
import { collection, doc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import {
  addAutomationOps,
  enabledAutomations,
  runtimeFor,
  usesNumbering,
} from '../automations/runtime';
import {
  commitOps,
  commitOpsChunked,
  readDoc,
  readQuery,
  runOpsTransaction,
} from '../../lib/firestore';
import type { Board, BoardItem } from './types';

const newId = (path: string) => doc(collection(db, path)).id;

// ---- activity log: one small entry, in the same batch as the change it describes.

let personName: (uid: string) => string = (u) => u;
/** Lets the log say "Bob" instead of a uid (set once by the workspace's member list). */
export function setActivityNameLookup(fn: (uid: string) => string) {
  personName = fn;
}

function activity(
  wid: string,
  bid: string,
  actor: string,
  type: ActivityType,
  itemId: string | null,
  itemName: string,
  data?: ActivityData,
): WriteOp {
  return planActivity({
    wid,
    bid,
    id: newId(boardPaths.activity(wid, bid)),
    actor,
    type,
    itemId,
    itemName,
    ...(data ? { data } : {}),
  });
}

/** One entry for a single item, or a single summary entry when many were touched at once. */
function activityForMany(
  wid: string,
  bid: string,
  actor: string,
  verb: 'deleted' | 'moved',
  items: ReadonlyArray<{ id: string; name: string }>,
  group?: string,
): WriteOp[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    const it = items[0] as { id: string; name: string };
    return [
      activity(
        wid,
        bid,
        actor,
        verb === 'deleted' ? 'delete' : 'move',
        it.id,
        it.name,
        group ? { group } : {},
      ),
    ];
  }
  return [
    activity(wid, bid, actor, 'bulk', null, '', {
      text: verb,
      count: items.length,
      ...(group ? { group } : {}),
    }),
  ];
}

/**
 * Item creation takes a number from the board's shared counter inside a transaction.
 * Two of those in flight at once (typing the next item before the last one finished)
 * collide on the counter and one is rejected, so they run one after another.
 */
let counterQueue: Promise<unknown> = Promise.resolve();
const lastIssuedOrder = new Map<string, string>();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = counterQueue.then(task, task);
  counterQueue = run.catch(() => undefined);
  return run;
}

export async function createBoard(input: {
  wid: string;
  uid: string;
  name: string;
  template: TemplateId;
  visibility: BoardVisibility;
  memberIds: string[];
  lastOrder: string | null;
}): Promise<string> {
  const bid = newId(paths.boards(input.wid));
  const itemsPath = boardPaths.items(input.wid, bid);
  await commitOps(
    'board:create',
    planCreateBoard({
      wid: input.wid,
      bid,
      viewId: 'main',
      uid: input.uid,
      name: input.name,
      visibility: input.visibility,
      memberIds: input.memberIds,
      order: keyBetween(input.lastOrder, null),
      template: buildTemplate(input.template),
      newItemId: () => newId(itemsPath),
    }),
  );
  return bid;
}

export function updateBoard(
  wid: string,
  bid: string,
  patch: Parameters<typeof planUpdateBoard>[2],
) {
  return commitOps('board:update', planUpdateBoard(wid, bid, patch));
}

export function saveColumns(wid: string, bid: string, columns: Column[]) {
  return updateBoard(wid, bid, { columns });
}

export function saveGroups(wid: string, bid: string, groups: Group[]) {
  return updateBoard(wid, bid, { groups });
}

/** Admin only: hard-deletes a board with its items, views and counter. */
export async function deleteBoardCompletely(wid: string, bid: string): Promise<void> {
  const base = paths.board(wid, bid);
  const [items, views] = await Promise.all([
    readQuery('board:deleteScan', collection(db, `${base}/items`)),
    readQuery('board:deleteScan', collection(db, `${base}/views`)),
  ]);
  const ops: WriteOp[] = [
    ...items.docs.map((d) => ({ kind: 'delete' as const, path: d.ref.path })),
    ...views.docs.map((d) => ({ kind: 'delete' as const, path: d.ref.path })),
    { kind: 'delete', path: boardPaths.counter(wid, bid) },
  ];
  await commitOpsChunked('board:deleteContents', ops);
  await commitOps('board:delete', [{ kind: 'delete', path: base }]);
}

/** Adds an item at the end of a group, numbered from the board counter (transaction). */
export function createItem(input: {
  board: Board;
  wid: string;
  uid: string;
  name: string;
  groupId: string;
  afterOrder: string | null;
  values?: Record<string, unknown>;
  parentId?: string | null;
  fallbackNumber: number;
}): Promise<void> {
  const iid = newId(boardPaths.items(input.wid, input.board.id));
  // Items typed in quick succession must land in order, even before the first one has come
  // back from the server: go after the later of the last order on screen and the last one we issued.
  const slot = `${input.board.id}:${input.parentId ?? input.groupId}`;
  const issued = lastIssuedOrder.get(slot) ?? null;
  const base =
    [input.afterOrder, issued]
      .filter((x): x is string => x !== null)
      .sort()
      .at(-1) ?? null;
  const order = keyBetween(base, null);
  lastIssuedOrder.set(slot, order);
  return serialized(() =>
    runOpsTransaction('item:create', async (get) => {
      const counter = await get(doc(db, boardPaths.counter(input.wid, input.board.id)));
      const next = (counter.data()?.['next'] as number | undefined) ?? input.fallbackNumber;
      const ops = planCreateItem({
        wid: input.wid,
        bid: input.board.id,
        iid,
        uid: input.uid,
        columns: input.board.columns,
        counterExists: counter.exists(),
        item: {
          name: input.name,
          groupId: input.groupId,
          order,
          itemNumber: next,
          parentId: input.parentId ?? null,
          values: { ...defaultItemValues(input.board.columns), ...(input.values ?? {}) },
        },
      });
      ops.push(activity(input.wid, input.board.id, input.uid, 'create', iid, input.name.trim()));
      const rt = runtimeFor(input.board.id);
      if (!rt || enabledAutomations(input.board.id).length === 0) return ops;
      const itemsAfter = new Map<string, EngineItem>(rt.items);
      itemsAfter.set(iid, {
        id: iid,
        name: input.name.trim(),
        groupId: input.groupId,
        order,
        parentId: input.parentId ?? null,
        itemNumber: next,
        values: cleanValues(input.board.columns, {
          ...defaultItemValues(input.board.columns),
          ...(input.values ?? {}),
        }),
        archived: false,
        deleted: false,
      });
      return addAutomationOps({
        bid: input.board.id,
        actor: input.uid,
        baseOps: ops,
        event: { kind: 'created', itemId: iid },
        itemsAfter,
        startNumber: next + 1,
        counterExists: counter.exists(),
      });
    }),
  );
}

export function setCell(input: {
  wid: string;
  board: Board;
  item: BoardItem;
  uid: string;
  column: Column;
  value: unknown;
}) {
  const ops = planSetCell({
    wid: input.wid,
    bid: input.board.id,
    iid: input.item.id,
    uid: input.uid,
    columns: input.board.columns,
    column: input.column,
    currentValues: input.item.values,
    value: input.value,
  });
  // Tell people when they've been put on an item.
  if (input.column.type === 'people') {
    const asList = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const itemsPath = boardPaths.items(input.wid, input.board.id);
    ops.push(
      ...planAssignmentNotifications({
        wid: input.wid,
        bid: input.board.id,
        iid: input.item.id,
        actor: input.uid,
        actorName: auth.currentUser?.displayName ?? auth.currentUser?.email ?? 'Someone',
        itemName: input.item.name || 'an item',
        boardName: input.board.name,
        before: asList(input.item.values[input.column.id]),
        after: asList(input.value),
        newId: () => newId(itemsPath),
      }),
    );
  }
  const change = cellActivity({
    column: input.column,
    before: input.item.values[input.column.id],
    after: input.value,
    memberName: personName,
  });
  if (change)
    ops.push(
      activity(
        input.wid,
        input.board.id,
        input.uid,
        change.type,
        input.item.id,
        input.item.name,
        change.data,
      ),
    );
  return commitWithAutomations(`cell:${input.column.type}`, input.board.id, ops, (base, ctl) => {
    if (isComputedType(input.column.type)) return base;
    const before = normalizeValue(input.column, input.item.values[input.column.id]);
    const after = normalizeValue(input.column, input.value);
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return base;
    const rt = runtimeFor(input.board.id);
    if (!rt) return base;
    const values = { ...input.item.values };
    if (after === null) delete values[input.column.id];
    else values[input.column.id] = after;
    const itemsAfter = new Map<string, EngineItem>(rt.items);
    itemsAfter.set(input.item.id, { ...input.item, values });
    return addAutomationOps({
      bid: input.board.id,
      actor: input.uid,
      baseOps: base,
      event: { kind: 'cell', itemId: input.item.id, columnId: input.column.id, before, after },
      itemsAfter,
      startNumber: ctl.startNumber,
      counterExists: ctl.counterExists,
    });
  });
}

/**
 * Commits `ops` plus whatever the board's instant automations add, atomically. If an
 * automation can create items it needs the board counter, so the write becomes a transaction
 * (which needs a connection); otherwise it is an ordinary batch that also works offline.
 */
function commitWithAutomations(
  label: string,
  bid: string,
  ops: WriteOp[],
  plan: (base: WriteOp[], ctl: { startNumber: number | null; counterExists: boolean }) => WriteOp[],
): Promise<void> {
  if (enabledAutomations(bid).length === 0) return commitOps(label, ops);
  const rt = runtimeFor(bid);
  if (rt && usesNumbering(bid)) {
    return serialized(() =>
      runOpsTransaction(`${label}:auto`, async (get) => {
        const counter = await get(doc(db, boardPaths.counter(rt.wid, bid)));
        const next = (counter.data()?.['next'] as number | undefined) ?? 1;
        return plan(ops, { startNumber: next, counterExists: counter.exists() });
      }),
    );
  }
  return commitOps(label, plan(ops, { startNumber: null, counterExists: true }));
}

export function renameItem(wid: string, bid: string, iid: string, uid: string, name: string) {
  return commitOps('item:rename', planUpdateItem(wid, bid, iid, uid, { name }));
}

export function moveItem(
  wid: string,
  bid: string,
  iid: string,
  uid: string,
  groupId: string,
  order: string,
) {
  return commitOps('item:move', planUpdateItem(wid, bid, iid, uid, { groupId, order }));
}

export function archiveItem(wid: string, bid: string, iid: string, uid: string, archived: boolean) {
  return commitOps('item:archive', planUpdateItem(wid, bid, iid, uid, { archived }));
}

export function deleteItem(wid: string, bid: string, iid: string, uid: string) {
  return commitOps('item:delete', planDeleteItem(wid, bid, iid, uid));
}

/** Deletes a group: tombstones its items and removes it from the board, atomically. */
export function deleteGroup(input: {
  wid: string;
  board: Board;
  uid: string;
  groupId: string;
  itemIds: string[];
}) {
  const ops: WriteOp[] = [
    ...input.itemIds.flatMap((iid) => planDeleteItem(input.wid, input.board.id, iid, input.uid)),
    ...planUpdateBoard(input.wid, input.board.id, {
      groups: input.board.groups.filter((g) => g.id !== input.groupId),
    }),
  ];
  return commitOpsChunked('group:delete', ops);
}

// ------------------------------------------------------------ 2b: views

/** Saves a view's settings (filters, sort, group-by, options…). */
export function saveViewConfig(
  wid: string,
  bid: string,
  vid: string,
  uid: string,
  config: ViewConfig,
  exists: boolean,
) {
  const path = boardPaths.view(wid, bid, vid);
  return commitOps(
    'view:save',
    exists
      ? [{ kind: 'update', path, data: { config, updatedAt: SERVER_TIME } }]
      : [
          {
            kind: 'set',
            path,
            data: {
              type: 'table',
              name: 'Main table',
              order: 'a0',
              config,
              createdBy: uid,
              updatedAt: SERVER_TIME,
            },
          },
        ],
  );
}

export function createView(input: {
  wid: string;
  bid: string;
  uid: string;
  type: ViewType;
  name: string;
  lastOrder: string | null;
  config: ViewConfig;
}): Promise<string> {
  const vid = shortId();
  return commitOps('view:create', [
    {
      kind: 'set',
      path: boardPaths.view(input.wid, input.bid, vid),
      data: {
        type: input.type,
        name: input.name.trim().slice(0, 80) || VIEW_TYPE_META[input.type].defaultName,
        order: keyBetween(input.lastOrder, null),
        config: input.config,
        createdBy: input.uid,
        updatedAt: SERVER_TIME,
      },
    },
  ]).then(() => vid);
}

export function renameView(wid: string, bid: string, vid: string, name: string) {
  return commitOps('view:rename', [
    {
      kind: 'update',
      path: boardPaths.view(wid, bid, vid),
      data: { name: name.trim().slice(0, 80), updatedAt: SERVER_TIME },
    },
  ]);
}

export function deleteView(wid: string, bid: string, vid: string) {
  return commitOps('view:delete', [{ kind: 'delete', path: boardPaths.view(wid, bid, vid) }]);
}

// ------------------------------------------------------------ 2b: item actions

export interface ItemTree {
  id: string;
  childIds: string[];
}

export function bulkSetCell(input: {
  wid: string;
  board: Board;
  uid: string;
  column: Column;
  items: BoardItem[];
  value: unknown;
}) {
  const ops = planBulkSetCell({
    wid: input.wid,
    bid: input.board.id,
    uid: input.uid,
    columns: input.board.columns,
    column: input.column,
    items: input.items,
    value: input.value,
  });
  if (input.items.length > 0)
    ops.push(
      activity(input.wid, input.board.id, input.uid, 'bulk', null, '', {
        text: `set ${input.column.title}`,
        count: input.items.length,
      }),
    );
  return commitOpsChunked('bulk:set', ops);
}

export function moveItemsToGroup(input: {
  wid: string;
  bid: string;
  uid: string;
  groupId: string;
  moves: Array<ItemTree & { order: string }>;
  /** For the activity log: the moved items' names and the target group's name. */
  log?: { items: Array<{ id: string; name: string }>; groupName: string };
}) {
  const ops = planMoveItems({
    wid: input.wid,
    bid: input.bid,
    uid: input.uid,
    groupId: input.groupId,
    moves: input.moves,
  });
  if (input.log)
    ops.push(
      ...activityForMany(
        input.wid,
        input.bid,
        input.uid,
        'moved',
        input.log.items,
        input.log.groupName,
      ),
    );
  // A single card/row moved to another group can fire "moved to group" automations.
  const only = input.moves.length === 1 ? input.moves[0] : undefined;
  const rt = runtimeFor(input.bid);
  const before = only ? rt?.items.get(only.id) : undefined;
  if (
    only &&
    rt &&
    before &&
    before.groupId !== input.groupId &&
    enabledAutomations(input.bid).length > 0
  ) {
    return commitWithAutomations('item:move', input.bid, ops, (base, ctl) => {
      const itemsAfter = new Map<string, EngineItem>(rt.items);
      itemsAfter.set(only.id, { ...before, groupId: input.groupId, order: only.order });
      for (const c of only.childIds) {
        const child = rt.items.get(c);
        if (child) itemsAfter.set(c, { ...child, groupId: input.groupId });
      }
      return addAutomationOps({
        bid: input.bid,
        actor: input.uid,
        baseOps: base,
        event: {
          kind: 'moved',
          itemId: only.id,
          fromGroupId: before.groupId,
          toGroupId: input.groupId,
        },
        itemsAfter,
        startNumber: ctl.startNumber,
        counterExists: ctl.counterExists,
      });
    });
  }
  return commitOpsChunked('item:move', ops);
}

/** `ids` must already include subitems of any parent being archived/deleted. */
export function archiveItems(
  wid: string,
  bid: string,
  uid: string,
  ids: string[],
  archived: boolean,
) {
  return commitOpsChunked('item:archive', planArchiveItems(wid, bid, uid, ids, archived));
}

export function deleteItems(
  wid: string,
  bid: string,
  uid: string,
  ids: string[],
  /** For the activity log: the top-level items being deleted. */
  logged?: Array<{ id: string; name: string }>,
) {
  const ops = planDeleteItems(wid, bid, uid, ids);
  if (logged) ops.push(...activityForMany(wid, bid, uid, 'deleted', logged));
  return commitOpsChunked('item:delete', ops);
}

/** Undo for deletes: clears the tombstone (and archive flag). */
export function restoreItems(wid: string, bid: string, uid: string, ids: string[]) {
  return commitOpsChunked(
    'item:restore',
    ids.flatMap((id) => planRestoreItem(wid, bid, id, uid)),
  );
}

export function duplicateItems(input: {
  wid: string;
  board: Board;
  uid: string;
  items: DuplicableItem[];
  lastOrderByGroup: Map<string, string | null>;
  fallbackNumber: number;
}) {
  const itemsPath = boardPaths.items(input.wid, input.board.id);
  return serialized(() =>
    runOpsTransaction('item:duplicate', async (get) => {
      const counter = await get(doc(db, boardPaths.counter(input.wid, input.board.id)));
      return planDuplicateItems({
        wid: input.wid,
        bid: input.board.id,
        uid: input.uid,
        columns: input.board.columns,
        startNumber: (counter.data()?.['next'] as number | undefined) ?? input.fallbackNumber,
        counterExists: counter.exists(),
        items: input.items,
        lastOrderByGroup: input.lastOrderByGroup,
        newId: () => newId(itemsPath),
      });
    }),
  );
}

// ------------------------------------------------------- 2b: column actions

export function applyColumnConversion(input: {
  wid: string;
  board: Board;
  uid: string;
  oldType: Column['type'];
  result: ConversionResult;
  items: BoardItem[];
}) {
  return commitOpsChunked(
    'column:convert',
    planApplyConversion({
      wid: input.wid,
      bid: input.board.id,
      uid: input.uid,
      columns: input.board.columns,
      newColumn: input.result.column,
      changes: input.result.changes,
      itemValues: new Map(input.items.map((i) => [i.id, i.values])),
      touchesPeople: input.oldType === 'people' || input.result.column.type === 'people',
    }),
  );
}

export { convertColumn };

// ---------------------------------------------------- 2b: board duplication

export async function duplicateBoard(input: {
  wid: string;
  source: Board;
  uid: string;
  name: string;
  lastOrder: string | null;
}): Promise<string> {
  const { wid, source } = input;
  const bid = newId(paths.boards(wid));
  const itemsPath = boardPaths.items(wid, bid);
  const [items, views, counter] = await Promise.all([
    readQuery('board:dupScan', collection(db, boardPaths.items(wid, source.id))),
    readQuery('board:dupScan', collection(db, `${paths.board(wid, source.id)}/views`)),
    readDoc('board:dupScan', doc(db, boardPaths.counter(wid, source.id))),
  ]);
  const live = items.docs.filter((d) => d.data()['deletedAt'] == null);
  const ops = planDuplicateBoard({
    wid,
    newBid: bid,
    uid: input.uid,
    name: input.name,
    order: keyBetween(input.lastOrder, null),
    source: {
      board: source,
      items: live.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          name: String(x['name'] ?? ''),
          groupId: String(x['groupId'] ?? ''),
          order: String(x['order'] ?? 'a0'),
          parentId: typeof x['parentId'] === 'string' ? x['parentId'] : null,
          itemNumber: typeof x['itemNumber'] === 'number' ? x['itemNumber'] : 0,
          values: (x['values'] as Record<string, unknown>) ?? {},
          archived: x['archived'] === true,
        };
      }),
      views: views.docs.map((d) => {
        const x = d.data();
        return {
          type: String(x['type'] ?? 'table'),
          name: String(x['name'] ?? 'Table'),
          order: String(x['order'] ?? 'a0'),
          config: x['config'] ?? {},
        };
      }),
      counterNext: (counter.data()?.['next'] as number | undefined) ?? live.length + 1,
    },
    newId: () => newId(itemsPath),
  });
  await commitOpsChunked('board:duplicate', ops);
  return bid;
}

// -------------------------------------------------- 2b: folders & favourites

export function createFolder(wid: string, uid: string, name: string, lastOrder: string | null) {
  const fid = newId(paths.folders(wid));
  return commitOps('folder:create', [
    {
      kind: 'set',
      path: paths.folder(wid, fid),
      data: {
        name: name.trim().slice(0, 200),
        order: keyBetween(lastOrder, null),
        createdBy: uid,
        createdAt: SERVER_TIME,
      },
    },
  ]);
}

export function renameFolder(wid: string, fid: string, name: string) {
  return commitOps('folder:rename', [
    { kind: 'update', path: paths.folder(wid, fid), data: { name: name.trim().slice(0, 200) } },
  ]);
}

/** Boards in the folder move back to the top level; nothing is deleted but the folder. */
export function deleteFolder(wid: string, fid: string, boardIds: string[]) {
  return commitOpsChunked('folder:delete', [
    ...boardIds.flatMap((bid) => planUpdateBoard(wid, bid, { folderId: null })),
    { kind: 'delete' as const, path: paths.folder(wid, fid) },
  ]);
}

export function setBoardFolder(wid: string, bid: string, folderId: string | null) {
  return updateBoard(wid, bid, { folderId });
}

/**
 * Writes my whole favourites list. (An array-union inside the nested `settings` map is
 * rejected by the rules — they can't see through the transform — and a plain list also
 * keeps the 200-item cap checkable.)
 */
export function setFavorite(uid: string, favoriteBoardIds: string[]) {
  return commitOps('favorite', [
    {
      kind: 'update',
      path: paths.user(uid),
      data: { 'settings.favoriteBoardIds': favoriteBoardIds },
    },
  ]);
}
