import type { Column } from '@app/shared';
import { createContext, useContext } from 'react';
import type { BoardItem } from '../boards/types';

/** What cells need from the board beyond their own item (kept in context, not prop-drilled). */
export interface CellEnv {
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
