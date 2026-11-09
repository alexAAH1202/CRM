import { isScheduledAutomation, type Automation, type Trigger } from './automations';
import { boardPaths } from './boardOps';
import { type Column } from './columns';
import { isIsoDate } from './dates';
import { SERVER_TIME, type WriteOp } from './ops';
import { fireAtForDate, nextOccurrence, PAST_GRACE_MS } from './scheduling';
import { spanOf } from './views';

/**
 * The queue the Apps Script helper works from. The browser keeps it in step with the data in the
 * same batch as each edit (so the helper never scans every item), and the helper can rebuild it
 * from scratch if it ever drifts ("rebuild schedule").
 *
 * One document per (automation, item); a board-wide recurring schedule has a single document.
 * Ids are deterministic, so re-registering simply overwrites, and removing needs no lookup.
 */
export type EventKind = 'date' | 'overdue' | 'recurring';

export interface ScheduledEventDoc {
  kind: EventKind;
  automationId: string;
  itemId: string | null;
  boardId: string;
  fireAt: Date;
  status: 'pending';
  attempts: 0;
  /** Same value for the same (automation, item, date): lets the helper spot a repeat. */
  idempotencyKey: string;
  /** The date the event was computed from (so the helper can tell if the item has since changed). */
  dateValue: string | null;
}

export function eventId(automationId: string, itemId: string | null): string {
  return itemId ? `${automationId}_${itemId}` : automationId;
}

export interface SchedItem {
  id: string;
  values: Record<string, unknown>;
  archived: boolean;
  deleted: boolean;
}

/** The date this trigger watches on an item, or null if there isn't one. */
export function triggerDate(
  t: Extract<Trigger, { type: 'dateArrives' | 'overdue' }>,
  item: Pick<SchedItem, 'values'>,
  columns: readonly Column[],
): string | null {
  const col = columns.find((c) => c.id === t.columnId);
  if (!col || (col.type !== 'date' && col.type !== 'timeline')) return null;
  const span = spanOf(col, item.values[col.id]);
  if (!span) return null;
  return t.type === 'dateArrives' && col.type === 'timeline' && t.which === 'start'
    ? span.start
    : span.end;
}

/** When the event for this trigger and item should fire, or null if it has no date. */
export function itemFireAt(
  t: Extract<Trigger, { type: 'dateArrives' | 'overdue' }>,
  item: Pick<SchedItem, 'values'>,
  columns: readonly Column[],
  tz: string,
): { fireAt: number; dateValue: string } | null {
  const date = triggerDate(t, item, columns);
  if (!date || !isIsoDate(date)) return null;
  const at = fireAtForDate(date, t.type === 'overdue' ? 1 : t.offsetDays, t.atTime, tz);
  return at === null ? null : { fireAt: at, dateValue: date };
}

interface Ctx {
  wid: string;
  bid: string;
  columns: readonly Column[];
  tz: string;
  nowMs: number;
}

const del = (c: Ctx, aid: string, iid: string | null): WriteOp => ({
  kind: 'delete',
  path: boardPaths.event(c.wid, c.bid, eventId(aid, iid)),
});

function put(c: Ctx, doc: ScheduledEventDoc): WriteOp {
  return {
    kind: 'set',
    path: boardPaths.event(c.wid, c.bid, eventId(doc.automationId, doc.itemId)),
    data: { ...doc, updatedAt: SERVER_TIME },
  };
}

/** Item-trigger events for one item against one automation: register, replace or remove. */
function itemEvents(c: Ctx, a: Automation, item: SchedItem): WriteOp[] {
  const t = a.trigger;
  if (t.type !== 'dateArrives' && t.type !== 'overdue') return [];
  if (!a.enabled || item.deleted || item.archived) return [del(c, a.id, item.id)];
  const f = itemFireAt(t, item, c.columns, c.tz);
  // Nothing to remind about, or the moment has already gone (we never fire reminders "from the past").
  if (!f || f.fireAt < c.nowMs - PAST_GRACE_MS) return [del(c, a.id, item.id)];
  return [
    put(c, {
      kind: t.type === 'overdue' ? 'overdue' : 'date',
      automationId: a.id,
      itemId: item.id,
      boardId: c.bid,
      fireAt: new Date(f.fireAt),
      status: 'pending',
      attempts: 0,
      idempotencyKey: `${a.id}:${item.id}:${f.dateValue}:${t.type === 'dateArrives' ? t.offsetDays : 'od'}`,
      dateValue: f.dateValue,
    }),
  ];
}

/**
 * Call when an item is created, deleted/archived, or its date changes. Cheap: a write or delete
 * per scheduled automation on the board (usually none).
 */
export function planItemSchedule(
  input: Ctx & { automations: readonly Automation[]; item: SchedItem },
): WriteOp[] {
  return input.automations
    .filter(isScheduledAutomation)
    .flatMap((a) => itemEvents(input, a, input.item));
}

/**
 * Call when an automation is created, edited, switched on/off or deleted: brings its events in
 * line for every item (or removes them all when it is off/deleted).
 */
export function planAutomationSchedule(
  input: Ctx & { automation: Automation | null; automationId: string; items: readonly SchedItem[] },
): WriteOp[] {
  const a = input.automation;
  const removeAll = (): WriteOp[] => [
    del(input, input.automationId, null),
    ...input.items.map((i) => del(input, input.automationId, i.id)),
  ];
  if (!a || !a.enabled || !isScheduledAutomation(a)) return removeAll();
  const t = a.trigger;
  if (t.type === 'recurring') {
    const at = nextOccurrence(t.schedule, input.nowMs, input.tz);
    if (at === null) return removeAll();
    return [
      // item-scoped events from an earlier version of this automation no longer apply
      ...input.items.map((i) => del(input, a.id, i.id)),
      put(input, {
        kind: 'recurring',
        automationId: a.id,
        itemId: null,
        boardId: input.bid,
        fireAt: new Date(at),
        status: 'pending',
        attempts: 0,
        idempotencyKey: `${a.id}:${at}`,
        dateValue: null,
      }),
    ];
  }
  return [del(input, a.id, null), ...input.items.flatMap((i) => itemEvents(input, a, i))];
}

export type { Ctx as ScheduleContext };
