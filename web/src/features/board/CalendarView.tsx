import {
  addDays,
  calendarEntries,
  diffDays,
  entriesOnDay,
  monthWeeks,
  rescheduled,
  stepAnchor,
  unscheduled,
  weekOf,
  type CalendarEntry,
  type Column,
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
import { format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, EmptyState, SelectField } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { setCell } from '../boards/api';
import type { BoardItem } from '../boards/types';
import { useAddItem, useVisibleItems, type ViewProps } from './viewParts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Chip({
  id,
  item,
  label,
  onOpen,
}: {
  id: string;
  item: BoardItem;
  label: string;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { itemId: item.id, day: id.split('|')[1] ?? '' },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`Event: ${item.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
        else listeners?.['onKeyDown']?.(e);
      }}
      className={cx(
        'cursor-grab truncate rounded-md bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-primary hover:ring-1 hover:ring-primary',
        isDragging && 'opacity-50',
      )}
    >
      {label}
    </div>
  );
}

function DayCell({
  day,
  today,
  inMonth,
  tall,
  canEdit,
  onAdd,
  children,
}: {
  day: string;
  today: string;
  inMonth: boolean;
  tall: boolean;
  canEdit: boolean;
  onAdd: (name: string) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day|${day}`, data: { day } });
  const [adding, setAdding] = useState(false);
  const d = parseISO(day);
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={format(d, 'EEEE d MMMM')}
      className={cx(
        'group flex flex-col gap-1 border-t border-l border-border p-1',
        tall ? 'min-h-64' : 'min-h-24',
        !inMonth && 'bg-surface-2',
        isOver && 'bg-primary-soft',
      )}
    >
      <div className="flex items-center">
        <span
          className={cx(
            'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-bold',
            day === today ? 'bg-primary text-on-primary' : inMonth ? '' : 'text-muted',
          )}
        >
          {d.getDate()}
        </span>
        {canEdit && !adding && (
          <button
            type="button"
            aria-label={`Add item on ${format(d, 'd MMMM')}`}
            onClick={() => setAdding(true)}
            className="ml-auto rounded p-0.5 text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-surface-3"
          >
            <Plus size={14} aria-hidden />
          </button>
        )}
      </div>
      {adding && (
        <input
          autoFocus
          aria-label={`New item on ${format(d, 'd MMMM')}`}
          placeholder="Name, Enter"
          className="h-7 rounded-md border border-primary bg-surface px-1.5 text-xs outline-none"
          onBlur={() => setAdding(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAdding(false);
            if (e.key === 'Enter') {
              const v = e.currentTarget.value.trim();
              if (v) onAdd(v);
              setAdding(false);
            }
          }}
        />
      )}
      {children}
    </div>
  );
}

