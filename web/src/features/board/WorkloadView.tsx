import {
  DEFAULT_CAPACITY_HOURS,
  isOver,
  MAX_CAPACITY_HOURS,
  mondayOf,
  nextWeek,
  spanOf,
  workloadGrid,
  type WorkItem,
} from '@app/shared';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, EmptyState, SelectField } from '../../components/ui';
import { cx } from '../../lib/cx';
import { useVisibleItems, type ViewProps } from './viewParts';

const WEEKS = 6;

export function WorkloadView(p: ViewProps) {
  const { board, members, canEdit, config, onConfig, memberName } = p;
  const { visible, today } = useVisibleItems(p);
  const [first, setFirst] = useState(() => mondayOf(today));
  const o = config.options;

  const peopleCols = board.columns.filter((c) => c.type === 'people');
  const dateCols = board.columns.filter((c) => c.type === 'timeline' || c.type === 'date');
  const effortCols = board.columns.filter((c) => c.type === 'numbers' || c.type === 'formula');
  const peopleCol = peopleCols.find((c) => c.id === o.peopleColumnId) ?? peopleCols[0];
  const dateCol =
    dateCols.find((c) => c.id === o.dateColumnId) ??
    dateCols.find((c) => c.type === 'timeline') ??
    dateCols[0];
  const effortCol = effortCols.find((c) => c.id === o.effortColumnId) ?? null;

  const grid = useMemo(() => {
    if (!peopleCol || !dateCol) return null;
    const items: WorkItem[] = [];
    for (const it of visible) {
      const span = spanOf(dateCol, it.values[dateCol.id]);
      if (!span) continue;
      const raw = effortCol ? Number(it.values[effortCol.id]) : NaN;
      const people = it.values[peopleCol.id];
      items.push({
        id: it.id,
        name: it.name,
        span,
        hours: effortCol && Number.isFinite(raw) ? raw : null,
        people: Array.isArray(people)
          ? people.filter((x): x is string => typeof x === 'string')
          : [],
      });
    }
    const g = workloadGrid({
      items,
      firstWeek: first,
      weeks: WEEKS,
      capacity: o.capacity,
      capacityByUid: o.capacityByUid,
    });
    // Show everyone, so free capacity is visible too.
    const have = new Set(g.rows.map((r) => r.key));
    const empty = members
      .filter((m) => !have.has(m.uid))
      .map((m) => ({
        key: m.uid,
        hours: new Array<number>(WEEKS).fill(0),
        total: 0,
        capacity: o.capacityByUid[m.uid] ?? o.capacity,
      }));
    const rows = [
      ...g.rows.filter((r) => r.key !== null),
      ...empty,
      ...g.rows.filter((r) => r.key === null),
    ];
    return { ...g, rows };
  }, [visible, peopleCol, dateCol, effortCol, first, o.capacity, o.capacityByUid, members]);

  if (!peopleCol || !dateCol || !grid) {
    return (
      <EmptyState
        title="Workload needs People and date columns"
        body="Add a People column and a Timeline (or Date) column to the table, then come back."
      />
    );
  }
  const set = (patch: Partial<typeof o>) => onConfig({ options: { ...o, ...patch } });
  const cap = (uid: string) => o.capacityByUid[uid] ?? o.capacity;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-2 sm:px-6">
        <Button
          variant="secondary"
          size="sm"
          aria-label="Earlier weeks"
          onClick={() => setFirst(nextWeek(first, -1, WEEKS))}
        >
          <ChevronLeft size={14} aria-hidden />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Later weeks"
          onClick={() => setFirst(nextWeek(first, 1, WEEKS))}
        >
          <ChevronRight size={14} aria-hidden />
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setFirst(mondayOf(today))}>
          This week
        </Button>
        <SelectField
          label="Dates from"
          value={dateCol.id}
          disabled={!canEdit}
          onChange={(e) => set({ dateColumnId: e.target.value })}
        >
          {dateCols.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Hours from"
          value={effortCol?.id ?? ''}
          disabled={!canEdit}
          onChange={(e) => set({ effortColumnId: e.target.value || null })}
        >
          <option value="">Dates (8h per working day)</option>
          {effortCols.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </SelectField>
        {peopleCols.length > 1 && (
          <SelectField
            label="People"
            value={peopleCol.id}
            disabled={!canEdit}
            onChange={(e) => set({ peopleColumnId: e.target.value })}
          >
            {peopleCols.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectField>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Hours per week
          <input
            autoComplete="off"
            type="number"
            min={1}
            max={MAX_CAPACITY_HOURS}
            disabled={!canEdit}
            defaultValue={o.capacity}
            key={o.capacity}
            aria-label="Default hours per person per week"
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (n >= 1 && n <= MAX_CAPACITY_HOURS && n !== o.capacity) set({ capacity: n });
              else e.target.value = String(o.capacity);
            }}
            className="h-10 w-24 rounded-xl border border-border bg-surface px-3 text-sm"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:px-6">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">Planned hours per person per week</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="w-56 border-b border-border p-2 text-left text-xs font-bold text-muted"
              >
                Person
              </th>
              {grid.weekStarts.map((w) => (
                <th
                  key={w}
                  scope="col"
                  className="border-b border-border p-2 text-right text-xs font-bold text-muted"
                >
                  {format(parseISO(w), 'd MMM')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r.key ?? 'none'}>
                <th scope="row" className="border-b border-border p-2 text-left font-semibold">
                  <div>{r.key === null ? 'Unassigned' : memberName(r.key)}</div>
                  {r.key !== null && (
                    <label className="flex items-center gap-1 text-xs font-normal text-muted">
                      <span>Capacity</span>
                      <input
                        autoComplete="off"
                        type="number"
                        min={1}
                        max={MAX_CAPACITY_HOURS}
                        disabled={!canEdit}
                        defaultValue={cap(r.key)}
                        key={cap(r.key)}
                        aria-label={`Weekly capacity for ${memberName(r.key)}`}
                        onBlur={(e) => {
                          const uid = r.key as string;
                          const n = Number(e.target.value);
                          if (!(n >= 1 && n <= MAX_CAPACITY_HOURS))
                            return void (e.target.value = String(cap(uid)));
                          const next = { ...o.capacityByUid };
                          if (n === o.capacity) delete next[uid];
                          else next[uid] = n;
                          if (n !== cap(uid)) set({ capacityByUid: next });
                        }}
                        className="h-7 w-16 rounded-md border border-border bg-surface px-1.5 text-xs"
                      />
                      <span>h/wk</span>
                    </label>
                  )}
                </th>
                {r.hours.map((h, i) => {
                  const over = isOver(r, h);
                  return (
                    <td
                      key={i}
                      aria-label={
                        over ? `${h} hours, over capacity of ${r.capacity}` : `${h} hours`
                      }
                      className={cx(
                        'border-b border-l border-border p-2 text-right tabular-nums',
                        over && 'bg-danger-soft font-bold text-danger',
                        !over && h === 0 && 'text-muted',
                      )}
                    >
                      {over && <AlertTriangle size={12} aria-hidden className="mr-1 inline" />}
                      {h === 0 ? '–' : h}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">
          Each item’s hours are spread over its working days (Mon–Fri) and split between the people
          on it. Default capacity {DEFAULT_CAPACITY_HOURS}h can be changed above or per person.
        </p>
      </div>
    </div>
  );
}
