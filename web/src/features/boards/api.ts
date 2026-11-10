import {
  boardPaths,
  buildTemplate,
  convertColumn,
  defaultItemValues,
  computeAssignees,
  planApplyConversion,
  planArchiveItems,
  planAssignmentNotifications,
  planActivity,
  normalizeValue,
  isComputedType,
  cleanValues,
  type AutoEvent,
  type CellChange,
  planCellReversal,
  UndoConflict,
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
  planImportChunk,
  type ImportItem,
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
  type LabelColor,
  planUpgradeBoard,
} from '@app/shared';
import { collection, doc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import {
  addAutomationOps,
  addAutomationOpsMany,
  enabledAutomations,
  MAX_BULK_AUTOMATION_ITEMS,
  runtimeFor,
  scheduleOpsFor,
  usesNumbering,
} from '../automations/runtime';
import {
  commitOps,
  commitOpsChunked,
  readDoc,
  readQuery,
  runOpsTransaction,
} from '../../lib/firestore';
import { toast } from '../../stores/toast';
import { saveWithUndo, type UndoEntry } from './undoStack';
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
  /** The list's starting sections; empty keeps the template's own groups. */
  sections?: ReadonlyArray<{ name: string; color: LabelColor }>;
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
      template: buildTemplate(input.template, input.sections),
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

/** One-off upgrade of an older list (adds the Group column); harmless to repeat. */
export function upgradeBoard(wid: string, board: Board) {
  if (planUpgradeBoard(wid, board.id, board).length === 0) return Promise.resolve();
  // Read the server's copy inside a transaction, so a stale cached copy or someone else's
  // simultaneous column change is never overwritten (and two editors don't both add it).
  return runOpsTransaction('board:upgrade', async (get) => {
    const snap = await get(doc(db, paths.board(wid, board.id)));
    const d = snap.data() as { columns?: Column[]; schemaVersion?: number } | undefined;
    if (!d || !Array.isArray(d.columns)) return [];
    return planUpgradeBoard(wid, board.id, { columns: d.columns, schemaVersion: d.schemaVersion });
  });
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
  // Everything that lives under the list: deleting a document leaves its sub-collections behind.
  const subs = ['items', 'views', 'automations', 'automationRuns', 'activity', 'scheduledEvents'];
  const scans = await Promise.all(
    subs.map((s) => readQuery('board:deleteScan', collection(db, `${base}/${s}`))),
  );
  const items = scans[0]!;
  // Each item's comments.
  const threads = await Promise.all(
    items.docs.map((d) => readQuery('board:deleteScan', collection(db, `${d.ref.path}/updates`))),
  );
  const ops: WriteOp[] = [
    ...threads.flatMap((t) => t.docs.map((d) => ({ kind: 'delete' as const, path: d.ref.path }))),
    ...scans.flatMap((s) => s.docs.map((d) => ({ kind: 'delete' as const, path: d.ref.path }))),
    { kind: 'delete', path: boardPaths.counter(wid, bid) },
  ];
  await commitOpsChunked('board:deleteContents', ops);
  await commitOps('board:delete', [{ kind: 'delete', path: base }]);
}

/** Schedule writes for items known only by id (archive / delete / restore): values come from the open board. */
function scheduleForIds(
  bid: string,
  ids: readonly string[],
  flags: { archived: boolean; deleted: boolean },
) {
  const rt = runtimeFor(bid);
  if (!rt) return [];
  return scheduleOpsFor(
    bid,
    ids.map((id) => ({ id, values: rt.items.get(id)?.values ?? {}, ...flags })),
  );
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
  // Undo removes it (a tombstone, like any delete); redo brings it back.
  const entry: UndoEntry = {
    label: `add “${clip(input.name.trim() || 'item')}”`,
    undo: () =>
      deleteItems(input.wid, input.board.id, input.uid, [iid], undefined, { quiet: true }),
    redo: () => restoreItems(input.wid, input.board.id, input.uid, [iid]),
  };
  return saveWithUndo(
    input.board.id,
    entry,
    serialized(() =>
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
        // People on a new item are told, and asked to accept, exactly as when they're added later.
        const assignees = computeAssignees(
          input.board.columns,
          cleanValues(input.board.columns, {
            ...defaultItemValues(input.board.columns),
            ...(input.values ?? {}),
          }),
        );
        if (assignees.length > 0) {
          const created = ops.find(
            (o) => o.kind === 'set' && o.path === boardPaths.item(input.wid, input.board.id, iid),
          );
          if (created && created.kind === 'set')
            created.data['acceptance'] = Object.fromEntries(
              assignees.map((u) => [
                u,
                { state: u === input.uid ? 'accepted' : 'pending', by: input.uid },
              ]),
            );
          ops.push(
            ...planAssignmentNotifications({
              wid: input.wid,
              bid: input.board.id,
              iid,
              actor: input.uid,
              actorName: auth.currentUser?.displayName ?? auth.currentUser?.email ?? 'Someone',
              itemName: input.name.trim() || 'an item',
              boardName: input.board.name,
              before: [],
              after: assignees,
              newId: () => newId(boardPaths.items(input.wid, input.board.id)),
            }),
          );
        }
        ops.push(activity(input.wid, input.board.id, input.uid, 'create', iid, input.name.trim()));
        ops.push(
          ...scheduleOpsFor(input.board.id, [
            {
              id: iid,
              values: cleanValues(input.board.columns, {
                ...defaultItemValues(input.board.columns),
                ...(input.values ?? {}),
              }),
              archived: false,
              deleted: false,
            },
          ]),
        );
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
    ),
  );
}

const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Reverses or re-applies cell edits for undo/redo, only where each cell is still exactly as the
 * edit left it (see planCellReversal). Quiet by design: no automations, no new history.
 */
async function writeCellReversal(
  bid: string,
  uid: string,
  columnId: string,
  changes: CellChange[],
) {
  const rt = runtimeFor(bid);
  if (!rt) throw new UndoConflict('open the list to do that.');
  const column = rt.board.columns.find((c) => c.id === columnId);
  if (!column) throw new UndoConflict('that column no longer exists.');
  const r = planCellReversal({
    wid: rt.wid,
    bid,
    uid,
    columns: rt.board.columns,
    column,
    changes,
    items: new Map([...rt.items].map(([id, i]) => [id, { values: i.values, deleted: i.deleted }])),
  });
  if (r.applied.length === 0)
    throw new UndoConflict(
      r.skipped.some((x) => x.reason === 'changed')
        ? 'it has been changed again since.'
        : 'the item is gone.',
    );
  const ops = [...r.ops];
  if (column.type === 'date' || column.type === 'timeline') {
    const to = new Map(changes.map((c) => [c.id, c.to]));
    ops.push(
      ...scheduleOpsFor(
        bid,
        r.applied.map((id) => {
          const it = rt.items.get(id) as BoardItem;
          const v = normalizeValue(column, to.get(id));
          const values = { ...it.values };
          if (v === null) delete values[column.id];
          else values[column.id] = v;
          return { id, values, archived: it.archived, deleted: false };
        }),
      ),
    );
  }
  await commitOpsChunked('undo:cells', ops);
  if (r.skipped.length > 0)
    toast.info(
      `${plural(r.skipped.length, 'item')} had changed since and ${r.skipped.length === 1 ? 'was' : 'were'} left as they are.`,
    );
}

function cellUndoEntry(
  bid: string,
  uid: string,
  label: string,
  column: Column,
  edits: Array<{ id: string; before: unknown; after: unknown }>,
): UndoEntry | null {
  if (isComputedType(column.type)) return null;
  const changes = edits
    .map((e) => ({
      id: e.id,
      before: normalizeValue(column, e.before),
      after: normalizeValue(column, e.after),
    }))
    .filter((e) => JSON.stringify(e.before ?? null) !== JSON.stringify(e.after ?? null));
  if (changes.length === 0) return null;
  return {
    label,
    undo: () =>
      writeCellReversal(
        bid,
        uid,
        column.id,
        changes.map((c) => ({ id: c.id, from: c.after, to: c.before })),
      ),
    redo: () =>
      writeCellReversal(
        bid,
        uid,
        column.id,
        changes.map((c) => ({ id: c.id, from: c.before, to: c.after })),
      ),
  };
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
  // A date changed: keep the helper's schedule queue in step, in the same batch.
  if (input.column.type === 'date' || input.column.type === 'timeline') {
    const v = normalizeValue(input.column, input.value);
    const values = { ...input.item.values };
    if (v === null) delete values[input.column.id];
    else values[input.column.id] = v;
    ops.push(
      ...scheduleOpsFor(input.board.id, [
        { id: input.item.id, values, archived: input.item.archived, deleted: false },
      ]),
    );
  }
  const entry = cellUndoEntry(
    input.board.id,
    input.uid,
    `edit ${input.column.title} on “${clip(input.item.name || 'item')}”`,
    input.column,
    [{ id: input.item.id, before: input.item.values[input.column.id], after: input.value }],
  );
  return saveWithUndo(
    input.board.id,
    entry,
    commitWithAutomations(`cell:${input.column.type}`, input.board.id, ops, (base, ctl) => {
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
    }),
  );
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
  const before = runtimeFor(bid)?.items.get(iid)?.name;
  const after = name.trim();
  const set = (from: string, to: string) => {
    const cur = runtimeFor(bid)?.items.get(iid);
    if (!cur || cur.deleted) throw new UndoConflict('the item is gone.');
    if (cur.name !== from) throw new UndoConflict('it has been renamed again since.');
    return commitOps('undo:rename', planUpdateItem(wid, bid, iid, uid, { name: to }));
  };
  const entry: UndoEntry | null =
    before === undefined || before === after
      ? null
      : {
          label: `rename “${clip(before)}”`,
          undo: () => set(after, before),
          redo: () => set(before, after),
        };
  return saveWithUndo(
    bid,
    entry,
    commitOps('item:rename', planUpdateItem(wid, bid, iid, uid, { name })),
  );
}

export function moveItem(
  wid: string,
  bid: string,
  iid: string,
  uid: string,
  groupId: string,
  order: string,
) {
  const was = runtimeFor(bid)?.items.get(iid);
  const prior = was ? { groupId: was.groupId, order: was.order } : null;
  const entry: UndoEntry | null =
    !prior || (prior.groupId === groupId && prior.order === order)
      ? null
      : {
          label: `move “${clip(was?.name ?? 'item')}”`,
          undo: () =>
            reposition(wid, bid, uid, [
              { id: iid, from: { groupId, order }, to: prior, childIds: [] },
            ]),
          redo: () =>
            reposition(wid, bid, uid, [
              { id: iid, from: prior, to: { groupId, order }, childIds: [] },
            ]),
        };
  return saveWithUndo(
    bid,
    entry,
    commitOps('item:move', planUpdateItem(wid, bid, iid, uid, { groupId, order })),
  );
}

interface Position {
  groupId: string;
  order: string;
}

/** Puts items back in a position (undo/redo of moves), unless they were moved again since. */
function reposition(
  wid: string,
  bid: string,
  uid: string,
  moves: Array<{ id: string; from: Position; to: Position; childIds: string[] }>,
) {
  const rt = runtimeFor(bid);
  if (!rt) throw new UndoConflict('open the list to do that.');
  const ops: WriteOp[] = [];
  for (const m of moves) {
    const cur = rt.items.get(m.id);
    if (!cur || cur.deleted) throw new UndoConflict('an item is gone.');
    if (cur.groupId !== m.from.groupId || cur.order !== m.from.order)
      throw new UndoConflict('it has been moved again since.');
    ops.push(...planUpdateItem(wid, bid, m.id, uid, { groupId: m.to.groupId, order: m.to.order }));
    for (const c of m.childIds)
      ops.push(...planUpdateItem(wid, bid, c, uid, { groupId: m.to.groupId }));
  }
  return commitOpsChunked('undo:move', ops);
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
  const entry = cellUndoEntry(
    input.board.id,
    input.uid,
    `set ${input.column.title} on ${plural(input.items.length, 'item')}`,
    input.column,
    input.items.map((it) => ({
      id: it.id,
      before: it.values[input.column.id],
      after: input.value,
    })),
  );
  const ops = planBulkSetCell({
    wid: input.wid,
    bid: input.board.id,
    uid: input.uid,
    columns: input.board.columns,
    column: input.column,
    items: input.items,
    value: input.value,
  });
  if (input.column.type === 'date' || input.column.type === 'timeline') {
    const v = normalizeValue(input.column, input.value);
    ops.push(
      ...scheduleOpsFor(
        input.board.id,
        input.items.map((it) => {
          const values = { ...it.values };
          if (v === null) delete values[input.column.id];
          else values[input.column.id] = v;
          return { id: it.id, values, archived: it.archived, deleted: false };
        }),
      ),
    );
  }
  if (input.items.length > 0)
    ops.push(
      activity(input.wid, input.board.id, input.uid, 'bulk', null, '', {
        text: `set ${input.column.title}`,
        count: input.items.length,
      }),
    );
  const rt = runtimeFor(input.board.id);
  const eligible =
    rt !== null &&
    enabledAutomations(input.board.id).length > 0 &&
    !isComputedType(input.column.type);
  if (eligible && input.items.length > MAX_BULK_AUTOMATION_ITEMS) {
    toast.info(
      `Automations didn’t run: they only run for up to ${MAX_BULK_AUTOMATION_ITEMS} items at a time.`,
    );
  } else if (eligible) {
    const after = normalizeValue(input.column, input.value);
    const events: AutoEvent[] = [];
    const itemsAfter = new Map<string, EngineItem>(rt.items);
    for (const it of input.items) {
      const before = normalizeValue(input.column, it.values[input.column.id]);
      if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) continue;
      const values = { ...it.values };
      if (after === null) delete values[input.column.id];
      else values[input.column.id] = after;
      itemsAfter.set(it.id, { ...it, values });
      events.push({ kind: 'cell', itemId: it.id, columnId: input.column.id, before, after });
    }
    if (events.length > 0)
      return saveWithUndo(
        input.board.id,
        entry,
        commitWithAutomations('bulk:set', input.board.id, ops, (base, ctl) =>
          addAutomationOpsMany({
            bid: input.board.id,
            actor: input.uid,
            baseOps: base,
            events,
            itemsAfter,
            startNumber: ctl.startNumber,
            counterExists: ctl.counterExists,
          }),
        ),
      );
  }
  return saveWithUndo(input.board.id, entry, commitOpsChunked('bulk:set', ops));
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
  const wid = input.wid;
  const priors = input.moves.flatMap((m) => {
    const was = runtimeFor(input.bid)?.items.get(m.id);
    return was ? [{ m, was }] : [];
  });
  const moveEntry = (): UndoEntry | null => {
    const moves = priors.filter(
      ({ m, was }) => was.groupId !== input.groupId || was.order !== m.order,
    );
    if (moves.length === 0) return null;
    const label =
      moves.length === 1
        ? `move “${clip(moves[0]!.was.name)}”`
        : `move ${plural(moves.length, 'item')}`;
    const forward = moves.map(({ m, was }) => ({
      id: m.id,
      from: { groupId: was.groupId, order: was.order },
      to: { groupId: input.groupId, order: m.order },
      childIds: [...m.childIds],
    }));
    return {
      label,
      undo: () =>
        reposition(
          wid,
          input.bid,
          input.uid,
          forward.map((f) => ({ ...f, from: f.to, to: f.from })),
        ),
      redo: () => reposition(wid, input.bid, input.uid, forward),
    };
  };
  const entry = moveEntry();
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
  // Items moved to another group can fire "moved to group" automations (a bounded number at once).
  const rt = runtimeFor(input.bid);
  const movers = input.moves.filter((m) => {
    const was = rt?.items.get(m.id);
    return was !== undefined && was.groupId !== input.groupId;
  });
  if (rt && movers.length > 0 && enabledAutomations(input.bid).length > 0) {
    if (movers.length > MAX_BULK_AUTOMATION_ITEMS) {
      toast.info(
        `Automations didn’t run: they only run for up to ${MAX_BULK_AUTOMATION_ITEMS} items at a time.`,
      );
    } else {
      const itemsAfter = new Map<string, EngineItem>(rt.items);
      const events: AutoEvent[] = [];
      for (const m of input.moves) {
        const was = rt.items.get(m.id);
        if (!was) continue;
        itemsAfter.set(m.id, { ...was, groupId: input.groupId, order: m.order });
        for (const c of m.childIds) {
          const child = rt.items.get(c);
          if (child) itemsAfter.set(c, { ...child, groupId: input.groupId });
        }
      }
      for (const m of movers)
        events.push({
          kind: 'moved',
          itemId: m.id,
          fromGroupId: (rt.items.get(m.id) as BoardItem).groupId,
          toGroupId: input.groupId,
        });
      return saveWithUndo(
        input.bid,
        entry,
        commitWithAutomations('item:move', input.bid, ops, (base, ctl) =>
          addAutomationOpsMany({
            bid: input.bid,
            actor: input.uid,
            baseOps: base,
            events,
            itemsAfter,
            startNumber: ctl.startNumber,
            counterExists: ctl.counterExists,
          }),
        ),
      );
    }
  }
  return saveWithUndo(input.bid, entry, commitOpsChunked('item:move', ops));
}

