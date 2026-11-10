import { applyComputed, boardToCsv, csvFileName, todayIso } from '@app/shared';
import type { Board, BoardItem } from '../boards/types';

/** Builds the CSV on this device from what's already loaded (no extra reads) and downloads it. */
export function downloadBoardCsv(
  board: Board,
  items: ReadonlyMap<string, BoardItem>,
  memberName: (uid: string) => string,
): void {
  const computed = applyComputed([...items.values()], board.columns, {
    today: todayIso(),
    memberName,
    itemName: (id) => items.get(id)?.name,
    groupName: (id) => board.groups.find((g) => g.id === id)?.name,
  });
  const csv = boardToCsv({
    columns: board.columns,
    groups: board.groups,
    items: computed,
    memberName,
  });
  // The BOM makes Excel read it as UTF-8 (accents, emoji).
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = csvFileName(board.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
