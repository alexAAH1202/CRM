import { BOARD_SCHEMA_VERSION, type BoardDoc, type BoardVisibility, type Group } from './board';
import {
  computeAssignees,
  isComputedType,
  normalizeValue,
  type Column,
  type DependencyValue,
} from './columns';
import { keysBetween } from './ordering';
import { DELETE_FIELD, SERVER_TIME, type DocData, type WriteOp } from './ops';
import { paths } from './paths';
import type { BuiltTemplate } from './templates';

export const boardPaths = {
  view: (wid: string, bid: string, vid: string) => `${paths.board(wid, bid)}/views/${vid}`,
  counter: (wid: string, bid: string) => `${paths.board(wid, bid)}/meta/counter`,
  items: (wid: string, bid: string) => `${paths.board(wid, bid)}/items`,
  item: (wid: string, bid: string, iid: string) => `${paths.board(wid, bid)}/items/${iid}`,
  activity: (wid: string, bid: string) => `${paths.board(wid, bid)}/activity`,
  runs: (wid: string, bid: string) => `${paths.board(wid, bid)}/automationRuns`,
  events: (wid: string, bid: string) => `${paths.board(wid, bid)}/scheduledEvents`,
  event: (wid: string, bid: string, eid: string) =>
    `${paths.board(wid, bid)}/scheduledEvents/${eid}`,
  automations: (wid: string, bid: string) => `${paths.board(wid, bid)}/automations`,
  automation: (wid: string, bid: string, aid: string) =>
    `${paths.board(wid, bid)}/automations/${aid}`,
  activityDoc: (wid: string, bid: string, id: string) => `${paths.board(wid, bid)}/activity/${id}`,
};

export interface NewItemInput {
  name: string;
  groupId: string;
  order: string;
  itemNumber: number;
  parentId?: string | null;
  values?: Record<string, unknown>;
}

