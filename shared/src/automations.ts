import type { Group } from './board';
import { normalizeValue, type Column } from './columns';
import { addDays, isIsoDate } from './dates';
import {
  describeRecurrence,
  describeTime,
  isValidTime,
  MAX_OFFSET_DAYS,
  parseRecurrence,
  type Schedule,
} from './scheduling';
import { type Filter, parseViewConfig } from './viewConfig';

/** Limits (mirrored by the security rules). */
export const MAX_AUTOMATIONS = 20;
export const MAX_ACTIONS = 5;
export const MAX_CONDITIONS = 5;
/** An automation's actions may trigger others, but only this many levels deep. */
export const MAX_DEPTH = 3;
/** Items one change may create through automations (stops an accidental explosion). */
export const MAX_CREATED = 10;
export const MAX_NOTIFY = 10;

export type Trigger =
  | { type: 'itemCreated' }
  | { type: 'columnChanged'; columnId: string | null }
  | { type: 'statusChangedTo'; columnId: string; labelId: string }
  | { type: 'personAssigned'; columnId: string | null; uid: string | null }
  | { type: 'movedToGroup'; groupId: string }
  | { type: 'subitemsAllDone'; columnId: string; labelId: string }
  // ---- scheduled: run by the Apps Script helper, not in the browser ----
  /** N days before (negative) / after a date, at a time of day. For a Timeline, `which` picks the start or end. */
  | {
      type: 'dateArrives';
      columnId: string;
      which: 'start' | 'end';
      offsetDays: number;
      atTime: string;
    }
  /** The day after a date passes, if the item isn't done. */
  | { type: 'overdue'; columnId: string; atTime: string }
  /** On a repeating schedule: once for the board, or once for each item that matches the conditions. */
  | { type: 'recurring'; scope: 'board' | 'items'; schedule: Schedule };

export type TriggerType = Trigger['type'];
export const TRIGGER_TYPES: readonly TriggerType[] = [
  'itemCreated',
  'columnChanged',
  'statusChangedTo',
  'personAssigned',
  'movedToGroup',
  'subitemsAllDone',
  'dateArrives',
  'overdue',
  'recurring',
];

/** Triggers the helper runs on a clock. The browser only registers them (see scheduleOps). */
export function isScheduledTrigger(t: Trigger): boolean {
  return t.type === 'dateArrives' || t.type === 'overdue' || t.type === 'recurring';
}

export function isScheduledAutomation(a: Pick<Automation, 'trigger'>): boolean {
  return isScheduledTrigger(a.trigger);
}

export type NotifyTo = 'assignees' | 'owner' | 'actor' | 'person';

/** Values for setValue may use these tokens, resolved when the automation runs. */
export const TOKEN_ME = '@me';
export const TOKEN_TODAY = '@today';

/**
 * "@today", "@today+7", "@today-3": a date relative to the day the automation runs.
 * Returns the YYYY-MM-DD, or null if `v` isn't one of these tokens.
 */
export function resolveDateToken(v: unknown, today: string): string | null {
  if (typeof v !== 'string') return null;
  const m = /^@today(?:([+-])(\d{1,4}))?$/.exec(v);
  if (!m) return null;
  if (!m[1]) return today;
  const n = Number(m[2]);
  return addDays(today, m[1] === '-' ? -n : n);
}

export function isDateToken(v: unknown): boolean {
  return typeof v === 'string' && /^@today(?:[+-]\d{1,4})?$/.test(v);
}

export type Action =
  | { type: 'setValue'; columnId: string; value: unknown }
  | { type: 'moveToGroup'; groupId: string }
  | { type: 'createItem'; name: string; groupId: string | null; subitem: boolean }
  | { type: 'duplicate' }
  | { type: 'archive' }
  | { type: 'notify'; to: NotifyTo; uid: string | null; message: string };

export type ActionType = Action['type'];
export const ACTION_TYPES: readonly ActionType[] = [
  'setValue',
  'moveToGroup',
  'createItem',
  'duplicate',
  'archive',
  'notify',
];

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  ownerUid: string;
  trigger: Trigger;
  conditions: Filter[];
  actions: Action[];
}

/** Actions that need an item number, and so a transaction on the board counter. */
export function needsNumbering(a: Automation): boolean {
  return a.actions.some((x) => x.type === 'createItem' || x.type === 'duplicate');
}

const str = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

