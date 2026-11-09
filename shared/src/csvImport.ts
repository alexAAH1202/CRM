import type { Group } from './board';
import { boardPaths, buildItemDoc } from './boardOps';
import { normalizeValue, type Column, type ColumnType } from './columns';
import { isIsoDate } from './dates';
import type { WriteOp } from './ops';
import { keysBetween } from './ordering';

/** Import limits (a household's board, not a data warehouse; also keeps one import cheap). */
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_COLUMNS = 60;
export const IMPORT_MAX_FIELD = 5000;
export const IMPORT_MAX_BYTES = 1_000_000;

export interface ParsedCsv {
  rows: string[][];
  /** Set when the file is unusable (too big, not a table). */
  error: string | null;
}

/** RFC 4180 reader: quotes, doubled quotes, newlines inside quotes, CRLF/LF/CR, a BOM. */
export function parseCsv(input: string): ParsedCsv {
  if (input.length > IMPORT_MAX_BYTES)
    return { rows: [], error: 'That file is too big to import (the limit is about 1 MB).' };
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  // Spreadsheets sometimes export with ; or tab; pick whichever the header line uses most.
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? '';
  const count = (c: string) => firstLine.split(c).length - 1;
  const delim = [',', ';', '\t'].reduce((best, c) => (count(c) > count(best) ? c : best), ',');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let any = false;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    row = [];
    any = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      quoted = true;
      any = true;
    } else if (ch === delim) {
      endField();
      any = true;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
      any = true;
    }
    if (field.length > IMPORT_MAX_FIELD)
      return { rows: [], error: 'A cell in that file is far too long to be a normal table.' };
    if (rows.length > IMPORT_MAX_ROWS + 1)
      return { rows: [], error: `That file has more than ${IMPORT_MAX_ROWS} rows.` };
  }
  if (quoted) return { rows: [], error: 'That file has a quote that never closes.' };
  if (any || field !== '' || row.length) endRow();
  if (rows.length === 0) return { rows: [], error: 'That file is empty.' };
  if (Math.max(...rows.map((r) => r.length)) > IMPORT_MAX_COLUMNS)
    return { rows: [], error: `That file has more than ${IMPORT_MAX_COLUMNS} columns.` };
  return { rows, error: null };
}

// ---------------------------------------------------------------------------- cell conversion

export const IMPORTABLE_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  'text',
  'longText',
  'numbers',
  'date',
  'status',
  'dropdown',
  'people',
  'checkbox',
  'rating',
  'email',
  'phone',
  'link',
  'tags',
]);

export interface ImportMember {
  uid: string;
  name: string;
  email: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
function ymd(y: number, m: number, d: number): string | null {
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return isIsoDate(s) ? s : null;
}
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** Dates as people write them. Day-first (Australian) for 3/4/2026; ISO and "15 Mar 2026" too. */
export function parseImportDate(text: string): string | null {
  const t = text.trim();
  if (isIsoDate(t)) return t;
  let m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(t);
  if (m) return ymd(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (m) return ymd(fullYear(+m[3]!), +m[2]!, +m[1]!);
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    return mi >= 0 ? ymd(fullYear(+m[3]!), mi + 1, +m[1]!) : null;
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    return mi >= 0 ? ymd(fullYear(+m[3]!), mi + 1, +m[2]!) : null;
  }
  return null;
}

export function parseImportNumber(text: string): number | null {
  let t = text.trim();
  if (!t) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/[$€£¥\s%]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || Math.abs(n) > 1e15) return null;
  return negative ? -n : n;
}

