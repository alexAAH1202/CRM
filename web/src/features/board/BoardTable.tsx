import {
  buildLayout,
  clampWidth,
  COLUMN_META,
  GROUP_COLORS,
  isViewActive,
  keyBetween,
  keysBetween,
  NAME_COLUMN_WIDTH,
  shortId,
  summaryKindOf,
  type Column,
  type DuplicableItem,
  type LayoutGroup,
  type ViewConfig,
  type ViewContext,
} from '@app/shared';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { format } from 'date-fns';
import { GripVertical, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button, EmptyState } from '../../components/ui';
import { friendlyError } from '../../lib/firestore/errors';
import { toast, useToastStore } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import {
  archiveItems,
  bulkSetCell,
  createItem,
  deleteGroup,
  deleteItems,
  duplicateItems,
  moveItemsToGroup,
  renameItem,
  restoreItems,
  saveColumns,
  saveGroups,
  setCell,
} from '../boards/api';
import type { Board, BoardItem, WorkspaceMember } from '../boards/types';
import { BulkBar } from './BulkBar';
import { ChangeTypeDialog, DefaultValueDialog } from './ColumnDialogs';
import {
  AddItemRow,
  AddSubitemRow,
  ColumnsRow,
  GapRow,
  GroupHeaderRow,
  ItemRow,
  SubRow,
  SummaryRow,
} from './rows';
import { TableProvider, type DropEdge, type TableContextValue } from './tableContext';

const EDGE = 6;
const ADD_COL = 48;
const MAX_BULK_DUPLICATE = 100;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], select, textarea';

type Row =
  | { kind: 'group'; key: string; group: LayoutGroup<BoardItem>; count: number }
  | { kind: 'columns'; key: string; group: LayoutGroup<BoardItem>; itemIds: string[] }
  | { kind: 'item'; key: string; group: LayoutGroup<BoardItem>; item: BoardItem; subCount: number }
  | { kind: 'sub'; key: string; group: LayoutGroup<BoardItem>; item: BoardItem }
  | {
      kind: 'addSub';
      key: string;
      group: LayoutGroup<BoardItem>;
      parent: BoardItem;
      lastOrder: string | null;
    }
  | { kind: 'add'; key: string; group: LayoutGroup<BoardItem> }
  | { kind: 'summary'; key: string; group: LayoutGroup<BoardItem> }
  | { kind: 'gap'; key: string };

const ROW_H: Record<Row['kind'], number> = {
  group: 48,
  columns: 34,
  item: 40,
  sub: 36,
  addSub: 34,
  add: 38,
  summary: 34,
  gap: 24,
};

