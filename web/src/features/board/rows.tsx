import {
  LABEL_COLOR_NAMES,
  LABEL_COLORS,
  summarize,
  type LayoutGroup,
  type LabelColor,
} from '@app/shared';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownRight,
  GripVertical,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Trash2,
  PanelRight,
} from 'lucide-react';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Popover } from '../../components/ui';
import { cx } from '../../lib/cx';
import type { BoardItem } from '../boards/types';
import { AddColumnButton, ColumnHeader } from './ColumnMenu';
import { Cell } from './cells';
import { useTable } from './tableContext';

export const EDGE = 6;
export const ADD_COL = 48;
const menuItem =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2';

function rowBox(
  style: { start: number; size: number },
  totalWidth: number,
  template: string,
): CSSProperties {
  return {
    top: style.start,
    height: style.size,
    width: totalWidth,
    gridTemplateColumns: template,
  };
}

// Rows are positioned with `top` (not transform): dnd-kit measures elements ignoring
// CSS transforms, which would put every drop target in the wrong place.
const rowBase = 'absolute left-0 grid';
const stickyName = 'sticky left-0 z-10';

function DropLine({ edge }: { edge: 'top' | 'bottom' }) {
  return (
    <div
      aria-hidden
      className={cx(
        'pointer-events-none absolute right-0 left-0 z-20 h-0.5 bg-primary',
        edge === 'top' ? 'top-0' : 'bottom-0',
      )}
    />
  );
}

type Pos = { start: number; size: number };

// ------------------------------------------------------------------- group