/** `ids` must already include subitems of any parent being archived/deleted. */
export function archiveItems(
  wid: string,
  bid: string,
  uid: string,
  ids: string[],
  archived: boolean,
  opts: { quiet?: boolean } = {},
): Promise<void> {
  const ops = planArchiveItems(wid, bid, uid, ids, archived);
  ops.push(...scheduleForIds(bid, ids, { archived, deleted: false }));
  const entry: UndoEntry | null = opts.quiet
    ? null
    : {
        label: `${archived ? 'archive' : 'restore'} ${topNames(bid, ids)}`,
        undo: () => archiveItems(wid, bid, uid, ids, !archived, { quiet: true }),
        redo: () => archiveItems(wid, bid, uid, ids, archived, { quiet: true }),
      };
  return saveWithUndo(bid, entry, commitOpsChunked('item:archive', ops));
}

/** "“Dishes”" or "3 items" for a history label (ids include subitems, so only count top-level). */
function topNames(bid: string, ids: readonly string[]): string {
  const items = runtimeFor(bid)?.items;
  const top = ids.filter((id) => !items?.get(id)?.parentId);
  const n = top.length || ids.length;
  const only = n === 1 ? items?.get(top[0] ?? ids[0]!)?.name : undefined;
  return only ? `“${clip(only)}”` : plural(n, 'item');
}

