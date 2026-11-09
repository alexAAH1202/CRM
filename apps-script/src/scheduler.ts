import {
  boardPaths,
  DEFAULT_TIMEZONE,
  isDone,
  isScheduledAutomation,
  itemFireAt,
  localDateIn,
  nextOccurrence,
  parseAutomation,
  planActivity,
  planAutomationSchedule,
  runAutomations,
  SERVER_TIME,
  HelperError,
  type Automation,
  type Column,
  type EngineItem,
  type Group,
  type RunRecord,
  type WriteOp,
} from '@app/shared';
import { FirestoreClient, PreconditionFailed, type Doc, type Precondition } from './firestore';
import type { Platform } from './platform';

/** A run stops starting new events after this long, so it always finishes inside Apps Script's 6 minutes. */
export const RUN_BUDGET_MS = 4 * 60 * 1000;
export const MAX_EVENTS_PER_RUN = 100;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 10 * 60 * 1000;
const MAX_ITEMS_PER_BOARD = 600;
const MAX_TARGETS_PER_FIRE = 100;
const HOUR = 3600 * 1000;

export interface RunSummary {
  due: number;
  processed: number;
  fired: number;
  skipped: number;
  failed: number;
  retried: number;
  /** Events still due that this run didn't get to (out of time or over the cap). */
  deferred: number;
}

interface ParsedEvent {
  doc: Doc;
  wid: string;
  bid: string;
  eid: string;
  kind: string;
  automationId: string;
  itemId: string | null;
  fireAt: number;
  attempts: number;
  dateValue: string | null;
}

interface BoardState {
  wid: string;
  bid: string;
  tz: string;
  boardName: string;
  columns: Column[];
  groups: Group[];
  automations: Automation[];
  memberUids: Set<string>;
  names: Map<string, string>;
  items: Map<string, EngineItem> | null;
}

const EVENT_PATH = /^workspaces\/([^/]+)\/boards\/([^/]+)\/scheduledEvents\/([^/]+)$/;

function parseEvent(doc: Doc): ParsedEvent | null {
  const m = EVENT_PATH.exec(doc.path);
  if (!m) return null;
  const d = doc.data;
  const fireAt = d['fireAt'] instanceof Date ? d['fireAt'].getTime() : NaN;
  if (typeof d['automationId'] !== 'string' || !Number.isFinite(fireAt)) return null;
  return {
    doc,
    wid: m[1] as string,
    bid: m[2] as string,
    eid: m[3] as string,
    kind: String(d['kind'] ?? ''),
    automationId: d['automationId'],
    itemId: typeof d['itemId'] === 'string' ? d['itemId'] : null,
    fireAt,
    attempts: typeof d['attempts'] === 'number' ? d['attempts'] : 0,
    dateValue: typeof d['dateValue'] === 'string' ? d['dateValue'] : null,
  };
}

function toEngineItem(doc: Doc): EngineItem {
  const d = doc.data;
  return {
    id: doc.id,
    name: String(d['name'] ?? ''),
    groupId: String(d['groupId'] ?? ''),
    order: String(d['order'] ?? 'a0'),
    parentId: typeof d['parentId'] === 'string' ? d['parentId'] : null,
    itemNumber: typeof d['itemNumber'] === 'number' ? d['itemNumber'] : 0,
    values: (d['values'] && typeof d['values'] === 'object' ? d['values'] : {}) as Record<
      string,
      unknown
    >,
    archived: d['archived'] === true,
    deleted: d['deletedAt'] != null,
    assigneeUids: Array.isArray(d['assigneeUids']) ? (d['assigneeUids'] as string[]) : [],
  };
}