export function GroupHeaderRow({
  group,
  count,
  pos,
}: {
  group: LayoutGroup<BoardItem>;
  count: number;
  pos: Pos;
}) {
  const t = useTable();
  const color = LABEL_COLORS[group.color].bg;
  const isCollapsed = t.collapsed.has(group.key);
  const draggable = t.groupDragEnabled && !group.virtual && t.canEdit;
  const dragId = `g:${group.groupId ?? group.key}`;
  const drag = useDraggable({
    id: dragId,
    data: { type: 'group', groupId: group.groupId },
    disabled: !draggable,
  });
  const drop = useDroppable({
    id: dragId,
    data: { type: 'group', groupId: group.groupId },
    disabled: group.virtual,
  });
  const target = t.dropTarget?.id === dragId ? t.dropTarget : null;
  const [renaming, setRenaming] = useState(false);

  return (
    <div
      ref={drop.setNodeRef}
      role="row"
      aria-label={`Group ${group.name}`}
      className={cx(rowBase, 'items-end pb-1', drag.isDragging && 'opacity-40')}
      style={rowBox(pos, t.totalWidth, t.template)}
    >
      <div
        ref={drag.setNodeRef}
        role="gridcell"
        className={cx(
          stickyName,
          'col-span-full flex w-max items-center gap-1 justify-self-start bg-bg pr-2 whitespace-nowrap',
        )}
      >
        {draggable && (
          <button
            type="button"
            {...drag.listeners}
            {...drag.attributes}
            aria-label={`Drag to reorder group ${group.name}`}
            className="cursor-grab rounded-md p-1 text-muted opacity-60 hover:bg-surface-2 hover:opacity-100 focus-visible:opacity-100"
          >
            <GripVertical size={14} aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => t.toggleGroup(group.key)}
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} group ${group.name}`}
          className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg"
        >
          {isCollapsed ? (
            <ChevronRight size={18} aria-hidden />
          ) : (
            <ChevronDown size={18} aria-hidden />
          )}
        </button>
        <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
        {renaming ? (
          <input
            autoFocus
            defaultValue={group.name}
            aria-label="Group name"
            maxLength={80}
            className="h-8 rounded-lg border-2 border-primary bg-surface px-2 text-base font-bold outline-none"
            onBlur={(e) => {
              const n = e.target.value.trim();
              if (n && n !== group.name && group.groupId) t.onGroupRename(group.groupId, n);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : t.canEdit && !group.virtual ? (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            className="min-w-0 rounded-md px-1 hover:bg-surface-2"
            aria-label={`Rename group ${group.name}`}
          >
            <h2 className="truncate text-base font-extrabold text-fg">{group.name}</h2>
          </button>
        ) : (
          <h2 className="truncate px-1 text-base font-extrabold text-fg">{group.name}</h2>
        )}
        <span className="ml-2 text-xs text-muted">
          {count} {count === 1 ? 'item' : 'items'}
        </span>
        {t.canEdit && !group.virtual && group.groupId && (
          <GroupMenu group={group} groupId={group.groupId} />
        )}
      </div>
      {target && <DropLine edge={target.edge} />}
    </div>
  );
}

function GroupMenu({ group, groupId }: { group: LayoutGroup<BoardItem>; groupId: string }) {
  const t = useTable();
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
            {LABEL_COLOR_NAMES.map((c: LabelColor) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={group.color === c}
                onClick={() => {
                  t.onGroupColor(groupId, c);
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
          {t.canDeleteGroup && (
            <button
              type="button"
              className={cx(menuItem, 'text-danger')}
              onClick={() => {
                close();
                t.onGroupDelete(groupId);
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

// ------------------------------------------------------------ column header

function ResizeHandle({ columnId, width }: { columnId: string; width: number }) {
  const t = useTable();
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      className="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-primary/30"
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        let latest = width;
        const move = (ev: PointerEvent) => {
          latest = Math.min(600, Math.max(80, width + ev.clientX - startX));
          t.setLiveWidth(columnId, latest);
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          t.setLiveWidth(columnId, null);
          if (latest !== width) t.onResize(columnId, latest);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
    />
  );
}

export function ColumnsRow({
  group,
  itemIds,
  pos,
  navRow,
}: {
  group: LayoutGroup<BoardItem>;
  itemIds: string[];
  pos: Pos;
  navRow: number;
}) {
  const t = useTable();
  const color = LABEL_COLORS[group.color].bg;
  const selectedCount = itemIds.filter((id) => t.selected.has(id)).length;
  const all = itemIds.length > 0 && selectedCount === itemIds.length;
  return (
    <div
      role="row"
      className={cx(rowBase, 'border-b border-border bg-surface')}
      style={rowBox(pos, t.totalWidth, t.template)}
    >
      <div className={cx(stickyName, 'rounded-tl-xl')} style={{ background: color }} />
      <div
        className={cx(
          stickyName,
          'flex items-center gap-2 border-r border-border bg-surface px-3 text-xs font-semibold text-muted',
        )}
        style={{ left: EDGE }}
        role="columnheader"
        data-nav-row={navRow}
        data-nav-col={0}
      >
        {t.canEdit && itemIds.length > 0 && (
          <input
            type="checkbox"
            aria-label={`Select all items in ${group.name}`}
            checked={all}
            ref={(el) => {
              if (el) el.indeterminate = selectedCount > 0 && !all;
            }}
            onChange={(e) => t.setGroupSelected(itemIds, e.target.checked)}
            className="h-4 w-4 accent-[var(--c-primary)]"
          />
        )}
        Item
      </div>
      {t.columns.map((c, i) => (
        <div key={c.id} role="columnheader" className="relative border-r border-border">
          <ColumnHeader
            column={c}
            canEdit={t.canEdit}
            index={i}
            count={t.columns.length}
            onSave={t.onColumnSave}
            onDelete={() => t.onColumnDelete(c)}
            onMove={(dir) => t.onColumnMove(c, dir)}
            onChangeType={() => t.onColumnChangeType(c)}
            onDefault={() => t.onColumnDefault(c)}
            onConfigure={() => t.onColumnConfigure(c)}
          />
          <ResizeHandle columnId={c.id} width={t.widths[i] ?? 150} />
        </div>
      ))}
      <div role="gridcell">{t.canEdit && <AddColumnButton onAdd={t.onAddColumn} />}</div>
    </div>
  );
}

// -------------------------------------------------------------------- items

function NameCell({
  item,
  group,
  isSub,
  navRow,
  subCount,
  drag,
}: {
  item: BoardItem;
  group: LayoutGroup<BoardItem>;
  isSub: boolean;
  navRow: number;
  subCount: number;
  drag?: {
    setActivatorNodeRef: (el: HTMLElement | null) => void;
    listeners: object | undefined;
    attributes: object;
    enabled: boolean;
  };
}) {
  const t = useTable();
  const [editing, setEditing] = useState(false);
  const expanded = t.expanded.has(item.id);
  const checked = t.selected.has(item.id);
  const showCheck = !isSub && t.canEdit;

  return (
    <div
      className={cx(
        stickyName,
        'flex items-center border-r border-border bg-surface group-hover/row:bg-surface-2',
        isSub && 'pl-5',
      )}
      style={{ left: EDGE }}
      role="gridcell"
      data-nav-row={navRow}
      data-nav-col={0}
    >
      {!isSub && t.canEdit && (
        <span className="hidden w-4 shrink-0 justify-center sm:flex">
          {drag?.enabled && (
            <button
              type="button"
              ref={drag.setActivatorNodeRef}
              {...drag.listeners}
              {...drag.attributes}
              aria-label={`Drag to reorder ${item.name}`}
              className="cursor-grab touch-none rounded text-muted opacity-0 hover:text-fg focus-visible:opacity-100 group-hover/row:opacity-70"
            >
              <GripVertical size={14} aria-hidden />
            </button>
          )}
        </span>
      )}
      {showCheck && (
        <input
          type="checkbox"
          checked={checked}
          onChange={() => t.toggleSelect(item.id)}
          aria-label={`Select ${item.name}`}
          className={cx(
            'mx-1 h-4 w-4 shrink-0 accent-[var(--c-primary)] sm:mx-1.5',
            !checked &&
              !t.selectionActive &&
              'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
          )}
        />
      )}
      {isSub && <CornerDownRight size={12} aria-hidden className="mr-1 shrink-0 text-muted" />}
      {!isSub && (
        <button
          type="button"
          onClick={() => t.onItemAction('expand', item)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} subitems of ${item.name}${subCount ? ` (${subCount})` : ''}`}
          className={cx(
            'mr-0.5 flex h-6 shrink-0 items-center gap-0.5 rounded px-1 text-xs text-muted hover:bg-surface-3 hover:text-fg',
            subCount === 0 &&
              !expanded &&
              'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 max-sm:hidden',
          )}
        >
          {expanded ? (
            <ChevronDown size={14} aria-hidden />
          ) : (
            <ChevronRight size={14} aria-hidden />
          )}
          {subCount > 0 && <span>{subCount}</span>}
        </button>
      )}
      {editing ? (
        <input
          autoFocus
          defaultValue={item.name}
          aria-label="Item name"
          maxLength={500}
          className="h-full min-w-0 flex-1 border-2 border-primary bg-surface px-2 text-sm outline-none"
          onBlur={(e) => {
            const n = e.target.value.trim();
            if (n && n !== item.name) t.onRename(item, n);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button
          type="button"
          disabled={!t.canEdit}
          // On a phone a tap opens the item (there's no hover, and the name is the big target);
          // renaming is in the item itself. Elsewhere a click edits the name in place.
          onClick={() =>
            window.matchMedia('(max-width: 639px)').matches
              ? t.onOpenItem(item.id)
              : setEditing(true)
          }
          data-nav-focus
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left text-sm enabled:hover:text-primary sm:px-2"
          aria-label={t.canEdit ? `Rename ${item.name}` : item.name}
        >
          <span className={cx('truncate', item.archived && 'line-through opacity-60')}>
            {item.name || <span className="text-muted">Untitled</span>}
          </span>
          {item.archived && (
            <span className="rounded-full bg-surface-3 px-1.5 text-[10px] font-semibold text-muted">
              Archived
            </span>
          )}
          {t.canEdit && (
            <Pencil
              size={12}
              aria-hidden
              className="shrink-0 opacity-0 group-hover/row:opacity-40 max-sm:hidden"
            />
          )}
        </button>
      )}
      <button
        type="button"
        onClick={() => t.onOpenItem(item.id)}
        aria-label={`Open ${item.name}`}
        title="Open item: updates, files and details"
        className="mr-1 shrink-0 rounded p-1 text-muted opacity-0 group-hover/row:opacity-100 hover:bg-surface-3 hover:text-fg focus-visible:opacity-100 max-sm:hidden"
      >
        <PanelRight size={14} aria-hidden />
      </button>
      {t.canEdit && <ItemMenu item={item} group={group} isSub={isSub} />}
    </div>
  );
}