export function deleteItems(
  wid: string,
  bid: string,
  uid: string,
  ids: string[],
  /** For the activity log: the top-level items being deleted. */
  logged?: Array<{ id: string; name: string }>,
  opts: { quiet?: boolean } = {},
): Promise<void> {
  const ops = planDeleteItems(wid, bid, uid, ids);
  ops.push(...scheduleForIds(bid, ids, { archived: false, deleted: true }));
  if (logged) ops.push(...activityForMany(wid, bid, uid, 'deleted', logged));
  const entry: UndoEntry | null = opts.quiet
    ? null
    : {
        label: `delete ${topNames(bid, ids)}`,
        undo: () => restoreItems(wid, bid, uid, ids),
        redo: () => deleteItems(wid, bid, uid, ids, undefined, { quiet: true }),
      };
  return saveWithUndo(bid, entry, commitOpsChunked('item:delete', ops));
}

/** Undo for deletes: clears the tombstone (and archive flag). */
export function restoreItems(wid: string, bid: string, uid: string, ids: string[]) {
  return commitOpsChunked('item:restore', [
    ...ids.flatMap((id) => planRestoreItem(wid, bid, id, uid)),
    ...scheduleForIds(bid, ids, { archived: false, deleted: false }),
  ]);
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

/**
 * Creates imported items in batches (each one atomic: numbers come from the board counter, so two
 * people importing or typing at once can't clash). Reminders are registered for imported dates.
 * Instant automations don't run for imports (a 500-row import shouldn't fire 500 notifications).
 */
export async function importItems(input: {
  wid: string;
  board: Board;
  uid: string;
  items: readonly ImportItem[];
  lastOrderByGroup: ReadonlyMap<string, string | null>;
  fallbackNumber: number;
  onProgress?: (done: number) => void;
}): Promise<void> {
  const CHUNK = 100;
  let last = new Map(input.lastOrderByGroup);
  for (let i = 0; i < input.items.length; i += CHUNK) {
    const slice = input.items.slice(i, i + CHUNK).map((it) => ({
      ...it,
      values: { ...defaultItemValues(input.board.columns), ...it.values },
    }));
    let nextLast = last;
    await serialized(() =>
      runOpsTransaction('item:import', async (get) => {
        const counter = await get(doc(db, boardPaths.counter(input.wid, input.board.id)));
        const ids: string[] = [];
        const planned = planImportChunk({
          wid: input.wid,
          bid: input.board.id,
          uid: input.uid,
          columns: input.board.columns,
          items: slice,
          startNumber: (counter.data()?.['next'] as number | undefined) ?? input.fallbackNumber,
          counterExists: counter.exists(),
          lastOrderByGroup: last,
          newItemId: () => {
            const id = newId(boardPaths.items(input.wid, input.board.id));
            ids.push(id);
            return id;
          },
        });
        nextLast = planned.lastOrderByGroup;
        return [
          ...planned.ops,
          ...scheduleOpsFor(
            input.board.id,
            ids.map((id, k) => ({
              id,
              values: cleanValues(input.board.columns, slice[k]!.values),
              archived: false,
              deleted: false,
            })),
          ),
        ];
      }),
    );
    last = nextLast;
    input.onProgress?.(Math.min(i + CHUNK, input.items.length));
  }
}
