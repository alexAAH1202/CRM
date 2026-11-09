import type { LabelColor } from './palette';
import { shortId } from './ids';

/**
 * Column model. Definitions live on the board doc (`columns[]`); values live on
 * items as `values[columnId]`. Value shapes are documented per type below and in
 * docs/DATA_MODEL.md. Phase 3 adds the remaining types.
 */
export const COLUMN_TYPES = [
  'text',
  'longText',
  'status',
  'dropdown',
  'people',
  'date',
  'timeline',
  'numbers',
  'checkbox',
  'link',
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export interface Label {
  id: string;
  name: string;
  color: LabelColor;
}

export interface StatusSettings {
  labels: Label[];
  defaultLabelId: string | null;
}
export interface DropdownSettings {
  options: Label[];
}
export interface NumbersSettings {
  unit: string; // e.g. "$", "h", "kg"
  unitPosition: 'prefix' | 'suffix';
  decimals: number;
}

export type SummaryKind = 'none' | 'count' | 'sum' | 'avg' | 'min' | 'max' | 'distribution';

export interface CommonSettings {
  /** Footer summary shown under each group. */
  summary: SummaryKind;
  /** Value given to new items (status uses `defaultLabelId` instead). */
  defaultValue: unknown;
}

export type ColumnSettings = Partial<
  StatusSettings & DropdownSettings & NumbersSettings & CommonSettings
>;

export interface Column {
  id: string;
  type: ColumnType;
  title: string;
  settings: ColumnSettings;
}

/** Value shapes stored in item.values[columnId]. */
export interface TimelineValue {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD (>= start)
}
export interface LinkValue {
  url: string;
  text: string;
}
export type CellValue =
  | string // text, longText, status (label id), date (YYYY-MM-DD)
  | string[] // dropdown (option ids), people (uids)
  | number // numbers
  | boolean // checkbox
  | TimelineValue
  | LinkValue
  | null;

export const COLUMN_META: Record<
  ColumnType,
  { label: string; width: number; description: string }
> = {
  text: { label: 'Text', width: 180, description: 'Short text' },
  longText: { label: 'Long text', width: 220, description: 'Notes and longer descriptions' },
  status: { label: 'Status', width: 150, description: 'Coloured labels like Done or Stuck' },
  dropdown: { label: 'Dropdown', width: 170, description: 'Pick one or more options' },
  people: { label: 'People', width: 130, description: 'Assign workspace members' },
  date: { label: 'Date', width: 130, description: 'A single date' },
  timeline: { label: 'Timeline', width: 190, description: 'A start and end date' },
  numbers: { label: 'Numbers', width: 120, description: 'Amounts, costs, hours' },
  checkbox: { label: 'Checkbox', width: 100, description: 'Yes / no' },
  link: { label: 'Link', width: 180, description: 'A web address' },
};

export const NAME_COLUMN_WIDTH = 320;

export function defaultStatusLabels(): Label[] {
  return [
    { id: 'not_started', name: 'Not started', color: 'gray' },
    { id: 'working', name: 'Working on it', color: 'orange' },
    { id: 'stuck', name: 'Stuck', color: 'red' },
    { id: 'done', name: 'Done', color: 'green' },
  ];
}

export function makeColumn(
  type: ColumnType,
  title?: string,
  settings: ColumnSettings = {},
): Column {
  const base: Column = {
    id: shortId(),
    type,
    title: title ?? COLUMN_META[type].label,
    settings: {},
  };
  switch (type) {
    case 'status':
      base.settings = { labels: defaultStatusLabels(), defaultLabelId: null, ...settings };
      break;
    case 'dropdown':
      base.settings = { options: [], ...settings };
      break;
    case 'numbers':
      base.settings = { unit: '', unitPosition: 'prefix', decimals: 0, ...settings };
      break;
    default:
      base.settings = { ...settings };
  }
  return base;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Coerces arbitrary stored data into the column's value shape (null if invalid/empty). */
export function normalizeValue(col: Column, v: unknown): CellValue {
  switch (col.type) {
    case 'text':
    case 'longText':
      return typeof v === 'string' && v.trim() !== '' ? v : null;
    case 'status': {
      const labels = col.settings.labels ?? [];
      return typeof v === 'string' && labels.some((l) => l.id === v) ? v : null;
    }
    case 'dropdown': {
      const ids = new Set((col.settings.options ?? []).map((o) => o.id));
      const arr = Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && ids.has(x))
        : [];
      return arr.length ? arr : null;
    }
    case 'people': {
      const arr = Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && x !== '')
        : [];
      return arr.length ? [...new Set(arr)] : null;
    }
    case 'date':
      return isIsoDate(v) ? v : null;
    case 'timeline': {
      const t = v as Partial<TimelineValue> | null;
      if (!t || !isIsoDate(t.start) || !isIsoDate(t.end)) return null;
      return t.start <= t.end ? { start: t.start, end: t.end } : { start: t.end, end: t.start };
    }
    case 'numbers':
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    case 'checkbox':
      return v === true ? true : null;
    case 'link': {
      const l = v as Partial<LinkValue> | null;
      if (!l || typeof l.url !== 'string') return null;
      const url = normalizeUrl(l.url);
      return url ? { url, text: typeof l.text === 'string' ? l.text : '' } : null;
    }
  }
}

/** Adds https:// when missing; refuses javascript:/data: URLs. */
export function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (!url || /^(javascript|data|vbscript):/i.test(url)) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return `https://${url}`;
}

/** Union of all People column values: kept on item.assigneeUids for "My Work" queries. */
export function computeAssignees(
  columns: readonly Column[],
  values: Record<string, unknown>,
): string[] {
  const out = new Set<string>();
  for (const c of columns) {
    if (c.type !== 'people') continue;
    const v = normalizeValue(c, values[c.id]);
    if (Array.isArray(v)) v.forEach((u) => out.add(u));
  }
  return [...out].sort();
}

export function formatNumber(n: number, s: ColumnSettings): string {
  const decimals = Math.min(Math.max(s.decimals ?? 0, 0), 6);
  const str = n.toLocaleString('en-AU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const unit = s.unit ?? '';
  if (!unit) return str;
  return s.unitPosition === 'suffix' ? `${str} ${unit}` : `${unit}${str}`;
}

/** Plain-text rendering, used for search and (later) CSV export. */
export function valueToText(
  col: Column,
  raw: unknown,
  peopleName: (uid: string) => string = (u) => u,
): string {
  const v = normalizeValue(col, raw);
  if (v === null) return '';
  switch (col.type) {
    case 'status':
      return col.settings.labels?.find((l) => l.id === v)?.name ?? '';
    case 'dropdown':
      return (v as string[])
        .map((id) => col.settings.options?.find((o) => o.id === id)?.name ?? '')
        .filter(Boolean)
        .join(', ');
    case 'people':
      return (v as string[]).map(peopleName).join(', ');
    case 'timeline':
      return `${(v as TimelineValue).start} – ${(v as TimelineValue).end}`;
    case 'numbers':
      return formatNumber(v as number, col.settings);
    case 'checkbox':
      return 'Yes';
    case 'link':
      return (v as LinkValue).text || (v as LinkValue).url;
    default:
      return String(v);
  }
}

/** Values a brand-new item starts with: status default label + each column's default value. */
export function defaultItemValues(columns: readonly Column[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    const raw = col.type === 'status' ? col.settings.defaultLabelId : col.settings.defaultValue;
    if (raw === undefined || raw === null) continue;
    const v = normalizeValue(col, raw);
    if (v !== null) out[col.id] = v;
  }
  return out;
}
