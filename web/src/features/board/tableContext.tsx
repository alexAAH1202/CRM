import type { Column, LayoutGroup } from '@app/shared';
import { createContext, useContext } from 'react';
import type { Board, BoardItem, WorkspaceMember } from '../boards/types';

export type DropEdge = 'top' | 'bottom';

/** Everything the table's row components share (kept in context to avoid prop drilling). */
export interface TableContextValue {
  wid: string;
  board: Board;
  /** Visible (non-hidden) columns, in order. */
  columns: Column[];
  widths: number[];
  template: string;
  totalWidth: number;
  canEdit: boolean;
  members: WorkspaceMember[];
  selected: ReadonlySet<string>;
  selectionActive: boolean;
  toggleSelect: (id: string) => void;
  setGroupSelected: (ids: string[], on: boolean) => void;
  expanded: ReadonlySet<string>;
  toggleExpand: (id: string) => void;
  collapsed: ReadonlySet<string>;
  toggleGroup: (key: string) => void;
  itemDragEnabled: boolean;
  groupDragEnabled: boolean;
  /** Where a drop would land, for the indicator line. */
  dropTarget: { id: string; edge: DropEdge } | null;
  onCell: (item: BoardItem, column: Column, value: unknown) => void;
  onRename: (item: BoardItem, name: string) => void;
  onAddItem: (group: LayoutGroup<BoardItem>, name: string) => void;
  onAddSubitem: (parent: BoardItem, name: string, lastOrder: string | null) => void;
  onItemAction: (
    action: 'move' | 'duplicate' | 'archive' | 'restore' | 'delete' | 'expand' | 'addSub',
    item: BoardItem,
    arg?: string,
  ) => void;
  onGroupRename: (groupId: string, name: string) => void;
  onGroupColor: (groupId: string, color: LayoutGroup<BoardItem>['color']) => void;
  onGroupDelete: (groupId: string) => void;
  onColumnSave: (c: Column) => void;
  onColumnDelete: (c: Column) => void;
  onColumnMove: (c: Column, dir: -1 | 1) => void;
  onColumnChangeType: (c: Column) => void;
  onColumnDefault: (c: Column) => void;
  onColumnConfigure: (c: Column) => void;
  onAddColumn: (c: Column) => void;
  onResize: (columnId: string, width: number) => void;
  setLiveWidth: (columnId: string, width: number | null) => void;
  canDeleteGroup: boolean;
}

const Ctx = createContext<TableContextValue | null>(null);
export const TableProvider = Ctx.Provider;

export function useTable(): TableContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTable outside TableProvider');
  return v;
}