const splitList = (text: string) =>
  text
    .split(/[;,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

export interface CellResult {
  /** The value to store (null = leave empty). */
  value: unknown;
  /** Why the text couldn't be used, if it couldn't (the cell is left empty). */
  problem: string | null;
}

/** Turns one cell of text into a value for `column`, or says why it can't. Never throws. */
export function convertCell(
  column: Column,
  raw: string,
  members: readonly ImportMember[],
): CellResult {
  const text = raw.trim();
  const ok = (value: unknown): CellResult => ({ value, problem: null });
  const bad = (problem: string): CellResult => ({ value: null, problem });
  if (text === '') return ok(null);
  const checked = (v: unknown, problem: string): CellResult => {
    const n = normalizeValue(column, v);
    return n === null ? bad(problem) : ok(n);
  };
  const byName = <T extends { id: string; name: string }>(list: readonly T[], t: string) =>
    list.find((x) => x.name.trim().toLowerCase() === t.toLowerCase()) ??
    list.find((x) => x.id === t);

  switch (column.type) {
    case 'text':
    case 'longText':
      return ok(text.slice(0, column.type === 'text' ? 500 : 5000));
    case 'numbers': {
      const n = parseImportNumber(text);
      return n === null ? bad('not a number') : ok(n);
    }
    case 'date': {
      const d = parseImportDate(text);
      return d ? ok(d) : bad('not a date I recognise (try 2026-03-17 or 17/3/2026)');
    }
    case 'status': {
      const l = byName(column.settings.labels ?? [], text);
      return l ? ok(l.id) : bad('no status with that name');
    }
    case 'dropdown':
    case 'tags': {
      const opts = column.settings.options ?? [];
      const ids: string[] = [];
      const unknown: string[] = [];
      for (const part of column.type === 'tags' ? splitList(text) : [text]) {
        const o = byName(opts, part);
        if (o) ids.push(o.id);
        else unknown.push(part);
      }
      if (unknown.length) return bad(`no option called “${unknown.join('”, “')}”`);
      return checked(ids, 'no matching option');
    }
    case 'people': {
      const uids: string[] = [];
      const unknown: string[] = [];
      for (const part of splitList(text)) {
        const p = part.toLowerCase();
        const m = members.find(
          (x) => x.email.toLowerCase() === p || x.name.trim().toLowerCase() === p,
        );
        if (m) uids.push(m.uid);
        else unknown.push(part);
      }
      if (unknown.length) return bad(`nobody in this workspace called “${unknown.join('”, “')}”`);
      return checked(uids, 'nobody matched');
    }
    case 'checkbox': {
      const t = text.toLowerCase();
      if (['true', 'yes', 'y', '1', 'x', '✓', '✔', 'done', 'checked'].includes(t)) return ok(true);
      if (['false', 'no', 'n', '0', 'unchecked'].includes(t)) return ok(null);
      return bad('not yes/no');
    }
    case 'rating': {
      const n = parseImportNumber(text);
      return n !== null && Number.isInteger(n) && n >= 1 && n <= 5
        ? ok(n)
        : bad('not a rating from 1 to 5');
    }
    case 'email':
      return checked(text, 'not an email address');
    case 'phone':
      return checked(text, 'not a phone number');
    case 'link':
      return checked({ url: text, text: '' }, 'not a web address');
    default:
      return bad('this kind of column can’t be imported');
  }
}

// ---------------------------------------------------------------------------- mapping + plan

/** What a CSV column feeds: the item name, the group, a board column, or nothing. */
export type Target = { kind: 'name' } | { kind: 'group' } | { kind: 'column'; id: string } | null;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** A first guess at the mapping from header names (the person can change every one). */
export function suggestMapping(headers: readonly string[], columns: readonly Column[]): Target[] {
  const used = new Set<string>();
  let nameTaken = false;
  let groupTaken = false;
  return headers.map((h): Target => {
    const n = norm(h);
    if (!n) return null;
    if (!nameTaken && ['item', 'name', 'title', 'task'].includes(n)) {
      nameTaken = true;
      return { kind: 'name' };
    }
    if (!groupTaken && n === 'group') {
      groupTaken = true;
      return { kind: 'group' };
    }
    const col = columns.find(
      (c) => !used.has(c.id) && IMPORTABLE_TYPES.has(c.type) && norm(c.title) === n,
    );
    if (col) {
      used.add(col.id);
      return { kind: 'column', id: col.id };
    }
    return null;
  });
}

export interface ImportProblem {
  /** 1-based, counting the header as row 1 (as a spreadsheet shows it). */
  row: number;
  column: string;
  text: string;
  reason: string;
}

export interface ImportItem {
  name: string;
  groupId: string;
  values: Record<string, unknown>;
}

export interface ImportPlan {
  items: ImportItem[];
  problems: ImportProblem[];
  /** Rows with no name (nothing to call the item). */
  skipped: number;
}

/** Works out the items an import would create, and every cell it couldn't use. Pure. */
export function buildImport(input: {
  /** Data rows only (header already removed). */
  rows: ReadonlyArray<readonly string[]>;
  headers: readonly string[];
  mapping: readonly Target[];
  columns: readonly Column[];
  groups: readonly Group[];
  defaultGroupId: string;
  members: readonly ImportMember[];
}): ImportPlan {
  const { rows, headers, mapping, columns, groups, defaultGroupId, members } = input;
  const items: ImportItem[] = [];
  const problems: ImportProblem[] = [];
  let skipped = 0;
  const nameIdx = mapping.findIndex((t) => t?.kind === 'name');
  const groupIdx = mapping.findIndex((t) => t?.kind === 'group');
  rows.forEach((r, i) => {
    const rowNo = i + 2;
    const name = (nameIdx >= 0 ? (r[nameIdx] ?? '') : '').trim().slice(0, 500);
    if (!name) {
      skipped++;
      return;
    }
    let groupId = defaultGroupId;
    if (groupIdx >= 0) {
      const g = (r[groupIdx] ?? '').trim();
      if (g) {
        const found = groups.find((x) => x.name.trim().toLowerCase() === g.toLowerCase());
        if (found) groupId = found.id;
        else
          problems.push({
            row: rowNo,
            column: headers[groupIdx] ?? 'Group',
            text: g,
            reason: 'no group with that name (put in the default group)',
          });
      }
    }
    const values: Record<string, unknown> = {};
    mapping.forEach((t, c) => {
      if (t?.kind !== 'column') return;
      const col = columns.find((x) => x.id === t.id);
      if (!col) return;
      const text = r[c] ?? '';
      const res = convertCell(col, text, members);
      if (res.problem)
        problems.push({
          row: rowNo,
          column: headers[c] ?? col.title,
          text: text.trim().slice(0, 60),
          reason: res.problem,
        });
      else if (res.value !== null) {
        // Several CSV columns can feed one board column (e.g. dropdown parts): keep the first.
        if (!(col.id in values)) values[col.id] = res.value;
      }
    });
    items.push({ name, groupId, values });
  });
  return { items, problems, skipped };
}

/**
 * The writes for one batch of an import: new items in order after `afterOrder` in their group,
 * numbered from `startNumber`, plus the counter. Items keep their CSV order within each group.
 */
export function planImportChunk(input: {
  wid: string;
  bid: string;
  uid: string;
  columns: readonly Column[];
  items: readonly ImportItem[];
  startNumber: number;
  counterExists: boolean;
  /** Last existing order key per group id (null/absent = group is empty). */
  lastOrderByGroup: ReadonlyMap<string, string | null>;
  newItemId: () => string;
}): { ops: WriteOp[]; lastOrderByGroup: Map<string, string | null> } {
  const { wid, bid, uid, columns, items, startNumber } = input;
  const perGroup = new Map<string, number>();
  for (const it of items) perGroup.set(it.groupId, (perGroup.get(it.groupId) ?? 0) + 1);
  const keys = new Map<string, string[]>();
  const last = new Map(input.lastOrderByGroup);
  for (const [g, n] of perGroup) {
    const after = input.lastOrderByGroup.get(g) ?? null;
    const ks = keysBetween(after, null, n);
    keys.set(g, [...ks]);
    last.set(g, ks.at(-1) ?? after);
  }
  const ops: WriteOp[] = [
    {
      kind: input.counterExists ? 'update' : 'set',
      path: boardPaths.counter(wid, bid),
      data: { next: startNumber + items.length },
    },
  ];
  items.forEach((it, i) => {
    ops.push({
      kind: 'set',
      path: boardPaths.item(wid, bid, input.newItemId()),
      data: buildItemDoc(uid, columns, {
        name: it.name,
        groupId: it.groupId,
        order: (keys.get(it.groupId) as string[]).shift() as string,
        itemNumber: startNumber + i,
        values: it.values,
      }),
    });
  });
  return { ops, lastOrderByGroup: last };
}
