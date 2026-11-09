import {
  MAX_CREATED,
  MAX_DEPTH,
  MAX_NOTIFY,
  TOKEN_ME,
  TOKEN_TODAY,
  type Action,
  type Automation,
} from './automations';
import { buildItemDoc, boardPaths } from './boardOps';
import type { Group } from './board';
import {
  computeAssignees,
  defaultItemValues,
  isComputedType,
  normalizeValue,
  type Column,
} from './columns';
import type { ItemLike } from './itemLike';
import { DELETE_FIELD, SERVER_TIME, type DocData, type WriteOp } from './ops';
import { keyBetween } from './ordering';
import { itemLink, notificationOp } from './updates';
import { matchesFilter } from './viewConfig';

export interface EngineItem extends ItemLike {
  assigneeUids?: string[];
}

/** What just happened (the caller has already applied it to `items`). */
export type AutoEvent =
  | { kind: 'created'; itemId: string }
  | { kind: 'cell'; itemId: string; columnId: string; before: unknown; after: unknown }
  | { kind: 'moved'; itemId: string; fromGroupId: string; toGroupId: string };

export interface RunRecord {
  automationId: string;
  name: string;
  status: 'ok' | 'skipped' | 'failed';
  error?: string;
  itemId: string | null;
  depth: number;
}

export interface EngineInput {
  wid: string;
  bid: string;
  boardName: string;
  event: AutoEvent;
  /** Every item on the board *after* the change that caused the event. */
  items: ReadonlyMap<string, EngineItem>;
  columns: readonly Column[];
  groups: readonly Group[];
  automations: readonly Automation[];
  /** The person whose edit started this; their permissions apply (it runs in their browser). */
  actor: string;
  memberUids: ReadonlySet<string>;
  memberName: (uid: string) => string;
  today: string;
  /** The board counter's `next`, or null if unknown (then item-creating actions fail). */
  startNumber: number | null;
  newId: (kind: 'item' | 'run' | 'notification') => string;
  maxDepth?: number;
}

export interface EngineResult {
  /** Writes to add to the same batch as the original change. */
  ops: WriteOp[];
  runs: RunRecord[];
  /** How many items automations created. */
  created: number;
  /** The counter value to store afterwards (null if nothing was numbered). */
  counterNext: number | null;
}

interface Work extends EngineItem {
  assigneeUids?: string[];
}

