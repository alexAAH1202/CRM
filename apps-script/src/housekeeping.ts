/**
 * The nightly tidy-up. Keeps the database small (the free tier counts every stored byte and read)
 * by deleting what nobody can see any more: items deleted over a month ago, old activity, old
 * automation run history, and notifications that have been read (or are just very old).
 *
 * Safe to run twice, safe to stop half-way: every step deletes in small batches and a step that
 * fails (for example, an index is still building after a deploy) is recorded and the rest carry on.
 */
import { paths } from '@app/shared';
import type { WriteOp } from '@app/shared';
import type { Doc, FirestoreClient, Filter, QuerySpec } from './firestore';
import type { Platform } from './platform';

export const TOMBSTONE_DAYS = 30;
export const ACTIVITY_DAYS = 180;
export const RUN_HISTORY_DAYS = 30;
export const READ_NOTIFICATION_DAYS = 30;
export const ANY_NOTIFICATION_DAYS = 90;

const DAY = 86_400_000;
const BATCH = 200;
/** One step never deletes more than this in a night (a backlog is cleared over several nights). */
const MAX_PER_STEP = 2000;

export interface StepResult {
  name: string;
  deleted: number;
  /** Stopped early because of the time budget or the nightly cap (more to do tomorrow). */
  more: boolean;
  error?: string;
}

export interface HousekeepingReport {
  at: string;
  steps: StepResult[];
}

interface Ctx {
  p: Platform;
  db: FirestoreClient;
  deadline: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Deletes everything a query returns (a batch at a time), returning how many it removed. */
function purge(
  ctx: Ctx,
  spec: Omit<QuerySpec, 'limit'>,
  opts: { keep?: (d: Doc) => boolean; onDeleted?: (docs: Doc[]) => void } = {},
): { deleted: number; more: boolean } {
  let deleted = 0;
  for (;;) {
    if (ctx.p.nowMs() >= ctx.deadline) return { deleted, more: true };
    if (deleted >= MAX_PER_STEP) return { deleted, more: true };
    const docs = ctx.db.query({ ...spec, limit: BATCH });
    const doomed = opts.keep ? docs.filter((d) => !opts.keep!(d)) : docs;
    if (doomed.length > 0) {
      ctx.db.commit(doomed.map((d): WriteOp => ({ kind: 'delete', path: d.path })));
      opts.onDeleted?.(doomed);
      deleted += doomed.length;
    }
    // Fewer than a full batch (or nothing deletable in a full batch we are not allowed to remove).
    if (docs.length < BATCH) return { deleted, more: false };
    if (doomed.length === 0) return { deleted, more: false };
  }
}

const olderThan = (field: string, now: number, days: number): Filter => ({
  field,
  op: 'LESS_THAN_OR_EQUAL',
  value: new Date(now - days * DAY),
});

function step(ctx: Ctx, name: string, body: () => { deleted: number; more: boolean }): StepResult {
  try {
    return { name, ...body() };
  } catch (e) {
    ctx.p.log(`Housekeeping step “${name}” failed: ${errText(e)}`);
    return { name, deleted: 0, more: false, error: errText(e).slice(0, 200) };
  }
}

/** Items deleted over TOMBSTONE_DAYS ago, together with their update threads. */
function purgeTombstones(ctx: Ctx) {
  const now = ctx.p.nowMs();
  let threads = 0;
  const r = purge(
    ctx,
    {
      collection: 'items',
      group: true,
      where: [olderThan('deletedAt', now, TOMBSTONE_DAYS)],
    },
    {
      // Notifications also live in collections called "items": only ever touch board items.
      keep: (d) => !/^workspaces\/[^/]+\/boards\/[^/]+\/items\/[^/]+$/.test(d.path),
      onDeleted: (docs) => {
        for (const d of docs) {
          // A deleted document leaves its sub-collections behind; remove the comments too.
          for (let i = 0; i < 10; i++) {
            const updates = ctx.db.query({ parent: d.path, collection: 'updates', limit: BATCH });
            if (updates.length === 0) break;
            ctx.db.commit(updates.map((u): WriteOp => ({ kind: 'delete', path: u.path })));
            threads += updates.length;
          }
        }
      },
    },
  );
  return { deleted: r.deleted + threads, more: r.more };
}

function purgeNotifications(ctx: Ctx) {
  const now = ctx.p.nowMs();
  const workspaces = ctx.db.query({ collection: 'workspaces', limit: 100 });
  let deleted = 0;
  let more = false;
  for (const w of workspaces) {
    const members = ctx.db.query({
      parent: `workspaces/${w.id}`,
      collection: 'members',
      limit: 200,
    });
    for (const m of members) {
      const parent = paths.notifications(w.id, m.id).replace(/\/items$/, '');
      // Read ones after a month…
      const a = purge(
        ctx,
        {
          parent,
          collection: 'items',
          where: [olderThan('createdAt', now, READ_NOTIFICATION_DAYS)],
        },
        { keep: (d) => d.data['read'] !== true },
      );
      // …and anything at all after three months (unread ones nobody ever opened).
      const b = purge(ctx, {
        parent,
        collection: 'items',
        where: [olderThan('createdAt', now, ANY_NOTIFICATION_DAYS)],
      });
      deleted += a.deleted + b.deleted;
      more = more || a.more || b.more;
    }
  }
  return { deleted, more };
}

/** Runs every step. Never throws. */
export function runHousekeeping(
  p: Platform,
  db: FirestoreClient,
  opts: { budgetMs?: number } = {},
): HousekeepingReport {
  const ctx: Ctx = { p, db, deadline: p.nowMs() + (opts.budgetMs ?? 4 * 60_000) };
  const now = p.nowMs();
  const steps: StepResult[] = [
    step(ctx, 'deleted items', () => purgeTombstones(ctx)),
    step(ctx, 'activity log', () =>
      purge(ctx, {
        collection: 'activity',
        group: true,
        where: [olderThan('at', now, ACTIVITY_DAYS)],
      }),
    ),
    step(ctx, 'automation history', () =>
      purge(ctx, {
        collection: 'automationRuns',
        group: true,
        where: [olderThan('at', now, RUN_HISTORY_DAYS)],
      }),
    ),
    step(ctx, 'notifications', () => purgeNotifications(ctx)),
  ];
  return { at: new Date(now).toISOString(), steps };
}
