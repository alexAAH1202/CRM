import type { Column } from '@app/shared';
import { createContext, useContext, useMemo } from 'react';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { saveColumns, setCell } from '../boards/api';
import type { Board, BoardItem } from '../boards/types';

/** What cells need from the board beyond their own item (kept in context, not prop-drilled). */
export interface CellEnv {
  /** For uploads and attribution. */
  wid: string;
  uid: string;
  boardId: string;
  /** Every item on the board (for dependency pickers and names). */
  items: ReadonlyMap<string, BoardItem>;
  /**
   * Adds options to a Tags column and assigns them in one go (the column must be saved
   * before the cell value can reference the new tag).
   */
  saveColumnAndSet: (column: Column, item: BoardItem, value: unknown) => void;
}

const Ctx = createContext<CellEnv | null>(null);
export const CellEnvProvider = Ctx.Provider;

export function useCellEnv(): CellEnv {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCellEnv outside CellEnvProvider');
  return v;
}

/** The env every board view hands to the cell editors. */
export function useBoardCellEnv(
  wid: string,
  board: Board,
  items: ReadonlyMap<string, BoardItem>,
  uid: string,
): CellEnv {
  return useMemo(
    () => ({
      wid,
      uid,
      boardId: board.id,
      items,
      // A new tag must exist on the column before an item can refer to it.
      saveColumnAndSet: (column: Column, item: BoardItem, value: unknown) => {
        const columns = board.columns.map((x) => (x.id === column.id ? column : x));
        saveColumns(wid, board.id, columns)
          .then(() => setCell({ wid, board: { ...board, columns }, item, uid, column, value }))
          .catch((err: unknown) => toast.error(friendlyError(err)));
      },
    }),
    [items, wid, board, uid],
  );
}
