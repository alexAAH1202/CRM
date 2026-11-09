import {
  boardPaths,
  buildTemplate,
  convertColumn,
  defaultItemValues,
  planApplyConversion,
  planArchiveItems,
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
import { db } from '../../lib/firebase';
import {
  commitOps,
  commitOpsChunked,
  readDoc,
  readQuery,
  runOpsTransaction,
} from '../../lib/firestore';
import type { Board, BoardItem } from './types';

const newId = (path: string) => doc(collection(db, path)).id;

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
  return runOpsTransaction('item:create', async (get) => {
    const counter = await get(doc(db, boardPaths.counter(input.wid, input.board.id)));
    const next = (counter.data()?.['next'] as number | undefined) ?? input.fallbackNumber;
    return planCreateItem({
      wid: input.wid,
      bid: input.board.id,
      iid,
      uid: input.uid,
      columns: input.board.columns,
      counterExists: counter.exists(),
      item: {
        name: input.name,
        groupId: input.groupId,
        order: keyBetween(input.afterOrder, null),
        itemNumber: next,
        parentId: input.parentId ?? null,
        values: { ...defaultItemValues(input.board.columns), ...(input.values ?? {}) },
      },
    });
  });
}

export function setCell(input: {
  wid: string;
  board: Board;
  item: BoardItem;
  uid: string;
  column: Column;
  value: unknown;
}) {
  return commitOps(
    `cell:${input.column.type}`,
    planSetCell({
      wid: input.wid,
      bid: input.board.id,
      iid: input.item.id,
      uid: input.uid,
      columns: input.board.columns,
      column: input.column,
      currentValues: input.item.values,
      value: input.value,
    }),
  );
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

/** Saves a view's settings (filters, sort, group-by, hidden columns, widths). */
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
  return commitOpsChunked(
    'bulk:set',
    planBulkSetCell({
      wid: input.wid,
      bid: input.board.id,
      uid: input.uid,
      columns: input.board.columns,
      column: input.column,
      items: input.items,
      value: input.value,
    }),
  );
}

export function moveItemsToGroup(input: {
  wid: string;
  bid: string;
  uid: string;
  groupId: string;
  moves: Array<ItemTree & { order: string }>;
}) {
  return commitOpsChunked(
    'item:move',
    planMoveItems({
      wid: input.wid,
      bid: input.bid,
      uid: input.uid,
      groupId: input.groupId,
      moves: input.moves,
    }),
  );
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

export function deleteItems(wid: string, bid: string, uid: string, ids: string[]) {
  return commitOpsChunked('item:delete', planDeleteItems(wid, bid, uid, ids));
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
  return runOpsTransaction('item:duplicate', async (get) => {
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
  });
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