export function parseTrigger(raw: unknown): Trigger | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (r['type']) {
    case 'itemCreated':
      return { type: 'itemCreated' };
    case 'columnChanged':
      return { type: 'columnChanged', columnId: str(r['columnId'], 64) };
    case 'statusChangedTo': {
      const columnId = str(r['columnId'], 64);
      const labelId = str(r['labelId'], 64);
      return columnId && labelId ? { type: 'statusChangedTo', columnId, labelId } : null;
    }
    case 'personAssigned':
      return { type: 'personAssigned', columnId: str(r['columnId'], 64), uid: str(r['uid'], 128) };
    case 'movedToGroup': {
      const groupId = str(r['groupId'], 64);
      return groupId ? { type: 'movedToGroup', groupId } : null;
    }
    case 'subitemsAllDone': {
      const columnId = str(r['columnId'], 64);
      const labelId = str(r['labelId'], 64);
      return columnId && labelId ? { type: 'subitemsAllDone', columnId, labelId } : null;
    }
    case 'dateArrives': {
      const columnId = str(r['columnId'], 64);
      const off = r['offsetDays'];
      if (
        !columnId ||
        typeof off !== 'number' ||
        !Number.isInteger(off) ||
        Math.abs(off) > MAX_OFFSET_DAYS
      )
        return null;
      return {
        type: 'dateArrives',
        columnId,
        which: r['which'] === 'start' ? 'start' : 'end',
        offsetDays: off,
        atTime: isValidTime(r['atTime']) ? r['atTime'] : '09:00',
      };
    }
    case 'overdue': {
      const columnId = str(r['columnId'], 64);
      return columnId
        ? { type: 'overdue', columnId, atTime: isValidTime(r['atTime']) ? r['atTime'] : '09:00' }
        : null;
    }
    case 'recurring': {
      const sch = (
        r['schedule'] && typeof r['schedule'] === 'object' ? r['schedule'] : {}
      ) as Record<string, unknown>;
      const recurrence = parseRecurrence(sch['recurrence']);
      if (!recurrence || !isIsoDate(sch['startDate'])) return null;
      return {
        type: 'recurring',
        scope: r['scope'] === 'items' ? 'items' : 'board',
        schedule: {
          recurrence,
          atTime: isValidTime(sch['atTime']) ? sch['atTime'] : '09:00',
          startDate: sch['startDate'],
        },
      };
    }
    default:
      return null;
  }
}

export function parseAction(raw: unknown): Action | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (r['type']) {
    case 'setValue': {
      const columnId = str(r['columnId'], 64);
      return columnId ? { type: 'setValue', columnId, value: r['value'] ?? null } : null;
    }
    case 'moveToGroup': {
      const groupId = str(r['groupId'], 64);
      return groupId ? { type: 'moveToGroup', groupId } : null;
    }
    case 'createItem': {
      const name = str(r['name'], 200);
      return name
        ? {
            type: 'createItem',
            name,
            groupId: str(r['groupId'], 64),
            subitem: r['subitem'] === true,
          }
        : null;
    }
    case 'duplicate':
      return { type: 'duplicate' };
    case 'archive':
      return { type: 'archive' };
    case 'notify': {
      const to = (['assignees', 'owner', 'actor', 'person'] as const).find((x) => x === r['to']);
      const message = str(r['message'], 200);
      if (!to || !message) return null;
      const uid = str(r['uid'], 128);
      if (to === 'person' && !uid) return null;
      return { type: 'notify', to, uid: to === 'person' ? uid : null, message };
    }
    default:
      return null;
  }
}

/** Coerces stored data into a safe Automation (null when it can't be made sense of). */
export function parseAutomation(id: string, raw: unknown): Automation | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const trigger = parseTrigger(r['trigger']);
  if (!trigger) return null;
  const actions = (Array.isArray(r['actions']) ? r['actions'] : [])
    .map(parseAction)
    .filter((a): a is Action => a !== null)
    .slice(0, MAX_ACTIONS);
  if (actions.length === 0) return null;
  const conditions = parseViewConfig({
    filters: Array.isArray(r['conditions']) ? r['conditions'] : [],
  }).filters.slice(0, MAX_CONDITIONS);
  return {
    id,
    name: typeof r['name'] === 'string' && r['name'] ? r['name'].slice(0, 120) : 'Automation',
    enabled: r['enabled'] === true,
    ownerUid: typeof r['ownerUid'] === 'string' ? r['ownerUid'] : '',
    trigger,
    conditions,
    actions,
  };
}

/** The saved document (without id). */
export function automationData(a: Omit<Automation, 'id'>): Record<string, unknown> {
  return {
    name: a.name.slice(0, 120),
    enabled: a.enabled,
    ownerUid: a.ownerUid,
    trigger: a.trigger,
    conditions: a.conditions.slice(0, MAX_CONDITIONS),
    actions: a.actions.slice(0, MAX_ACTIONS),
  };
}

// ------------------------------------------------------------ plain-language text

interface Board {
  columns: readonly Column[];
  groups: readonly Group[];
}

