/**
 * Google Drive for the workspace's files: a folder per workspace under the shared root folder,
 * chunked uploads through Drive's resumable protocol, and keeping the folder's sharing in step
 * with the members list. Everything goes through the platform's `http` (REST), so the real logic
 * runs unchanged in Node tests against a fake Drive.
 *
 * Why this shape: a browser can't write to the owner's Drive, so the helper (running as the owner)
 * does it. Each piece arrives as base64 in its own request, which keeps every request small and
 * lets a flaky connection retry one piece. The session address Drive hands back never leaves the
 * helper; the browser only ever holds an opaque upload id bound to the person who started it.
 */
import {
  cleanMimeType,
  driveViewUrl,
  GOOGLE_DOC,
  googleDocUrl,
  HelperError,
  MAX_FILE_BYTES,
  sanitizeFileName,
  UPLOAD_CHUNK_BYTES,
  uploadProblem,
  type UploadedFile,
} from '@app/shared';
import type { Caller } from './auth';
import type { HelperConfig } from './config';
import { PreconditionFailed, type FirestoreClient } from './firestore';
import type { HttpResponse, Platform } from './platform';

export const DRIVE = 'https://www.googleapis.com/drive/v3';
export const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SESSION_TTL_SECONDS = 6 * 3600;
const MAX_UPLOADS_PER_HOUR = 40;

interface UploadSession {
  uid: string;
  wid: string;
  session: string;
  size: number;
  name: string;
  mime: string;
  next: number;
}

function driveFail(res: HttpResponse, what: string, p: Platform): never {
  p.log(`Drive ${what} failed: ${res.status} ${res.body.slice(0, 300)}`);
  if (res.status === 429 || res.status >= 500)
    throw new HelperError('unavailable', 'Google Drive is busy. Try again shortly.');
  if (res.status === 403 || res.status === 401)
    throw new HelperError(
      'internal',
      'The helper isn’t allowed to use Google Drive (check the Drive API is enabled and the folder is yours).',
    );
  if (res.status === 404) throw new HelperError('not_found', 'That Drive item was not found.');
  throw new HelperError('internal', 'Google Drive refused the request.');
}

export function driveJson<T>(p: Platform, what: string, req: Parameters<Platform['http']>[0]): T {
  const res = p.http({ ...req, oauth: true });
  if (res.status < 200 || res.status > 299) driveFail(res, what, p);
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new HelperError('internal', 'Google Drive sent an unreadable reply.');
  }
}

// ---------------------------------------------------------------------------------------------
// The workspace's folder
// ---------------------------------------------------------------------------------------------

