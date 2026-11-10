import {
  addSession,
  DEFAULT_TIMEZONE,
  formatDuration,
  MAX_SESSION_MS,
  normalizeValue,
  removeSession,
  sessionProblem,
  shortId,
  todayIso,
  totalMs,
  totalsByUid,
  zonedToUtcMs,
  type TimeSession,
  type TimeValue,
} from '@app/shared';
import { Clock, Play, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Popover } from '../../components/ui';
import { cx } from '../../lib/cx';
import { useCellEnv } from '../board/cellEnv';
import { Empty, cellBase, type CellProps } from '../board/cellParts';
import { useWorkspace } from '../workspaces/WorkspaceProvider';
import { clock, useNow, useTimer } from './TimerProvider';

const field =
  'h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm focus:border-primary focus:outline-none';

function Elapsed({ since }: { since: number }) {
  const now = useNow();
  return <span className="tabular-nums">{clock(now - since)}</span>;
}

/** The "Time tracking" cell: a timer button, the total, and the list of logged sessions. */
export function TimeCell({ column, item, itemName, canEdit, members, onChange }: CellProps) {
  const env = useCellEnv();
  const timer = useTimer();
  const { workspace, role } = useWorkspace();
  const tz = workspace.settings?.timezone ?? DEFAULT_TIMEZONE;
  const value = normalizeValue(column, item.values[column.id]) as TimeValue | null;
  const total = totalMs(value);
  const here =
    timer.running?.itemId === item.id && timer.running.columnId === column.id
      ? timer.running
      : null;
  const name = (uid: string) => members.find((m) => m.uid === uid)?.name ?? 'Former member';

  const [date, setDate] = useState(todayIso());
  const [start, setStart] = useState('09:00');
  const [hours, setHours] = useState('1');
  const [mins, setMins] = useState('0');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

  const addManual = () => {
    const begin = zonedToUtcMs(date, start, tz);
    const dur = (Number(hours) || 0) * 3_600_000 + (Number(mins) || 0) * 60_000;
    if (begin === null || dur <= 0) {
      setError('Enter a date, a start time and how long it took.');
      return;
    }
    const session: TimeSession = {
      id: shortId(),
      uid: env.uid,
      start: begin,
      end: begin + dur,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const problem = sessionProblem(session, Date.now());
    if (problem) {
      setError(problem);
      return;
    }
    onChange(addSession(value, session));
    setError('');
    setNote('');
  };

  const sessions = [...(value?.sessions ?? [])].sort((a, b) => b.start - a.start);
  const byPerson = [...totalsByUid(value)].sort((a, b) => b[1] - a[1]);

  const label = (
    <span className="flex min-w-0 items-center gap-1.5 truncate">
      <Clock size={13} aria-hidden className="shrink-0 text-muted" />
      {here ? (
        <>
          <Elapsed since={here.startedAtMs} />
          {total > 0 && <span className="text-xs text-muted">+ {formatDuration(total)}</span>}
        </>
      ) : total > 0 ? (
        formatDuration(total)
      ) : (
        <Empty />
      )}
    </span>
  );
  if (!canEdit) return <div className={cx(cellBase, 'gap-1')}>{label}</div>;

  return (
    <div className={cx(cellBase, 'gap-1 px-0')}>
      <button
        type="button"
        disabled={timer.busy}
        onClick={() => (here ? timer.stop() : timer.start(env.boardId, item.id, column.id))}
        aria-label={here ? `Stop timer for ${itemName}` : `Start timer for ${itemName}`}
        title={here ? 'Stop and save this session' : 'Start a timer'}
        className={cx(
          'ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          here ? 'bg-primary text-on-primary' : 'text-muted hover:bg-surface-3 hover:text-fg',
        )}
      >
        {here ? (
          <Square size={11} aria-hidden fill="currentColor" />
        ) : (
          <Play size={12} aria-hidden fill="currentColor" />
        )}
      </button>
      <Popover
        label={`${column.title} for ${itemName}`}
        className="w-80"
        trigger={(p) => (
          <button
            type="button"
            {...p}
            aria-label={`Edit ${column.title} for ${itemName}`}
            className="h-full min-w-0 flex-1 truncate px-1 text-left hover:bg-surface-2"
          >
            {label}
          </button>
        )}
      >
        <div className="space-y-3 p-1">
          <p className="text-sm font-semibold">
            Total {formatDuration(total)}
            {byPerson.length > 1 && (
              <span className="block text-xs font-normal text-muted">
                {byPerson.map(([uid, ms]) => `${name(uid)} ${formatDuration(ms)}`).join(' · ')}
              </span>
            )}
          </p>
          {sessions.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="Logged time">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {name(s.uid)} · {formatDuration(s.end - s.start)}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {s.rolled
                        ? `${fmt.format(s.start).split(',')[1] ?? ''} (earlier, combined)`
                        : fmt.format(s.start)}
                      {s.note ? ` · ${s.note}` : ''}
                    </span>
                  </span>
                  {(s.uid === env.uid || role === 'admin') && (
                    <button
                      type="button"
                      aria-label={`Delete ${formatDuration(s.end - s.start)} logged by ${name(s.uid)}`}
                      onClick={() => onChange(removeSession(value, s.id))}
                      className="rounded p-1 text-muted hover:bg-surface-2"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form
            className="space-y-2 border-t border-border pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              addManual();
            }}
          >
            <p className="text-xs font-bold text-muted">Add time you already spent</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                autoComplete="off"
                aria-label="Date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={field}
              />
              <input
                autoComplete="off"
                aria-label="Start time"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={field}
              />
              <label className="flex items-center gap-1 text-sm">
                <input
                  autoComplete="off"
                  aria-label="Hours"
                  type="number"
                  min={0}
                  max={24}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className={field}
                />{' '}
                h
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input
                  autoComplete="off"
                  aria-label="Minutes"
                  type="number"
                  min={0}
                  max={59}
                  value={mins}
                  onChange={(e) => setMins(e.target.value)}
                  className={field}
                />{' '}
                m
              </label>
            </div>
            <input
              autoComplete="off"
              aria-label="Note"
              placeholder="Note (optional)"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={field}
            />
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted">
                Up to {MAX_SESSION_MS / 3_600_000} hours at a time.
              </p>
              <Button size="sm" type="submit">
                Add time
              </Button>
            </div>
          </form>
        </div>
      </Popover>
    </div>
  );
}
