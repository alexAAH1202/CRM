import {
  needsNumbering,
  runAutomations,
  withFinalCounter,
  localDateIn,
  isScheduledAutomation,
  planAutomationSchedule,
  planItemSchedule,
  type SchedItem,
  type Automation,
  type AutoEvent,
  type EngineItem,
  type WriteOp,
} from '@app/shared';
import { toast } from '../../stores/toast';
import type { Board, BoardItem } from '../boards/types';

/**
 * What the open board makes available to the automation engine. Instant automations run in
 * the browser of whoever makes the change, so only the board that's open can fire them
 * (and only while the app is open: a limit we state in the UI).
 */
export interface BoardRuntime {
  wid: string;
  board: Board;
  automations: Automation[];
  items: ReadonlyMap<string, BoardItem>;
  memberUids: ReadonlySet<string>;
  memberName: (uid: string) => string;
  /** The workspace's time zone: scheduled automations fire on this clock. */
  tz: string;
}

let current: BoardRuntime | null = null;

export function setBoardRuntime(rt: BoardRuntime | null) {
  current = rt;
}

export function runtimeFor(bid: string): BoardRuntime | null {
  return current && current.board.id === bid ? current : null;
}

export function enabledAutomations(bid: string): Automation[] {
  return runtimeFor(bid)?.automations.filter((a) => a.enabled) ?? [];
}

export function usesNumbering(bid: string): boolean {
  return enabledAutomations(bid).some(needsNumbering);
}

export function toEngineItem(i: BoardItem): EngineItem {
  return i;
}

/**
 * Adds the writes automations want to make to the batch for the change `event`
 * (the caller has already applied the change to `itemsAfter`). Failures and skips are shown
 * to the user; the person's own edit is never blocked by an automation that can't run.
 */
