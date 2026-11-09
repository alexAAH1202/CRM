import {
  GROUPABLE_TYPES,
  kanbanDefaultColumn,
  kanbanLanes,
  laneKeysOf,
  LABEL_COLORS,
  LABEL_COLOR_NAMES,
  moveBetweenLanes,
  type LabelColor,
} from '@app/shared';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState, SelectField } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { setCell } from '../boards/api';
import type { BoardItem } from '../boards/types';
import { cardFacts, ItemDialog, useAddItem, useVisibleItems, type ViewProps } from './viewParts';

function colorOf(name: string): LabelColor {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return LABEL_COLOR_NAMES[h % LABEL_COLOR_NAMES.length] ?? 'blue';
}

function Card({
  item,
  laneKey,
  facts,
  onOpen,
  dragging,
}: {
  item: BoardItem;
  laneKey: string | null;
  facts: Array<{ id: string; title: string; text: string }>;
  onOpen: () => void;
  dragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${item.id}|${laneKey ?? ''}`,
    data: { itemId: item.id, laneKey },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`Card: ${item.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        // dnd-kit's keyboard sensor uses Space; Enter opens the item.
        if (e.key === 'Enter') onOpen();
        else listeners?.['onKeyDown']?.(e);
      }}
      className={cx(
        'cursor-grab touch-manipulation rounded-xl border border-border bg-surface p-3 text-left shadow-sm hover:border-primary',
        (isDragging || dragging) && 'opacity-60',
      )}
    >
      <p className="text-sm font-semibold break-words">{item.name || 'Untitled'}</p>
      {facts.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {facts.map((f) => (
            <li key={f.id} className="truncate text-xs text-muted">
              <span className="font-semibold">{f.title}:</span> {f.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Lane({
  laneKey,
  name,
  color,
  count,
  canEdit,
  onAdd,
  children,
}: {
  laneKey: string | null;
  name: string;
  color: LabelColor;
  count: number;
  canEdit: boolean;
  onAdd: (name: string) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane|${laneKey ?? ''}`, data: { laneKey } });
  const [adding, setAdding] = useState(false);
  return (
    <section
      ref={setNodeRef}
      aria-label={`Lane ${name}`}
      className={cx(
        'flex w-72 shrink-0 flex-col rounded-2xl bg-surface-2 p-2',
        isOver && 'ring-2 ring-primary',
      )}
    >
      <h3 className="flex items-center gap-2 px-2 py-1.5 text-sm font-bold">
        <span
          aria-hidden
          className="h-3 w-3 rounded-full"
          style={{ background: LABEL_COLORS[color].bg }}
        />
        <span className="truncate">{name}</span>
        <span className="ml-auto text-xs font-semibold text-muted">{count}</span>
      </h3>
      <div className="flex min-h-12 flex-col gap-2">{children}</div>
      {canEdit &&
        (adding ? (
          <input
            autoFocus
            aria-label={`New item in ${name}`}
            placeholder="Item name, then Enter"
            className="mt-2 h-9 rounded-lg border border-primary bg-surface px-2 text-sm outline-none"
            onBlur={() => setAdding(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAdding(false);
              if (e.key === 'Enter') {
                const v = e.currentTarget.value.trim();
                if (v) onAdd(v);
                e.currentTarget.value = '';
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-muted hover:bg-surface-3"
          >
            <Plus size={14} aria-hidden /> Add item
          </button>
        ))}
    </section>
  );
}

export function KanbanView(p: ViewProps) {
  const user = useCurrentUser();
  const { board, members, canEdit, config, onConfig, memberName, wid } = p;
  const { visible, byId } = useVisibleItems(p);
  const add = useAddItem(p);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const laneColumns = board.columns.filter((c) => GROUPABLE_TYPES.includes(c.type));
  const laneCol =
    laneColumns.find((c) => c.id === config.options.laneColumnId) ??
    kanbanDefaultColumn(board.columns);

  const lanes = useMemo(
    () => (laneCol ? kanbanLanes(laneCol, members, colorOf) : []),
    [laneCol, members],
  );
  const cards = useMemo(() => {
    const m = new Map<string | null, BoardItem[]>();
    if (!laneCol) return m;
    for (const it of visible) {
      for (const k of laneKeysOf(laneCol, it.values[laneCol.id])) {
        const list = m.get(k) ?? [];
        list.push(it);
        m.set(k, list);
      }
    }
    return m;
  }, [visible, laneCol]);

  if (!laneCol) {
    return (
      <EmptyState
        title="Kanban needs a column to make lanes from"
        body="Add a Status, Dropdown or People column to the table, then come back."
      />
    );
  }

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const from = e.active.data.current as { itemId: string; laneKey: string | null } | undefined;
    const to = e.over?.data.current as { laneKey: string | null } | undefined;
    if (!from || !to || !canEdit || from.laneKey === to.laneKey) return;
    const item = byId.get(from.itemId);
    if (!item) return;
    const value = moveBetweenLanes(laneCol, item.values[laneCol.id], from.laneKey, to.laneKey);
    setCell({ wid, board, item, uid: user.uid, column: laneCol, value }).catch((err: unknown) =>
      toast.error(friendlyError(err)),
    );
  };

  const dragging = dragId ? byId.get(dragId.split('|')[0] as string) : undefined;
  const opened = openId ? byId.get(openId) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 sm:px-6">
        <SelectField
          label="Lanes from"
          value={laneCol.id}
          disabled={!canEdit}
          onChange={(e) =>
            onConfig({ options: { ...config.options, laneColumnId: e.target.value } })
          }
        >
          {laneColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </SelectField>
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setDragId(String(e.active.id))}
        onDragCancel={() => setDragId(null)}
        onDragEnd={onDragEnd}
      >
        <div className="flex min-h-0 flex-1 items-start gap-3 overflow-auto p-4 sm:px-6">
          {lanes.map((l) => {
            const list = cards.get(l.key) ?? [];
            return (
              <Lane
                key={l.key ?? 'none'}
                laneKey={l.key}
                name={l.name}
                color={l.color}
                count={list.length}
                canEdit={canEdit}
                onAdd={(name) =>
                  add(
                    name,
                    l.key === null
                      ? undefined
                      : { [laneCol.id]: laneCol.type === 'status' ? l.key : [l.key] },
                  )
                }
              >
                {list.map((it) => (
                  <Card
                    key={it.id}
                    item={it}
                    laneKey={l.key}
                    facts={cardFacts(board.columns, it, laneCol.id, memberName)}
                    onOpen={() => setOpenId(it.id)}
                  />
                ))}
              </Lane>
            );
          })}
        </div>
        <DragOverlay>
          {dragging && (
            <div className="rounded-xl border border-primary bg-surface p-3 text-sm font-semibold shadow-pop">
              {dragging.name}
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {opened && <ItemDialog p={p} item={opened} onClose={() => setOpenId(null)} />}
    </div>
  );
}