/** Narrower item-name column on phones so other columns stay in view. */
function useNameWidth(): number {
  const narrow = () => typeof window !== 'undefined' && window.innerWidth < 640;
  const [isNarrow, setNarrow] = useState(narrow);
  useEffect(() => {
    const onResize = () => setNarrow(narrow());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isNarrow ? 200 : NAME_COLUMN_WIDTH;
}

const collapsedKey = (bid: string) => `collapsed:${bid}`;
function loadCollapsed(bid: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(collapsedKey(bid)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export interface BoardTableProps {
  wid: string;
  board: Board;
  items: Map<string, BoardItem>;
  members: WorkspaceMember[];
  canEdit: boolean;
  search: string;
  config: ViewConfig;
  onConfig: (patch: Partial<ViewConfig>) => void;
  memberName: (uid: string) => string;
}

type Confirm = { kind: 'group'; groupId: string } | null;
type Dialog = { kind: 'type'; column: Column } | { kind: 'default'; column: Column } | null;

export function BoardTable({
  wid,
  board,
  items,
  members,
  canEdit,
  search,
  config,
  onConfig,
  memberName,
}: BoardTableProps) {
  const user = useCurrentUser();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(board.id));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [active, setActive] = useState<{ type: 'item' | 'group'; label: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: DropEdge } | null>(null);
  const nameWidth = useNameWidth();
  const fail = useCallback((err: unknown) => toast.error(friendlyError(err)), []);

  // ------------------------------------------------------------- derived data

  const today = format(new Date(), 'yyyy-MM-dd');
  const viewCtx = useMemo<ViewContext>(
    () => ({ today, me: user.uid, memberName }),
    [today, user.uid, memberName],
  );
  const layout = useMemo(
    () =>
      buildLayout<BoardItem>({
        items: items.values(),
        columns: board.columns,
        groups: board.groups,
        config,
        search,
        ctx: viewCtx,
      }),
    [items, board.columns, board.groups, config, search, viewCtx],
  );
  const columns = useMemo(
    () => board.columns.filter((c) => !config.hiddenCols.includes(c.id)),
    [board.columns, config.hiddenCols],
  );
  const widths = columns.map(
    (c) => liveWidths[c.id] ?? config.colWidths[c.id] ?? COLUMN_META[c.type].width,
  );
  const template = `${EDGE}px ${nameWidth}px ${widths.map((w) => `${w}px`).join(' ')} ${ADD_COL}px`;
  const totalWidth = EDGE + nameWidth + widths.reduce((a, b) => a + b, 0) + ADD_COL;
  const groupCol = board.columns.find((c) => c.id === config.groupBy);
  const filtering = isViewActive(config, search);
  const hasSummary = columns.some((c) => summaryKindOf(c) !== 'none');

  /** Every non-deleted subitem per parent (archived ones included, so cascades are complete). */
  const childrenOf = useMemo(() => {
    const m = new Map<string, BoardItem[]>();
    for (const it of items.values()) {
      if (it.deleted || !it.parentId) continue;
      const l = m.get(it.parentId) ?? [];
      l.push(it);
      m.set(it.parentId, l);
    }
    return m;
  }, [items]);
  const treeIds = useCallback(
    (id: string) => [id, ...(childrenOf.get(id) ?? []).map((c) => c.id)],
    [childrenOf],
  );

  /** Highest order key per board group, whatever the current sort/filter shows. */
  const maxOrderByGroup = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const it of items.values()) {
      if (it.deleted || it.parentId) continue;
      const cur = m.get(it.groupId);
      if (cur == null || it.order > cur) m.set(it.groupId, it.order);
    }
    return m;
  }, [items]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    layout.forEach((g, gi) => {
      out.push({ kind: 'group', key: `g-${g.key}`, group: g, count: g.rows.length });
      if (!collapsed.has(g.key)) {
        out.push({
          kind: 'columns',
          key: `c-${g.key}`,
          group: g,
          itemIds: g.rows.map((r) => r.item.id),
        });
        for (const r of g.rows) {
          out.push({
            kind: 'item',
            key: r.item.id,
            group: g,
            item: r.item,
            subCount: r.subitems.length,
          });
          if (expanded.has(r.item.id)) {
            for (const s of r.subitems) out.push({ kind: 'sub', key: s.id, group: g, item: s });
            if (canEdit) {
              const all = childrenOf.get(r.item.id) ?? [];
              const last = all.reduce<string | null>(
                (m, c) => (m == null || c.order > m ? c.order : m),
                null,
              );
              out.push({
                kind: 'addSub',
                key: `as-${r.item.id}`,
                group: g,
                parent: r.item,
                lastOrder: last,
              });
            }
          }
        }
        if (canEdit) out.push({ kind: 'add', key: `a-${g.key}`, group: g });
        if (hasSummary && g.rows.length > 0)
          out.push({ kind: 'summary', key: `s-${g.key}`, group: g });
      }
      if (gi < layout.length - 1) out.push({ kind: 'gap', key: `gap-${g.key}` });
    });
    return out;
  }, [layout, collapsed, expanded, canEdit, hasSummary, childrenOf]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => ROW_H[rows[i]!.kind],
    getItemKey: (i) => rows[i]!.key,
    overscan: 12,
  });

  // Selection only counts items that are still on screen.
  const visibleIds = useMemo(
    () => new Set(layout.flatMap((g) => g.rows.map((r) => r.item.id))),
    [layout],
  );
  const selectedIds = useMemo(
    () => [...selected].filter((id) => visibleIds.has(id)),
    [selected, visibleIds],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedItems = useMemo(
    () => selectedIds.map((id) => items.get(id)).filter((i): i is BoardItem => !!i),
    [selectedIds, items],
  );

  // ---------------------------------------------------------------- handlers

  const uid = user.uid;
  const fallbackNumber = useMemo(
    () => Math.max(0, ...[...items.values()].map((i) => i.itemNumber)) + 1,
    [items],
  );
  const offlineMessage = "You're offline — new items need a connection.";

  const withUndo = (message: string, undo: () => Promise<unknown>) =>
    useToastStore.getState().push(
      {
        message,
        tone: 'info',
        action: { label: 'Undo', onClick: () => void undo().catch(fail) },
      },
      10000,
    );

  const addItem = useCallback(
    (group: LayoutGroup<BoardItem>, name: string) => {
      const gid = group.groupId ?? board.groups[0]?.id;
      if (!gid) return;
      createItem({
        board,
        wid,
        uid,
        name,
        groupId: gid,
        afterOrder: maxOrderByGroup.get(gid) ?? null,
        fallbackNumber,
        ...(group.virtual && groupCol
          ? { values: { [groupCol.id]: group.newItemValue ?? null } }
          : {}),
      }).catch((err: unknown) =>
        toast.error(navigator.onLine ? friendlyError(err) : offlineMessage),
      );
    },
    [board, wid, uid, maxOrderByGroup, fallbackNumber, groupCol],
  );

  const doDuplicate = useCallback(
    (ids: string[]) => {
      if (ids.length > MAX_BULK_DUPLICATE) {
        toast.error(`Duplicate up to ${MAX_BULK_DUPLICATE} items at a time.`);
        return;
      }
      const list: DuplicableItem[] = ids.flatMap((id) => {
        const it = items.get(id);
        if (!it) return [];
        const subs = (childrenOf.get(id) ?? []).filter((c) => !c.archived);
        return [
          {
            id,
            name: it.name,
            groupId: it.groupId,
            order: it.order,
            values: it.values,
            subitems: subs.map((s) => ({ name: s.name, order: s.order, values: s.values })),
          },
        ];
      });
      duplicateItems({
        wid,
        board,
        uid,
        items: list,
        lastOrderByGroup: maxOrderByGroup,
        fallbackNumber,
      })
        .then(() => toast.success(`Duplicated ${list.length} item${list.length === 1 ? '' : 's'}`))
        .catch((err: unknown) =>
          toast.error(
            navigator.onLine
              ? friendlyError(err)
              : "You're offline — duplicating needs a connection.",
          ),
        );
    },
    [items, childrenOf, wid, board, uid, maxOrderByGroup, fallbackNumber],
  );

  const doArchive = (ids: string[], archived: boolean) => {
    const all = ids.flatMap(treeIds);
    archiveItems(wid, board.id, uid, all, archived)
      .then(() => {
        if (archived)
          withUndo(`Archived ${ids.length} item${ids.length === 1 ? '' : 's'}`, () =>
            archiveItems(wid, board.id, uid, all, false),
          );
      })
      .catch(fail);
  };

  const doDelete = (ids: string[]) => {
    const all = ids.flatMap(treeIds);
    deleteItems(wid, board.id, uid, all)
      .then(() => {
        setSelected(new Set());
        withUndo(`Deleted ${ids.length} item${ids.length === 1 ? '' : 's'}`, () =>
          restoreItems(wid, board.id, uid, all),
        );
      })
      .catch(fail);
  };

  const doMove = (ids: string[], groupId: string) => {
    const order = keysBetween(maxOrderByGroup.get(groupId) ?? null, null, ids.length);
    moveItemsToGroup({
      wid,
      bid: board.id,
      uid,
      groupId,
      moves: ids.map((id, i) => ({
        id,
        childIds: (childrenOf.get(id) ?? []).map((c) => c.id),
        order: order[i]!,
      })),
    }).catch(fail);
  };

  const focusAddSub = (parentName: string) => {
    let tries = 8;
    const go = () => {
      const el = [
        ...(scrollRef.current?.querySelectorAll<HTMLInputElement>(
          'input[aria-label^="Add subitem to"]',
        ) ?? []),
      ].find((i) => i.getAttribute('aria-label') === `Add subitem to ${parentName}`);
      if (el) el.focus();
      else if (tries-- > 0) requestAnimationFrame(go);
    };
    requestAnimationFrame(go);
  };

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    setter((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const ctxValue: TableContextValue = {
    wid,
    board,
    columns,
    widths,
    template,
    totalWidth,
    canEdit,
    members,
    selected: selectedSet,
    selectionActive: selectedIds.length > 0,
    toggleSelect: (id) => toggleIn(setSelected, id),
    setGroupSelected: (ids, on) =>
      setSelected((prev) => {
        const n = new Set(prev);
        ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
        return n;
      }),
    expanded,
    toggleExpand: (id) => toggleIn(setExpanded, id),
    collapsed,
    toggleGroup: (key) =>
      setCollapsed((prev) => {
        const n = new Set(prev);
        if (n.has(key)) n.delete(key);
        else n.add(key);
        try {
          localStorage.setItem(collapsedKey(board.id), JSON.stringify([...n]));
        } catch {
          /* ignore */
        }
        return n;
      }),
    itemDragEnabled: canEdit && !config.groupBy && config.sort.length === 0,
    groupDragEnabled: canEdit && !config.groupBy,
    dropTarget,
    onCell: (item, column, value) => setCell({ wid, board, item, uid, column, value }).catch(fail),
    onRename: (item, name) => renameItem(wid, board.id, item.id, uid, name).catch(fail),
    onAddItem: addItem,
    onAddSubitem: (parent, name, lastOrder) =>
      createItem({
        board,
        wid,
        uid,
        name,
        groupId: parent.groupId,
        parentId: parent.id,
        afterOrder: lastOrder,
        fallbackNumber,
      }).catch((err: unknown) =>
        toast.error(navigator.onLine ? friendlyError(err) : offlineMessage),
      ),
    onItemAction: (action, item, arg) => {
      switch (action) {
        case 'expand':
          return toggleIn(setExpanded, item.id);
        case 'addSub':
          setExpanded((prev) => new Set(prev).add(item.id));
          return focusAddSub(item.name);
        case 'move':
          return arg ? doMove([item.id], arg) : undefined;
        case 'duplicate':
          return doDuplicate([item.id]);
        case 'archive':
          return doArchive([item.id], true);
        case 'restore':
          return doArchive([item.id], false);
        case 'delete':
          return doDelete([item.id]);
      }
    },
    onGroupRename: (gid, name) =>
      saveGroups(
        wid,
        board.id,
        board.groups.map((g) => (g.id === gid ? { ...g, name } : g)),
      ).catch(fail),
    onGroupColor: (gid, color) =>
      saveGroups(
        wid,
        board.id,
        board.groups.map((g) => (g.id === gid ? { ...g, color } : g)),
      ).catch(fail),
    onGroupDelete: (gid) => setConfirm({ kind: 'group', groupId: gid }),
    onColumnSave: (c) =>
      saveColumns(
        wid,
        board.id,
        board.columns.map((x) => (x.id === c.id ? c : x)),
      ).catch(fail),
    onColumnDelete: (c) =>
      saveColumns(
        wid,
        board.id,
        board.columns.filter((x) => x.id !== c.id),
      ).catch(fail),
    onColumnMove: (c, dir) => {
      const arr = [...board.columns];
      const i = arr.findIndex((x) => x.id === c.id);
      let j = i + dir;
      while (arr[j] && config.hiddenCols.includes(arr[j]!.id)) j += dir;
      if (i < 0 || !arr[j]) return;
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
      saveColumns(wid, board.id, arr).catch(fail);
    },
    onColumnChangeType: (c) => setDialog({ kind: 'type', column: c }),
    onColumnDefault: (c) => setDialog({ kind: 'default', column: c }),
    onAddColumn: (c) => saveColumns(wid, board.id, [...board.columns, c]).catch(fail),
    onResize: (columnId, width) =>
      onConfig({ colWidths: { ...config.colWidths, [columnId]: clampWidth(width) } }),
    setLiveWidth: (columnId, width) =>
      setLiveWidths((prev) => {
        const n = { ...prev };
        if (width === null) delete n[columnId];
        else n[columnId] = width;
        return n;
      }),
    canDeleteGroup: board.groups.length > 1,
  };

  // ------------------------------------------------------------ drag & drop

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const collision: CollisionDetection = useCallback((args) => {
    const type = args.active.data.current?.['type'] as string | undefined;
    const containers = args.droppableContainers.filter((c) =>
      type === 'group' ? c.data.current?.['type'] === 'group' : true,
    );
    const filtered = { ...args, droppableContainers: containers };
    const hits = pointerWithin(filtered);
    return hits.length ? hits : closestCenter(filtered);
  }, []);

  /** Where would the dragged item land? Neighbours are the *visible* items in the target group. */
  const computeItemDrop = (activeId: string, over: DragOverEvent['over']) => {
    if (!over) return null;
    const od = over.data.current as
      { type: string; id?: string; groupId: string | null } | undefined;
    if (!od || !od.groupId || od.id === activeId) return null;
    const targetGroup = layout.find((g) => g.groupId === od.groupId);
    if (!targetGroup) return null;
    const original = targetGroup.rows.map((r) => r.item);
    const list = original.filter((i) => i.id !== activeId);
    let prev: BoardItem | undefined;
    let next: BoardItem | undefined;
    let edge: DropEdge;
    if (od.type === 'item') {
      const idx = list.findIndex((i) => i.id === od.id);
      if (idx < 0) return null;
      const overOrig = original.findIndex((i) => i.id === od.id);
      const activeOrig = original.findIndex((i) => i.id === activeId);
      const after = activeOrig >= 0 && activeOrig < overOrig; // moving down within the group
      edge = after ? 'bottom' : 'top';
      prev = after ? list[idx] : list[idx - 1];
      next = after ? list[idx + 1] : list[idx];
    } else if (od.type === 'add') {
      prev = list.at(-1);
      edge = 'bottom';
    } else {
      next = list[0];
      edge = 'bottom';
    }
    let order: string;
    try {
      order = keyBetween(prev?.order ?? null, next?.order ?? null);
    } catch {
      order = keyBetween(prev?.order ?? null, null);
    }
    return { groupId: od.groupId, order, edge };
  };

  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as
      { type: 'item' | 'group'; id?: string; groupId?: string } | undefined;
    if (!d) return;
    const label =
      d.type === 'item'
        ? (items.get(d.id ?? '')?.name ?? 'Item')
        : (board.groups.find((g) => g.id === d.groupId)?.name ?? 'Group');
    setActive({ type: d.type, label });
  };

  const groupMove = (d: { groupId?: string }, over: NonNullable<DragOverEvent['over']>) => {
    const from = board.groups.findIndex((g) => g.id === d.groupId);
    const overGid = (over.data.current as { groupId?: string } | undefined)?.groupId;
    const to = board.groups.findIndex((g) => g.id === overGid);
    return from < 0 || to < 0 || from === to ? null : { from, to };
  };

  const onDragOver = (e: DragOverEvent) => {
    const d = e.active.data.current as { type: string; id?: string; groupId?: string } | undefined;
    if (!e.over || !d) return setDropTarget(null);
    if (d.type === 'group') {
      const m = groupMove(d, e.over);
      return setDropTarget(
        m ? { id: String(e.over.id), edge: m.from < m.to ? 'bottom' : 'top' } : null,
      );
    }
    const drop = computeItemDrop(d.id ?? '', e.over);
    setDropTarget(drop ? { id: String(e.over.id), edge: drop.edge } : null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    setDropTarget(null);
    const d = e.active.data.current as { type: string; id?: string; groupId?: string } | undefined;
    if (!e.over || !d) return;
    if (d.type === 'group') {
      const m = groupMove(d, e.over);
      if (!m) return;
      const arr = [...board.groups];
      const [moved] = arr.splice(m.from, 1);
      arr.splice(m.to, 0, moved!);
      saveGroups(wid, board.id, arr).catch(fail);
      return;
    }
    const item = items.get(d.id ?? '');
    const drop = computeItemDrop(d.id ?? '', e.over);
    if (!item || !drop) return;
    moveItemsToGroup({
      wid,
      bid: board.id,
      uid,
      groupId: drop.groupId,
      moves: [
        {
          id: item.id,
          childIds: (childrenOf.get(item.id) ?? []).map((c) => c.id),
          order: drop.order,
        },
      ],
    }).catch(fail);
  };

  // ------------------------------------------------------- keyboard movement

  const focusCell = (row: number, col: number) => {
    virtualizer.scrollToIndex(row, { align: 'auto' });
    let tries = 8;
    const go = () => {
      const cell = scrollRef.current?.querySelector<HTMLElement>(
        `[data-nav-row="${row}"][data-nav-col="${col}"]`,
      );
      const target = cell?.matches(FOCUSABLE)
        ? cell
        : (cell?.querySelector<HTMLElement>('[data-nav-focus]') ??
          cell?.querySelector<HTMLElement>(FOCUSABLE));
      if (target) target.focus();
      else if (tries-- > 0) requestAnimationFrame(go);
    };
    requestAnimationFrame(go);
  };

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (active) return; // a keyboard drag is in progress
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    const isAddInput = t instanceof HTMLInputElement && t.hasAttribute('data-nav-row');
    if (t instanceof HTMLInputElement && t.type !== 'checkbox' && !isAddInput) return; // editing text
    const cell = t.closest<HTMLElement>('[data-nav-col]');
    if (!cell) return;
    const ri = Number(cell.dataset['navRow']);
    const ci = Number(cell.dataset['navCol']);
    const navigable = (r: number) =>
      !!rows[r] && ['item', 'sub', 'add', 'addSub'].includes(rows[r]!.kind);
    const step = (dir: 1 | -1) => {
      let r = ri + dir;
      while (r >= 0 && r < rows.length && !navigable(r)) r += dir;
      return r >= 0 && r < rows.length ? r : ri;
    };
    let nr = ri;
    let nc = ci;
    switch (e.key) {
      case 'ArrowDown':
        nr = step(1);
        break;
      case 'ArrowUp':
        nr = step(-1);
        break;
      case 'ArrowRight':
        if (isAddInput) return; // caret movement
        nc = Math.min(ci + 1, columns.length);
        break;
      case 'ArrowLeft':
        if (isAddInput) return;
        nc = Math.max(ci - 1, 0);
        break;
      default:
        return;
    }
    if (rows[nr] && (rows[nr]!.kind === 'add' || rows[nr]!.kind === 'addSub')) nc = 0;
    e.preventDefault();
    if (nr !== ri || nc !== ci) focusCell(nr, nc);
  };

  // ----------------------------------------------------------------- render

  const confirmGroup =
    confirm?.kind === 'group' ? board.groups.find((g) => g.id === confirm.groupId) : undefined;
  const groupItemCount = confirmGroup
    ? [...items.values()].filter((i) => i.groupId === confirmGroup.id && !i.deleted && !i.parentId)
        .length
    : 0;

  if (layout.length === 0 && filtering) {
    return (
      <EmptyState
        title="No items match"
        body="Nothing fits your filters or search."
        action={
          config.filters.length > 0 ? (
            <Button onClick={() => onConfig({ filters: [] })}>Clear filters</Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <TableProvider value={ctxValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActive(null);
          setDropTarget(null);
        }}
      >
        <div
          ref={scrollRef}
          onKeyDown={onGridKeyDown}
          className="relative min-h-0 flex-1 overflow-auto"
          role="grid"
          aria-label={`${board.name} table`}
          aria-rowcount={rows.length}
        >
          <div
            style={{ height: virtualizer.getTotalSize(), width: totalWidth + 32 }}
            className="relative pr-8"
          >
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index]!;
              const pos = { start: v.start, size: v.size };
              switch (row.kind) {
                case 'gap':
                  return <GapRow key={row.key} pos={pos} />;
                case 'group':
                  return (
                    <GroupHeaderRow key={row.key} group={row.group} count={row.count} pos={pos} />
                  );
                case 'columns':
                  return (
                    <ColumnsRow
                      key={row.key}
                      group={row.group}
                      itemIds={row.itemIds}
                      pos={pos}
                      navRow={v.index}
                    />
                  );
                case 'item':
                  return (
                    <ItemRow
                      key={row.key}
                      item={row.item}
                      group={row.group}
                      subCount={row.subCount}
                      pos={pos}
                      navRow={v.index}
                    />
                  );
                case 'sub':
                  return (
                    <SubRow
                      key={row.key}
                      item={row.item}
                      group={row.group}
                      pos={pos}
                      navRow={v.index}
                    />
                  );
                case 'addSub':
                  return (
                    <AddSubitemRow
                      key={row.key}
                      parent={row.parent}
                      group={row.group}
                      lastOrder={row.lastOrder}
                      pos={pos}
                      navRow={v.index}
                    />
                  );
                case 'add':
                  return <AddItemRow key={row.key} group={row.group} pos={pos} navRow={v.index} />;
                case 'summary':
                  return <SummaryRow key={row.key} group={row.group} pos={pos} />;
              }
            })}
          </div>

          {canEdit && !config.groupBy && (
            <div className="sticky left-0 px-2 pb-8">
              <button
                type="button"
                onClick={() =>
                  saveGroups(wid, board.id, [
                    ...board.groups,
                    {
                      id: shortId(),
                      name: 'New group',
                      color: GROUP_COLORS[board.groups.length % GROUP_COLORS.length] ?? 'blue',
                    },
                  ]).catch(fail)
                }
                className="inline-flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-fg"
              >
                <Plus size={16} aria-hidden /> Add group
              </button>
            </div>
          )}

          {canEdit && selectedIds.length > 0 && (
            <BulkBar
              count={selectedIds.length}
              columns={board.columns}
              groups={board.groups}
              members={members}
              allArchived={selectedItems.every((i) => i.archived)}
              canMove={!config.groupBy}
              onSetValue={(column, value) =>
                bulkSetCell({ wid, board, uid, column, items: selectedItems, value })
                  .then(() =>
                    toast.success(
                      `Updated ${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'}`,
                    ),
                  )
                  .catch(fail)
              }
              onMove={(gid) => {
                doMove(selectedIds, gid);
                setSelected(new Set());
              }}
              onDuplicate={() => {
                doDuplicate(selectedIds);
                setSelected(new Set());
              }}
              onArchive={(archived) => {
                doArchive(selectedIds, archived);
                setSelected(new Set());
              }}
              onDelete={() => doDelete(selectedIds)}
              onClear={() => setSelected(new Set())}
            />
          )}
        </div>
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className="flex items-center gap-2 rounded-xl border border-primary bg-surface px-3 py-2 text-sm font-semibold shadow-pop">
              <GripVertical size={14} aria-hidden /> {active.label}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <ConfirmDialog
        open={confirmGroup !== undefined}
        danger
        title={`Delete group “${confirmGroup?.name}”?`}
        body={`This also deletes its ${groupItemCount} item(s).`}
        confirmLabel="Delete group"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirmGroup) return;
          const ids = [...items.values()]
            .filter((i) => i.groupId === confirmGroup.id && !i.deleted)
            .map((i) => i.id);
          await deleteGroup({ wid, board, uid, groupId: confirmGroup.id, itemIds: ids }).catch(
            fail,
          );
        }}
      />
      {dialog?.kind === 'type' && (
        <ChangeTypeDialog
          wid={wid}
          uid={uid}
          board={board}
          column={dialog.column}
          items={[...items.values()]}
          members={members}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'default' && (
        <DefaultValueDialog
          column={dialog.column}
          onClose={() => setDialog(null)}
          onSave={(value) => {
            const rest = { ...dialog.column.settings };
            delete rest.defaultValue;
            ctxValue.onColumnSave({
              ...dialog.column,
              settings:
                value === null || value === undefined ? rest : { ...rest, defaultValue: value },
            });
          }}
        />
      )}
    </TableProvider>
  );
}
