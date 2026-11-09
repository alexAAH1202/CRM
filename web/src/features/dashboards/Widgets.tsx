import {
  battery,
  chartData,
  DEFAULT_TIMEZONE,
  formatDuration,
  mondayOf,
  overdueRows,
  spanOf,
  tableRows,
  tasksByPerson,
  timelineBars,
  timeTrackedByPerson,
  todayIso,
  WIDGET_META,
  workloadGrid,
  isOver,
  type ListData,
  type TimesheetRow,
  type Widget,
  type WorkItem,
} from '@app/shared';
import { addDays, format, parseISO } from 'date-fns';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { loadList, loadNumber, loadTime } from './data';

const ChartCanvas = lazy(() => import('../board/ChartCanvas'));

export interface DashList {
  id: string;
  name: string;
}

export interface WidgetEnv {
  wid: string;
  lists: DashList[];
  memberName: (uid: string) => string;
  tz: string;
  /** Bumps when the person presses Refresh (the cached data has been dropped by then). */
  reload: number;
}

type Load<T> =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

function useAsync<T>(run: () => Promise<T>, deps: unknown[]): Load<T> {
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    run().then(
      (data) => live && setState({ status: 'ready', data }),
      (e: unknown) => live && setState({ status: 'error', message: friendlyError(e) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller lists what matters
  }, deps);
  return state;
}

const targets = (w: Widget, env: WidgetEnv): DashList[] =>
  w.config.boardId ? env.lists.filter((l) => l.id === w.config.boardId) : env.lists;

/** Every list this widget draws from, read once (shared with the other widgets). */
function useLists(w: Widget, env: WidgetEnv): Load<ListData[]> {
  const t = targets(w, env);
  return useAsync(
    async () =>
      (await Promise.all(t.map((l) => loadList(env.wid, l.id, l.name)))).filter(
        (x): x is ListData => !!x,
      ),
    [env.wid, t.map((l) => l.id).join(), env.reload],
  );
}

function Frame({ load, children }: { load: Load<unknown>; children: ReactNode }) {
  if (load.status === 'loading') return <Skeleton className="h-full min-h-16 w-full" />;
  if (load.status === 'error')
    return (
      <p role="alert" className="text-sm text-danger">
        Couldn’t load this: {load.message}
      </p>
    );
  return <>{children}</>;
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-muted">{children}</p>
);

export const widgetTitle = (w: Widget): string => w.config.title || WIDGET_META[w.type].label;

// ------------------------------------------------------------------ the widgets

function NumbersWidget({ w, env }: { w: Widget; env: WidgetEnv }) {
  const t = targets(w, env);
  const load = useAsync(async () => {
    const parts = await Promise.all(t.map((l) => loadNumber(env.wid, l.id, w.config)));
    const avg = w.config.measure === 'avg';
    return parts.length === 0
      ? 0
      : avg
        ? parts.reduce((a, b) => a + b, 0) / parts.length
        : parts.reduce((a, b) => a + b, 0);
  }, [env.wid, JSON.stringify(w.config), t.map((l) => l.id).join(), env.reload]);
  return (
    <Frame load={load}>
      {load.status === 'ready' && (
        <div className="flex h-full flex-col justify-center">
          <p
            className="text-4xl font-extrabold tabular-nums"
            aria-label={`${widgetTitle(w)}: ${load.data}`}
          >
            {Math.round(load.data * 100) / 100}
          </p>
          <p className="text-sm text-muted">
            {w.config.boardId
              ? (t[0]?.name ?? '')
              : `across ${t.length} list${t.length === 1 ? '' : 's'}`}
          </p>
        </div>
      )}
    </Frame>
  );
}

function BatteryWidget({ w, env }: { w: Widget; env: WidgetEnv }) {
  const load = useLists(w, env);
  return (
    <Frame load={load}>
      {load.status === 'ready' &&
        (() => {
          const b = battery(load.data);
          return (
            <div className="flex h-full flex-col justify-center gap-2">
              <p className="text-3xl font-extrabold tabular-nums">{b.pct}%</p>
              <div
                role="progressbar"
                aria-label={widgetTitle(w)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={b.pct}
                className="h-4 overflow-hidden rounded-full bg-surface-3"
              >
                <div className="h-full rounded-full bg-[#13865a]" style={{ width: `${b.pct}%` }} />
              </div>
              <p className="text-sm text-muted">
                {b.done} of {b.total} done
              </p>
            </div>
          );
        })()}
    </Frame>
  );
}

function ChartWidget({ w, env }: { w: Widget; env: WidgetEnv }) {
  const load = useLists(w, env);
  return (
    <Frame load={load}>
      {load.status === 'ready' &&
        (() => {
          const list = load.data[0];
          const group = list?.columns.find((c) => c.id === w.config.groupColumnId);
          if (!list || !group) return <Empty>Choose what to group by (⚙ Settings).</Empty>;
          const value = list.columns.find((c) => c.id === w.config.columnId) ?? null;
          const stack = list.columns.find((c) => c.id === w.config.stackColumnId) ?? null;
          const type = w.config.chartType ?? 'bar';
          const data = chartData({
            items: list.items.filter((i) => !i.archived && !i.parentId),
            group,
            stack: type === 'stacked' ? stack : null,
            measure: w.config.measure ?? 'count',
            value,
            memberName: env.memberName,
          });
          if (data.points.length === 0) return <Empty>Nothing to chart yet.</Empty>;
          return (
            <div
              className="h-full min-h-32 w-full"
              role="img"
              aria-label={`${widgetTitle(w)}: ${data.points.map((p) => `${p.key} ${p.total}`).join(', ')}`}
            >
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <ChartCanvas type={type} data={data} />
              </Suspense>
            </div>
          );
        })()}
    </Frame>
  );
}

function TableWidget({ w, env }: { w: Widget; env: WidgetEnv }) {
  const load = useLists(w, env);
  return (
    <Frame load={load}>
      {load.status === 'ready' &&
        (() => {
          const list = load.data[0];
          if (!list) return <Empty>Choose a list (⚙ Settings).</Empty>;
          const t = tableRows(list, w.config, env.memberName);
          if (t.rows.length === 0) return <Empty>Nothing here.</Empty>;
          return (
            <div className="h-full overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 pr-2 font-semibold">Item</th>
                    {t.headers.map((h) => (
                      <th key={h} className="py-1 pr-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="max-w-40 truncate py-1 pr-2">
                        <Link
                          to={`/w/${env.wid}/b/${list.boardId}?item=${r.id}`}
                          className="hover:text-primary hover:underline"
                        >
                          {r.name || 'Untitled'}
                        </Link>
                      </td>
                      {r.cells.map((c, i) => (
                        <td key={i} className="max-w-32 truncate py-1 pr-2 text-muted">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
    </Frame>
  );
}

function OverdueWidget({ w, env }: { w: Widget; env: WidgetEnv }) {
  const load = useLists(w, env);
  return (
    <Frame load={load}>
      {load.status === 'ready' &&
        (() => {
          const rows = overdueRows(load.data, todayIso(), w.config.limit ?? 10);
          if (rows.length === 0) return <Empty>Nothing is overdue. 🎉</Empty>;
          return (
            <ul className="h-full space-y-1 overflow-auto text-sm" aria-label="Overdue items">
              {rows.map((r) => (
                <li key={`${r.boardId}:${r.itemId}`} className="flex items-baseline gap-2">
                  <Link
                    to={`/w/${env.wid}/b/${r.boardId}?item=${r.itemId}`}
                    className="min-w-0 flex-1 truncate hover:text-primary hover:underline"
                  >
                    {r.name || 'Untitled'}
                  </Link>
                  <span className="shrink-0 text-xs font-semibold text-danger">
                    {r.daysLate} day{r.daysLate === 1 ? '' : 's'} late
                  </span>
                </li>
              ))}
            </ul>
          );
        })()}
    </Frame>
  );
}

function BarRow({
  label,
  value,
  max,
  extra,
}: {
  label: string;
  value: number;
  max: number;
  extra?: string;
}) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="w-24 shrink-0 truncate">{label}</span>
      <span className="h-3 flex-1 overflow-hidden rounded-full bg-surface-3">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${max === 0 ? 0 : (value / max) * 100}%` }}
        />
      </span>
      <span className="w-14 shrink-0 text-right tabular-nums">
        {value}
        {extra && <span className="text-xs text-danger"> {extra}</span>}
      </span>
    </li>
  );
}

function PeopleWidget({ w, env }: { w: Widget; env: WidgetEnv }) {
  const load = useLists(w, env);
  return (
    <Frame load={load}>
      {load.status === 'ready' &&
        (() => {
          const rows = tasksByPerson(load.data, todayIso());
          if (rows.length === 0) return <Empty>No open items.</Empty>;
          const max = Math.max(...rows.map((r) => r.open));
          return (
            <ul className="h-full space-y-1.5 overflow-auto" aria-label="Open items by person">
              {rows.map((r) => (
                <BarRow
                  key={r.uid ?? 'none'}
                  label={r.uid ? env.memberName(r.uid) : 'Unassigned'}
                  value={r.open}
                  max={max}
                  {...(r.overdue ? { extra: `${r.overdue} late` } : {})}
                />
              ))}
            </ul>
          );
        })()}
    </Frame>
  );
}

function WorkloadWidget({ w, env }: { w: Widget; env: WidgetEnv }) {
  const load = useLists(w, env);
  return (
    <Frame load={load}>
      {load.status === 'ready' &&
        (() => {
          const weeks = w.config.weeks ?? 4;
          const items: WorkItem[] = [];
          for (const l of load.data) {
            const col =
              l.columns.find((c) => c.id === w.config.dateColumnId && c.type === 'timeline') ??
              l.columns.find((c) => c.type === 'timeline');
            if (!col) continue;
            for (const it of l.items) {
              if (it.archived || it.parentId) continue;
              const span = spanOf(col, it.values[col.id]);
              if (span)
                items.push({
                  id: `${l.boardId}:${it.id}`,
                  name: it.name,
                  span,
                  hours: null,
                  people: it.assigneeUids ?? [],
                });
            }
          }
          if (items.length === 0)
            return <Empty>Needs a list with a Timeline column and some dates.</Empty>;
          const grid = workloadGrid({
            items,
            firstWeek: mondayOf(todayIso()),
            weeks,
            capacity: 40,
            capacityByUid: {},
          });
          return (
            <div className="h-full overflow-auto">
              <table className="w-full text-sm" aria-label="Hours per person per week">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 pr-2 text-left font-semibold">Person</th>
                    {grid.weekStarts.map((s) => (
                      <th key={s} className="px-1 py-1 text-right font-semibold">
                        {format(parseISO(s), 'd MMM')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.map((r) => (
                    <tr key={r.key ?? 'none'} className="border-t border-border">
                      <td className="max-w-28 truncate py-1 pr-2">
                        {r.key ? env.memberName(r.key) : 'Unassigned'}
                      </td>
                      {r.hours.map((h, i) => (
                        <td
                          key={i}
                          className={cx(
                            'px-1 py-1 text-right tabular-nums',
                            isOver(r, h) && 'font-bold text-danger',
                          )}
                        >
                          {h || '–'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
    </Frame>
  );
}

function TimelineWidget({ w, env }: { w: Widget; env: WidgetEnv }) {
  const load = useLists(w, env);
  return (
    <Frame load={load}>
      {load.status === 'ready' &&
        (() => {
          const list = load.data[0];
          const bars = list ? timelineBars(list, w.config.dateColumnId ?? null) : [];
          if (bars.length === 0)
            return <Empty>Needs a list with a Timeline column and some dates.</Empty>;
          const t0 = Date.parse(
            bars.reduce((m, b) => (b.span.start < m ? b.span.start : m), bars[0]!.span.start),
          );
          const t1 = Date.parse(
            bars.reduce((m, b) => (b.span.end > m ? b.span.end : m), bars[0]!.span.end),
          );
          const total = Math.max(1, t1 - t0 + 86_400_000);
          return (
            <ul className="h-full space-y-1.5 overflow-auto" aria-label="Timeline">
              {bars.map((b) => {
                const left = ((Date.parse(b.span.start) - t0) / total) * 100;
                const width = Math.max(
                  2,
                  ((Date.parse(b.span.end) - Date.parse(b.span.start) + 86_400_000) / total) * 100,
                );
                return (
                  <li key={b.id} className="text-xs">
                    <span className="block truncate">
                      {b.name || 'Untitled'}{' '}
                      <span className="text-muted">
                        {format(parseISO(b.span.start), 'd MMM')} –{' '}
                        {format(parseISO(b.span.end), 'd MMM')}
                      </span>
                    </span>
                    <span className="relative mt-0.5 block h-2.5 rounded-full bg-surface-3">
                      <span
                        className="absolute h-full rounded-full bg-primary"
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          );
        })()}
    </Frame>
  );
}

function TimeWidget({ w, env }: { w: Widget; env: WidgetEnv }) {
  const t = targets(w, env);
  const load = useAsync(async () => {
    const lists = (await Promise.all(t.map((l) => loadList(env.wid, l.id, l.name)))).filter(
      (x): x is ListData => !!x,
    );
    const rows: TimesheetRow[] = (await Promise.all(lists.map((l) => loadTime(env.wid, l)))).flat();
    return rows;
  }, [env.wid, t.map((l) => l.id).join(), env.reload]);
  const period = w.config.period ?? 'month';
  return (
    <Frame load={load}>
      {load.status === 'ready' &&
        (() => {
          const now = new Date();
          const to = format(now, 'yyyy-MM-dd');
          const from =
            period === 'all'
              ? null
              : period === 'week'
                ? format(addDays(now, -((now.getDay() + 6) % 7)), 'yyyy-MM-dd')
                : format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
          const rows = timeTrackedByPerson(load.data, {
            from,
            to: period === 'all' ? null : to,
            tz: env.tz || DEFAULT_TIMEZONE,
          });
          if (rows.length === 0)
            return <Empty>No time logged {period === 'all' ? 'yet' : `this ${period}`}.</Empty>;
          const max = Math.max(...rows.map((r) => r.ms));
          const total = rows.reduce((n, r) => n + r.ms, 0);
          return (
            <div className="flex h-full flex-col gap-2">
              <p className="text-2xl font-extrabold tabular-nums">{formatDuration(total)}</p>
              <ul className="space-y-1.5 overflow-auto" aria-label="Time by person">
                {rows.map((r) => (
                  <li key={r.uid} className="flex items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 truncate">{env.memberName(r.uid)}</span>
                    <span className="h-3 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${(r.ms / max) * 100}%` }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right tabular-nums">
                      {formatDuration(r.ms)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}
    </Frame>
  );
}

export function WidgetBody({ w, env }: { w: Widget; env: WidgetEnv }) {
  switch (w.type) {
    case 'numbers':
      return <NumbersWidget w={w} env={env} />;
    case 'battery':
      return <BatteryWidget w={w} env={env} />;
    case 'chart':
      return <ChartWidget w={w} env={env} />;
    case 'table':
      return <TableWidget w={w} env={env} />;
    case 'overdue':
      return <OverdueWidget w={w} env={env} />;
    case 'tasksByPerson':
      return <PeopleWidget w={w} env={env} />;
    case 'workload':
      return <WorkloadWidget w={w} env={env} />;
    case 'timeline':
      return <TimelineWidget w={w} env={env} />;
    case 'timeTracked':
      return <TimeWidget w={w} env={env} />;
  }
}