function ItemMenu({
  item,
  group,
  isSub,
}: {
  item: BoardItem;
  group: LayoutGroup<BoardItem>;
  isSub: boolean;
}) {
  const t = useTable();
  const groups = t.board.groups;
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
          className="mr-0.5 rounded-md p-1 text-muted opacity-0 hover:bg-surface-3 focus-visible:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100 sm:mr-1"
        >
          <MoreHorizontal size={16} aria-hidden />
        </button>
      )}
    >
      {(close) => {
        const act = (a: Parameters<typeof t.onItemAction>[0], arg?: string) => () => {
          close();
          t.onItemAction(a, item, arg);
        };
        return (
          <div className="flex flex-col">
            {!isSub && (
              <button type="button" className={menuItem} onClick={act('addSub')}>
                <Plus size={14} aria-hidden /> Add subitem
              </button>
            )}
            {!isSub && (
              <button type="button" className={menuItem} onClick={act('duplicate')}>
                <Copy size={14} aria-hidden /> Duplicate
              </button>
            )}
            {!isSub && !group.virtual && groups.length > 1 && (
              <div className="px-3 pt-1 pb-1 text-xs font-semibold text-muted">Move to</div>
            )}
            {!isSub &&
              !group.virtual &&
              groups
                .filter((g) => g.id !== item.groupId)
                .map((g) => (
                  <button key={g.id} type="button" className={menuItem} onClick={act('move', g.id)}>
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ background: LABEL_COLORS[g.color].bg }}
                      aria-hidden
                    />
                    {g.name}
                  </button>
                ))}
            <div className="my-1 border-t border-border" />
            {item.archived ? (
              <button type="button" className={menuItem} onClick={act('restore')}>
                <ArchiveRestore size={14} aria-hidden /> Restore
              </button>
            ) : (
              <button type="button" className={menuItem} onClick={act('archive')}>
                <Archive size={14} aria-hidden /> Archive
              </button>
            )}
            <button type="button" className={cx(menuItem, 'text-danger')} onClick={act('delete')}>
              <Trash2 size={14} aria-hidden /> Delete
            </button>
          </div>
        );
      }}
    </Popover>
  );
}

