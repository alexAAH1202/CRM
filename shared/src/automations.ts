import type { Group } from './board';
import { normalizeValue, type Column } from './columns';
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
  | { type: 'subitemsAllDone'; columnId: string; labelId: string };

export type TriggerType = Trigger['type'];
export const TRIGGER_TYPES: readonly TriggerType[] = [
  'itemCreated',
  'columnChanged',
  'statusChangedTo',
  'personAssigned',
  'movedToGroup',
  'subitemsAllDone',
];

export type NotifyTo = 'assignees' | 'owner' | 'actor' | 'person';

/** Values for setValue may use these tokens, resolved when the automation runs. */
export const TOKEN_ME = '@me';
export const TOKEN_TODAY = '@today';

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
  }
}

export function describeAction(a: Action, b: Board, memberName: (uid: string) => string): string {
  switch (a.type) {
    case 'setValue': {
      const col = b.columns.find((c) => c.id === a.columnId);
      const v =
        a.value === TOKEN_ME
          ? 'the person who made the change'
          : a.value === TOKEN_TODAY
            ? 'today'
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
