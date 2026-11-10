import {
  focusOrder,
  MAX_PLAN,
  parsePlan,
  relativeDue,
  todayIso,
  type FocusCandidate,
} from '@app/shared';
import { Check, Clock3, Plus, RefreshCw, SkipForward, Target } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Skeleton } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { createItem, setCell } from '../boards/api';
import { useBoards } from '../boards/BoardsProvider';
import type { BoardItem } from '../boards/types';
import { useTimer } from '../time/TimerProvider';
import { useWorkspace } from '../workspaces/WorkspaceProvider';
import { forgetFocus, loadFocus, loadSteps, saveTodayPlan, type FocusData } from './data';

const DONE = /^(done|complete|completed|finished|paid|closed|resolved|achieved|bought)$/i;
const tone = {
  late: 'bg-danger-soft text-danger',
  today: 'bg-primary-soft text-primary',
  soon: 'bg-primary-soft text-primary',
  week: 'bg-surface-3 text-fg',
  later: 'bg-surface-3 text-muted',
} as const;

function Countdown({ due }: { due: string | null }) {
  const r = due ? relativeDue(due, todayIso()) : null;
  if (!r) return null;
  return (
    <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', tone[r.tone])}>
      {r.text}
    </span>
  );
}

/** A short beep (no sound file to download) for when a timebox ends. */
function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.8);
  } catch {
    /* no audio: the message is enough */
  }
}

/** A countdown you choose (5/15/25 min); at the end, a sound, a notification and a message. */
function Timebox({ onEnd, onStart }: { onEnd: () => void; onStart: () => void }) {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const ended = useRef(false);
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  useEffect(() => {
    if (endsAt && now >= endsAt && !ended.current) {
      ended.current = true;
      setEndsAt(null);
      beep();
      try {
        if ('Notification' in window && Notification.permission === 'granted')
          new Notification('Time’s up', { body: 'Take a breath. Keep going, or call it done.' });
      } catch {
        /* notifications blocked */
      }
      toast.info('Time’s up. Keep going, or call it done.');
      onEnd();
    }
  }, [now, endsAt, onEnd]);
  const start = (min: number) => {
    ended.current = false;
    setNow(Date.now());
    setEndsAt(Date.now() + min * 60_000);
    onStart();
    try {
      if ('Notification' in window && Notification.permission === 'default')
        void Notification.requestPermission();
    } catch {
      /* ignore */
    }
  };
  if (endsAt) {
    const left = Math.max(0, endsAt - now);
    const m = Math.floor(left / 60_000);
    const s = Math.floor((left % 60_000) / 1000);
    return (
      <div className="flex items-center gap-3" role="timer" aria-label="Timebox">
        <span className="text-3xl font-extrabold tabular-nums">
          {m}:{String(s).padStart(2, '0')}
        </span>
        <Button variant="secondary" size="sm" onClick={() => (setEndsAt(null), onEnd())}>
          Stop
        </Button>
      </div>
    );
  }
  return (
    <div role="group" aria-label="Timebox" className="flex flex-wrap items-center gap-2">
      <Clock3 size={16} aria-hidden className="text-muted" />
      <span className="text-sm text-muted">Work on it for</span>
      {[5, 15, 25].map((m) => (
        <Button key={m} variant="secondary" size="sm" onClick={() => start(m)}>
          {m} min
        </Button>
      ))}
    </div>
  );
}

/**
 * Focus: one thing at a time. Today's plan (up to three) comes first, then whatever is most
 * urgent. Each item shows how soon it's due, its first small step (or a way to break it into
 * steps), a timebox, Done, and "Not now".
 */