function ItemCells({ item, navRow }: { item: BoardItem; navRow: number }) {
  const t = useTable();
  return (
    <>
      {t.columns.map((c, i) => (
        <div
          key={c.id}
          role="gridcell"
          className="min-w-0 border-r border-border"
          data-nav-row={navRow}
          data-nav-col={i + 1}
        >
          <Cell
            column={c}
            item={item}
            itemName={item.name}
            canEdit={t.canEdit}
            members={t.members}
            onChange={(v) => t.onCell(item, c, v)}
          />
        </div>
      ))}
      <div />
    </>
  );
}

export function ItemRow({
  item,
  group,
  subCount,
  pos,
  navRow,
}: {
  item: BoardItem;
  group: LayoutGroup<BoardItem>;
  subCount: number;
  pos: Pos;
  navRow: number;
}) {
  const t = useTable();
  const id = `i:${item.id}`;
  const color = LABEL_COLORS[group.color].bg;
  const drag = useDraggable({
    id,
    data: { type: 'item', id: item.id, groupId: item.groupId },
    disabled: !t.itemDragEnabled,
  });
  const drop = useDroppable({
    id,
    data: { type: 'item', id: item.id, groupId: item.groupId },
    disabled: !t.itemDragEnabled,
  });
  const target = t.dropTarget?.id === id ? t.dropTarget : null;
  return (
    <div
      ref={(el) => {
        drop.setNodeRef(el);
        drag.setNodeRef(el);
      }}
      role="row"
      aria-selected={t.selected.has(item.id)}
      className={cx(
        rowBase,
        'group/row border-b border-border bg-surface hover:bg-surface-2/60',
        t.selected.has(item.id) && 'bg-primary-soft hover:bg-primary-soft',
        drag.isDragging && 'opacity-40',
        item.archived && 'opacity-70',
      )}
      style={rowBox(pos, t.totalWidth, t.template)}
    >
      <div className={stickyName} style={{ background: color }} />
      <NameCell
        item={item}
        group={group}
        isSub={false}
        navRow={navRow}
        subCount={subCount}
        drag={{
          setActivatorNodeRef: drag.setActivatorNodeRef,
          listeners: drag.listeners,
          attributes: drag.attributes,
          enabled: t.itemDragEnabled,
        }}
      />
      <ItemCells item={item} navRow={navRow} />
      {target && <DropLine edge={target.edge} />}
    </div>
  );
}

