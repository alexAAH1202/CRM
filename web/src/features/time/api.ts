import {
  boardPaths,
  paths,
  planStartTimer,
  planStopTimer,
  shortId,
  type RunningTimer,
} from '@app/shared';
import { doc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { commitOps, runOpsTransaction } from '../../lib/firestore';

/**
 * Stops a running timer: reads the item inside a transaction (so two people logging to the same
 * item at once can't lose a session), adds the session and deletes the timer, together.
 */
export function stopTimer(input: { wid: string; uid: string; timer: RunningTimer; note?: string }) {
  const { wid, uid, timer } = input;
  return runOpsTransaction('timer:stop', async (get) => {
    const snap = await get(doc(db, boardPaths.item(wid, timer.boardId, timer.itemId)));
    const data = snap.exists() ? snap.data() : undefined;
    const deleted = !data || data['deletedAt'] != null;
    const current =
      (data?.['values'] as Record<string, unknown> | undefined)?.[timer.columnId] ?? null;
    if (deleted)
      return [{ kind: 'delete' as const, path: `${paths.workspace(wid)}/timers/${uid}` }];
    return planStopTimer({
      wid,
      uid,
      timer,
      nowMs: Date.now(),
      current,
      newId: () => shortId(),
      ...(input.note ? { note: input.note } : {}),
    }).ops;
  });
}

/** Starts a timer on an item, first stopping (and saving) whichever one was already running. */
export async function startTimer(input: {
  wid: string;
  uid: string;
  bid: string;
  iid: string;
  columnId: string;
  running: RunningTimer | null;
}) {
  if (input.running) await stopTimer({ wid: input.wid, uid: input.uid, timer: input.running });
  await commitOps(
    'timer:start',
    planStartTimer({
      wid: input.wid,
      uid: input.uid,
      bid: input.bid,
      iid: input.iid,
      columnId: input.columnId,
    }),
  );
}