export default function FocusPage() {
  const user = useCurrentUser();
  const { workspace } = useWorkspace();
  const { boards, todayPlan } = useBoards();
  const timer = useTimer();
  const wid = workspace.id;
  const today = todayIso();
  const [data, setData] = useState<FocusData | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [quickOnly, setQuickOnly] = useState(false);
  const [picking, setPicking] = useState<string[] | null>(null);
  const [steps, setSteps] = useState<BoardItem[] | null>(null);
  const [newSteps, setNewSteps] = useState(['', '', '']);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => toast.error(friendlyError(e));

  const load = useCallback(
    (force: boolean) => {
      if (!boards) return;
      loadFocus(wid, user.uid, boards, force).then(setData).catch(fail);
    },
    [boards, wid, user.uid],
  );
  useEffect(() => load(false), [load]);

  const plan = parsePlan(todayPlan, today);
  const order = useMemo(
    () => (data ? focusOrder(data.candidates, plan, skipped, quickOnly) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plan is derived from todayPlan
    [data, todayPlan, skipped, quickOnly],
  );
  const now: FocusCandidate | undefined = order[0];
  const ctx = now ? data?.lookup.get(now.key) : undefined;

  useEffect(() => {
    setSteps(null);
    if (now)
      loadSteps(wid, now.boardId, now.itemId)
        .then(setSteps)
        .catch(() => setSteps([]));
  }, [wid, now?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusCol = ctx?.board.columns.find((c) => c.type === 'status');
  const doneLabel = statusCol?.settings.labels?.find((l) => DONE.test(l.name.trim()));
  const timeCol = ctx?.board.columns.find((c) => c.type === 'time');
  const firstStep = steps?.find((s) => {
    if (!statusCol) return true;
    const l = statusCol.settings.labels?.find((x) => x.id === s.values[statusCol.id]);
    return !l || !DONE.test(l.name.trim());
  });

  const markDone = (item: BoardItem, label: string, fallbackToSkip = true) => {
    if (!ctx || !statusCol || !doneLabel) {
      if (fallbackToSkip) setSkipped((s) => new Set([...s, `${ctx?.board.id}:${item.id}`]));
      return Promise.resolve();
    }
    return setCell({ wid, board: ctx.board, item, uid: user.uid, column: statusCol, value: label });
  };

  const done = () => {
    if (!ctx || !now) return;
    setBusy(true);
    markDone(ctx.item, doneLabel?.id ?? '')
      .then(() => {
        toast.success(`Done: ${now.name} 🎉`);
        forgetFocus();
        setSkipped((s) => new Set([...s, now.key]));
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const addSteps = () => {
    if (!ctx) return;
    const names = newSteps.map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) return;
    setBusy(true);
    names
      .reduce<Promise<void>>(
        (p, name) =>
          p.then(() =>
            createItem({
              board: ctx.board,
              wid,
              uid: user.uid,
              name,
              groupId: ctx.item.groupId,
              afterOrder: null,
              parentId: ctx.item.id,
              fallbackNumber: 1,
            }),
          ),
        Promise.resolve(),
      )
      .then(() => loadSteps(wid, ctx.board.id, ctx.item.id).then(setSteps))
      .then(() => setNewSteps(['', '', '']))
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const listName = (bid: string) => boards?.find((b) => b.id === bid)?.name ?? '';
  const planned = plan
    .map((k) => data?.candidates.find((c) => c.key === k))
    .filter((c): c is FocusCandidate => !!c);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex flex-1 items-center gap-2 text-2xl font-extrabold">
          <Target size={22} aria-hidden className="text-primary" /> Focus
        </h1>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={quickOnly}
            onChange={(e) => setQuickOnly(e.target.checked)}
            className="h-4 w-4 accent-[var(--c-primary)]"
          />
          Quick wins only
        </label>
        <Button variant="secondary" size="sm" onClick={() => (setSkipped(new Set()), load(true))}>
          <RefreshCw size={14} aria-hidden /> Refresh
        </Button>
      </div>

      {/* ---- today's plan */}
      <section aria-label="Today’s plan" className="rounded-3xl bg-surface p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="flex-1 font-bold">Today’s plan</h2>
          {picking === null && data && data.candidates.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setPicking(plan)}>
              {plan.length ? 'Change' : `Pick up to ${MAX_PLAN}`}
            </Button>
          )}
        </div>
        {picking !== null ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">
              Choose up to {MAX_PLAN}. Small and done beats big and dreaded.
            </p>
            <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Choose for today">
              {(data ? focusOrder(data.candidates, [], new Set(), quickOnly) : [])
                .slice(0, 15)
                .map((c) => {
                  const on = picking.includes(c.key);
                  return (
                    <li key={c.key}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!on && picking.length >= MAX_PLAN}
                          onChange={() =>
                            setPicking(
                              on ? picking.filter((k) => k !== c.key) : [...picking, c.key],
                            )
                          }
                          className="h-4 w-4 accent-[var(--c-primary)]"
                        />
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        <Countdown due={c.due} />
                      </label>
                    </li>
                  );
                })}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPicking(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  saveTodayPlan(user.uid, today, picking).catch(fail);
                  setPicking(null);
                }}
              >
                Save plan
              </Button>
            </div>
          </div>
        ) : planned.length === 0 ? (
          <p className="text-sm text-muted">
            No plan yet. Picking a few things for today makes starting easier.
          </p>
        ) : (
          <ol className="space-y-1 text-sm" aria-label="Planned for today">
            {planned.map((c, i) => (
              <li
                key={c.key}
                className={cx('flex items-center gap-2', c.done && 'text-muted line-through')}
              >
                <span className="font-bold">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.done || skipped.has(c.key) ? (
                  <Check size={14} aria-label="Done" />
                ) : (
                  <Countdown due={c.due} />
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ---- the one thing */}
      {data === null ? (
        <Skeleton className="h-48 w-full" />
      ) : !now || !ctx ? (
        <EmptyState
          title={quickOnly ? 'No quick wins right now' : 'Nothing waiting for you 🎉'}
          body={
            quickOnly
              ? 'Tag small jobs “Quick” (a Tags or Dropdown option) and they show up here.'
              : 'Everything assigned to you is done. Enjoy it.'
          }
        />
      ) : (
        <section
          aria-label="Do this next"
          className="space-y-4 rounded-3xl bg-surface p-5 shadow-pop"
        >
          <div>
            <p className="text-xs font-bold tracking-wide text-muted uppercase">
              {plan.includes(now.key) ? 'On today’s plan' : 'Next up'} · {listName(now.boardId)}
            </p>
            <h2 className="mt-1 text-2xl font-extrabold break-words">{now.name || 'Untitled'}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Countdown due={now.due} />
              {now.quick && (
                <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-semibold">
                  Quick win
                </span>
              )}
              <Link
                to={`/w/${wid}/b/${now.boardId}?item=${now.itemId}`}
                className="text-sm text-primary underline underline-offset-2"
              >
                Open it
              </Link>
            </div>
          </div>

          <div className="rounded-2xl bg-surface-2 p-3">
            {steps === null ? (
              <Skeleton className="h-6 w-1/2" />
            ) : firstStep ? (
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-sm">
                  <span className="font-bold">First tiny step:</span> {firstStep.name}
                </p>
                {statusCol && doneLabel && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      markDone(firstStep, doneLabel.id, false)
                        .then(() => loadSteps(wid, now.boardId, now.itemId).then(setSteps))
                        .catch(fail)
                    }
                  >
                    <Check size={14} aria-hidden /> Step done
                  </Button>
                )}
              </div>
            ) : (
              <form
                className="space-y-2"
                aria-label="Break it down"
                onSubmit={(e) => {
                  e.preventDefault();
                  addSteps();
                }}
              >
                <p className="text-sm font-bold">Feels big? Break it into small steps.</p>
                {newSteps.map((v, i) => (
                  <input
                    key={i}
                    aria-label={`Step ${i + 1}`}
                    placeholder={
                      i === 0
                        ? 'The very first thing, e.g. “find the letter”'
                        : `Step ${i + 1} (optional)`
                    }
                    value={v}
                    maxLength={200}
                    onChange={(e) =>
                      setNewSteps(newSteps.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
                  />
                ))}
                <Button size="sm" type="submit" disabled={busy || !newSteps.some((s) => s.trim())}>
                  <Plus size={14} aria-hidden /> Add steps
                </Button>
              </form>
            )}
          </div>

          <Timebox
            onStart={() => {
              if (timeCol && !timer.running) timer.start(now.boardId, now.itemId, timeCol.id);
            }}
            onEnd={() => {
              if (timer.running?.itemId === now.itemId) timer.stop();
            }}
          />
          {timeCol && (
            <p className="text-xs text-muted">The time you spend is logged on the item too.</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={done} disabled={busy || !doneLabel}>
              <Check size={16} aria-hidden /> Done
            </Button>
            <Button variant="secondary" onClick={() => setSkipped((s) => new Set([...s, now.key]))}>
              <SkipForward size={16} aria-hidden /> Not now
            </Button>
          </div>
          {!doneLabel && (
            <p className="text-xs text-muted">
              This list has no “Done” status, so mark it finished from the list itself.
            </p>
          )}

          {order.length > 1 && (
            <div>
              <h3 className="text-xs font-bold tracking-wide text-muted uppercase">After that</h3>
              <ul className="mt-1 space-y-1 text-sm" aria-label="After that">
                {order.slice(1, 4).map((c) => (
                  <li key={c.key} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <Countdown due={c.due} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {data && data.failed.length > 0 && (
        <p role="alert" className="text-sm text-danger">
          Couldn’t read: {data.failed.join(', ')}.
        </p>
      )}
    </div>
  );
}