const colName = (b: Board, id: string | null) =>
  id ? (b.columns.find((c) => c.id === id)?.title ?? 'a deleted column') : 'any column';
const groupName = (b: Board, id: string | null) =>
  id ? (b.groups.find((g) => g.id === id)?.name ?? 'a deleted group') : 'its group';
const labelName = (b: Board, columnId: string, labelId: string) => {
  const c = b.columns.find((x) => x.id === columnId);
  const l = (c?.settings.labels ?? []).find((x) => x.id === labelId);
  return l?.name ?? 'a deleted label';
};

export function describeTrigger(t: Trigger, b: Board, memberName: (uid: string) => string): string {
  switch (t.type) {
    case 'itemCreated':
      return 'an item is created';
    case 'columnChanged':
      return t.columnId ? `${colName(b, t.columnId)} changes` : 'anything changes';
    case 'statusChangedTo':
      return `${colName(b, t.columnId)} changes to ${labelName(b, t.columnId, t.labelId)}`;
    case 'personAssigned':
      return `${t.uid ? memberName(t.uid) : 'someone'} is assigned${t.columnId ? ` in ${colName(b, t.columnId)}` : ''}`;
    case 'movedToGroup':
      return `an item is moved to ${groupName(b, t.groupId)}`;
    case 'subitemsAllDone':
      return `all subitems are ${labelName(b, t.columnId, t.labelId)}`;
    case 'dateArrives': {
      const col = colName(b, t.columnId);
      const d =
        t.offsetDays === 0
          ? `the day of ${col}`
          : `${Math.abs(t.offsetDays)} day${Math.abs(t.offsetDays) === 1 ? '' : 's'} ${t.offsetDays < 0 ? 'before' : 'after'} ${col}`;
      return `it is ${d}, at ${describeTime(t.atTime)}`;
    }
    case 'overdue':
      return `${colName(b, t.columnId)} has passed and it isn’t done, at ${describeTime(t.atTime)}`;
    case 'recurring':
      return `${describeRecurrence(t.schedule.recurrence)} at ${describeTime(t.schedule.atTime)}${t.scope === 'items' ? ', for each matching item' : ''}`;
  }
}

export function describeAction(a: Action, b: Board, memberName: (uid: string) => string): string {
  switch (a.type) {
    case 'setValue': {
      const col = b.columns.find((c) => c.id === a.columnId);
      const v =
        a.value === TOKEN_ME
          ? 'the person who made the change'
          : isDateToken(a.value)
            ? a.value === TOKEN_TODAY
              ? 'today'
              : `today ${String(a.value).slice(6)} days`
            : col
              ? ((col.settings.labels ?? col.settings.options ?? []).find(
                  (l) => l.id === a.value || (Array.isArray(a.value) && a.value.includes(l.id)),
                )?.name ?? (normalizeValue(col, a.value) === null ? 'empty' : String(a.value)))
              : String(a.value);
      return `set ${colName(b, a.columnId)} to ${v}`;
    }
    case 'moveToGroup':
      return `move it to ${groupName(b, a.groupId)}`;
    case 'createItem':
      return `create ${a.subitem ? 'a subitem' : 'an item'} “${a.name}”`;
    case 'duplicate':
      return 'duplicate it';
    case 'archive':
      return 'archive it';
    case 'notify':
      return `notify ${
        a.to === 'assignees'
          ? 'the people on it'
          : a.to === 'owner'
            ? 'the automation’s owner'
            : a.to === 'actor'
              ? 'whoever made the change'
              : memberName(a.uid ?? '')
      }`;
  }
}

/** "When status changes to Done, then move it to Archive." */
export function describeAutomation(
  a: Automation,
  b: Board,
  memberName: (uid: string) => string,
): string {
  const when = describeTrigger(a.trigger, b, memberName);
  const cond = a.conditions.length
    ? ` and ${a.conditions.length} condition${a.conditions.length > 1 ? 's' : ''} match${a.conditions.length > 1 ? '' : 'es'}`
    : '';
  const then = a.actions.map((x) => describeAction(x, b, memberName)).join(', then ');
  return `When ${when}${cond}, ${then}.`;
}

/** Why a scheduled automation's actions can't work (null = fine). Board-wide runs have no item to act on. */
export function scheduledActionProblem(a: Pick<Automation, 'trigger' | 'actions'>): string | null {
  const t = a.trigger;
  if (t.type !== 'recurring' || t.scope !== 'board') return null;
  for (const act of a.actions) {
    if (act.type === 'createItem' && !act.subitem) continue;
    if (act.type === 'notify' && act.to !== 'assignees') continue;
    return 'A board-wide schedule has no single item, so it can only create items and send notifications. Choose “for each matching item” to change items.';
  }
  return null;
}
