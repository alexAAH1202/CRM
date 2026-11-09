import {
  boardPaths,
  DEFAULT_TIMEZONE,
  dayIn,
  durationOf,
  filterRows,
  formatDuration,
  groupRows,
  guardCell,
  paths,
  rowsFromItems,
  todayIso,
  toCsv,
  toHours,
  type BoardDoc,
  type TimesheetRow,
} from '@app/shared';
import { addDays, endOfMonth, format, startOfMonth, startOfWeek } from 'date-fns';
import { collection, doc, orderBy, query } from 'firebase/firestore';
import { Download, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyState, SelectField, Skeleton } from '../../components/ui';
import { cx } from '../../lib/cx';
import { db } from '../../lib/firebase';
import { readDoc, readQuery } from '../../lib/firestore';
import { useBoards } from '../boards/BoardsProvider';
import { useWorkspace } from '../workspaces/WorkspaceProvider';

const FRESH_MS = 60_000;
const cache = new Map<
  string,
  { at: number; rows: TimesheetRow[]; failed: string[]; tracked: number }
>();
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

type Preset = 'week' | 'lastWeek' | 'month' | 'all';
function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  if (p === 'week') {
    const s = startOfWeek(now, { weekStartsOn: 1 });
    return { from: iso(s), to: iso(addDays(s, 6)) };
  }
  if (p === 'lastWeek') {
    const s = addDays(startOfWeek(now, { weekStartsOn: 1 }), -7);
    return { from: iso(s), to: iso(addDays(s, 6)) };
  }
  if (p === 'month') return { from: iso(startOfMonth(now)), to: iso(endOfMonth(now)) };
  return { from: '', to: '' };
}

/**
 * Time logged across your lists. Only lists with a "Time tracking" column are read, and only the
 * items that actually have time on them (a query ordered by that cell leaves out the rest), so a
 * visit costs about one read per item with time logged. Results are kept for a minute.
 */