function loadBoard(db: FirestoreClient, wid: string, bid: string): BoardState | null {
  const ws = db.getDoc(`workspaces/${wid}`);
  const board = db.getDoc(`workspaces/${wid}/boards/${bid}`);
  if (!ws || !board) return null;
  const settings = (ws.data['settings'] ?? {}) as Record<string, unknown>;
  const members = db.query({ collection: 'members', parent: `workspaces/${wid}`, limit: 200 });
  const automations = db
    .query({ collection: 'automations', parent: `workspaces/${wid}/boards/${bid}`, limit: 50 })
    .map((d) => parseAutomation(d.id, d.data))
    .filter((a): a is Automation => a !== null);
  return {
    wid,
    bid,
    tz: typeof settings['timezone'] === 'string' ? settings['timezone'] : DEFAULT_TIMEZONE,
    boardName: String(board.data['name'] ?? 'Board'),
    columns: (Array.isArray(board.data['columns']) ? board.data['columns'] : []) as Column[],
    groups: (Array.isArray(board.data['groups']) ? board.data['groups'] : []) as Group[],
    automations,
    memberUids: new Set(members.map((m) => m.id)),
    names: new Map(members.map((m) => [m.id, String(m.data['displayName'] ?? m.id)])),
    items: null,
  };
}

function itemsOf(db: FirestoreClient, b: BoardState): Map<string, EngineItem> {
  if (!b.items) {
    b.items = new Map(
      db
        .query({
          collection: 'items',
          parent: `workspaces/${b.wid}/boards/${b.bid}`,
          limit: MAX_ITEMS_PER_BOARD,
        })
        .map((d) => [d.id, toEngineItem(d)]),
    );
  }
  return b.items;
}

// ---------------------------------------------------------------------------------------------

type Outcome = 'fired' | 'skipped' | 'failed' | 'retried' | 'conflict';

/**
 * Runs everything that is due. Safe to run twice at once or to be cut off half way: each event is
 * handled in one atomic commit that also marks it done *only if nobody else changed it since it
 * was read*, so a repeat can't fire it twice, and anything left over is simply due next time.
 */
export function runDueEvents(
  p: Platform,
  opts: { budgetMs?: number; limit?: number } = {},
): RunSummary {
  const started = p.nowMs();
  const deadline = started + (opts.budgetMs ?? RUN_BUDGET_MS);
  const db = new FirestoreClient(p, p.prop('FIREBASE_PROJECT_ID') ?? 'life-management-de315');
  const limit = opts.limit ?? MAX_EVENTS_PER_RUN;
  const sum: RunSummary = {
    due: 0,
    processed: 0,
    fired: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
    deferred: 0,
  };

  const docs = db.query({
    collection: 'scheduledEvents',
    group: true,
    where: [
      { field: 'status', op: 'EQUAL', value: 'pending' },
      { field: 'fireAt', op: 'LESS_THAN_OR_EQUAL', value: new Date(started) },
    ],
    orderBy: [{ field: 'fireAt' }],
    limit,
  });
  sum.due = docs.length;
  if (docs.length === 0) return sum; // early exit: the common case costs one query

  const boards = new Map<string, BoardState | null>();
  for (const doc of docs) {
    if (p.nowMs() >= deadline) {
      sum.deferred = docs.length - sum.processed;
      p.log(`Scheduler out of time: ${sum.deferred} event(s) left for the next run.`);
      break;
    }
    const ev = parseEvent(doc);
    sum.processed++;
    if (!ev) {
      p.log(`Ignoring malformed event ${doc.path}`);
      sum.skipped++;
      continue;
    }
    const key = `${ev.wid}/${ev.bid}`;
    if (!boards.has(key)) {
      try {
        boards.set(key, loadBoard(db, ev.wid, ev.bid));
      } catch (e) {
        p.log(`Could not load ${key}: ${e instanceof Error ? e.message : String(e)}`);
        boards.set(key, null);
      }
    }
    const board = boards.get(key) ?? null;
    let outcome: Outcome;
    try {
      outcome = board ? processEvent(p, db, board, ev) : dropEvent(db, ev);
    } catch (e) {
      outcome = recordTransientFailure(p, db, ev, e);
    }
    if (outcome === 'conflict') outcome = 'skipped';
    sum[outcome === 'fired' ? 'fired' : outcome]++;
  }
  return sum;
}

