import {
  boardPaths,
  buildTemplate,
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
import { commitOps, commitOpsChunked, readQuery, runOpsTransaction } from '../../lib/firestore';
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
        values: input.values ?? {},
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
