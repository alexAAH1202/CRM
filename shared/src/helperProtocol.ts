import type { UploadedFile } from './files';

/**
 * The contract between the browser and the Apps Script helper (shared, so both sides agree).
 *
 * The browser POSTs JSON as text/plain (no CORS preflight; Apps Script can't answer OPTIONS).
 * Every request except `ping` carries a Firebase ID token in the body; the helper verifies it
 * and the person's workspace role before doing anything.
 */
export const HELPER_ERROR_CODES = [
  'bad_request',
  'unknown_action',
  'unauthenticated',
  'forbidden',
  'not_found',
  'too_large',
  'rate_limited',
  'unavailable',
  'internal',
] as const;
export type HelperErrorCode = (typeof HELPER_ERROR_CODES)[number];

export interface HelperFailure {
  code: HelperErrorCode;
  message: string;
}

export type HelperResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: HelperFailure };

/** Typed errors on either side. */
export class HelperError extends Error {
  readonly code: HelperErrorCode;
  constructor(code: HelperErrorCode, message: string) {
    super(message);
    this.name = 'HelperError';
    this.code = code;
  }
}

export interface WhoAmI {
  uid: string;
  email: string | null;
  /** Role in the workspace asked about, or null if there isn't one / none was asked about. */
  role: 'admin' | 'member' | 'viewer' | null;
  workspaceId: string | null;
  /** The helper's own version, so the app can tell an out-of-date deployment. */
  version: string;
  serverTime: string;
  /** What the helper has been set up with (no secrets), for the admin status card. */
  config: { driveFolder: boolean; timeZone: string };
}

/** Bump when the helper code changes in a way the app should notice. */
export const HELPER_VERSION = '7e.3';

export interface HelperActions {
  ping: { request: Record<string, never>; response: { pong: true; at: string; version: string } };
  whoami: { request: { workspaceId?: string }; response: WhoAmI };
  /** Admin: recompute the whole schedule queue from the data (the repair button). */
  rebuildSchedule: {
    request: { workspaceId: string };
    response: { boards: number; automations: number; registered: number; removed: number };
  };
  /** Admin: how many scheduled runs are waiting, and whether the scheduler looks stuck. */
  schedulerStatus: {
    request: { workspaceId: string };
    response: { pending: number; failed: number; nextDue: string | null; stalled: boolean };
  };
  /** Admin: did the nightly tidy-up, the weekly backup and the daily emails run? */
  maintenanceStatus: {
    request: { workspaceId: string };
    response: {
      nightly: {
        at: string;
        deleted: number;
        problems: string[];
        backups: { ok: number; failed: number };
      } | null;
      digest: { at: string; sent: number; failed: number } | null;
      lastBackupAt: string | null;
    };
  };
  /** Member: start an upload to the workspace's Drive folder. */
  uploadStart: {
    request: { workspaceId: string; name: string; mimeType: string; size: number };
    response: { uploadId: string; chunkBytes: number };
  };
  /** Member: send the next piece (base64) at `offset`; the last piece completes the upload. */
  uploadChunk: {
    request: { workspaceId: string; uploadId: string; offset: number; data: string };
    response: { done: false; next: number } | { done: true; file: UploadedFile };
  };
  /** Editor: a blank Google Doc in the workspace's Drive folder, editable by members. */
  createDoc: {
    request: { workspaceId: string; name: string };
    response: UploadedFile;
  };
  /** Member: make the workspace folder's Drive sharing match the members list. */
  syncFolderSharing: {
    request: { workspaceId: string };
    response: { shared: number; added: number; removed: number; skipped: boolean };
  };
}
export type HelperActionName = keyof HelperActions;

/** Turns response text into a typed result, or throws a HelperError (never trusts the shape). */
export function parseHelperResponse<T>(text: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HelperError(
      'unavailable',
      'The helper sent something that isn’t JSON. Is the web app URL right?',
    );
  }
  const r = raw as { ok?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown } };
  if (r && r.ok === true) return r.data as T;
  if (r && r.ok === false && r.error) {
    const code = (HELPER_ERROR_CODES as readonly string[]).includes(String(r.error.code))
      ? (r.error.code as HelperErrorCode)
      : 'internal';
    throw new HelperError(
      code,
      typeof r.error.message === 'string' ? r.error.message : 'The helper reported an error.',
    );
  }
  throw new HelperError('unavailable', 'Unexpected reply from the helper.');
}

/** Worth retrying (a blip), as opposed to a real answer like "forbidden". */
export function isRetryableHelperError(e: unknown): boolean {
  return (
    e instanceof HelperError &&
    (e.code === 'unavailable' || e.code === 'rate_limited' || e.code === 'internal')
  );
}

/** Exponential backoff with a cap: 400ms, 800ms, 1.6s … (jitter is added by the caller). */
export function helperBackoffMs(attempt: number): number {
  return Math.min(400 * 2 ** attempt, 5000);
}

/** The one place the wire format is built. */
export function buildHelperBody(
  action: string,
  idToken: string | null,
  payload: object = {},
): string {
  return JSON.stringify({ ...payload, action, ...(idToken ? { idToken } : {}) });
}