/** Returns the workspace's Drive folder id, creating (and recording) it the first time. */
export function ensureWorkspaceFolder(
  p: Platform,
  cfg: HelperConfig,
  db: FirestoreClient,
  wid: string,
): string {
  if (!cfg.driveRootFolderId)
    throw new HelperError('unavailable', 'The Drive folder hasn’t been set up for the helper.');
  const path = `workspaces/${wid}`;
  const ws = db.getDoc(path);
  if (!ws) throw new HelperError('not_found', 'That household was not found.');
  const existing = ws.data['driveFolderId'];
  if (typeof existing === 'string' && existing) return existing;

  const wsName = sanitizeFileName(ws.data['name'] ?? 'Household').slice(0, 80);
  const made = driveJson<{ id: string }>(p, 'create folder', {
    url: `${DRIVE}/files?fields=id`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Sorted – ${wsName}`,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [cfg.driveRootFolderId],
    }),
  });
  try {
    db.commit(
      [{ kind: 'update', path, data: { driveFolderId: made.id } }],
      new Map([[path, { updateTime: ws.updateTime ?? undefined }]]),
    );
    return made.id;
  } catch (e) {
    if (!(e instanceof PreconditionFailed)) throw e;
    // Someone else (another request) got there first. Use theirs; bin ours.
    const again = db.getDoc(path)?.data['driveFolderId'];
    if (typeof again === 'string' && again) {
      p.http({
        url: `${DRIVE}/files/${made.id}`,
        method: 'PATCH',
        oauth: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
      return again;
    }
    // The document changed for some other reason: retry once with a fresh read.
    const fresh = db.getDoc(path);
    db.commit(
      [{ kind: 'update', path, data: { driveFolderId: made.id } }],
      new Map([[path, { updateTime: fresh?.updateTime ?? undefined }]]),
    );
    return made.id;
  }
}

// ---------------------------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------------------------

function rateLimit(p: Platform, uid: string) {
  const key = `uprl:${uid}`;
  const n = Number(p.cacheGet(key) ?? '0');
  if (n >= MAX_UPLOADS_PER_HOUR)
    throw new HelperError('rate_limited', 'That’s a lot of uploads. Try again in a little while.');
  p.cachePut(key, String(n + 1), 3600);
}

export function uploadStart(
  p: Platform,
  cfg: HelperConfig,
  db: FirestoreClient,
  caller: Caller,
  wid: string,
  req: Record<string, unknown>,
): { uploadId: string; chunkBytes: number } {
  const problem = uploadProblem(req['name'], req['size']);
  if (problem) throw new HelperError(problem.includes('MB') ? 'too_large' : 'bad_request', problem);
  const size = req['size'] as number;
  const name = sanitizeFileName(req['name']);
  const mime = cleanMimeType(req['mimeType']);
  rateLimit(p, caller.uid);
  const folder = ensureWorkspaceFolder(p, cfg, db, wid);

  const res = p.http({
    url: `${UPLOAD}?uploadType=resumable&fields=id,name,mimeType,size`,
    method: 'POST',
    oauth: true,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({
      name,
      mimeType: mime,
      parents: [folder],
      description: `Uploaded by ${caller.email ?? caller.uid} via Sorted`,
    }),
  });
  const session = res.headers?.['location'];
  if (res.status !== 200 || !session || !session.startsWith('https://'))
    driveFail(res, 'start upload', p);
  const uploadId = p.uuid();
  const state: UploadSession = { uid: caller.uid, wid, session, size, name, mime, next: 0 };
  p.cachePut(`up:${uploadId}`, JSON.stringify(state), SESSION_TTL_SECONDS);
  return { uploadId, chunkBytes: UPLOAD_CHUNK_BYTES };
}

function decodedLength(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

export function uploadChunk(
  p: Platform,
  caller: Caller,
  wid: string,
  req: Record<string, unknown>,
): { done: false; next: number } | { done: true; file: UploadedFile } {
  const id = req['uploadId'];
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{8,64}$/.test(id))
    throw new HelperError('bad_request', 'That upload isn’t valid.');
  const raw = p.cacheGet(`up:${id}`);
  const st = raw ? (JSON.parse(raw) as UploadSession) : null;
  // Same message whether it's missing, expired or someone else's: no probing other people's uploads.
  if (!st || st.uid !== caller.uid || st.wid !== wid)
    throw new HelperError('not_found', 'That upload has expired. Please start it again.');

  const offset = req['offset'];
  const data = req['data'];
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > st.size)
    throw new HelperError('bad_request', 'That piece’s position isn’t valid.');
  if (
    typeof data !== 'string' ||
    data.length === 0 ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw new HelperError('bad_request', 'That piece isn’t valid.');
  // A repeat of a piece we already have (a retried request): say where we are, change nothing.
  if (offset < st.next) return { done: false, next: st.next };
  if (offset > st.next)
    throw new HelperError('bad_request', 'A piece is missing. Please start the upload again.');
  const len = decodedLength(data);
  const expected = Math.min(UPLOAD_CHUNK_BYTES, st.size - offset);
  if (len !== expected) throw new HelperError('bad_request', 'That piece is the wrong size.');

  const end = offset + len;
  const res = p.http({
    url: st.session,
    method: 'PUT',
    oauth: true,
    headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${st.size}` },
    bodyBase64: data,
    followRedirects: false,
  });
  if (res.status === 308) {
    st.next = end;
    p.cachePut(`up:${id}`, JSON.stringify(st), SESSION_TTL_SECONDS);
    return { done: false, next: end };
  }
  if (res.status === 200 || res.status === 201) {
    if (end !== st.size) driveFail(res, 'finish upload early', p);
    p.cachePut(`up:${id}`, '', 1);
    let meta: { id?: unknown; name?: unknown; mimeType?: unknown; size?: unknown };
    try {
      meta = JSON.parse(res.body);
    } catch {
      meta = {};
    }
    if (typeof meta.id !== 'string') driveFail(res, 'finish upload', p);
    return {
      done: true,
      file: {
        driveFileId: meta.id,
        name: typeof meta.name === 'string' ? meta.name : st.name,
        mimeType: typeof meta.mimeType === 'string' ? meta.mimeType : st.mime,
        size: Number(meta.size ?? st.size),
        url: driveViewUrl(meta.id),
      },
    };
  }
  if (res.status === 404 || res.status === 410) {
    p.cachePut(`up:${id}`, '', 1);
    throw new HelperError('not_found', 'That upload has expired. Please start it again.');
  }
  driveFail(res, 'upload piece', p);
}