export function addAutomationOps(input: {
  bid: string;
  actor: string;
  baseOps: WriteOp[];
  event: AutoEvent;
  itemsAfter: ReadonlyMap<string, EngineItem>;
  startNumber: number | null;
  counterExists: boolean;
}): WriteOp[] {
  const rt = runtimeFor(input.bid);
  const automations = enabledAutomations(input.bid);
  if (!rt || automations.length === 0) return input.baseOps;
  const newId = (kind: string) =>
    `${kind}${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  const result = runAutomations({
    wid: rt.wid,
    bid: input.bid,
    boardName: rt.board.name,
    event: input.event,
    items: input.itemsAfter,
    columns: rt.board.columns,
    groups: rt.board.groups,
    automations,
    actor: input.actor,
    memberUids: rt.memberUids,
    memberName: rt.memberName,
    today: localDateIn(Date.now(), rt.tz),
    startNumber: input.startNumber,
    newId: (kind) => newId(kind),
  });
  const failed = result.runs.filter((r) => r.status === 'failed');
  const skipped = result.runs.filter((r) => r.status === 'skipped');
  if (failed.length > 0)
    toast.error(
      `Automation “${failed[0]!.name}” couldn’t run: ${failed[0]!.error ?? 'unknown problem'}`,
    );
  else if (skipped.length > 0)
    toast.info(`Automation “${skipped[0]!.name}” was skipped: ${skipped[0]!.error ?? ''}`);
  if (result.ops.length === 0) return input.baseOps;
  const ops = [
    ...input.baseOps,
    ...result.ops,
    ...scheduleOpsForChanges(input.bid, input.itemsAfter, result.items),
  ];
  return result.counterNext !== null
    ? withFinalCounter(ops, rt.wid, input.bid, input.counterExists, result.counterNext)
    : ops;
}

/** Bulk edits fire automations only up to this many items (more would mean a flood of changes). */
export const MAX_BULK_AUTOMATION_ITEMS = 25;

/**
 * Like addAutomationOps, for several events caused by one bulk edit: each event sees the board as
 * the earlier events and their automations left it, items created along the way are numbered in
 * order, and the counter is written once.
 */
export function addAutomationOpsMany(input: {
  bid: string;
  actor: string;
  baseOps: WriteOp[];
  events: AutoEvent[];
  itemsAfter: ReadonlyMap<string, EngineItem>;
  startNumber: number | null;
  counterExists: boolean;
}): WriteOp[] {
  const rt = runtimeFor(input.bid);
  const automations = enabledAutomations(input.bid);
  if (!rt || automations.length === 0 || input.events.length === 0) return input.baseOps;
  const newId = (kind: string) =>
    `${kind}${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  let items = input.itemsAfter;
  let next = input.startNumber;
  let counterTouched = false;
  const ops = [...input.baseOps];
  let failed = 0;
  let skipped = 0;
  let firstProblem = '';
  for (const event of input.events) {
    const result = runAutomations({
      wid: rt.wid,
      bid: input.bid,
      boardName: rt.board.name,
      event,
      items,
      columns: rt.board.columns,
      groups: rt.board.groups,
      automations,
      actor: input.actor,
      memberUids: rt.memberUids,
      memberName: rt.memberName,
      today: localDateIn(Date.now(), rt.tz),
      startNumber: next,
      newId: (kind) => newId(kind),
    });
    for (const r of result.runs) {
      if (r.status === 'failed') failed++;
      else if (r.status === 'skipped') skipped++;
      else continue;
      if (!firstProblem) firstProblem = `“${r.name}”: ${r.error ?? 'unknown problem'}`;
    }
    ops.push(...result.ops);
    items = result.items;
    if (result.counterNext !== null) {
      next = result.counterNext;
      counterTouched = true;
    }
  }
  if (failed > 0)
    toast.error(
      `${failed} automation run${failed === 1 ? '' : 's'} couldn’t happen. First: ${firstProblem}`,
    );
  else if (skipped > 0)
    toast.info(
      `${skipped} automation run${skipped === 1 ? ' was' : 's were'} skipped. ${firstProblem}`,
    );
  ops.push(...scheduleOpsForChanges(input.bid, input.itemsAfter, items));
  return counterTouched && next !== null
    ? withFinalCounter(ops, rt.wid, input.bid, input.counterExists, next)
    : ops;
}

export { useBoardAutomationsRegistration } from './useAutomations';

// ------------------------------------------------------------------ scheduled automations

/**
 * Keeps the helper's schedule queue in step with an edit: adds the event writes for these items to
 * the same batch (see shared/scheduleOps.ts). Returns [] when the board has no scheduled automation,
 * which is almost always.
 */
export function scheduleOpsFor(bid: string, items: ReadonlyArray<SchedItem>): WriteOp[] {
  const rt = runtimeFor(bid);
  if (!rt || !rt.automations.some(isScheduledAutomation)) return [];
  return items.flatMap((item) =>
    planItemSchedule({
      wid: rt.wid,
      bid,
      columns: rt.board.columns,
      tz: rt.tz,
      nowMs: Date.now(),
      automations: rt.automations,
      item,
    }),
  );
}

/** Writes for an automation being created, changed, switched or removed (`automation` null = removed). */
export function scheduleOpsForAutomation(
  bid: string,
  automationId: string,
  automation: Automation | null,
): WriteOp[] {
  const rt = runtimeFor(bid);
  if (!rt) return [];
  const had = rt.automations.find((a) => a.id === automationId);
  // Nothing to do if neither the old nor the new version is scheduled.
  if (!(automation && isScheduledAutomation(automation)) && !(had && isScheduledAutomation(had)))
    return [];
  return planAutomationSchedule({
    wid: rt.wid,
    bid,
    columns: rt.board.columns,
    tz: rt.tz,
    nowMs: Date.now(),
    automation,
    automationId,
    items: [...rt.items.values()].map((i) => ({
      id: i.id,
      values: i.values,
      archived: i.archived,
      deleted: i.deleted,
    })),
  });
}

/**
 * Reminder-queue writes for items automations created or changed (the engine copies an item
 * before changing it, so a different object means it changed): their dates, or archiving.
 */
function scheduleOpsForChanges(
  bid: string,
  before: ReadonlyMap<string, EngineItem>,
  after: ReadonlyMap<string, EngineItem>,
): WriteOp[] {
  const changed: SchedItem[] = [];
  for (const [id, it] of after)
    if (id !== '' && before.get(id) !== it)
      changed.push({ id, values: it.values, archived: it.archived, deleted: it.deleted });
  return changed.length ? scheduleOpsFor(bid, changed) : [];
}