interface Patch {
  values: Record<string, unknown>; // value or DELETE_FIELD
  groupId?: string;
  order?: string;
  archived?: boolean;
  peopleTouched: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Who was added to a people value. */
function addedPeople(before: unknown, after: unknown): string[] {
  const had = new Set(Array.isArray(before) ? (before as string[]) : []);
  return (Array.isArray(after) ? (after as string[]) : []).filter((u) => !had.has(u));
}

interface Queued {
  event: AutoEvent;
  depth: number;
  chain: readonly string[];
}

export function runAutomations(input: EngineInput): EngineResult {
  const maxDepth = input.maxDepth ?? MAX_DEPTH;
  const { columns, groups, actor } = input;
  const working = new Map<string, Work>();
  for (const [id, it] of input.items) working.set(id, it);
  const cloned = new Set<string>();
  const patches = new Map<string, Patch>();
  const createdIds: string[] = [];
  const notifyOps: WriteOp[] = [];
  const runs: RunRecord[] = [];
  const skippedOnce = new Set<string>();
  let counter = input.startNumber;

  const editable = (id: string): Work => {
    const it = working.get(id) as Work;
    if (!cloned.has(id)) {
      working.set(id, { ...it, values: { ...it.values } });
      cloned.add(id);
    }
    return working.get(id) as Work;
  };
  const patchOf = (id: string): Patch => {
    let p = patches.get(id);
    if (!p) {
      p = { values: {}, peopleTouched: false };
      patches.set(id, p);
    }
    return p;
  };
  const col = (id: string) => columns.find((c) => c.id === id);
  const live = (it: Work) => !it.deleted;

  const maxOrder = (pred: (it: Work) => boolean): string | null => {
    let m: string | null = null;
    for (const it of working.values())
      if (live(it) && pred(it) && (m === null || it.order > m)) m = it.order;
    return m;
  };

  // --------------------------------------------------------------- trigger matching

  /** The item the automation should act on, or null if it doesn't fire for this event. */
  const targetOf = (a: Automation, ev: AutoEvent): string | null => {
    const t = a.trigger;
    switch (t.type) {
      case 'itemCreated':
        return ev.kind === 'created' ? ev.itemId : null;
      case 'columnChanged':
        return ev.kind === 'cell' && (t.columnId === null || ev.columnId === t.columnId)
          ? ev.itemId
          : null;
      case 'statusChangedTo': {
        if (ev.kind !== 'cell' || ev.columnId !== t.columnId) return null;
        const c = col(t.columnId);
        if (!c || c.type !== 'status') return null;
        return normalizeValue(c, ev.after) === t.labelId && !same(ev.before, ev.after)
          ? ev.itemId
          : null;
      }
      case 'personAssigned': {
        if (ev.kind !== 'cell') return null;
        const c = col(ev.columnId);
        if (!c || c.type !== 'people') return null;
        if (t.columnId !== null && ev.columnId !== t.columnId) return null;
        const added = addedPeople(ev.before, ev.after);
        return added.length > 0 && (t.uid === null || added.includes(t.uid)) ? ev.itemId : null;
      }
      case 'movedToGroup':
        return ev.kind === 'moved' && ev.toGroupId === t.groupId ? ev.itemId : null;
      case 'subitemsAllDone': {
        if (ev.kind !== 'cell' || ev.columnId !== t.columnId) return null;
        const sub = working.get(ev.itemId);
        const c = col(t.columnId);
        if (!sub || !sub.parentId || !c || c.type !== 'status') return null;
        if (normalizeValue(c, ev.after) !== t.labelId) return null;
        const siblings = [...working.values()].filter(
          (x) => x.parentId === sub.parentId && live(x) && !x.archived,
        );
        const done =
          siblings.length > 0 &&
          siblings.every((x) => normalizeValue(c, x.values[c.id]) === t.labelId);
        return done ? sub.parentId : null;
      }
    }
  };

  // ---------------------------------------------------------------- validation

  /** Static problems that would make an automation fail; nothing is applied if any. */
  const problem = (a: Automation, target: Work): string | null => {
    let creates = 0;
    for (const act of a.actions) {
      switch (act.type) {
        case 'setValue': {
          const c = col(act.columnId);
          if (!c) return 'A column it sets was deleted.';
          if (isComputedType(c.type)) return `${c.title} is calculated, so it can’t be set.`;
          if (act.value === TOKEN_ME && c.type !== 'people')
            return `“The person who made the change” only fits a People column.`;
          if (act.value === TOKEN_TODAY && c.type !== 'date')
            return `“Today” only fits a Date column.`;
          break;
        }
        case 'moveToGroup':
          if (!groups.some((g) => g.id === act.groupId))
            return 'The group it moves to was deleted.';
          if (target.parentId) return 'Subitems can’t be moved to another group.';
          break;
        case 'createItem':
          creates++;
          if (act.subitem && target.parentId) return 'A subitem can’t have subitems.';
          if (act.groupId && !groups.some((g) => g.id === act.groupId))
            return 'The group for the new item was deleted.';
          break;
        case 'duplicate':
          creates++;
          break;
        default:
          break;
      }
    }
    if (creates > 0) {
      if (counter === null) return 'Creating items needs a connection to number them.';
      if (createdIds.length + creates > MAX_CREATED)
        return `Automations can create at most ${MAX_CREATED} items per change.`;
    }
    return null;
  };

  // ------------------------------------------------------------------ actions

  const queue: Queued[] = [{ event: input.event, depth: 0, chain: [] }];
  const emit = (event: AutoEvent, q: Queued, automationId: string) =>
    queue.push({ event, depth: q.depth + 1, chain: [...q.chain, automationId] });

  const apply = (a: Automation, act: Action, targetId: string, q: Queued) => {
    const target = editable(targetId);
    switch (act.type) {
      case 'setValue': {
        const c = col(act.columnId) as Column;
        const raw =
          act.value === TOKEN_ME ? [actor] : act.value === TOKEN_TODAY ? input.today : act.value;
        const next = normalizeValue(c, raw);
        const before = normalizeValue(c, target.values[c.id]);
        if (same(before, next)) return;
        if (next === null) delete target.values[c.id];
        else target.values[c.id] = next;
        patchOf(targetId).values[c.id] = next === null ? DELETE_FIELD : next;
        if (c.type === 'people') {
          patchOf(targetId).peopleTouched = true;
          target.assigneeUids = computeAssignees(columns, target.values);
        }
        emit({ kind: 'cell', itemId: targetId, columnId: c.id, before, after: next }, q, a.id);
        return;
      }
      case 'moveToGroup': {
        if (target.groupId === act.groupId) return;
        const from = target.groupId;
        const order = keyBetween(
          maxOrder((x) => !x.parentId && x.groupId === act.groupId),
          null,
        );
        target.groupId = act.groupId;
        target.order = order;
        const p = patchOf(targetId);
        p.groupId = act.groupId;
        p.order = order;
        for (const child of [...working.values()]) {
          if (child.parentId === targetId && child.groupId !== act.groupId) {
            editable(child.id).groupId = act.groupId;
            patchOf(child.id).groupId = act.groupId;
          }
        }
        emit(
          { kind: 'moved', itemId: targetId, fromGroupId: from, toGroupId: act.groupId },
          q,
          a.id,
        );
        return;
      }
      case 'createItem':
      case 'duplicate': {
        const isDup = act.type === 'duplicate';
        const parentId = isDup ? target.parentId : act.subitem ? targetId : null;
        const groupId = isDup ? target.groupId : (act.groupId ?? target.groupId);
        const name = isDup
          ? `${target.name} (copy)`
          : act.name.replaceAll('{item}', target.name).slice(0, 500);
        const values = isDup ? { ...target.values } : { ...defaultItemValues(columns) };
        const id = input.newId('item');
        const order = keyBetween(
          maxOrder((x) =>
            parentId ? x.parentId === parentId : !x.parentId && x.groupId === groupId,
          ),
          null,
        );
        const itemNumber = counter as number;
        counter = itemNumber + 1;
        working.set(id, {
          id,
          name,
          groupId,
          order,
          parentId,
          itemNumber,
          values,
          archived: false,
          deleted: false,
          assigneeUids: computeAssignees(columns, values),
        });
        cloned.add(id);
        createdIds.push(id);
        emit({ kind: 'created', itemId: id }, q, a.id);
        return;
      }
      case 'archive': {
        if (target.archived) return;
        target.archived = true;
        patchOf(targetId).archived = true;
        for (const child of [...working.values()]) {
          if (child.parentId === targetId && !child.archived) {
            editable(child.id).archived = true;
            patchOf(child.id).archived = true;
          }
        }
        return;
      }
      case 'notify': {
        const who =
          act.to === 'assignees'
            ? computeAssignees(columns, target.values)
            : act.to === 'owner'
              ? [a.ownerUid]
              : act.to === 'actor'
                ? [actor]
                : [act.uid ?? ''];
        const ids = [...new Set(who)]
          .filter((u) => u && input.memberUids.has(u))
          .slice(0, MAX_NOTIFY);
        for (const r of ids)
          notifyOps.push(
            notificationOp({
              wid: input.wid,
              recipient: r,
              nid: input.newId('notification'),
              actor,
              type: 'automation',
              title: act.message.replaceAll('{item}', target.name || 'an item'),
              body: `${input.boardName} · ${a.name}`,
              link: itemLink(input.wid, input.bid, targetId),
            }),
          );
        return;
      }
    }
  };

  const ctx = { today: input.today, me: actor, memberName: input.memberName };

  while (queue.length > 0) {
    const q = queue.shift() as Queued;
    for (const a of input.automations) {
      if (!a.enabled) continue;
      const targetId = targetOf(a, q.event);
      if (!targetId) continue;
      const target = working.get(targetId);
      if (!target || !live(target)) continue;
      if (!a.conditions.every((f) => matchesFilter(target, columns, f, ctx))) continue;

      // Loop guard: an automation never runs twice in one chain of cause and effect, and
      // chains stop at a fixed depth.
      const guard = q.chain.includes(a.id)
        ? 'Skipped: it would run itself again (loop guard).'
        : q.depth >= maxDepth
          ? `Skipped: automations triggering automations stop after ${maxDepth} levels.`
          : null;
      if (guard) {
        const k = `${a.id}|${guard}`;
        if (!skippedOnce.has(k)) {
          skippedOnce.add(k);
          runs.push({
            automationId: a.id,
            name: a.name,
            status: 'skipped',
            error: guard,
            itemId: targetId,
            depth: q.depth,
          });
        }
        continue;
      }

      const bad = problem(a, target);
      if (bad) {
        runs.push({
          automationId: a.id,
          name: a.name,
          status: 'failed',
          error: bad,
          itemId: targetId,
          depth: q.depth,
        });
        continue;
      }
      for (const act of a.actions) apply(a, act, targetId, q);
      runs.push({
        automationId: a.id,
        name: a.name,
        status: 'ok',
        itemId: targetId,
        depth: q.depth,
      });
    }
  }

  // ------------------------------------------------------------------ writes
  const ops: WriteOp[] = [];
  const stamp: DocData = { updatedBy: actor, updatedAt: SERVER_TIME };
  for (const [id, p] of patches) {
    if (createdIds.includes(id)) continue; // written whole below
    const data: DocData = { ...stamp };
    for (const [cid, v] of Object.entries(p.values)) data[`values.${cid}`] = v;
    const w = working.get(id) as Work;
    if (p.peopleTouched) data['assigneeUids'] = computeAssignees(columns, w.values);
    if (p.groupId !== undefined) data['groupId'] = p.groupId;
    if (p.order !== undefined) data['order'] = p.order;
    if (p.archived !== undefined) data['archived'] = p.archived;
    ops.push({ kind: 'update', path: boardPaths.item(input.wid, input.bid, id), data });
  }
  for (const id of createdIds) {
    const w = working.get(id) as Work;
    ops.push({
      kind: 'set',
      path: boardPaths.item(input.wid, input.bid, id),
      data: buildItemDoc(actor, columns, {
        name: w.name,
        groupId: w.groupId,
        order: w.order,
        itemNumber: w.itemNumber,
        parentId: w.parentId,
        values: w.values,
      }),
    });
  }
  ops.push(...notifyOps);
  for (const r of runs) {
    ops.push({
      kind: 'set',
      path: `${boardPaths.runs(input.wid, input.bid)}/${input.newId('run')}`,
      data: {
        automationId: r.automationId,
        name: r.name.slice(0, 120),
        status: r.status,
        ...(r.error ? { error: r.error.slice(0, 300) } : {}),
        itemId: r.itemId,
        depth: r.depth,
        actor,
        at: SERVER_TIME,
      },
    });
  }
  return {
    ops,
    runs,
    created: createdIds.length,
    counterNext: createdIds.length > 0 ? counter : null,
  };
}

/**
 * Replaces the counter write inside `ops` (from planCreateItem) with a single final one, so
 * the counter doc is written once per batch however many items were numbered.
 */
export function withFinalCounter(
  ops: readonly WriteOp[],
  wid: string,
  bid: string,
  counterExists: boolean,
  next: number,
): WriteOp[] {
  const path = boardPaths.counter(wid, bid);
  return [
    ...ops.filter((o) => o.path !== path),
    { kind: counterExists ? 'update' : 'set', path, data: { next } },
  ];
}
