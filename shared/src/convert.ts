import {
  isIsoDate,
  makeColumn,
  normalizeUrl,
  normalizeValue,
  RATING_MAX,
  valueToText,
  type CellValue,
  type Column,
  type ColumnType,
  type Label,
} from './columns';
import { shortId } from './ids';
import { LABEL_COLOR_NAMES } from './palette';

/** Types whose values are stored as typed data and can be converted between each other. */
export const CONVERTIBLE_TYPES: readonly ColumnType[] = [
  'text',
  'longText',
  'status',
  'dropdown',
  'tags',
  'people',
  'date',
  'numbers',
  'rating',
  'checkbox',
  'link',
  'email',
  'phone',
];

export interface ConversionResult {
  column: Column;
  /** Items whose stored value must change (null = clear the cell). */
  changes: Array<{ id: string; value: CellValue }>;
  /** Cells that had a value and still have one after converting. */
  kept: number;
  /** Cells that had a value which can't be represented in the new type. */
  cleared: number;
}

export interface ConversionContext {
  memberName: (uid: string) => string;
  /** Looks up a member uid by (case-insensitive) display name or email. */
  uidByName: (name: string) => string | null;
}

const MAX_NEW_LABELS = 20;
const TRUE_WORDS = new Set(['yes', 'true', 'done', 'x', '1', 'y', 'checked']);

function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(text: string): string | null {
  const t = text.trim();
  if (isIsoDate(t)) return t;
  const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t); // d/m/yyyy (AU)
  if (m) {
    const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    return isIsoDate(iso) ? iso : null;
  }
  return null;
}

function labelsFromTexts(texts: string[]): Label[] {
  const seen: string[] = [];
  for (const t of texts) if (t && !seen.includes(t)) seen.push(t);
  return seen.slice(0, MAX_NEW_LABELS).map((name, i) => ({
    id: shortId(),
    name: name.slice(0, 40),
    color: LABEL_COLOR_NAMES[i % LABEL_COLOR_NAMES.length] ?? 'blue',
  }));
}

/**
 * Plans a change of column type. Existing values are converted through their
 * text form (status/dropdown labels carry over directly); values that don't
 * fit are cleared and counted so the UI can warn before applying.
 */
export function convertColumn(
  old: Column,
  newType: ColumnType,
  items: ReadonlyArray<{ id: string; value: unknown }>,
  ctx: ConversionContext,
): ConversionResult {
  if (
    old.type === newType ||
    !CONVERTIBLE_TYPES.includes(old.type) ||
    !CONVERTIBLE_TYPES.includes(newType)
  ) {
    return { column: old, changes: [], kept: 0, cleared: 0 };
  }
  const column: Column = { ...makeColumn(newType, old.title), id: old.id };
  const oldLabels =
    old.type === 'status'
      ? old.settings.labels
      : old.type === 'dropdown' || old.type === 'tags'
        ? old.settings.options
        : undefined;
  const isLabelType = (t: ColumnType) => t === 'status' || t === 'dropdown' || t === 'tags';

  // Label-to-label conversions keep ids and colours.
  if (oldLabels && isLabelType(newType)) {
    column.settings =
      newType === 'status' ? { labels: oldLabels, defaultLabelId: null } : { options: oldLabels };
  }

  const texts = items.map((i) => valueToText(old, i.value, ctx.memberName));
  if (isLabelType(newType) && !oldLabels) {
    const labels = labelsFromTexts(texts);
    column.settings = newType === 'status' ? { labels, defaultLabelId: null } : { options: labels };
  }
  const labelDefs =
    newType === 'status' ? (column.settings.labels ?? []) : (column.settings.options ?? []);

  const changes: ConversionResult['changes'] = [];
  let kept = 0;
  let cleared = 0;

  items.forEach((it, idx) => {
    const before = normalizeValue(old, it.value);
    if (before === null) {
      // Empty stays empty — but clear any stray stored junk.
      if (it.value !== undefined && it.value !== null) changes.push({ id: it.id, value: null });
      return;
    }
    const text = texts[idx] ?? '';
    let next: CellValue = null;
    switch (newType) {
      case 'text':
      case 'longText':
        next = text || null;
        break;
      case 'status':
      case 'dropdown':
      case 'tags': {
        let name = text;
        if (oldLabels && Array.isArray(before))
          name = oldLabels.find((l) => l.id === before[0])?.name ?? '';
        const def = oldLabels
          ? labelDefs.find((l) => l.id === (Array.isArray(before) ? before[0] : before))
          : labelDefs.find((l) => l.name === name.slice(0, 40));
        if (def) next = newType === 'status' ? def.id : [def.id];
        break;
      }
      case 'people': {
        const uids = text
          .split(',')
          .map((s) => ctx.uidByName(s.trim()))
          .filter((u): u is string => !!u);
        next = uids.length ? [...new Set(uids)] : null;
        break;
      }
      case 'rating': {
        const n = parseNumber(text);
        next = n !== null && n >= 0.5 && n <= RATING_MAX + 0.5 ? Math.round(n) : null;
        break;
      }
      case 'email':
        next = normalizeValue({ ...column, type: 'email' }, text.trim());
        break;
      case 'phone':
        next = normalizeValue({ ...column, type: 'phone' }, text.trim());
        break;
      case 'date':
        next = parseDate(text);
        break;
      case 'timeline':
        next = null;
        break;
      case 'numbers':
        next = parseNumber(text);
        break;
      case 'checkbox':
        next = TRUE_WORDS.has(text.trim().toLowerCase()) ? true : null;
        break;
      case 'link': {
        const url = /^(https?:\/\/|www\.)\S+$/i.test(text.trim()) ? normalizeUrl(text) : '';
        next = url ? { url, text: '' } : null;
        break;
      }
    }
    if (next === null) {
      cleared++;
      changes.push({ id: it.id, value: null });
    } else {
      kept++;
      changes.push({ id: it.id, value: next });
    }
  });

  return { column, changes, kept, cleared };
}
