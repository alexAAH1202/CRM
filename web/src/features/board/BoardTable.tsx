import {
  byOrder,
  COLUMN_META,
  GROUP_COLORS,
  keyBetween,
  LABEL_COLOR_NAMES,
  LABEL_COLORS,
  NAME_COLUMN_WIDTH,
  shortId,
  type Column,
  type Group,
} from '@app/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Popover } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import {
  archiveItem,
  createItem,
  deleteGroup,
  deleteItem,
  moveItem,
  renameItem,
  saveColumns,
  saveGroups,
  setCell,
} from '../boards/api';
import type { Board, BoardItem, WorkspaceMember } from '../boards/types';
import { AddColumnButton, ColumnHeader } from './ColumnMenu';
import { Cell } from './cells';

type Row =
  | { kind: 'group'; group: Group; count: number }
  | { kind: 'columns'; group: Group }
  | { kind: 'item'; group: Group; item: BoardItem }
  | { kind: 'add'; group: Group; lastOrder: string | null }
  | { kind: 'gap'; key: string };

const ROW_H: Record<Row['kind'], number> = { group: 48, columns: 34, item: 40, add: 38, gap: 24 };
const EDGE = 6;
const ADD_COL = 48;

/** Narrower item-name column on phones so other columns stay in view. */
function useNameWidth(): number {
  const narrow = () => typeof window !== 'undefined' && window.innerWidth < 640;
  const [isNarrow, setNarrow] = useState(narrow);
  useEffect(() => {
    const onResize = () => setNarrow(narrow());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isNarrow ? 180 : NAME_COLUMN_WIDTH;
}

function collapsedKey(bid: string) {
  return `collapsed:${bid}`;
}
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
  memberName: (uid: string) => string;
}

export function BoardTable({ wid, board, items, members, canEdit, search }: BoardTableProps) {
  const user = useCurrentUser();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(board.id));
  const [confirmGroup, setConfirmGroup] = useState<Group | null>(null);

  const nameWidth = useNameWidth();
  const columns = board.columns;
  const template = `${EDGE}px ${nameWidth}px ${columns.map((c) => `${COLUMN_META[c.type].width}px`).join(' ')} ${ADD_COL}px`;
  const totalWidth =
    EDGE + nameWidth + columns.reduce((s, c) => s + COLUMN_META[c.type].width, 0) + ADD_COL;

  const byGroup = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, BoardItem[]>();
    for (const it of items.values()) {
      if (it.deleted || it.archived || it.parentId) continue;
      if (q && !it.name.toLowerCase().includes(q)) continue;
      const list = map.get(it.groupId) ?? [];
      list.push(it);
      map.set(it.groupId, list);
    }
    for (const list of map.values()) list.sort(byOrder);
    return map;
  }, [items, search]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    board.groups.forEach((g, i) => {
      const list = byGroup.get(g.id) ?? [];
      out.push({ kind: 'group', group: g, count: list.length });
      if (!collapsed.has(g.id)) {
        out.push({ kind: 'columns', group: g });
        list.forEach((item) => out.push({ kind: 'item', group: g, item }));
        if (canEdit) out.push({ kind: 'add', group: g, lastOrder: list.at(-1)?.order ?? null });
      }
      if (i < board.groups.length - 1) out.push({ kind: 'gap', key: `gap-${g.id}` });
    });
    return out;
  }, [board.groups, byGroup, collapsed, canEdit]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => ROW_H[rows[i]!.kind],
    overscan: 12,
  });

  const fail = (err: unknown) => toast.error(friendlyError(err));

  function toggleGroup(gid: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      try {
        localStorage.setItem(collapsedKey(board.id), JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const saveColumn = (c: Column) =>
    saveColumns(
      wid,
      board.id,
      columns.map((x) => (x.id === c.id ? c : x)),
    ).catch(fail);

  function rowStyle(start: number, h: number): CSSProperties {
    return {
      transform: `translateY(${start}px)`,
      height: h,
      width: totalWidth,
      gridTemplateColumns: template,
    };
  }

  const stickyName = 'sticky left-0 z-10';

  return (
    <div
      ref={scrollRef}
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
          const color = 'group' in row ? LABEL_COLORS[row.group.color].bg : undefined;
          const base = 'absolute left-0 top-0 grid';

          if (row.kind === 'gap')
            return (
              <div key={row.key} className={base} style={rowStyle(v.start, v.size)} aria-hidden />
            );

          if (row.kind === 'group') {
            const g = row.group;
            const isCollapsed = collapsed.has(g.id);
            return (
              <div
                key={`g-${g.id}`}
                role="row"
                className={cx(base, 'items-end pb-1')}
                style={rowStyle(v.start, v.size)}
              >
                <div
                  className={cx(
                    stickyName,
                    'col-span-full flex w-max items-center gap-1 justify-self-start whitespace-nowrap bg-bg pr-2',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.id)}
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} group ${g.name}`}
                    className="rounded-md p-1 hover:bg-surface-2"
                    style={{ color }}
                  >
                    {isCollapsed ? (
                      <ChevronRight size={18} aria-hidden />
                    ) : (
                      <ChevronDown size={18} aria-hidden />
                    )}
                  </button>
                  <GroupTitle
                    group={g}
                    color={color!}
                    canEdit={canEdit}
                    onRename={(name) =>
                      saveGroups(
                        wid,
                        board.id,
                        board.groups.map((x) => (x.id === g.id ? { ...x, name } : x)),
                      ).catch(fail)
                    }
                  />
                  <span className="ml-2 text-xs text-muted">
                    {row.count} {row.count === 1 ? 'item' : 'items'}
                  </span>
                  {canEdit && (
                    <GroupMenu
                      group={g}
                      onColor={(c) =>
                        saveGroups(
                          wid,
                          board.id,
                          board.groups.map((x) => (x.id === g.id ? { ...x, color: c } : x)),
                        ).catch(fail)
                      }
                      onDelete={() => setConfirmGroup(g)}
                      canDelete={board.groups.length > 1}
                    />
                  )}
                </div>
              </div>
            );
          }

          if (row.kind === 'columns') {
            return (
              <div
                key={`c-${row.group.id}`}
                role="row"
                className={cx(base, 'border-b border-border bg-surface')}
                style={rowStyle(v.start, v.size)}
              >
                <div
                  className={cx(stickyName, 'rounded-tl-xl bg-surface')}
                  style={{ background: color }}
                />
                <div
                  className={cx(
                    stickyName,
                    'flex items-center border-r border-border bg-surface px-3 text-xs font-semibold text-muted',
                  )}
                  style={{ left: EDGE }}
                  role="columnheader"
                >
                  Item
                </div>
                {columns.map((c) => (
                  <div key={c.id} role="columnheader" className="border-r border-border">
                    <ColumnHeader
                      column={c}
                      canEdit={canEdit}
                      onSave={saveColumn}
                      onDelete={() =>
                        saveColumns(
                          wid,
                          board.id,
                          columns.filter((x) => x.id !== c.id),
                        ).catch(fail)
                      }
                    />
                  </div>
                ))}
                <div>
                  {canEdit && (
                    <AddColumnButton
                      onAdd={(c) => saveColumns(wid, board.id, [...columns, c]).catch(fail)}
                    />
                  )}
                </div>
              </div>
            );
          }

          if (row.kind === 'add') {
            return (
              <div
                key={`a-${row.group.id}`}
                role="row"
                className={cx(base, 'border-b border-border bg-surface')}
                style={rowStyle(v.start, v.size)}
              >
                <div
                  className={cx(stickyName, 'rounded-bl-xl')}
                  style={{ background: color, opacity: 0.5 }}
                />
                <div className={cx(stickyName, 'bg-surface')} style={{ left: EDGE }}>
                  <AddItemInput
                    groupName={row.group.name}
                    onAdd={(name) =>
                      createItem({
                        board,
                        wid,
                        uid: user.uid,
                        name,
                        groupId: row.group.id,
                        afterOrder: row.lastOrder,
                        fallbackNumber:
                          Math.max(0, ...[...items.values()].map((i) => i.itemNumber)) + 1,
                        values: Object.fromEntries(
                          columns
                            .filter((c) => c.type === 'status' && c.settings.defaultLabelId)
                            .map((c) => [c.id, c.settings.defaultLabelId]),
                        ),
                      }).catch((err: unknown) =>
                        toast.error(
                          navigator.onLine
                            ? friendlyError(err)
                            : "You're offline — new items need a connection.",
                        ),
                      )
                    }
                  />
                </div>
              </div>
            );
          }

          const it = row.item;
          return (
            <div
              key={it.id}
              role="row"
              className={cx(
                base,
                'group/row border-b border-border bg-surface hover:bg-surface-2/60',
              )}
              style={rowStyle(v.start, v.size)}
            >
              <div className={stickyName} style={{ background: color }} />
              <div
                className={cx(
                  stickyName,
                  'flex items-center border-r border-border bg-surface group-hover/row:bg-surface-2',
                )}
                style={{ left: EDGE }}
                role="gridcell"
              >
                <ItemName
                  item={it}
                  canEdit={canEdit}
                  onRename={(name) => renameItem(wid, board.id, it.id, user.uid, name).catch(fail)}
                />
                {canEdit && (
                  <ItemMenu
                    item={it}
                    groups={board.groups}
                    onMove={(gid) => {
                      const last = (byGroup.get(gid) ?? []).at(-1)?.order ?? null;
                      moveItem(wid, board.id, it.id, user.uid, gid, keyBetween(last, null)).catch(
                        fail,
                      );
                    }}
                    onArchive={() =>
                      archiveItem(wid, board.id, it.id, user.uid, true)
                        .then(() => toast.info(`Archived “${it.name}”`))
                        .catch(fail)
                    }
                    onDelete={() => deleteItem(wid, board.id, it.id, user.uid).catch(fail)}
                  />
                )}
              </div>
              {columns.map((c) => (
                <div key={c.id} role="gridcell" className="min-w-0 border-r border-border">
                  <Cell
                    column={c}
                    item={it}
                    itemName={it.name}
                    canEdit={canEdit}
                    members={members}
                    onChange={(value) =>
                      setCell({ wid, board, item: it, uid: user.uid, column: c, value }).catch(fail)
                    }
                  />
                </div>
              ))}
              <div />
            </div>
          );
        })}
      </div>
      {canEdit && (
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
      <ConfirmDialog
        open={confirmGroup !== null}
        danger
        title={`Delete group “${confirmGroup?.name}”?`}
        body={`This also deletes its ${(confirmGroup && byGroup.get(confirmGroup.id)?.length) || 0} item(s).`}
        confirmLabel="Delete group"
        onClose={() => setConfirmGroup(null)}
        onConfirm={async () => {
          if (!confirmGroup) return;
          const ids = [...items.values()]
            .filter((i) => i.groupId === confirmGroup.id && !i.deleted)
            .map((i) => i.id);
          await deleteGroup({
            wid,
            board,
            uid: user.uid,
            groupId: confirmGroup.id,
            itemIds: ids,
          }).catch(fail);
        }}
      />
    </div>
  );
}

function GroupTitle({
  group,
  color,
  canEdit,
  onRename,
}: {
  group: Group;
  color: string;
  canEdit: boolean;
  onRename: (n: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={group.name}
        aria-label="Group name"
        maxLength={80}
        className="h-8 rounded-lg border-2 border-primary bg-surface px-2 text-base font-bold outline-none"
        onBlur={(e) => {
          const n = e.target.value.trim();
          if (n && n !== group.name) onRename(n);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  const text = (
    <h2 className="truncate text-base font-extrabold" style={{ color }}>
      {group.name}
    </h2>
  );
  if (!canEdit) return text;
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="min-w-0 rounded-md px-1 hover:bg-surface-2"
      aria-label={`Rename group ${group.name}`}
    >
      {text}
    </button>
  );
}

const menuItem =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2';

function GroupMenu({
  group,
  onColor,
  onDelete,
  canDelete,
}: {
  group: Group;
  onColor: (c: Group['color']) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  return (
    <Popover
      label={`Group ${group.name} options`}
      className="w-56"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          aria-label={`Options for group ${group.name}`}
          className="ml-1 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg"
        >
          <MoreHorizontal size={16} aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div className="space-y-2">
          <div className="px-2 pt-1 text-xs font-semibold text-muted">
            <Palette size={12} aria-hidden className="mr-1 inline" /> Colour
          </div>
          <div className="grid grid-cols-7 gap-1.5 px-2">
            {LABEL_COLOR_NAMES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={group.color === c}
                onClick={() => {
                  onColor(c);
                  close();
                }}
                className={cx(
                  'h-6 w-6 rounded-full',
                  group.color === c && 'ring-2 ring-fg ring-offset-2 ring-offset-surface',
                )}
                style={{ background: LABEL_COLORS[c].bg }}
              />
            ))}
          </div>
          {canDelete && (
            <button
              type="button"
              className={cx(menuItem, 'text-danger')}
              onClick={() => {
                close();
                onDelete();
              }}
            >
              <Trash2 size={14} aria-hidden /> Delete group
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}

function ItemName({
  item,
  canEdit,
  onRename,
}: {
  item: BoardItem;
  canEdit: boolean;
  onRename: (n: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={item.name}
        aria-label="Item name"
        maxLength={500}
        className="h-full w-full border-2 border-primary bg-surface px-3 text-sm outline-none"
        onBlur={(e) => {
          const n = e.target.value.trim();
          if (n && n !== item.name) onRename(n);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={() => setEditing(true)}
      className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-3 text-left text-sm enabled:hover:text-primary"
      aria-label={canEdit ? `Rename ${item.name}` : item.name}
    >
      <span className="truncate">{item.name || <span className="text-muted">Untitled</span>}</span>
      {canEdit && (
        <Pencil size={12} aria-hidden className="shrink-0 opacity-0 group-hover/row:opacity-40" />
      )}
    </button>
  );
}

function ItemMenu({
  item,
  groups,
  onMove,
  onArchive,
  onDelete,
}: {
  item: BoardItem;
  groups: Group[];
  onMove: (gid: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <Popover
      label={`Options for ${item.name}`}
      className="w-56"
      placement="bottom-end"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          aria-label={`Options for ${item.name}`}
          className="mr-1 rounded-md p-1 text-muted opacity-0 hover:bg-surface-3 focus-visible:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100"
        >
          <MoreHorizontal size={16} aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col">
          {groups.length > 1 && (
            <div className="px-3 pt-1 pb-1 text-xs font-semibold text-muted">Move to</div>
          )}
          {groups
            .filter((g) => g.id !== item.groupId)
            .map((g) => (
              <button
                key={g.id}
                type="button"
                className={menuItem}
                onClick={() => {
                  close();
                  onMove(g.id);
                }}
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ background: LABEL_COLORS[g.color].bg }}
                  aria-hidden
                />
                {g.name}
              </button>
            ))}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              close();
              onArchive();
            }}
          >
            <Archive size={14} aria-hidden /> Archive
          </button>
          <button
            type="button"
            className={cx(menuItem, 'text-danger')}
            onClick={() => {
              close();
              onDelete();
            }}
          >
            <Trash2 size={14} aria-hidden /> Delete
          </button>
        </div>
      )}
    </Popover>
  );
}

function AddItemInput({ groupName, onAdd }: { groupName: string; onAdd: (name: string) => void }) {
  const [v, setV] = useState('');
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      placeholder="+ Add item"
      aria-label={`Add item to ${groupName}`}
      maxLength={500}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && v.trim()) {
          onAdd(v.trim());
          setV(''); // clear immediately so the next item can be typed
        }
        if (e.key === 'Escape') setV('');
      }}
      className="h-full w-full bg-transparent px-3 text-sm placeholder:text-muted focus:bg-surface-2 focus:outline-none"
    />
  );
}