// ---------------------------------------------------------------------------------------------
// Folder sharing
// ---------------------------------------------------------------------------------------------

interface Permission {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
}

export interface SharingPlan {
  add: string[];
  remove: Permission[];
}

/**
 * What to change so exactly the members (lower-cased emails) can *view* the folder. Only touches
 * individual-user "reader" grants: the owner, editors and link/domain sharing are never changed.
 */
export function planSharing(
  members: readonly string[],
  current: readonly Permission[],
): SharingPlan {
  const want = new Set(members.map((m) => m.trim().toLowerCase()).filter((m) => m.includes('@')));
  const have = new Map<string, Permission>();
  const remove: Permission[] = [];
  for (const perm of current) {
    if (perm.type !== 'user' || !perm.emailAddress) continue;
    const email = perm.emailAddress.toLowerCase();
    if (perm.role === 'owner' || perm.role === 'organizer' || perm.role === 'fileOrganizer')
      continue;
    have.set(email, perm);
    if (perm.role === 'reader' && !want.has(email)) remove.push(perm);
  }
  const add = [...want].filter((e) => !have.has(e)).sort();
  return { add, remove };
}

const SYNC_MIN_GAP_SECONDS = 60;

/** Members → viewers on the workspace folder. Safe to run any time, as often as you like. */
export function syncFolderSharing(
  p: Platform,
  cfg: HelperConfig,
  db: FirestoreClient,
  wid: string,
  opts: { force?: boolean } = {},
): { shared: number; added: number; removed: number; skipped: boolean } {
  const gapKey = `sync:${wid}`;
  if (!opts.force && p.cacheGet(gapKey)) return { shared: 0, added: 0, removed: 0, skipped: true };
  p.cachePut(gapKey, '1', SYNC_MIN_GAP_SECONDS);

  const folder = ensureWorkspaceFolder(p, cfg, db, wid);
  const memberDocs = db.query({ parent: `workspaces/${wid}`, collection: 'members', limit: 200 });
  const members = memberDocs
    .map((d) => d.data['email'])
    .filter((e): e is string => typeof e === 'string');

  const perms =
    driveJson<{ permissions?: Permission[] }>(p, 'list permissions', {
      url: `${DRIVE}/files/${folder}/permissions?fields=${encodeURIComponent('permissions(id,type,role,emailAddress)')}&pageSize=100`,
    }).permissions ?? [];
  const plan = planSharing(members, perms);

  let added = 0;
  for (const email of plan.add) {
    const res = p.http({
      url: `${DRIVE}/files/${folder}/permissions?sendNotificationEmail=false`,
      method: 'POST',
      oauth: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: email }),
    });
    // A non-Google address can't be a Drive user; skip it rather than failing everyone else.
    if (res.status === 200) added++;
    else p.log(`Drive share with ${email} skipped: ${res.status}`);
  }
  let removed = 0;
  for (const perm of plan.remove) {
    const res = p.http({
      url: `${DRIVE}/files/${folder}/permissions/${perm.id}`,
      method: 'DELETE',
      oauth: true,
    });
    if (res.status === 204 || res.status === 200 || res.status === 404) removed++;
    else p.log(`Drive unshare ${perm.id} failed: ${res.status}`);
  }
  removed += revokeDocEditors(p, folder, editorEmails(memberDocs));
  return { shared: members.length, added, removed, skipped: false };
}

