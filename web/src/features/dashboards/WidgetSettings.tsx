import {
  GROUPABLE_TYPES,
  WIDGET_META,
  parseWidgetConfig,
  type BoardDoc,
  type Widget,
  type WidgetConfig,
} from '@app/shared';
import { useEffect, useState } from 'react';
import { Button, Modal, SelectField, TextField } from '../../components/ui';
import { loadBoardDoc } from './data';
import type { DashList } from './Widgets';

const NEEDS_LIST = new Set(['numbers', 'chart', 'table', 'timeline', 'workload']);

/** Settings for one widget: which list, and whatever its kind needs. */
export function WidgetSettings({
  widget,
  wid,
  lists,
  onSave,
  onClose,
}: {
  widget: Widget;
  wid: string;
  lists: DashList[];
  onSave: (config: WidgetConfig) => void;
  onClose: () => void;
}) {
  const type = widget.type;
  const [c, setC] = useState<WidgetConfig>(() => ({
    ...widget.config,
    ...(NEEDS_LIST.has(type) && !widget.config.boardId ? { boardId: lists[0]?.id ?? null } : {}),
  }));
  const [board, setBoard] = useState<BoardDoc | null>(null);
  const set = (patch: WidgetConfig) => setC((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    let live = true;
    setBoard(null);
    if (c.boardId)
      void loadBoardDoc(wid, c.boardId)
        .then((b) => live && setBoard(b))
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [wid, c.boardId]);

  const cols = board?.columns ?? [];
  const numberCols = cols.filter((x) => x.type === 'numbers');
  const statusCols = cols.filter((x) => x.type === 'status');
  const groupCols = cols.filter((x) => GROUPABLE_TYPES.includes(x.type));
  const timelineCols = cols.filter((x) => x.type === 'timeline');
  const storedCols = cols.filter(
    (x) =>
      !['formula', 'progress', 'itemId', 'createdAt', 'updatedAt', 'createdBy', 'time'].includes(
        x.type,
      ),
  );
  const statusCol = statusCols.find((x) => x.id === c.statusColumnId);
  const meta = WIDGET_META[type];

  return (
    <Modal
      open
      onClose={onClose}
      title={`${meta.label} settings`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(
                parseWidgetConfig(
                  c,
                  lists.map((l) => l.id),
                ),
              );
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Title (optional)"
          value={c.title ?? ''}
          maxLength={80}
          placeholder={meta.label}
          onChange={(e) => set({ title: e.target.value })}
        />
        <SelectField
          label="List"
          value={c.boardId ?? ''}
          onChange={(e) =>
            set({
              boardId: e.target.value || null,
              columnId: null,
              statusColumnId: null,
              statusLabelId: null,
              groupColumnId: null,
              stackColumnId: null,
              dateColumnId: null,
              columnIds: [],
            })
          }
        >
          {!NEEDS_LIST.has(type) && <option value="">All the dashboard’s lists</option>}
          {NEEDS_LIST.has(type) === false || type !== 'numbers' ? null : (
            <option value="">All the dashboard’s lists (counts only)</option>
          )}
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </SelectField>

        {type === 'numbers' && (
          <>
            <SelectField
              label="Show"
              value={c.measure ?? 'count'}
              onChange={(e) => set({ measure: e.target.value as 'count' | 'sum' | 'avg' })}
            >
              <option value="count">How many items</option>
              <option value="sum" disabled={!c.boardId}>
                Total of a number column
              </option>
              <option value="avg" disabled={!c.boardId}>
                Average of a number column
              </option>
            </SelectField>
            {(c.measure === 'sum' || c.measure === 'avg') && (
              <SelectField
                label="Number column"
                value={c.columnId ?? ''}
                onChange={(e) => set({ columnId: e.target.value || null })}
              >
                <option value="">Choose…</option>
                {numberCols.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </SelectField>
            )}
            {c.boardId && statusCols.length > 0 && (
              <>
                <SelectField
                  label="Only items whose status…"
                  value={c.statusColumnId ?? ''}
                  onChange={(e) =>
                    set({ statusColumnId: e.target.value || null, statusLabelId: null })
                  }
                >
                  <option value="">Any (count everything)</option>
                  {statusCols.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title} is…
                    </option>
                  ))}
                </SelectField>
                {statusCol && (
                  <SelectField
                    label="Is"
                    value={c.statusLabelId ?? ''}
                    onChange={(e) => set({ statusLabelId: e.target.value || null })}
                  >
                    <option value="">Choose…</option>
                    {(statusCol.settings.labels ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </SelectField>
                )}
              </>
            )}
          </>
        )}

        {type === 'chart' && (
          <>
            <SelectField
              label="Group by"
              value={c.groupColumnId ?? ''}
              onChange={(e) => set({ groupColumnId: e.target.value || null })}
            >
              <option value="">Choose…</option>
              {groupCols.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Chart"
              value={c.chartType ?? 'bar'}
              onChange={(e) => set({ chartType: e.target.value as 'bar' })}
            >
              <option value="bar">Bar</option>
              <option value="stacked">Stacked bar</option>
              <option value="pie">Pie</option>
              <option value="line">Line</option>
            </SelectField>
            {c.chartType === 'stacked' && (
              <SelectField
                label="Stack by"
                value={c.stackColumnId ?? ''}
                onChange={(e) => set({ stackColumnId: e.target.value || null })}
              >
                <option value="">Choose…</option>
                {groupCols.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </SelectField>
            )}
            <SelectField
              label="Measure"
              value={c.measure ?? 'count'}
              onChange={(e) => set({ measure: e.target.value as 'count' })}
            >
              <option value="count">Number of items</option>
              <option value="sum">Total of a number column</option>
              <option value="avg">Average of a number column</option>
            </SelectField>
            {(c.measure === 'sum' || c.measure === 'avg') && (
              <SelectField
                label="Number column"
                value={c.columnId ?? ''}
                onChange={(e) => set({ columnId: e.target.value || null })}
              >
                <option value="">Choose…</option>
                {numberCols.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </SelectField>
            )}
          </>
        )}

        {type === 'table' && (
          <>
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm font-semibold">Columns to show (up to 5)</legend>
              {storedCols.map((x) => {
                const on = (c.columnIds ?? []).includes(x.id);
                return (
                  <label key={x.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && (c.columnIds ?? []).length >= 5}
                      onChange={() =>
                        set({
                          columnIds: on
                            ? (c.columnIds ?? []).filter((i) => i !== x.id)
                            : [...(c.columnIds ?? []), x.id],
                        })
                      }
                      className="h-4 w-4 accent-[var(--c-primary)]"
                    />
                    {x.title}
                  </label>
                );
              })}
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={c.onlyOpen !== false}
                onChange={(e) => set({ onlyOpen: e.target.checked })}
                className="h-4 w-4 accent-[var(--c-primary)]"
              />
              Only items that aren’t done
            </label>
          </>
        )}

        {(type === 'timeline' || type === 'workload') && (
          <SelectField
            label="Timeline column"
            value={c.dateColumnId ?? ''}
            onChange={(e) => set({ dateColumnId: e.target.value || null })}
          >
            <option value="">First timeline column</option>
            {timelineCols.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </SelectField>
        )}
        {type === 'workload' && (
          <TextField
            label="Weeks to show"
            type="number"
            min={1}
            max={12}
            value={String(c.weeks ?? 4)}
            onChange={(e) => set({ weeks: Number(e.target.value) })}
          />
        )}
        {type === 'timeTracked' && (
          <SelectField
            label="Period"
            value={c.period ?? 'month'}
            onChange={(e) => set({ period: e.target.value as 'week' })}
          >
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </SelectField>
        )}
        {(type === 'overdue' || type === 'table') && (
          <TextField
            label="Rows to show"
            type="number"
            min={1}
            max={25}
            value={String(c.limit ?? 10)}
            onChange={(e) => set({ limit: Number(e.target.value) })}
          />
        )}
      </div>
    </Modal>
  );
}
