import { History, UndoConflict, type HistoryEntry } from '@app/shared';
import { useSyncExternalStore } from 'react';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';

/**
 * Undo/redo for the board you have open. History lives in memory for this tab (a reload starts
 * fresh) and is kept per board. Each entry knows how to reverse and re-apply itself; an entry
 * throws UndoConflict when the data has moved on (someone else changed it, or it was deleted),
 * in which case nothing is overwritten and the person is told.
 */
export interface UndoEntry extends HistoryEntry {
  undo: () => Promise<unknown>;
  redo: () => Promise<unknown>;
}

const histories = new Map<string, History<UndoEntry>>();
const listeners = new Set<() => void>();
let version = 0;
let busy = false;

const historyOf = (bid: string) => {
  let h = histories.get(bid);
  if (!h) histories.set(bid, (h = new History<UndoEntry>()));
  return h;
};
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

/** Called by the write functions after a change has been saved. */
export function recordUndo(bid: string, entry: UndoEntry): () => void {
  if (busy) return () => undefined; // the writes an undo/redo makes are not new history
  historyOf(bid).record(entry);
  changed();
  // Call this if the action then fails to save: there is nothing to undo.
  return () => {
    historyOf(bid).discard(entry);
    changed();
  };
}

/**
 * Records an action when it is issued (so Ctrl+Z straight after an edit undoes that edit, even
 * before the server has confirmed it), and forgets it if saving it fails.
 */
export function saveWithUndo<T>(
  bid: string,
  entry: UndoEntry | null,
  save: Promise<T>,
): Promise<T> {
  if (!entry) return save;
  const drop = recordUndo(bid, entry);
  return save.catch((e: unknown) => {
    drop();
    throw e;
  });
}

export function clearUndo(bid: string): void {
  histories.delete(bid);
  changed();
}

// Steps run one at a time, in the order they were asked for: pressing Ctrl+Z twice quickly undoes
// two things (the second waits for the first), rather than the second being lost.
let chain: Promise<void> = Promise.resolve();
function run(bid: string, direction: 'undo' | 'redo'): Promise<void> {
  const next = chain.then(() => exec(bid, direction));
  chain = next.catch(() => undefined);
  return next;
}

async function exec(bid: string, direction: 'undo' | 'redo'): Promise<void> {
  const h = historyOf(bid);
  const entry = direction === 'undo' ? h.takeUndo() : h.takeRedo();
  if (!entry) return;
  busy = true;
  changed();
  try {
    await (direction === 'undo' ? entry.undo() : entry.redo());
    if (direction === 'undo') h.doneUndo(entry);
    else h.doneRedo(entry);
    toast.info(`${direction === 'undo' ? 'Undid' : 'Redid'}: ${entry.label}`);
  } catch (e) {
    if (e instanceof UndoConflict) {
      // The data moved on: this step can't be applied safely, so it is dropped.
      toast.info(`Couldn’t ${direction} “${entry.label}”: ${e.message}`);
    } else {
      // A blip: keep the step so it can be tried again.
      if (direction === 'undo') h.putBackUndo(entry);
      else h.putBackRedo(entry);
      toast.error(friendlyError(e));
    }
  } finally {
    busy = false;
    changed();
  }
}

export const undoLast = (bid: string) => run(bid, 'undo');
export const redoLast = (bid: string) => run(bid, 'redo');

export interface UndoState {
  undoLabel: string | null;
  redoLabel: string | null;
  busy: boolean;
}

let cache: { v: number; bid: string; state: UndoState } | null = null;
function snapshot(bid: string): UndoState {
  if (cache && cache.v === version && cache.bid === bid) return cache.state;
  const h = historyOf(bid);
  const state = { undoLabel: h.undoLabel, redoLabel: h.redoLabel, busy };
  cache = { v: version, bid, state };
  return state;
}

export function useUndoState(bid: string): UndoState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot(bid),
  );
}
