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
  'tags',
  'people',
  'date',
  'timeline',
  'numbers',
  'rating',
  'checkbox',
  'link',
  'email',
  'phone',
  'files',
  'dependency',
  'progress',
  'formula',
  'itemId',
  'createdAt',
  'updatedAt',
  'createdBy',
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

/**
 * Computed columns store nothing: their value is worked out when the board is shown
 * (from the item, its subitems or other columns) and is never written to the database.
 */
export const COMPUTED_TYPES: readonly ColumnType[] = [
  'formula',
  'progress',
  'itemId',
  'createdAt',
  'updatedAt',
  'createdBy',
];
export function isComputedType(type: ColumnType): boolean {
  return COMPUTED_TYPES.includes(type);
}

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

export interface ProgressSettings {
  /** Where progress comes from: the share of subitems that are done, or ticked checkboxes. */
  source: 'subitems' | 'checkboxes';
  /** For 'subitems': the Status column to read, and which of its labels count as done. */
  statusColumnId: string | null;
  doneLabelIds: string[];
  /** For 'checkboxes': the Checkbox columns to count. */
  checkboxColumnIds: string[];
}

export interface ComputedSettings {
  /** Formula text, e.g. `{Budget} - {Spent}`. */
  formula: string;
  progress: ProgressSettings;
  /** Item ID prefix, e.g. "#" or "BILL-". */
  prefix: string;
}

export type ColumnSettings = Partial<
  StatusSettings & DropdownSettings & NumbersSettings & CommonSettings & ComputedSettings
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
export interface FileValue {
  name: string;
  url: string;
}
/** A dependency on another item (a predecessor), with a lag in days (finish-to-start). */
export interface DependencyValue {
  id: string;
  lag: number;
}
export type CellValue =
  | string // text, longText, email, phone, status (label id), date (YYYY-MM-DD)
  | string[] // dropdown / tags (option ids), people (uids)
  | number // numbers, rating, progress, item id
  | boolean // checkbox
  | TimelineValue
  | LinkValue
  | FileValue[]
  | DependencyValue[]
  | null;

export const MAX_FILES = 20;
export const MAX_DEPENDENCIES = 30;
export const MAX_LAG_DAYS = 365;
export const RATING_MAX = 5;

export type PickerGroup =
  'Text & numbers' | 'Choices & people' | 'Dates' | 'Links & files' | 'Calculated' | 'Relations';

export const COLUMN_META: Record<
  ColumnType,
  { label: string; width: number; description: string; group: PickerGroup }
> = {
  text: { label: 'Text', width: 180, description: 'Short text', group: 'Text & numbers' },
  longText: {
    label: 'Long text',
    width: 220,
    description: 'Notes and longer descriptions',
    group: 'Text & numbers',
  },
  numbers: {
    label: 'Numbers',
    width: 120,
    description: 'Amounts, costs, hours',
    group: 'Text & numbers',
  },
  rating: { label: 'Rating', width: 130, description: '1 to 5 stars', group: 'Text & numbers' },
  checkbox: { label: 'Checkbox', width: 100, description: 'Yes / no', group: 'Text & numbers' },
  status: {
    label: 'Status',
    width: 150,
    description: 'Coloured labels like Done or Stuck',
    group: 'Choices & people',
  },
  dropdown: {
    label: 'Dropdown',
    width: 170,
    description: 'Pick one or more options',
    group: 'Choices & people',
  },
  tags: {
    label: 'Tags',
    width: 170,
    description: 'Tags you can create as you go',
    group: 'Choices & people',
  },
  people: {
    label: 'People',
    width: 130,
    description: 'Assign workspace members',
    group: 'Choices & people',
  },
  date: { label: 'Date', width: 130, description: 'A single date', group: 'Dates' },
  timeline: { label: 'Timeline', width: 190, description: 'A start and end date', group: 'Dates' },
  link: { label: 'Link', width: 180, description: 'A web address', group: 'Links & files' },
  email: { label: 'Email', width: 190, description: 'An email address', group: 'Links & files' },
  phone: { label: 'Phone', width: 150, description: 'A phone number', group: 'Links & files' },
  files: {
    label: 'Files',
    width: 170,
    description: 'Links to files (e.g. in Google Drive)',
    group: 'Links & files',
  },
  formula: {
    label: 'Formula',
    width: 160,
    description: 'Calculate from other columns',
    group: 'Calculated',
  },
  progress: {
    label: 'Progress',
    width: 160,
    description: 'Percent done, from subitems or checkboxes',
    group: 'Calculated',
  },
  itemId: {
    label: 'Item ID',
    width: 100,
    description: 'An automatic number for each item',
    group: 'Calculated',
  },
  createdAt: {
    label: 'Created',
    width: 130,
    description: 'When the item was created',
    group: 'Calculated',
  },
  updatedAt: {
    label: 'Last updated',
    width: 130,
    description: 'When the item last changed',
    group: 'Calculated',
  },
  createdBy: {
    label: 'Created by',
    width: 130,
    description: 'Who created the item',
    group: 'Calculated',
  },
  dependency: {
    label: 'Dependency',
    width: 190,
    description: 'Items that must finish first',
    group: 'Relations',
  },
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
    case 'tags':
      base.settings = { options: [], ...settings };
      break;
    case 'numbers':
      base.settings = { unit: '', unitPosition: 'prefix', decimals: 0, ...settings };
      break;
    case 'formula':
      base.settings = { formula: '', ...settings };
      break;
    case 'progress':
      base.settings = {
        progress: {
          source: 'subitems',
          statusColumnId: null,
          doneLabelIds: [],
          checkboxColumnIds: [],
        },
        ...settings,
      };
      break;
    case 'itemId':
      base.settings = { prefix: '#', ...settings };
      break;
    default:
      base.settings = { ...settings };
  }
  return base;
}