export function SubRow({
  item,
  group,
  pos,
  navRow,
}: {
  item: BoardItem;
  group: LayoutGroup<BoardItem>;
  pos: Pos;
  navRow: number;
}) {
  const t = useTable();
  return (
    <div
      role="row"
      className={cx(
        rowBase,
        'group/row border-b border-border bg-surface-2/50 hover:bg-surface-2',
        item.archived && 'opacity-70',
      )}
      style={rowBox(pos, t.totalWidth, t.template)}
    >
      <div
        className={stickyName}
        style={{ background: LABEL_COLORS[group.color].bg, opacity: 0.45 }}
      />
      <NameCell item={item} group={group} isSub navRow={navRow} subCount={0} />
      <ItemCells item={item} navRow={navRow} />
    </div>
  );
}

function AddInput({
  label,
  placeholder,
  indent,
  onAdd,
  navRow,
}: {
  label: string;
  placeholder: string;
  indent?: boolean;
  onAdd: (name: string) => void;
  navRow: number;
}) {
  const [v, setV] = useState('');
  const cancelled = useRef(false);
  const commit = () => {
    const name = v.trim();
    if (name) {
      onAdd(name);
      setV(''); // clear at once so the next item can be typed
    }
  };
  return (
    <div className="relative h-full w-full">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        maxLength={500}
        data-nav-row={navRow}
        data-nav-col={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            cancelled.current = true;
            setV('');
          }
        }}
        // Clicking away saves what you typed, like every other inline editor here.
        onBlur={() => {
          if (cancelled.current) cancelled.current = false;
          else commit();
        }}
        className={cx(
          'h-full w-full bg-transparent text-sm placeholder:text-muted focus:bg-surface-2 focus:outline-none',
          indent ? 'pl-12' : 'px-3',
        )}
      />
      {v.trim() !== '' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted"
        >
          Enter to add
        </span>
      )}
    </div>
  );
}