export default function TimesheetPage() {
  const { workspace } = useWorkspace();
  const { boards, memberName, members } = useBoards();
  const tz = workspace.settings?.timezone ?? DEFAULT_TIMEZONE;
  const [state, setState] = useState<{
    rows: TimesheetRow[];
    failed: string[];
    tracked: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [person, setPerson] = useState('');
  const [list, setList] = useState('');
  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState(presetRange('month').from);
  const [to, setTo] = useState(presetRange('month').to);
  const [by, setBy] = useState<'person' | 'item'>('person');
  const run = useRef(0);

  const load = useCallback(
    async (force: boolean) => {
      if (!boards) return;
      const hit = cache.get(workspace.id);
      if (!force && hit && Date.now() - hit.at < FRESH_MS) {
        setState(hit);
        return;
      }
      const my = ++run.current;
      setLoading(true);
      const rows: TimesheetRow[] = [];
      const failed: string[] = [];
      let tracked = 0;
      await Promise.all(
        boards.map(async (b) => {
          try {
            const board = (
              await readDoc('timesheet:board', doc(db, paths.board(workspace.id, b.id)))
            ).data() as BoardDoc | undefined;
            const timeCols = (board?.columns ?? []).filter((c) => c.type === 'time');
            if (timeCols.length === 0) return;
            tracked++;
            for (const col of timeCols) {
              const snap = await readQuery(
                'timesheet:items',
                query(
                  collection(db, boardPaths.items(workspace.id, b.id)),
                  orderBy(`values.${col.id}`),
                ),
              );
              rows.push(
                ...rowsFromItems(
                  snap.docs.map((d) => ({
                    id: d.id,
                    name: String(d.data()['name'] ?? ''),
                    values: (d.data()['values'] ?? {}) as Record<string, unknown>,
                    deleted: d.data()['deletedAt'] != null,
                  })),
                  b.id,
                  [col.id],
                ),
              );
            }
          } catch {
            failed.push(b.name);
          }
        }),
      );
      if (my !== run.current) return;
      const next = { at: Date.now(), rows, failed, tracked };
      cache.set(workspace.id, next);
      setState(next);
      setLoading(false);
    },
    [boards, workspace.id],
  );
  useEffect(() => {
    void load(false);
  }, [load]);

  const boardName = useMemo(() => new Map((boards ?? []).map((b) => [b.id, b.name])), [boards]);
  const filtered = useMemo(
    () =>
      filterRows(state?.rows ?? [], {
        tz,
        uids: person ? new Set([person]) : null,
        boardIds: list ? new Set([list]) : null,
        from: from || null,
        to: to || null,
      }),
    [state, tz, person, list, from, to],
  );
  const groups = useMemo(() => groupRows(filtered, by), [filtered, by]);
  const total = filtered.reduce((n, r) => n + durationOf(r.session), 0);

  const dayFmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const timeFmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  });

  const exportCsv = () => {
    const header = ['Date', 'Start', 'End', 'Person', 'List', 'Item', 'Hours', 'Note'];
    const lines = [...filtered]
      .sort((a, b) => a.session.start - b.session.start)
      .map((r) => [
        dayIn(r.session.start, tz),
        timeFmt.format(r.session.start),
        timeFmt.format(r.session.end),
        guardCell(memberName(r.uid)),
        guardCell(boardName.get(r.boardId) ?? ''),
        guardCell(r.itemName),
        String(toHours(durationOf(r.session))),
        guardCell(r.session.note ?? ''),
      ]);
    const csv = toCsv([header, ...lines]);
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheet-${todayIso()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const pick = (p: Preset) => {
    setPreset(p);
    const r = presetRange(p);
    setFrom(r.from);
    setTo(r.to);
  };
  const presets: Array<[Preset, string]> = [
    ['week', 'This week'],
    ['lastWeek', 'Last week'],
    ['month', 'This month'],
    ['all', 'All time'],
  ];

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-extrabold">Timesheet</h1>
        <Button variant="secondary" size="sm" disabled={loading} onClick={() => void load(true)}>
          <RefreshCw size={14} aria-hidden className={cx(loading && 'animate-spin')} /> Refresh
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={filtered.length === 0}
          onClick={exportCsv}
          aria-label="Export timesheet CSV"
        >
          <Download size={14} aria-hidden /> Export
        </Button>
      </div>

      <div className="mb-4 space-y-3 rounded-2xl bg-surface p-3 shadow-sm">
        <div role="group" aria-label="Period" className="flex flex-wrap gap-1.5">
          {presets.map(([p, label]) => (
            <button
              key={p}
              type="button"
              aria-pressed={preset === p}
              onClick={() => pick(p)}
              className={cx(
                'h-8 rounded-full px-3 text-sm font-semibold',
                preset === p ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => (setFrom(e.target.value), setPreset('all'))}
              className="h-10 rounded-xl border border-border bg-surface px-2 text-sm font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => (setTo(e.target.value), setPreset('all'))}
              className="h-10 rounded-xl border border-border bg-surface px-2 text-sm font-normal"
            />
          </label>
          <SelectField label="Person" value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            {(members ?? []).map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="List" value={list} onChange={(e) => setList(e.target.value)}>
            <option value="">All lists</option>
            {(boards ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
        </div>
        <div role="group" aria-label="Group by" className="flex items-center gap-1.5 text-sm">
          <span className="font-semibold">Group by</span>
          {(['person', 'item'] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={by === g}
              onClick={() => setBy(g)}
              className={cx(
                'h-8 rounded-full px-3 font-semibold',
                by === g ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2',
              )}
            >
              {g === 'person' ? 'Person' : 'Item'}
            </button>
          ))}
        </div>
      </div>

      {state === null ? (
        <Skeleton className="h-32 w-full" />
      ) : state.tracked === 0 ? (
        <EmptyState
          title="No time tracking yet"
          body="Add a “Time tracking” column to a list (Add column → Time tracking), then press its ▶ to start a timer or add time you already spent."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No time logged in this period"
          body="Try a wider period, or press ▶ on an item to start a timer."
        />
      ) : (
        <>
          <p role="status" className="mb-3 text-lg font-bold">
            {formatDuration(total)}{' '}
            <span className="text-sm font-normal text-muted">
              in {filtered.length} session{filtered.length === 1 ? '' : 's'}
            </span>
          </p>
          <div className="space-y-3">
            {groups.map((g) => {
              const first = g.rows[0]!;
              const title =
                by === 'person' ? memberName(first.uid) : `${first.itemName || 'Untitled'}`;
              return (
                <section
                  key={g.key}
                  aria-label={title}
                  className="rounded-2xl bg-surface p-3 shadow-sm"
                >
                  <h2 className="mb-1 flex items-baseline gap-2 text-base font-bold">
                    <span className="min-w-0 flex-1 truncate">
                      {title}
                      {by === 'item' && (
                        <span className="ml-2 text-xs font-normal text-muted">
                          {boardName.get(first.boardId)}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">{formatDuration(g.ms)}</span>
                  </h2>
                  <ul className="divide-y divide-border text-sm">
                    {g.rows.map((r) => (
                      <li
                        key={`${r.itemId}:${r.session.id}`}
                        className="flex items-baseline gap-3 py-1.5"
                      >
                        <span className="w-24 shrink-0 text-muted">
                          {dayFmt.format(r.session.start)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {by === 'person' ? r.itemName || 'Untitled' : memberName(r.uid)}
                          {r.session.note && (
                            <span className="text-muted"> · {r.session.note}</span>
                          )}
                        </span>
                        <span className="tabular-nums">
                          {formatDuration(durationOf(r.session))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
      {state && state.failed.length > 0 && (
        <p role="alert" className="mt-3 text-sm text-danger">
          Couldn’t read: {state.failed.join(', ')}.
        </p>
      )}
    </div>
  );
}