export function CalendarView(p: ViewProps) {
  const user = useCurrentUser();
  const { board, canEdit, config, onConfig, wid } = p;
  const { visible, byId, today } = useVisibleItems(p);
  const add = useAddItem(p);
  const [anchor, setAnchor] = useState(today);
  const [dragId, setDragId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const mode = config.options.calendarMode;

  const dateCols = board.columns.filter((c) => c.type === 'date' || c.type === 'timeline');
  const col: Column | undefined =
    dateCols.find((c) => c.id === config.options.dateColumnId) ?? dateCols[0];

  const entries = useMemo(() => (col ? calendarEntries(visible, col) : []), [visible, col]);
  const loose = useMemo(
    () =>
      col
        ? unscheduled(
            visible.filter((i) => !i.parentId),
            col,
          )
        : [],
    [visible, col],
  );
  const weeks = useMemo(
    () => (mode === 'week' ? [weekOf(anchor)] : monthWeeks(anchor)),
    [mode, anchor],
  );

  if (!col) {
    return (
      <EmptyState
        title="Calendar needs a date column"
        body="Add a Date or Timeline column to the table, then come back."
      />
    );
  }

  const title =
    mode === 'week'
      ? `Week of ${format(parseISO(weeks[0]![0]!), 'd MMM yyyy')}`
      : format(parseISO(anchor), 'MMMM yyyy');

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const from = e.active.data.current as { itemId: string; day: string } | undefined;
    const to = e.over?.data.current as { day?: string } | undefined;
    if (!from || !to?.day || !canEdit) return;
    const item = byId.get(from.itemId);
    if (!item) return;
    const raw = item.values[col.id];
    const entry = entries.find((x) => x.item.id === item.id);
    let value: unknown;
    if (entry) {
      // Grabbing a later day of a multi-day item keeps that day under the pointer.
      const offset = from.day ? (diffDays(from.day, entry.span.start) ?? 0) : 0;
      const start = addDays(to.day, -offset) as string;
      if (start === entry.span.start) return;
      value = rescheduled(col, raw, start);
    } else {
      value = col.type === 'date' ? to.day : { start: to.day, end: to.day };
    }
    setCell({ wid, board, item, uid: user.uid, column: col, value }).catch((err: unknown) =>
      toast.error(friendlyError(err)),
    );
  };

  const newValue = (day: string) => ({
    [col.id]: col.type === 'date' ? day : { start: day, end: day },
  });
  const dragging = dragId ? byId.get(dragId.split('|')[0] as string) : undefined;
  const monthKey = anchor.slice(0, 7);
  const label = (e: CalendarEntry<BoardItem>, day: string) =>
    e.span.start === day || day === weeks[0]![0] || parseISO(day).getDay() === 1
      ? e.item.name
      : `↳ ${e.item.name}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-2 sm:px-6">
        <Button
          variant="secondary"
          size="sm"
          aria-label={mode === 'week' ? 'Previous week' : 'Previous month'}
          onClick={() => setAnchor(stepAnchor(anchor, mode, -1))}
        >
          <ChevronLeft size={14} aria-hidden />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-label={mode === 'week' ? 'Next week' : 'Next month'}
          onClick={() => setAnchor(stepAnchor(anchor, mode, 1))}
        >
          <ChevronRight size={14} aria-hidden />
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setAnchor(today)}>
          Today
        </Button>
        <h2 className="mx-2 pb-1 text-lg font-bold" aria-live="polite">
          {title}
        </h2>
        <div className="ml-auto flex items-end gap-2">
          <SelectField
            label="Show by"
            value={col.id}
            disabled={!canEdit}
            onChange={(e) =>
              onConfig({ options: { ...config.options, dateColumnId: e.target.value } })
            }
          >
            {dateCols.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Range"
            value={mode}
            onChange={(e) =>
              onConfig({
                options: {
                  ...config.options,
                  calendarMode: e.target.value === 'week' ? 'week' : 'month',
                },
              })
            }
          >
            <option value="month">Month</option>
            <option value="week">Week</option>
          </SelectField>
        </div>
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setDragId(String(e.active.id))}
        onDragCancel={() => setDragId(null)}
        onDragEnd={onDragEnd}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 sm:px-6 lg:flex-row">
          <div
            role="grid"
            aria-label={title}
            className="min-w-[44rem] flex-1 border-r border-b border-border"
          >
            <div role="row" className="grid grid-cols-7">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  role="columnheader"
                  className="border-t border-l border-border bg-surface-2 px-2 py-1 text-xs font-bold text-muted"
                >
                  {d}
                </div>
              ))}
            </div>
            {weeks.map((week) => (
              <div key={week[0]} role="row" className="grid grid-cols-7">
                {week.map((day) => (
                  <DayCell
                    key={day}
                    day={day}
                    today={today}
                    inMonth={mode === 'week' || day.slice(0, 7) === monthKey}
                    tall={mode === 'week'}
                    canEdit={canEdit}
                    onAdd={(name) => add(name, newValue(day))}
                  >
                    {entriesOnDay(entries, day).map((e) => (
                      <Chip
                        key={e.item.id}
                        id={`${e.item.id}|${day}`}
                        item={e.item}
                        label={label(e, day)}
                        onOpen={() => p.onOpenItem(e.item.id)}
                      />
                    ))}
                  </DayCell>
                ))}
              </div>
            ))}
          </div>
          {loose.length > 0 && (
            <aside
              aria-label="No date yet"
              className="w-full shrink-0 rounded-2xl bg-surface-2 p-3 lg:w-56"
            >
              <h3 className="mb-2 text-sm font-bold">
                No date yet <span className="text-muted">({loose.length})</span>
              </h3>
              <p className="mb-2 text-xs text-muted">
                {canEdit ? 'Drag onto a day to schedule.' : 'Items without a date.'}
              </p>
              <div className="flex flex-col gap-1.5">
                {loose.map((i) => (
                  <Chip
                    key={i.id}
                    id={`${i.id}|`}
                    item={i}
                    label={i.name}
                    onOpen={() => p.onOpenItem(i.id)}
                  />
                ))}
              </div>
            </aside>
          )}
        </div>
        <DragOverlay>
          {dragging && (
            <div className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-on-primary shadow-pop">
              {dragging.name}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