/** The board or workspace is gone: nothing to do, remove the event. */
function dropEvent(db: FirestoreClient, ev: ParsedEvent): Outcome {
  safeCommit(
    db,
    [{ kind: 'delete', path: ev.doc.path }],
    new Map([[ev.doc.path, { updateTime: ev.doc.updateTime ?? undefined }]]),
  );
  return 'skipped';
}

function safeCommit(
  db: FirestoreClient,
  ops: WriteOp[],
  pre?: ReadonlyMap<string, Precondition>,
): boolean {
  try {
    db.commit(ops, pre);
    return true;
  } catch (e) {
    if (e instanceof PreconditionFailed) return false;
    throw e;
  }
}

function recordTransientFailure(
  p: Platform,
  db: FirestoreClient,
  ev: ParsedEvent,
  err: unknown,
): Outcome {
  const attempts = ev.attempts + 1;
  const message = (
    err instanceof HelperError ? err.message : err instanceof Error ? err.message : String(err)
  ).slice(0, 300);
  p.log(`Event ${ev.doc.path} failed (attempt ${attempts}): ${message}`);
  const giveUp = attempts >= MAX_ATTEMPTS;
  try {
    safeCommit(
      db,
      [
        {
          kind: 'update',
          path: ev.doc.path,
          data: {
            attempts,
            lastError: message,
            status: giveUp ? 'failed' : 'pending',
            ...(giveUp ? {} : { fireAt: new Date(p.nowMs() + RETRY_DELAY_MS * attempts) }),
            updatedAt: SERVER_TIME,
          },
        },
      ],
      new Map([[ev.doc.path, { updateTime: ev.doc.updateTime ?? undefined }]]),
    );
  } catch (e) {
    p.log(
      `Could not record the failure for ${ev.doc.path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return giveUp ? 'failed' : 'retried';
}

// ---------------------------------------------------------------------------------------------

function processEvent(p: Platform, db: FirestoreClient, b: BoardState, ev: ParsedEvent): Outcome {
  const auto = b.automations.find((a) => a.id === ev.automationId);
  const pre = new Map<string, Precondition>([
    [ev.doc.path, { updateTime: ev.doc.updateTime ?? undefined }],
  ]);
  const remove = (): Outcome =>
    safeCommit(db, [{ kind: 'delete', path: ev.doc.path }], pre) ? 'skipped' : 'conflict';

  // The automation was deleted, switched off, or changed to something that isn't scheduled.
  if (!auto || !auto.enabled || !isScheduledAutomation(auto)) return remove();
  const t = auto.trigger;
  const now = p.nowMs();

  // ---- which item(s) does this fire for?
  let targets: Array<string | null>;
  if (t.type === 'recurring') {
    if (t.scope === 'board') targets = [null];
    else {
      const all = itemsOf(db, b);
      targets = [...all.values()]
        .filter((i) => !i.deleted && !i.archived)
        .map((i) => i.id)
        .slice(0, MAX_TARGETS_PER_FIRE);
    }
  } else {
    if ((t.type !== 'dateArrives' && t.type !== 'overdue') || !ev.itemId) return remove();
    const item = itemsOf(db, b).get(ev.itemId);
    if (!item || item.deleted || item.archived) return remove();
    const f = itemFireAt(t, item, b.columns, b.tz);
    // The date changed (or went) since this event was registered: put it right instead of firing.
    if (!f || f.dateValue !== ev.dateValue) {
      if (f && f.fireAt >= now - 6 * HOUR) {
        const moved: WriteOp = {
          kind: 'update',
          path: ev.doc.path,
          data: { fireAt: new Date(f.fireAt), dateValue: f.dateValue, updatedAt: SERVER_TIME },
        };
        return safeCommit(db, [moved], pre) ? 'skipped' : 'conflict';
      }
      return remove();
    }
    if (t.type === 'overdue' && isDone(b.columns, item.values)) return remove();
    targets = [ev.itemId];
  }

  // ---- run the actions (retrying if the board counter moves under us)
  for (let attempt = 0; attempt < 3; attempt++) {
    const counterDoc = db.getDoc(boardPaths.counter(b.wid, b.bid));
    const counterNow =
      typeof counterDoc?.data['next'] === 'number' ? (counterDoc.data['next'] as number) : 1;
    const preconditions = new Map(pre);
    preconditions.set(
      boardPaths.counter(b.wid, b.bid),
      counterDoc ? { updateTime: counterDoc.updateTime ?? undefined } : { exists: false },
    );

    let counter = counterNow;
    let state: ReadonlyMap<string, EngineItem> = itemsOf(db, b);
    const ops: WriteOp[] = [];
    const runs: RunRecord[] = [];
    for (const target of targets) {
      const r = runAutomations({
        wid: b.wid,
        bid: b.bid,
        boardName: b.boardName,
        event: { kind: 'scheduled', automationId: auto.id, itemId: target },
        items: state,
        columns: b.columns,
        groups: b.groups,
        automations: b.automations,
        actor: auto.ownerUid,
        memberUids: b.memberUids,
        memberName: (u) => b.names.get(u) ?? 'Former member',
        today: localDateIn(now, b.tz),
        startNumber: counter,
        newId: () => p.uuid(),
      });
      ops.push(...r.ops);
      runs.push(...r.runs);
      state = r.items;
      if (r.counterNext !== null) counter = r.counterNext;
      for (const run of r.runs)
        if (run.status === 'ok' && run.automationId === auto.id)
          ops.push(
            planActivity({
              wid: b.wid,
              bid: b.bid,
              id: p.uuid(),
              actor: auto.ownerUid,
              type: 'automation',
              itemId: run.itemId && run.itemId !== '' ? run.itemId : null,
              itemName: run.itemId ? (state.get(run.itemId)?.name ?? '') : '',
              data: { text: `Automation “${auto.name}” ran` },
            }),
          );
    }
    if (counter !== counterNow)
      ops.push({
        kind: counterDoc ? 'update' : 'set',
        path: boardPaths.counter(b.wid, b.bid),
        data: { next: counter },
      });

    const mine = runs.filter((r) => r.automationId === auto.id);
    const failedRun = mine.find((r) => r.status === 'failed');
    const nothingRan = mine.length === 0; // e.g. conditions didn't match any item: not an error

    // ---- what happens to the event itself
    if (t.type === 'recurring') {
      const next = nextOccurrence(t.schedule, Math.max(now, ev.fireAt), b.tz);
      ops.push(
        next === null
          ? {
              kind: 'update',
              path: ev.doc.path,
              data: { status: 'done', attempts: 0, doneAt: SERVER_TIME, updatedAt: SERVER_TIME },
            }
          : {
              kind: 'update',
              path: ev.doc.path,
              data: {
                status: 'pending',
                attempts: 0,
                fireAt: new Date(next),
                idempotencyKey: `${auto.id}:${next}`,
                lastRunAt: SERVER_TIME,
                ...(failedRun?.error ? { lastError: failedRun.error.slice(0, 300) } : {}),
                updatedAt: SERVER_TIME,
              },
            },
      );
    } else {
      ops.push({
        kind: 'update',
        path: ev.doc.path,
        data: {
          status: failedRun ? 'failed' : 'done',
          attempts: ev.attempts + 1,
          doneAt: SERVER_TIME,
          ...(failedRun?.error ? { lastError: failedRun.error.slice(0, 300) } : {}),
          updatedAt: SERVER_TIME,
        },
      });
    }

    try {
      db.commit(ops, preconditions);
    } catch (e) {
      if (!(e instanceof PreconditionFailed)) throw e;
      // Either someone else already handled this event (then we're done), or the counter moved (try again).
      const fresh = db.getDoc(ev.doc.path);
      if (!fresh || fresh.updateTime !== ev.doc.updateTime || fresh.data['status'] !== 'pending')
        return 'conflict';
      b.items = null; // re-read the board next time round
      continue;
    }
    // keep our in-memory copy of the board current for later events in this run
    b.items = new Map(state);
    return failedRun ? 'failed' : nothingRan ? 'skipped' : 'fired';
  }
  throw new HelperError('unavailable', 'The board was busy; will retry.');
}

// ---------------------------------------------------------------------------------------------
// Self-healing: rebuild the whole queue from the data.
// ---------------------------------------------------------------------------------------------

export interface RebuildSummary {
  boards: number;
  automations: number;
  registered: number;
  removed: number;
}

/**
 * "Rebuild schedule": for every board in the workspace, recompute every scheduled automation's
 * events from the current items, and delete events that no longer belong to anything. Reads each
 * board's items once; meant to be run by an admin when something looks off, not routinely.
 */
export function rebuildSchedule(
  p: Platform,
  db: FirestoreClient,
  workspaceId: string,
): RebuildSummary {
  const ws = db.getDoc(`workspaces/${workspaceId}`);
  if (!ws) throw new HelperError('not_found', 'Workspace not found.');
  const tz =
    typeof (ws.data['settings'] as Record<string, unknown> | undefined)?.['timezone'] === 'string'
      ? ((ws.data['settings'] as Record<string, unknown>)['timezone'] as string)
      : DEFAULT_TIMEZONE;
  const out: RebuildSummary = { boards: 0, automations: 0, registered: 0, removed: 0 };
  const boards = db.query({
    collection: 'boards',
    parent: `workspaces/${workspaceId}`,
    limit: 100,
  });
  for (const bd of boards) {
    out.boards++;
    const bid = bd.id;
    const parent = `workspaces/${workspaceId}/boards/${bid}`;
    const columns = (Array.isArray(bd.data['columns']) ? bd.data['columns'] : []) as Column[];
    const automations = db
      .query({ collection: 'automations', parent, limit: 50 })
      .map((d) => parseAutomation(d.id, d.data))
      .filter((a): a is Automation => a !== null);
    const items = db
      .query({ collection: 'items', parent, limit: MAX_ITEMS_PER_BOARD })
      .map(toEngineItem);
    const existing = db.query({ collection: 'scheduledEvents', parent, limit: 1000 });
    const wanted = new Set<string>();
    const ops: WriteOp[] = [];
    for (const a of automations.filter((x) => x.enabled && isScheduledAutomation(x))) {
      out.automations++;
      for (const op of planAutomationSchedule({
        wid: workspaceId,
        bid,
        columns,
        tz,
        nowMs: p.nowMs(),
        automation: a,
        automationId: a.id,
        items,
      })) {
        if (op.kind === 'set') {
          wanted.add(op.path);
          ops.push(op);
          out.registered++;
        }
      }
    }
    for (const e of existing) {
      if (!wanted.has(e.path)) {
        ops.push({ kind: 'delete', path: e.path });
        out.removed++;
      }
    }
    if (ops.length) db.commit(ops);
  }
  return out;
}

export interface QueueStatus {
  pending: number;
  failed: number;
  nextDue: string | null;
  /** True when something is overdue by more than 30 minutes: the scheduler may not be running. */
  stalled: boolean;
}

export function queueStatus(p: Platform, db: FirestoreClient, workspaceId: string): QueueStatus {
  const boards = db.query({
    collection: 'boards',
    parent: `workspaces/${workspaceId}`,
    limit: 100,
  });
  let pending = 0;
  let failed = 0;
  let next: number | null = null;
  let stalled = false;
  const now = p.nowMs();
  for (const bd of boards) {
    for (const e of db.query({
      collection: 'scheduledEvents',
      parent: `workspaces/${workspaceId}/boards/${bd.id}`,
      limit: 500,
    })) {
      const ev = parseEvent(e);
      if (!ev) continue;
      if (e.data['status'] === 'failed') failed++;
      else if (e.data['status'] === 'pending') {
        pending++;
        if (next === null || ev.fireAt < next) next = ev.fireAt;
        if (ev.fireAt < now - 30 * 60 * 1000) stalled = true;
      }
    }
  }
  return { pending, failed, nextDue: next === null ? null : new Date(next).toISOString(), stalled };
}
