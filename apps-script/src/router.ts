import { HelperError, type HelperActionName, type HelperResponse, type WhoAmI } from '@app/shared';
import { roleIn, verifyIdToken, type Caller, type Role } from './auth';
import { syncFolderSharing, uploadChunk, uploadStart } from './drive';
import { loadConfig, TIME_ZONE, VERSION, type HelperConfig } from './config';
import { FirestoreClient } from './firestore';
import type { Platform } from './platform';
import { queueStatus, rebuildSchedule } from './scheduler';

/** Requests bigger than this are refused (uploads are sent in chunks, later). */
export const MAX_REQUEST_CHARS = 2_000_000;

export interface Context {
  p: Platform;
  cfg: HelperConfig;
  db: FirestoreClient;
  caller: Caller | null;
  workspaceId: string | null;
  role: Role | null;
}

type Auth = 'none' | 'user' | 'member' | 'admin';

export interface Action {
  /** none = anyone; user = signed in; member/admin = needs `workspaceId` and that role (admin) or any role (member). */
  auth: Auth;
  /** member actions that change data should also set this so viewers are refused. */
  writes?: boolean;
  run(ctx: Context, req: Record<string, unknown>): unknown;
}

const actions: Record<string, Action> = {
  ping: {
    auth: 'none',
    run: () => ({ pong: true, at: new Date().toISOString(), version: VERSION }),
  },
  whoami: {
    auth: 'user',
    run: (ctx, req): WhoAmI => {
      const wid = typeof req['workspaceId'] === 'string' ? req['workspaceId'] : null;
      return {
        uid: (ctx.caller as Caller).uid,
        email: (ctx.caller as Caller).email,
        role: wid ? roleIn(ctx.db, (ctx.caller as Caller).uid, wid) : null,
        workspaceId: wid,
        version: VERSION,
        serverTime: new Date().toISOString(),
        config: { driveFolder: ctx.cfg.driveRootFolderId !== null, timeZone: TIME_ZONE },
      };
    },
  },
};

actions['rebuildSchedule'] = {
  auth: 'admin',
  writes: true,
  run: (ctx) => rebuildSchedule(ctx.p, ctx.db, ctx.workspaceId as string),
};
actions['schedulerStatus'] = {
  auth: 'admin',
  run: (ctx) => queueStatus(ctx.p, ctx.db, ctx.workspaceId as string),
};

actions['uploadStart'] = {
  auth: 'member',
  writes: true,
  run: (ctx, req) =>
    uploadStart(ctx.p, ctx.cfg, ctx.db, ctx.caller as Caller, ctx.workspaceId as string, req),
};
actions['uploadChunk'] = {
  auth: 'member',
  writes: true,
  run: (ctx, req) => uploadChunk(ctx.p, ctx.caller as Caller, ctx.workspaceId as string, req),
};
// Any member may ask for a sync (it only makes Drive match the members list, and is rate-limited),
// so a new joiner can get access without waiting for an admin.
actions['syncFolderSharing'] = {
  auth: 'member',
  run: (ctx) => syncFolderSharing(ctx.p, ctx.cfg, ctx.db, ctx.workspaceId as string),
};

/** Later phases add their actions here (scheduler tools, uploads, backup…). */
export function registerAction(name: string, action: Action) {
  actions[name] = action;
}

const ok = <T>(data: T): HelperResponse<T> => ({ ok: true, data });
const fail = (code: HelperError['code'], message: string): HelperResponse<never> => ({
  ok: false,
  error: { code, message },
});

/**
 * One entry point: parse, authenticate, authorise, run, and turn every outcome (including
 * unexpected exceptions) into a JSON reply. Nothing from an internal error is echoed back.
 */
export function handleRequest(p: Platform, raw: string | null | undefined): HelperResponse {
  try {
    if (typeof raw !== 'string' || raw.length === 0)
      throw new HelperError('bad_request', 'Empty request.');
    if (raw.length > MAX_REQUEST_CHARS)
      throw new HelperError('too_large', 'That request is too large.');
    let req: unknown;
    try {
      req = JSON.parse(raw);
    } catch {
      throw new HelperError('bad_request', 'The request must be JSON.');
    }
    if (typeof req !== 'object' || req === null || Array.isArray(req))
      throw new HelperError('bad_request', 'The request must be a JSON object.');
    const body = req as Record<string, unknown>;
    const name = body['action'];
    if (typeof name !== 'string' || !Object.hasOwn(actions, name))
      throw new HelperError('unknown_action', 'Unknown action.');
    const action = actions[name] as Action;

    const cfg = loadConfig(p);
    const db = new FirestoreClient(p, cfg.projectId);
    const ctx: Context = { p, cfg, db, caller: null, workspaceId: null, role: null };

    if (action.auth !== 'none') {
      ctx.caller = verifyIdToken(p, cfg, body['idToken']);
      if (action.auth === 'member' || action.auth === 'admin') {
        const wid = body['workspaceId'];
        ctx.role = roleIn(db, ctx.caller.uid, wid);
        ctx.workspaceId = wid as string;
        if (action.auth === 'admin' && ctx.role !== 'admin')
          throw new HelperError('forbidden', 'Only a workspace admin can do that.');
        if (action.writes && ctx.role === 'viewer')
          throw new HelperError('forbidden', 'Viewers can’t make changes.');
      }
    }
    return ok(action.run(ctx, body));
  } catch (e) {
    if (e instanceof HelperError) return fail(e.code, e.message);
    p.log(`Unexpected error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    return fail('internal', 'Something went wrong in the helper.');
  }
}

export type { HelperActionName };