/** Lower-cased emails of members who may edit (admins and members, not viewers). */
function editorEmails(memberDocs: ReadonlyArray<{ data: Record<string, unknown> }>): Set<string> {
  return new Set(
    memberDocs
      .filter((d) => d.data['role'] !== 'viewer')
      .map((d) => d.data['email'])
      .filter((e): e is string => typeof e === 'string')
      .map((e) => e.toLowerCase()),
  );
}

/**
 * New documents give each editor their own edit access (D100). Take it away again from anyone
 * who has left or become a viewer, so leaving the household really does end their access.
 */
function revokeDocEditors(p: Platform, folder: string, editors: ReadonlySet<string>): number {
  const q = `'${folder}' in parents and mimeType='${GOOGLE_DOC}' and trashed=false`;
  const docs =
    driveJson<{ files?: Array<{ id: string }> }>(p, 'list documents', {
      url: `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=100`,
    }).files ?? [];
  let removed = 0;
  for (const f of docs) {
    const perms =
      driveJson<{ permissions?: Permission[] }>(p, 'list document permissions', {
        url: `${DRIVE}/files/${f.id}/permissions?fields=${encodeURIComponent('permissions(id,type,role,emailAddress)')}&pageSize=100`,
      }).permissions ?? [];
    for (const perm of perms) {
      if (perm.type !== 'user' || perm.role !== 'writer' || !perm.emailAddress) continue;
      if (editors.has(perm.emailAddress.toLowerCase())) continue;
      const res = p.http({
        url: `${DRIVE}/files/${f.id}/permissions/${perm.id}`,
        method: 'DELETE',
        oauth: true,
      });
      if (res.status === 204 || res.status === 200 || res.status === 404) removed++;
      else p.log(`Document unshare ${perm.id} failed: ${res.status}`);
    }
  }
  return removed;
}

/** Every workspace (used by the daily housekeeping run as a safety net). */
export function syncAllFolders(p: Platform, cfg: HelperConfig, db: FirestoreClient): number {
  const workspaces = db.query({ collection: 'workspaces', limit: 100 });
  let n = 0;
  for (const w of workspaces) {
    try {
      syncFolderSharing(p, cfg, db, w.id, { force: true });
      n++;
    } catch (e) {
      p.log(`Folder sync for ${w.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return n;
}

export { MAX_FILE_BYTES };

// ---------------------------------------------------------------------------------------------
// New Google Docs
// ---------------------------------------------------------------------------------------------

/**
 * A blank Google Doc in the workspace folder. Members who can edit (not viewers) get edit access
 * to this one document; everyone else can still view it through the folder.
 */
export function createDoc(
  p: Platform,
  cfg: HelperConfig,
  db: FirestoreClient,
  caller: Caller,
  wid: string,
  req: Record<string, unknown>,
): UploadedFile {
  const name = sanitizeFileName(req['name']) || 'Untitled document';
  rateLimit(p, caller.uid);
  const folder = ensureWorkspaceFolder(p, cfg, db, wid);
  const made = driveJson<{ id?: string; name?: string }>(p, 'create document', {
    url: `${DRIVE}/files?fields=id,name`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      name,
      mimeType: GOOGLE_DOC,
      parents: [folder],
      description: `Created by ${caller.email ?? caller.uid} via Sorted`,
    }),
  });
  if (typeof made.id !== 'string')
    throw new HelperError('internal', 'Google Drive refused the request.');
  const editors = editorEmails(
    db.query({ parent: `workspaces/${wid}`, collection: 'members', limit: 200 }),
  );
  for (const email of editors) {
    const res = p.http({
      url: `${DRIVE}/files/${made.id}/permissions?sendNotificationEmail=false`,
      method: 'POST',
      oauth: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
    });
    if (res.status !== 200) p.log(`Doc share with ${email} skipped: ${res.status}`);
  }
  return {
    driveFileId: made.id,
    name: made.name ?? name,
    mimeType: GOOGLE_DOC,
    size: 0,
    url: googleDocUrl(made.id),
  };
}
