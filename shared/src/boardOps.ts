import { BOARD_SCHEMA_VERSION, type BoardVisibility, type Group } from './board';
import { computeAssignees, normalizeValue, type Column } from './columns';
import { keysBetween } from './ordering';
import { DELETE_FIELD, SERVER_TIME, type DocData, type WriteOp } from './ops';
import { paths } from './paths';
import type { BuiltTemplate } from './templates';

export const boardPaths = {
  view: (wid: string, bid: string, vid: string) => `${paths.board(wid, bid)}/views/${vid}`,
  counter: (wid: string, bid: string) => `${paths.board(wid, bid)}/meta/counter`,
  items: (wid: string, bid: string) => `${paths.board(wid, bid)}/items`,
  item: (wid: string, bid: string, iid: string) => `${paths.board(wid, bid)}/items/${iid}`,
};

export interface NewItemInput {
  name: string;
  groupId: string;
  order: string;
  itemNumber: number;
  parentId?: string | null;
  values?: Record<string, unknown>;
}

function itemDoc(uid: string, columns: readonly Column[], it: NewItemInput): DocData {
  const values = cleanValues(columns, it.values ?? {});
  return {
    name: it.name.trim(),
    groupId: it.groupId,
    order: it.order,
    parentId: it.parentId ?? null,
    itemNumber: it.itemNumber,
    values,
    assigneeUids: computeAssignees(columns, values),
    reminderKeys: [],
    archived: false,
    deletedAt: null,
    createdBy: uid,
    createdAt: SERVER_TIME,
    updatedBy: uid,
    updatedAt: SERVER_TIME,
  };
}

/** Drops values that don't match their column (or belong to no column). */
export function cleanValues(
  columns: readonly Column[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    const v = normalizeValue(col, values[col.id]);
    if (v !== null) out[col.id] = v;
  }
  return out;
}

/** Board + default table view + counter + template items, in one batch. */
export function planCreateBoard(input: {
  wid: string;
  bid: string;
  viewId: string;
  uid: string;
  name: string;
  description?: string;
  visibility: BoardVisibility;
  memberIds?: string[];
  order: string;
  template: BuiltTemplate;
  newItemId: () => string;
}): WriteOp[] {
  const { wid, bid, uid, template } = input;
  const memberIds =
    input.visibility === 'private' ? [...new Set([uid, ...(input.memberIds ?? [])])] : [];
  const ops: WriteOp[] = [
    {
      kind: 'set',
      path: paths.board(wid, bid),
      data: {
        name: input.name.trim(),
        description: input.description ?? '',
        folderId: null,
        order: input.order,
        visibility: input.visibility,
        memberIds,
        columns: template.columns,
        groups: template.groups,
        schemaVersion: BOARD_SCHEMA_VERSION,
        archived: false,
        createdBy: uid,
        createdAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
      },
    },
    {
      kind: 'set',
      path: boardPaths.view(wid, bid, input.viewId),
      data: {
        type: 'table',
        name: 'Main table',
        order: 'a0',
        config: {},
        createdBy: uid,
        updatedAt: SERVER_TIME,
      },
    },
    { kind: 'set', path: boardPaths.counter(wid, bid), data: { next: template.items.length + 1 } },
  ];
  // Order keys per group, in template order.
  const byGroup = new Map<string, number>();
  template.items.forEach((it) => byGroup.set(it.groupId, (byGroup.get(it.groupId) ?? 0) + 1));
  const keys = new Map<string, string[]>();
  for (const [g, n] of byGroup) keys.set(g, keysBetween(null, null, n));
  template.items.forEach((it, i) => {
    const order = (keys.get(it.groupId) as string[]).shift() as string;
    ops.push({
      kind: 'set',
      path: boardPaths.item(wid, bid, input.newItemId()),
      data: itemDoc(uid, template.columns, { ...it, order, itemNumber: i + 1 }),
    });
  });
  return ops;
}

/** Board-level edits (name, description, columns, groups, visibility, archived). */
export function planUpdateBoard(
  wid: string,
  bid: string,
  patch: Partial<{
    name: string;
    description: string;
    columns: Column[];
    groups: Group[];
    visibility: BoardVisibility;
    memberIds: string[];
    archived: boolean;
    order: string;
  }>,
): WriteOp[] {
  return [
    { kind: 'update', path: paths.board(wid, bid), data: { ...patch, updatedAt: SERVER_TIME } },
  ];
}

/**
 * New item. Run inside a transaction that read `counter.next` (= itemNumber),
 * so autonumbers never collide.
 */
export function planCreateItem(input: {
  wid: string;
  bid: string;
  iid: string;
  uid: string;
  columns: readonly Column[];
  item: NewItemInput;
  counterExists: boolean;
}): WriteOp[] {
  const { wid, bid } = input;
  return [
    {
      kind: input.counterExists ? 'update' : 'set',
      path: boardPaths.counter(wid, bid),
      data: { next: input.item.itemNumber + 1 },
    },
    {
      kind: 'set',
      path: boardPaths.item(wid, bid, input.iid),
      data: itemDoc(input.uid, input.columns, input.item),
    },
  ];
}

function stamp(uid: string): DocData {
  return { updatedBy: uid, updatedAt: SERVER_TIME };
}

export function planUpdateItem(
  wid: string,
  bid: string,
  iid: string,
  uid: string,
  patch: Partial<{ name: string; groupId: string; order: string; archived: boolean }>,
): WriteOp[] {
  const data: DocData = { ...patch, ...stamp(uid) };
  if (typeof patch.name === 'string') data['name'] = patch.name.trim();
  return [{ kind: 'update', path: boardPaths.item(wid, bid, iid), data }];
}

/** Sets (or clears) one cell, keeping assigneeUids in step with People columns. */
export function planSetCell(input: {
  wid: string;
  bid: string;
  iid: string;
  uid: string;
  columns: readonly Column[];
  column: Column;
  currentValues: Record<string, unknown>;
  value: unknown;
}): WriteOp[] {
  const v = normalizeValue(input.column, input.value);
  const data: DocData = {
    [`values.${input.column.id}`]: v === null ? DELETE_FIELD : v,
    ...stamp(input.uid),
  };
  if (input.column.type === 'people') {
    const next = { ...input.currentValues, [input.column.id]: v };
    data['assigneeUids'] = computeAssignees(input.columns, next);
  }
  return [{ kind: 'update', path: boardPaths.item(input.wid, input.bid, input.iid), data }];
}

/** Soft delete (tombstone): other clients' caches learn about it via delta sync. */
export function planDeleteItem(wid: string, bid: string, iid: string, uid: string): WriteOp[] {
  return [
    {
      kind: 'update',
      path: boardPaths.item(wid, bid, iid),
      data: { deletedAt: SERVER_TIME, ...stamp(uid) },
    },
  ];
}

export function planRestoreItem(wid: string, bid: string, iid: string, uid: string): WriteOp[] {
  return [
    {
      kind: 'update',
      path: boardPaths.item(wid, bid, iid),
      data: { deletedAt: null, archived: false, ...stamp(uid) },
    },
  ];
}
