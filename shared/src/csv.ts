import type { Group } from './board';
import { isComputedType, valueToText, type Column } from './columns';
import type { ItemLike } from './itemLike';

/**
 * Spreadsheet apps run text that starts with = + - @ (or a tab/CR) as a formula, so a cell
 * someone typed as `=HYPERLINK(...)` would execute when the export is opened. A leading
 * apostrophe makes it plain text (the standard defence).
 */
export function guardCell(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** RFC 4180 quoting: wrap in quotes when needed, double any quotes. */
export function csvField(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: ReadonlyArray<readonly string[]>): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

export interface CsvInput {
  columns: readonly Column[];
  groups: readonly Group[];
  /** Items with computed columns already worked out (so formulas export their results). */
  items: readonly ItemLike[];
  memberName: (uid: string) => string;
  /** Include archived items (deleted ones never are). */
  includeArchived?: boolean;
}

/**
 * One row per item (subitems follow their parent, with the parent's name in "Parent"):
 * Item, Group, Parent, then every column as readable text. Numbers stay numbers; user-typed
 * text is guarded against formula injection.
 */
export function boardToCsv(input: CsvInput): string {
  const { columns, groups, memberName } = input;
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? '';
  const live = input.items.filter((i) => !i.deleted && (input.includeArchived || !i.archived));
  const byParent = new Map<string, ItemLike[]>();
  const top: ItemLike[] = [];
  for (const it of live) {
    if (it.parentId) byParent.set(it.parentId, [...(byParent.get(it.parentId) ?? []), it]);
    else top.push(it);
  }
  const order = (a: ItemLike, b: ItemLike) =>
    groups.findIndex((g) => g.id === a.groupId) - groups.findIndex((g) => g.id === b.groupId) ||
    a.order.localeCompare(b.order);
  top.sort(order);

  const cell = (col: Column, it: ItemLike): string => {
    const raw = it.values[col.id];
    const text = valueToText(col, raw, { peopleName: memberName });
    if (col.type === 'numbers' || col.type === 'rating') return text;
    if (isComputedType(col.type) && col.type !== 'formula') return text;
    return guardCell(text);
  };

  const header = ['Item', 'Group', 'Parent', ...columns.map((c) => guardCell(c.title))];
  const rows: string[][] = [header];
  for (const it of top) {
    rows.push([guardCell(it.name), groupName(it.groupId), '', ...columns.map((c) => cell(c, it))]);
    for (const sub of (byParent.get(it.id) ?? []).sort((a, b) => a.order.localeCompare(b.order)))
      rows.push([
        guardCell(sub.name),
        groupName(sub.groupId),
        guardCell(it.name),
        ...columns.map((c) => cell(c, sub)),
      ]);
  }
  return toCsv(rows);
}

/** A safe file name for a download. */
export function csvFileName(boardName: string): string {
  const base = boardName
    .replace(/[^\p{L}\p{N} _-]+/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60);
  return `${base || 'board'}.csv`;
}
