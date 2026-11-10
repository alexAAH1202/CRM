import { toDayNumber } from './dates';
import type { Column } from './columns';
import { dueDateOf, isDone } from './myWork';

/**
 * Helpers for the ADHD-friendly features: countdowns instead of bare dates, a single "do this
 * next" pick, quick wins, and a plan of up to three things for today.
 */

export type DueTone = 'late' | 'today' | 'soon' | 'week' | 'later';

/** "2 days late", "today", "tomorrow", "in 5 days", "in 3 weeks", with a tone that warms as it nears. */
export function relativeDue(
  due: string,
  today: string,
): { text: string; tone: DueTone; days: number } | null {
  const d = toDayNumber(due);
  const t = toDayNumber(today);
  if (d === null || t === null) return null;
  const days = d - t;
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} late`, tone: 'late', days };
  if (days === 0) return { text: 'today', tone: 'today', days };
  if (days === 1) return { text: 'tomorrow', tone: 'soon', days };
  if (days <= 3) return { text: `in ${days} days`, tone: 'soon', days };
  if (days <= 7) return { text: `in ${days} days`, tone: 'week', days };
  if (days <= 60) return { text: `in ${Math.round(days / 7)} weeks`, tone: 'later', days };
  return { text: `in ${Math.round(days / 30)} months`, tone: 'later', days };
}

const QUICK = /^(quick|2 ?min(ute)?s?|5 ?min(ute)?s?|quick win)$/i;

/** A quick win: the item carries a Tags or Dropdown option called "Quick" (or "2 min", "5 min"). */
export function isQuick(columns: readonly Column[], values: Record<string, unknown>): boolean {
  for (const c of columns) {
    if (c.type !== 'tags' && c.type !== 'dropdown') continue;
    const v = values[c.id];
    const ids = Array.isArray(v) ? (v as unknown[]) : [];
    if ((c.settings.options ?? []).some((o) => QUICK.test(o.name.trim()) && ids.includes(o.id)))
      return true;
  }
  return false;
}

export interface FocusCandidate {
  key: string; // `${boardId}:${itemId}`
  boardId: string;
  itemId: string;
  name: string;
  due: string | null;
  quick: boolean;
  done: boolean;
}

export function toCandidate(
  boardId: string,
  item: { id: string; name: string; values: Record<string, unknown> },
  columns: readonly Column[],
): FocusCandidate {
  return {
    key: `${boardId}:${item.id}`,
    boardId,
    itemId: item.id,
    name: item.name,
    due: dueDateOf(columns, item.values),
    quick: isQuick(columns, item.values),
    done: isDone(columns, item.values),
  };
}

/**
 * What to show next: today's plan first (in the order chosen), then anything overdue, due today,
 * soonest, then things with no date. Done items and skipped ones are left out.
 */
export function focusOrder(
  candidates: readonly FocusCandidate[],
  plan: readonly string[],
  skipped: ReadonlySet<string> = new Set(),
  onlyQuick = false,
): FocusCandidate[] {
  const open = candidates.filter((c) => !c.done && !skipped.has(c.key) && (!onlyQuick || c.quick));
  const planned = plan
    .map((k) => open.find((c) => c.key === k))
    .filter((c): c is FocusCandidate => !!c);
  const rest = open
    .filter((c) => !plan.includes(c.key))
    .sort(
      (a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.name.localeCompare(b.name),
    );
  return [...planned, ...rest];
}

export const MAX_PLAN = 3;

export interface TodayPlan {
  date: string;
  picks: string[];
}

/** Today's plan from stored data: only today's counts; at most three valid picks. */
export function parsePlan(raw: unknown, today: string): string[] {
  const r = raw as Partial<TodayPlan> | null;
  if (!r || r.date !== today || !Array.isArray(r.picks)) return [];
  return [
    ...new Set(
      r.picks.filter(
        (p): p is string => typeof p === 'string' && /^[\w-]{1,128}:[\w-]{1,128}$/.test(p),
      ),
    ),
  ].slice(0, MAX_PLAN);
}
