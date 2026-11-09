import { paths, type RunningTimer } from '@app/shared';
import { doc } from 'firebase/firestore';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { friendlyError } from '../../lib/firestore/errors';
import { db } from '../../lib/firebase';
import { listenDoc } from '../../lib/firestore';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { useWorkspace } from '../workspaces/WorkspaceProvider';
import { startTimer, stopTimer } from './api';

interface TimerState {
  /** My running timer (one per person per household), or null. */
  running: RunningTimer | null;
  busy: boolean;
  start: (bid: string, iid: string, columnId: string) => void;
  stop: () => void;
}

const Ctx = createContext<TimerState | null>(null);

/** One small listener on my own timer document: every cell and the pill read from it. */
export function TimerProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const { workspace } = useWorkspace();
  const [running, setRunning] = useState<RunningTimer | null>(null);
  const [busy, setBusy] = useState(false);
  const wid = workspace.id;
  const uid = user.uid;

  useEffect(
    () =>
      listenDoc('timer:mine', doc(db, `${paths.workspace(wid)}/timers/${uid}`), (snap) => {
        const d = snap.data({ serverTimestamps: 'estimate' });
        if (!snap.exists() || !d) return setRunning(null);
        const at = d['startedAt'] as { toMillis?: () => number } | null;
        setRunning({
          boardId: String(d['boardId'] ?? ''),
          itemId: String(d['itemId'] ?? ''),
          columnId: String(d['columnId'] ?? ''),
          startedAtMs: at?.toMillis?.() ?? Date.now(),
        });
      }),
    [wid, uid],
  );

  const run = useCallback((job: Promise<unknown>, done?: string) => {
    setBusy(true);
    job
      .then(() => done && toast.success(done))
      .catch((e: unknown) => toast.error(friendlyError(e)))
      .finally(() => setBusy(false));
  }, []);

  const value = useMemo<TimerState>(
    () => ({
      running,
      busy,
      start: (bid, iid, columnId) => run(startTimer({ wid, uid, bid, iid, columnId, running })),
      stop: () => {
        if (running) run(stopTimer({ wid, uid, timer: running }), 'Time saved');
      },
    }),
    [running, busy, run, wid, uid],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTimer(): TimerState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTimer outside TimerProvider');
  return v;
}

/** Re-renders every second (only mount it while a timer is visible). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