export { isIsoDate } from './dates';
import { isIsoDate } from './dates';

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
    case 'tags': {
      const ids = new Set((col.settings.options ?? []).map((o) => o.id));
      const arr = Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && ids.has(x))
        : [];
      return arr.length ? [...new Set(arr)] : null;
    }
    case 'rating':
      return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= RATING_MAX ? v : null;
    case 'email': {
      const t = typeof v === 'string' ? v.trim() : '';
      return t.length <= 254 && EMAIL_RE.test(t) ? t : null;
    }
    case 'phone': {
      const t = typeof v === 'string' ? v.trim() : '';
      return PHONE_RE.test(t) && (t.match(/\d/g)?.length ?? 0) >= 3 ? t : null;
    }
    case 'files': {
      if (!Array.isArray(v)) return null;
      const seen = new Set<string>();
      const out: FileValue[] = [];
      for (const f of v as Array<Partial<FileValue> | null>) {
        if (!f || typeof f.url !== 'string') continue;
        const url = normalizeUrl(f.url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const name =
          typeof f.name === 'string' && f.name.trim()
            ? f.name.trim().slice(0, 200)
            : url.replace(/^https?:\/\//, '').slice(0, 200);
        out.push({ name, url });
        if (out.length >= MAX_FILES) break;
      }
      return out.length ? out : null;
    }
    case 'dependency': {
      if (!Array.isArray(v)) return null;
      const seen = new Set<string>();
      const out: DependencyValue[] = [];
      for (const d of v as unknown[]) {
        const id = typeof d === 'string' ? d : (d as Partial<DependencyValue> | null)?.id;
        if (typeof id !== 'string' || id === '' || id.length > 128 || seen.has(id)) continue;
        const rawLag =
          typeof d === 'object' && d !== null ? (d as Partial<DependencyValue>).lag : 0;
        const lag =
          typeof rawLag === 'number' && Number.isFinite(rawLag)
            ? Math.max(-MAX_LAG_DAYS, Math.min(MAX_LAG_DAYS, Math.trunc(rawLag)))
            : 0;
        seen.add(id);
        out.push({ id, lag });
        if (out.length >= MAX_DEPENDENCIES) break;
      }
      return out.length ? out : null;
    }
    // Computed columns: the value is whatever was worked out for display (never stored).
    case 'progress':
      return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null;
    case 'itemId':
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    case 'createdAt':
    case 'updatedAt':
      return isIsoDate(v) ? v : null;
    case 'createdBy':
      return typeof v === 'string' && v !== '' ? v : null;
    case 'formula':
      if (typeof v === 'number') return Number.isFinite(v) ? v : null;
      if (typeof v === 'boolean') return v;
      return typeof v === 'string' && v !== '' ? v : null; // errors ({ __formulaError }) → null
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\-.\s\d#*xX]{3,30}$/;

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
    if (Array.isArray(v)) (v as string[]).forEach((u) => out.add(u));
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

/** Number formatting for formula results: honours the column's decimals/unit if set, else up to 4 decimals. */
export function formatComputedNumber(n: number, s: ColumnSettings): string {
  if (typeof s.decimals === 'number' && s.decimals >= 0) return formatNumber(n, s);
  const str = n.toLocaleString('en-AU', { maximumFractionDigits: 4 });
  const unit = s.unit ?? '';
  if (!unit) return str;
  return s.unitPosition === 'suffix' ? `${str} ${unit}` : `${unit}${str}`;
}

export interface TextContext {
  peopleName?: (uid: string) => string;
  itemName?: (id: string) => string | undefined;
}

/** Plain-text rendering, used for search, sorting, conversion and (later) CSV export. */
export function valueToText(
  col: Column,
  raw: unknown,
  peopleName: ((uid: string) => string) | TextContext = (u) => u,
): string {
  const ctx: TextContext = typeof peopleName === 'function' ? { peopleName } : peopleName;
  const who = ctx.peopleName ?? ((u: string) => u);
  const v = normalizeValue(col, raw);
  if (v === null) return '';
  switch (col.type) {
    case 'status':
      return col.settings.labels?.find((l) => l.id === v)?.name ?? '';
    case 'dropdown':
    case 'tags':
      return (v as string[])
        .map((id) => col.settings.options?.find((o) => o.id === id)?.name ?? '')
        .filter(Boolean)
        .join(', ');
    case 'people':
      return (v as string[]).map(who).join(', ');
    case 'createdBy':
      return who(v as string);
    case 'timeline':
      return `${(v as TimelineValue).start} – ${(v as TimelineValue).end}`;
    case 'numbers':
      return formatNumber(v as number, col.settings);
    case 'rating':
      return `${v}/${RATING_MAX}`;
    case 'progress':
      return `${Math.round(v as number)}%`;
    case 'itemId':
      return `${col.settings.prefix ?? ''}${v}`;
    case 'formula':
      return typeof v === 'number'
        ? formatComputedNumber(v, col.settings)
        : typeof v === 'boolean'
          ? v
            ? 'TRUE'
            : 'FALSE'
          : typeof v === 'string'
            ? v
            : '';
    case 'checkbox':
      return 'Yes';
    case 'link':
      return (v as LinkValue).text || (v as LinkValue).url;
    case 'files':
      return (v as FileValue[]).map((f) => f.name).join(', ');
    case 'dependency':
      return (v as DependencyValue[])
        .map((d) => ctx.itemName?.(d.id) ?? '')
        .filter(Boolean)
        .join(', ');
    default:
      return String(v);
  }
}

/** Values a brand-new item starts with: status default label + each column's default value. */
export function defaultItemValues(columns: readonly Column[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    if (isComputedType(col.type)) continue;
    const raw = col.type === 'status' ? col.settings.defaultLabelId : col.settings.defaultValue;
    if (raw === undefined || raw === null) continue;
    const v = normalizeValue(col, raw);
    if (v !== null) out[col.id] = v;
  }
  return out;
}

// ------------------------------------------------------------- add-column picker

export const PRIORITY_LABELS: Label[] = [
  { id: 'critical', name: 'Critical', color: 'red' },
  { id: 'high', name: 'High', color: 'orange' },
  { id: 'medium', name: 'Medium', color: 'yellow' },
  { id: 'low', name: 'Low', color: 'sky' },
];

export interface PickerEntry {
  key: string;
  label: string;
  description: string;
  group: PickerGroup;
  make: () => Column;
}

/** What the "Add column" menu offers: every type, plus Priority (a Status with preset labels). */
export const COLUMN_PICKER: readonly PickerEntry[] = [
  ...COLUMN_TYPES.map((t) => ({
    key: t,
    label: COLUMN_META[t].label,
    description: COLUMN_META[t].description,
    group: COLUMN_META[t].group,
    make: () => makeColumn(t),
  })),
  {
    key: 'priority',
    label: 'Priority',
    description: 'Critical, High, Medium, Low',
    group: 'Choices & people' as PickerGroup,
    make: () =>
      makeColumn('status', 'Priority', {
        labels: PRIORITY_LABELS.map((l) => ({ ...l })),
        defaultLabelId: null,
      }),
  },
];
