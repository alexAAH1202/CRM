import { planSetCell } from './boardOps';
import { normalizeValue, type Column } from './columns';
import type { WriteOp } from './ops';

/**
 * Undo/redo, kept pure so the rules can be tested: a bounded two-stack history, and the "has
 * anything changed underneath me?" check that keeps an undo from overwriting someone else's work.
 */

export interface HistoryEntry {
  /** Shown to the person: "Set Status on 3 items". */
  label: string;
}

export const MAX_HISTORY = 50;

export class History<E extends HistoryEntry> {
  private undos: E[] = [];
  private redos: E[] = [];

  /** A new action: it becomes the next thing to undo, and the redo list is no longer meaningful. */
  record(entry: E): void {
    this.undos.push(entry);
    if (this.undos.length > MAX_HISTORY) this.undos.shift();
    this.redos = [];
  }
  get undoLabel(): string | null {
    return this.undos.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.redos.at(-1)?.label ?? null;
  }
  takeUndo(): E | undefined {
    return this.undos.pop();
  }
  takeRedo(): E | undefined {
    return this.redos.pop();
  }
  /** After an undo succeeded, it can be redone. */
  doneUndo(entry: E): void {
    this.redos.push(entry);
  }
  /** After a redo succeeded, it can be undone again (without wiping the rest of the redo list). */
  doneRedo(entry: E): void {
    this.undos.push(entry);
  }
  /** A transient failure: put it back exactly where it was. */
  putBackUndo(entry: E): void {
    this.undos.push(entry);
  }
  putBackRedo(entry: E): void {
    this.redos.push(entry);
  }
  /** Forget an entry (its action failed to save, so there is nothing to undo). */
  discard(entry: E): void {
    this.undos = this.undos.filter((e) => e !== entry);
    this.redos = this.redos.filter((e) => e !== entry);
  }
  clear(): void {
    this.undos = [];
    this.redos = [];
  }
}

/** Why an undo couldn't be carried out. */
export class UndoConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UndoConflict';
  }
}

export interface CellChange {
  id: string;
  /** What the cell must still hold for us to change it (what the original edit left there). */
  from: unknown;
  /** What to put back. */
  to: unknown;
}

export interface CellReversal {
  ops: WriteOp[];
  applied: string[];
  skipped: Array<{ id: string; reason: 'gone' | 'changed' }>;
}

const same = (column: Column, a: unknown, b: unknown) =>
  JSON.stringify(normalizeValue(column, a) ?? null) ===
  JSON.stringify(normalizeValue(column, b) ?? null);

/**
 * Reverses (or re-applies) cell edits, but only where the cell is still exactly as the original
 * edit left it. An item that has been deleted, or a cell someone else has since changed, is left
 * alone and reported, so undo can never silently overwrite newer work.
 */
export function planCellReversal(input: {
  wid: string;
  bid: string;
  uid: string;
  columns: readonly Column[];
  column: Column;
  changes: readonly CellChange[];
  items: ReadonlyMap<string, { values: Record<string, unknown>; deleted: boolean }>;
}): CellReversal {
  const out: CellReversal = { ops: [], applied: [], skipped: [] };
  for (const c of input.changes) {
    const it = input.items.get(c.id);
    if (!it || it.deleted) {
      out.skipped.push({ id: c.id, reason: 'gone' });
      continue;
    }
    if (!same(input.column, it.values[input.column.id], c.from)) {
      out.skipped.push({ id: c.id, reason: 'changed' });
      continue;
    }
    out.ops.push(
      ...planSetCell({
        wid: input.wid,
        bid: input.bid,
        iid: c.id,
        uid: input.uid,
        columns: input.columns,
        column: input.column,
        currentValues: it.values,
        value: c.to,
      }),
    );
    out.applied.push(c.id);
  }
  return out;
}
