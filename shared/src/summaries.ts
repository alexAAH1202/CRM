import { formatDuration, totalMs, type TimeValue } from './timeTracking';
import {
  formatComputedNumber,
  formatNumber,
  normalizeValue,
  type Column,
  type ColumnType,
  type SummaryKind,
} from './columns';
import type { LabelColor } from './palette';

export const SUMMARY_LABELS: Record<SummaryKind, string> = {
  none: 'None',
  count: 'Filled',
  sum: 'Sum',
  avg: 'Average',
  min: 'Min',
  max: 'Max',
  distribution: 'Breakdown',
};

export function summaryOptions(type: ColumnType): SummaryKind[] {
  switch (type) {
    case 'numbers':
      return ['none', 'sum', 'avg', 'min', 'max', 'count'];
    case 'formula':
      return ['none', 'sum', 'avg', 'min', 'max', 'count'];
    case 'time':
      return ['none', 'sum', 'count'];
    case 'rating':
    case 'progress':
      return ['none', 'avg', 'count'];
    case 'itemId':
    case 'createdAt':
    case 'updatedAt':
    case 'createdBy':
      return ['none'];
    case 'status':
    case 'dropdown':
    case 'tags':
      return ['none', 'distribution', 'count'];
    default:
      return ['none', 'count'];
  }
}

export function defaultSummary(type: ColumnType): SummaryKind {
  return type === 'numbers' || type === 'time'
    ? 'sum'
    : type === 'status'
      ? 'distribution'
      : 'none';
}

export function summaryKindOf(col: Column): SummaryKind {
  const k = col.settings.summary;
  return k && summaryOptions(col.type).includes(k) ? k : defaultSummary(col.type);
}

export interface DistributionPart {
  label: string;
  color: LabelColor;
  count: number;
}

export type Summary =
  | { kind: 'none' }
  | { kind: 'count'; n: number }
  | { kind: 'number'; op: 'sum' | 'avg' | 'min' | 'max'; text: string | null }
  | { kind: 'distribution'; parts: DistributionPart[]; total: number };

/** Footer summary for one column over the items currently visible in a group. */
export function summarize(col: Column, rawValues: readonly unknown[]): Summary {
  const kind = summaryKindOf(col);
  if (kind === 'none') return { kind: 'none' };
  const values = rawValues.map((v) => normalizeValue(col, v)).filter((v) => v !== null);
  if (kind === 'count') return { kind: 'count', n: values.length };

  if (kind === 'distribution') {
    const counts = new Map<string, number>();
    for (const v of values) {
      const ids = Array.isArray(v) ? (v as string[]) : [v as string];
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const defs = col.type === 'status' ? (col.settings.labels ?? []) : (col.settings.options ?? []);
    const parts = defs
      .map((d) => ({ label: d.name, color: d.color, count: counts.get(d.id) ?? 0 }))
      .filter((p) => p.count > 0);
    return { kind: 'distribution', parts, total: parts.reduce((s, p) => s + p.count, 0) };
  }

  const nums =
    col.type === 'time'
      ? values.map((v) => totalMs(v as TimeValue))
      : values.filter((v): v is number => typeof v === 'number');
  if (nums.length === 0) return { kind: 'number', op: kind as 'sum', text: null };
  const sum = nums.reduce((a, b) => a + b, 0);
  const result =
    kind === 'sum'
      ? sum
      : kind === 'avg'
        ? sum / nums.length
        : kind === 'min'
          ? Math.min(...nums)
          : Math.max(...nums);
  return {
    kind: 'number',
    op: kind as 'sum' | 'avg' | 'min' | 'max',
    text:
      col.type === 'time'
        ? formatDuration(result)
        : col.type === 'numbers'
          ? formatNumber(result, col.settings)
          : col.type === 'progress'
            ? `${Math.round(result)}%`
            : col.type === 'rating'
              ? `${Math.round(result * 10) / 10} / 5`
              : formatComputedNumber(result, col.settings),
  };
}