export function AddItemRow({
  group,
  pos,
  navRow,
}: {
  group: LayoutGroup<BoardItem>;
  pos: Pos;
  navRow: number;
}) {
  const t = useTable();
  const id = `a:${group.key}`;
  const drop = useDroppable({
    id,
    data: { type: 'add', groupId: group.groupId },
    disabled: group.virtual,
  });
  const target = t.dropTarget?.id === id ? t.dropTarget : null;
  return (
    <div
      ref={drop.setNodeRef}
      role="row"
      className={cx(rowBase, 'border-b border-border bg-surface')}
      style={rowBox(pos, t.totalWidth, t.template)}
    >
      <div
        className={cx(stickyName, 'rounded-bl-xl')}
        style={{ background: LABEL_COLORS[group.color].bg, opacity: 0.5 }}
      />
      <div role="gridcell" className={cx(stickyName, 'bg-surface')} style={{ left: EDGE }}>
        <AddInput
          label={`Add item to ${group.name}`}
          placeholder="+ Add item"
          navRow={navRow}
          onAdd={(name) => t.onAddItem(group, name)}
        />
      </div>
      {target && <DropLine edge={target.edge} />}
    </div>
  );
}

export function AddSubitemRow({
  parent,
  lastOrder,
  group,
  pos,
  navRow,
}: {
  parent: BoardItem;
  lastOrder: string | null;
  group: LayoutGroup<BoardItem>;
  pos: Pos;
  navRow: number;
}) {
  const t = useTable();
  return (
    <div
      role="row"
      className={cx(rowBase, 'border-b border-border bg-surface-2/50')}
      style={rowBox(pos, t.totalWidth, t.template)}
    >
      <div
        className={stickyName}
        style={{ background: LABEL_COLORS[group.color].bg, opacity: 0.45 }}
      />
      <div role="gridcell" className={cx(stickyName, 'bg-surface-2/50')} style={{ left: EDGE }}>
        <AddInput
          label={`Add subitem to ${parent.name}`}
          placeholder="+ Add subitem"
          indent
          navRow={navRow}
          onAdd={(name) => t.onAddSubitem(parent, name, lastOrder)}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ summary

export function SummaryRow({ group, pos }: { group: LayoutGroup<BoardItem>; pos: Pos }) {
  const t = useTable();
  const items = group.rows.map((r) => r.item);
  return (
    <div
      role="row"
      className={cx(rowBase, 'border-b border-border bg-surface-2/40 text-xs')}
      style={rowBox(pos, t.totalWidth, t.template)}
    >
      <div
        className={stickyName}
        style={{ background: LABEL_COLORS[group.color].bg, opacity: 0.25 }}
      />
      <div className={cx(stickyName, 'bg-surface-2')} style={{ left: EDGE }} />
      {t.columns.map((c) => {
        const s = summarize(
          c,
          items.map((i) => i.values[c.id]),
        );
        let body: ReactNode = null;
        if (s.kind === 'number')
          body = s.text ? <span className="font-semibold tabular-nums">{s.text}</span> : null;
        else if (s.kind === 'count') body = <span className="text-muted">{s.n} filled</span>;
        else if (s.kind === 'distribution' && s.total > 0) {
          body = (
            <span
              className="flex h-5 w-full overflow-hidden rounded-md"
              role="img"
              aria-label={s.parts.map((p) => `${p.label} ${p.count}`).join(', ')}
              title={s.parts.map((p) => `${p.label}: ${p.count}`).join('\n')}
            >
              {s.parts.map((p) => (
                <span
                  key={p.label}
                  style={{ flex: p.count, background: LABEL_COLORS[p.color].bg }}
                />
              ))}
            </span>
          );
        }
        return (
          <div
            key={c.id}
            role="gridcell"
            className="flex items-center justify-center overflow-hidden border-r border-border px-2"
          >
            {body}
          </div>
        );
      })}
      <div />
    </div>
  );
}

export function GapRow({ pos }: { pos: Pos }) {
  const t = useTable();
  return <div aria-hidden className={rowBase} style={rowBox(pos, t.totalWidth, t.template)} />;
}
