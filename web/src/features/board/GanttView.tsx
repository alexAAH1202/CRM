import {
  barRect,
  dependencyEdges,
  dragSpan,
  ganttRange,
  ganttTicks,
  LABEL_COLORS,
  predecessorsOf,
  shiftPlan,
  spanOf,
  ZOOM_PX,
  addDays,
  diffDays,
  type DateSpan,
  type DragMode,
  type GanttZoom,
} from '@app/shared';
import { useMemo, useRef, useState } from 'react';
import { EmptyState, SelectField } from '../../components/ui';
import { friendlyError } from '../../lib/firestore/errors';
import { toast, useToastStore } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { setCell } from '../boards/api';
import type { BoardItem } from '../boards/types';
import { ItemDialog, useVisibleItems, type ViewProps } from './viewParts';

const ROW = 36;
const HEAD = 44;
const NAME_W = 220;

type Line =
  | { type: 'group'; key: string; name: string; color: keyof typeof LABEL_COLORS }
  | { type: 'item'; key: string; item: BoardItem };

interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  delta: number;
}

export function GanttView(p: ViewProps) {
  const user = useCurrentUser();
  const { board, canEdit, config, onConfig, wid } = p;
  const { layout, byId, today } = useVisibleItems(p);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const moved = useRef(false);

  const zoom: GanttZoom = config.options.zoom;
  const px = ZOOM_PX[zoom];
  const timelineCols = board.columns.filter((c) => c.type === 'timeline');
  const col = timelineCols.find((c) => c.id === config.options.ganttColumnId) ?? timelineCols[0];
  const depCol = board.columns.find((c) => c.type === 'dependency');

  const lines = useMemo<Line[]>(
    () =>
      layout.flatMap((g) => {
        if (g.rows.length === 0) return [];
        const out: Line[] = [{ type: 'group', key: `g:${g.key}`, name: g.name, color: g.color }];
        for (const r of g.rows)
          for (const item of [r.item, ...r.subitems])
            out.push({ type: 'item', key: item.id, item });
        return out;
      }),
    [layout],
  );

  // Spans of every item on the board (not only the ones shown), for dependency logic.
  const allSpans = useMemo(() => {
    const m = new Map<string, DateSpan>();
    if (!col) return m;
    for (const it of byId.values()) {
      const s = spanOf(col, it.values[col.id]);
      if (s) m.set(it.id, s);
    }
    return m;
  }, [byId, col]);
  const depsOf = useMemo(
    () => (id: string) => {
      const it = byId.get(id);
      return depCol && it ? predecessorsOf(depCol, it.values) : [];
    },
    [byId, depCol],
  );

  // While dragging, the dragged bar previews its new dates.
  const shownSpan = (id: string): DateSpan | null => {
    const s = allSpans.get(id) ?? null;
    if (s && drag && drag.id === id) return dragSpan(s, drag.mode, drag.delta);
    return s;
  };

  const range = useMemo(() => ganttRange([...allSpans.values()], today), [allSpans, today]);
  const ticks = useMemo(() => ganttTicks(range, zoom), [range, zoom]);

  const rowIndex = new Map<string, number>();
  lines.forEach((l, i) => {
    if (l.type === 'item') rowIndex.set(l.item.id, i);
  });
  const previewSpans = new Map(allSpans);
  if (drag) {
    const s = allSpans.get(drag.id);
    if (s) previewSpans.set(drag.id, dragSpan(s, drag.mode, drag.delta));
  }
  const edges = dependencyEdges(depsOf, previewSpans).filter(
    (e) => rowIndex.has(e.from) && rowIndex.has(e.to),
  );

  if (!col) {
    return (
      <EmptyState
        title="The timeline needs a Timeline column"
        body="Add a Timeline column to the table (start and end dates), then come back."
      />
    );
  }

  const fail = (err: unknown) => toast.error(friendlyError(err));
  const write = (item: BoardItem, span: DateSpan) =>
    setCell({
      wid,
      board,
      item,
      uid: user.uid,
      column: col,
      value: { start: span.start, end: span.end },
    });

  const commit = (item: BoardItem, next: DateSpan) => {
    write(item, next).catch(fail);
    // Offer to push dependents that now start too early.
    const spans = new Map(allSpans).set(item.id, next);
    const plan = shiftPlan(item.id, spans, depsOf);
    if (plan.size > 0) {
      useToastStore.getState().push(
        {
          message: `${plan.size} dependent ${plan.size === 1 ? 'item now starts' : 'items now start'} too early.`,
          tone: 'info',
          action: {
            label: `Shift ${plan.size === 1 ? 'it' : 'them'}`,
            onClick: () => {
              for (const [id, span] of plan) {
                const it = byId.get(id);
                if (it) write(it, span).catch(fail);
              }
            },
          },
        },
        12000,
      );
    }
  };

  const onDown = (e: React.PointerEvent, id: string, mode: DragMode) => {
    if (!canEdit || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    moved.current = false;
    setDrag({ id, mode, startX: e.clientX, delta: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.startX) / px);
    if (delta !== drag.delta) {
      moved.current = true;
      setDrag({ ...drag, delta });
    }
  };
  const onUp = () => {
    if (!drag) return;
    const item = byId.get(drag.id);
    const span = allSpans.get(drag.id);
    setDrag(null);
    if (!item || !span) return;
    if (drag.delta !== 0) commit(item, dragSpan(span, drag.mode, drag.delta));
    else if (!moved.current) setOpenId(item.id);
  };

  const width = range.days * px;
  const todayX = (diffDays(today, range.start) ?? 0) * px + px / 2;
  const opened = openId ? byId.get(openId) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-2 sm:px-6">
        <SelectField
          label="Bars from"
          value={col.id}
          disabled={!canEdit}
          onChange={(e) =>
            onConfig({ options: { ...config.options, ganttColumnId: e.target.value } })
          }
        >
          {timelineCols.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Zoom"
          value={zoom}
          onChange={(e) =>
            onConfig({ options: { ...config.options, zoom: e.target.value as GanttZoom } })
          }
        >
          <option value="day">Days</option>
          <option value="week">Weeks</option>
          <option value="month">Months</option>
        </SelectField>
        {!depCol && (
          <p className="pb-2 text-xs text-muted">
            Add a Dependency column to the table to draw arrows between items.
          </p>
        )}
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto"
        role="region"
        aria-label="Timeline chart"
        tabIndex={0}
      >
        <div
          className="relative"
          style={{ width: NAME_W + width, minHeight: HEAD + lines.length * ROW }}
        >
          {/* header */}
          <div
            className="sticky top-0 z-20 flex border-b border-border bg-surface"
            style={{ height: HEAD }}
          >
            <div
              className="sticky left-0 z-30 shrink-0 border-r border-border bg-surface px-3 py-2 text-xs font-bold text-muted"
              style={{ width: NAME_W }}
            >
              Item
            </div>
            <div className="relative" style={{ width }}>
              {ticks.map((t) => (
                <div
                  key={t.x}
                  className="absolute top-0 h-full border-l border-border pl-1 pt-2.5 text-xs text-muted"
                  style={{ left: t.x }}
                >
                  <span className={t.major ? 'font-bold text-fg' : ''}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* names column */}
          <div className="absolute left-0 z-10" style={{ top: HEAD, width: NAME_W }}>
            {lines.map((l) => (
              <div
                key={l.key}
                className="sticky left-0 flex items-center gap-2 truncate border-r border-b border-border bg-surface px-3 text-sm"
                style={{ height: ROW }}
              >
                {l.type === 'group' ? (
                  <>
                    <span
                      aria-hidden
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: LABEL_COLORS[l.color].bg }}
                    />
                    <span className="truncate font-bold">{l.name}</span>
                  </>
                ) : (
                  <button
                    type="button"
                    className="truncate text-left hover:underline"
                    onClick={() => setOpenId(l.item.id)}
                  >
                    {l.item.name || 'Untitled'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* chart area */}
          <div
            className="absolute"
            style={{ left: NAME_W, top: HEAD, width, height: lines.length * ROW }}
          >
            {ticks
              .filter((t) => t.major)
              .map((t) => (
                <div
                  key={t.x}
                  className="absolute top-0 h-full border-l border-border"
                  style={{ left: t.x }}
                />
              ))}
            {lines.map((l, i) => (
              <div
                key={l.key}
                className={
                  l.type === 'group'
                    ? 'absolute w-full bg-surface-2'
                    : 'absolute w-full border-b border-border'
                }
                style={{ top: i * ROW, height: ROW }}
              />
            ))}
            <div
              aria-label="Today"
              className="absolute top-0 z-10 h-full w-0.5 bg-primary opacity-70"
              style={{ left: todayX }}
            />
            <svg
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 z-10 text-muted"
              width={width}
              height={lines.length * ROW}
            >
              <defs>
                <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" fill="currentColor" />
                </marker>
              </defs>
              {edges.map((e) => {
                const a = previewSpans.get(e.from) as DateSpan;
                const b = previewSpans.get(e.to) as DateSpan;
                const ra = barRect(a, range.start, px);
                const rb = barRect(b, range.start, px);
                const y1 = (rowIndex.get(e.from) as number) * ROW + ROW / 2;
                const y2 = (rowIndex.get(e.to) as number) * ROW + ROW / 2;
                const x1 = ra.x + ra.w;
                const x2 = rb.x;
                const mid = y1 + (y2 > y1 ? ROW / 2 : -ROW / 2);
                const d =
                  x2 >= x1 + 12
                    ? `M${x1},${y1} H${x1 + 6} V${y2} H${x2}`
                    : `M${x1},${y1} H${x1 + 6} V${mid} H${x2 - 6} V${y2} H${x2}`;
                return (
                  <path
                    key={`${e.from}>${e.to}`}
                    d={d}
                    fill="none"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    markerEnd="url(#arrow)"
                    className={e.violated ? 'text-danger' : 'text-muted'}
                    data-violated={e.violated || undefined}
                  />
                );
              })}
            </svg>
            {lines.map((l, i) => {
              if (l.type !== 'item') return null;
              const span = shownSpan(l.item.id);
              const top = i * ROW + 6;
              if (!span) {
                return canEdit ? (
                  <button
                    key={l.key}
                    type="button"
                    aria-label={`Set dates for ${l.item.name}`}
                    onClick={() =>
                      write(l.item, { start: today, end: addDays(today, 2) as string }).catch(fail)
                    }
                    className="absolute z-20 rounded-md border border-dashed border-border px-2 text-xs text-muted hover:border-primary hover:text-primary"
                    style={{ left: todayX + 6, top, height: ROW - 12 }}
                  >
                    + Set dates
                  </button>
                ) : null;
              }
              const r = barRect(span, range.start, px);
              const days = (diffDays(span.end, span.start) ?? 0) + 1;
              return (
                <div
                  key={l.key}
                  role="button"
                  tabIndex={0}
                  aria-label={`Bar: ${l.item.name}, ${span.start} to ${span.end}`}
                  data-start={span.start}
                  data-end={span.end}
                  onPointerDown={(e) => onDown(e, l.item.id, 'move')}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(e) => {
                    const item = l.item;
                    const base = allSpans.get(item.id);
                    if (e.key === 'Enter') setOpenId(item.id);
                    else if (canEdit && base && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                      e.preventDefault();
                      const d = e.key === 'ArrowLeft' ? -1 : 1;
                      commit(item, dragSpan(base, e.shiftKey ? 'end' : 'move', d));
                    }
                  }}
                  className={`absolute z-20 flex touch-none items-center overflow-hidden rounded-md bg-primary text-xs font-semibold text-on-primary shadow-sm ${canEdit ? 'cursor-grab' : ''}`}
                  style={{ left: r.x, top, width: Math.max(r.w, 8), height: ROW - 12 }}
                >
                  {canEdit && (
                    <span
                      aria-hidden
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onDown(e, l.item.id, 'start');
                      }}
                      onPointerMove={onMove}
                      onPointerUp={onUp}
                      className="absolute left-0 h-full w-2 cursor-ew-resize bg-black/20"
                    />
                  )}
                  <span className="truncate px-3">
                    {r.w > 90 ? `${l.item.name} · ${days}d` : ''}
                  </span>
                  {canEdit && (
                    <span
                      aria-hidden
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onDown(e, l.item.id, 'end');
                      }}
                      onPointerMove={onMove}
                      onPointerUp={onUp}
                      className="absolute right-0 h-full w-2 cursor-ew-resize bg-black/20"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {opened && <ItemDialog p={p} item={opened} onClose={() => setOpenId(null)} />}
    </div>
  );
}