/** The stored document for a new item (also used by the automation engine). */
export function buildItemDoc(uid: string, columns: readonly Column[], it: NewItemInput): DocData {
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
    if (isComputedType(col.type)) continue; // computed columns are never stored
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
      data: buildItemDoc(uid, template.columns, { ...it, order, itemNumber: i + 1 }),
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
    folderId: string | null;
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
      data: buildItemDoc(input.uid, input.columns, input.item),
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

export type AcceptanceState = 'pending' | 'accepted' | 'rejected';
export interface AcceptanceEntry {
  state: AcceptanceState;
  /** Who assigned them. */
  by: string;
}

/**
 * Field updates for item.acceptance when the assignees change: someone newly assigned by another
 * person is waiting to accept; assigning yourself counts as accepted; removed people are cleared.
 */
export function acceptanceChanges(
  before: readonly string[],
  after: readonly string[],
  editor: string,
): DocData {
  const had = new Set(before);
  const has = new Set(after);
  const out: DocData = {};
  for (const u of has)
    if (!had.has(u))
      out[`acceptance.${u}`] = { state: u === editor ? 'accepted' : 'pending', by: editor };
  for (const u of had) if (!has.has(u)) out[`acceptance.${u}`] = DELETE_FIELD;
  return out;
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
  if (isComputedType(input.column.type)) return []; // nothing to store for a computed column
  const v = normalizeValue(input.column, input.value);
  const data: DocData = {
    [`values.${input.column.id}`]: v === null ? DELETE_FIELD : v,
    ...stamp(input.uid),
  };
  if (input.column.type === 'people') {
    const next = { ...input.currentValues, [input.column.id]: v };
    const after = computeAssignees(input.columns, next);
    data['assigneeUids'] = after;
    Object.assign(
      data,
      acceptanceChanges(computeAssignees(input.columns, input.currentValues), after, input.uid),
    );
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

// ------------------------------------------------------------ 2b: bulk ops

type ItemRef = { id: string; values: Record<string, unknown> };

/** Sets (or clears) one column on many items. */
export function planBulkSetCell(input: {
  wid: string;
  bid: string;
  uid: string;
  columns: readonly Column[];
  column: Column;
  items: readonly ItemRef[];
  value: unknown;
}): WriteOp[] {
  return input.items.flatMap((it) =>
    planSetCell({
      wid: input.wid,
      bid: input.bid,
      iid: it.id,
      uid: input.uid,
      columns: input.columns,
      column: input.column,
      currentValues: it.values,
      value: input.value,
    }),
  );
}

/** Moves items (with their subitems) into a group, appended in the given order keys. */
export function planMoveItems(input: {
  wid: string;
  bid: string;
  uid: string;
  moves: ReadonlyArray<{ id: string; childIds: readonly string[]; order: string }>;
  groupId: string;
}): WriteOp[] {
  return input.moves.flatMap((m) => [
    ...planUpdateItem(input.wid, input.bid, m.id, input.uid, {
      groupId: input.groupId,
      order: m.order,
    }),
    ...m.childIds.flatMap((cid) =>
      planUpdateItem(input.wid, input.bid, cid, input.uid, { groupId: input.groupId }),
    ),
  ]);
}

/** Archive/restore items together with their subitems. */
export function planArchiveItems(
  wid: string,
  bid: string,
  uid: string,
  ids: readonly string[],
  archived: boolean,
): WriteOp[] {
  return ids.flatMap((id) => planUpdateItem(wid, bid, id, uid, { archived }));
}

/** Soft-deletes items together with their subitems. */
export function planDeleteItems(
  wid: string,
  bid: string,
  uid: string,
  ids: readonly string[],
): WriteOp[] {
  return ids.flatMap((id) => planDeleteItem(wid, bid, id, uid));
}

export interface DuplicableItem extends ItemRef {
  name: string;
  groupId: string;
  order: string;
  subitems: ReadonlyArray<{ name: string; order: string; values: Record<string, unknown> }>;
}

/**
 * Copies items (and their subitems) to the end of their groups. Numbers are taken
 * from `startNumber` (the board counter, read inside a transaction); the counter
 * is advanced once for the whole copy.
 */
/** A copy starts with no logged time (the hours were someone else's work on the original). */
export function withoutLoggedTime(
  columns: readonly Column[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...values };
  for (const c of columns) if (c.type === 'time') delete out[c.id];
  return out;
}

export function planDuplicateItems(input: {
  wid: string;
  bid: string;
  uid: string;
  columns: readonly Column[];
  startNumber: number;
  counterExists: boolean;
  items: readonly DuplicableItem[];
  /** Last existing order key per group, to append after. */
  lastOrderByGroup: ReadonlyMap<string, string | null>;
  newId: () => string;
}): WriteOp[] {
  const { wid, bid, uid, columns } = input;
  let n = input.startNumber;
  const lastByGroup = new Map(input.lastOrderByGroup);
  const ops: WriteOp[] = [];
  for (const it of input.items) {
    const last = lastByGroup.get(it.groupId) ?? null;
    const order = keysBetween(last, null, 1)[0] as string;
    lastByGroup.set(it.groupId, order);
    const pid = input.newId();
    ops.push({
      kind: 'set',
      path: boardPaths.item(wid, bid, pid),
      data: buildItemDoc(uid, columns, {
        name: `${it.name} (copy)`.slice(0, 500),
        groupId: it.groupId,
        order,
        itemNumber: n++,
        values: withoutLoggedTime(columns, it.values),
      }),
    });
    for (const s of it.subitems) {
      ops.push({
        kind: 'set',
        path: boardPaths.item(wid, bid, input.newId()),
        data: buildItemDoc(uid, columns, {
          name: s.name,
          groupId: it.groupId,
          order: s.order,
          itemNumber: n++,
          parentId: pid,
          values: withoutLoggedTime(columns, s.values),
        }),
      });
    }
  }
  ops.push({
    kind: input.counterExists ? 'update' : 'set',
    path: boardPaths.counter(wid, bid),
    data: { next: n },
  });
  return ops;
}

export interface BoardCopySource {
  board: Pick<
    BoardDoc,
    'description' | 'visibility' | 'memberIds' | 'columns' | 'groups' | 'folderId'
  >;
  items: ReadonlyArray<{
    id: string;
    name: string;
    groupId: string;
    order: string;
    parentId: string | null;
    itemNumber: number;
    values: Record<string, unknown>;
    archived: boolean;
  }>;
  views: ReadonlyArray<{ type: string; name: string; order: string; config: unknown }>;
  counterNext: number;
}

/** Dependencies point at item ids, so a copied board's must point at the copied items. */
export function remapDependencies(
  columns: readonly Column[],
  values: Record<string, unknown>,
  idMap: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const out = { ...values };
  for (const col of columns) {
    if (col.type !== 'dependency') continue;
    const deps = normalizeValue(col, values[col.id]);
    if (!Array.isArray(deps)) continue;
    const mapped = (deps as DependencyValue[])
      .filter((d) => idMap.has(d.id))
      .map((d) => ({ id: idMap.get(d.id) as string, lag: d.lag }));
    if (mapped.length) out[col.id] = mapped;
    else delete out[col.id];
  }
  return out;
}

/** Board + views + counter first, then items — chunk the result in order. */
export function planDuplicateBoard(input: {
  wid: string;
  newBid: string;
  uid: string;
  name: string;
  order: string;
  source: BoardCopySource;
  newId: () => string;
}): WriteOp[] {
  const { wid, newBid, uid, source } = input;
  const private_ = source.board.visibility === 'private';
  const ops: WriteOp[] = [
    {
      kind: 'set',
      path: paths.board(wid, newBid),
      data: {
        name: input.name.trim().slice(0, 200),
        description: source.board.description,
        folderId: source.board.folderId,
        order: input.order,
        visibility: source.board.visibility,
        memberIds: private_ ? [...new Set([uid, ...source.board.memberIds])] : [],
        columns: source.board.columns,
        groups: source.board.groups,
        schemaVersion: BOARD_SCHEMA_VERSION,
        archived: false,
        createdBy: uid,
        createdAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
      },
    },
    ...(source.views.length
      ? source.views
      : [{ type: 'table', name: 'Main table', order: 'a0', config: {} }]
    ).map((v, i): WriteOp => ({
      kind: 'set',
      path: boardPaths.view(wid, newBid, i === 0 ? 'main' : input.newId()),
      data: {
        type: v.type,
        name: v.name,
        order: v.order,
        config: v.config ?? {},
        createdBy: uid,
        updatedAt: SERVER_TIME,
      },
    })),
    {
      kind: 'set',
      path: boardPaths.counter(wid, newBid),
      data: { next: Math.max(1, source.counterNext) },
    },
  ];
  const idMap = new Map(source.items.map((i) => [i.id, input.newId()]));
  // Parents before children so a partially-applied copy never has orphans.
  const sorted = [...source.items].sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId));
  for (const it of sorted) {
    if (it.parentId && !idMap.has(it.parentId)) continue; // orphaned subitem
    const data = buildItemDoc(uid, source.board.columns, {
      name: it.name,
      groupId: it.groupId,
      order: it.order,
      itemNumber: it.itemNumber,
      parentId: it.parentId ? (idMap.get(it.parentId) as string) : null,
      values: withoutLoggedTime(
        source.board.columns,
        remapDependencies(source.board.columns, it.values, idMap),
      ),
    });
    data['archived'] = it.archived;
    ops.push({ kind: 'set', path: boardPaths.item(wid, newBid, idMap.get(it.id) as string), data });
  }
  return ops;
}

/**
 * Applies a column type conversion: replaces the column on the board and rewrites
 * the affected cells. Every write is stamped so delta sync picks it up.
 */
export function planApplyConversion(input: {
  wid: string;
  bid: string;
  uid: string;
  columns: readonly Column[];
  newColumn: Column;
  changes: ReadonlyArray<{ id: string; value: unknown }>;
  itemValues: ReadonlyMap<string, Record<string, unknown>>;
  touchesPeople: boolean;
}): WriteOp[] {
  const { wid, bid, uid } = input;
  const newColumns = input.columns.map((c) => (c.id === input.newColumn.id ? input.newColumn : c));
  const ops: WriteOp[] = [...planUpdateBoard(wid, bid, { columns: newColumns })];
  for (const ch of input.changes) {
    const data: DocData = {
      [`values.${input.newColumn.id}`]: ch.value === null ? DELETE_FIELD : ch.value,
      ...stamp(uid),
    };
    if (input.touchesPeople) {
      data['assigneeUids'] = computeAssignees(newColumns, {
        ...(input.itemValues.get(ch.id) ?? {}),
        [input.newColumn.id]: ch.value,
      });
    }
    ops.push({ kind: 'update', path: boardPaths.item(wid, bid, ch.id), data });
  }
  return ops;
}
