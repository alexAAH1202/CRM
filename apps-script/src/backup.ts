/**
 * Weekly backup: one JSON file per workspace in a "Backups" folder inside the workspace's Drive
 * folder, keeping the newest few. It holds everything needed to rebuild the workspace's boards
 * (boards, views, automations, items, folders, members), not chat or notifications.
 *
 * Reads every document once a week (a few thousand at most for a household: well inside the free
 * tier's 50,000 reads/day). A backup that can't be written is reported, never silently skipped.
 */
import { HelperError } from '@app/shared';
import type { HelperConfig } from './config';
import { driveJson, DRIVE, ensureWorkspaceFolder, UPLOAD } from './drive';
import type { Doc, FirestoreClient } from './firestore';
import type { Platform } from './platform';

export const BACKUPS_TO_KEEP = 8;
const WEEK_MS = 6.5 * 86_400_000;
const PROP = 'BACKUP_LAST';

const asRecord = (d: Doc) => ({ id: d.id, ...d.data });

/** Everything worth restoring, as plain data. */
export function collectWorkspace(db: FirestoreClient, wid: string, nowIso: string) {
  const root = `workspaces/${wid}`;
  const sub = (parent: string, collection: string) =>
    db.query({ parent, collection }).map(asRecord);
  const ws = db.getDoc(root);
  const boards = db.query({ parent: root, collection: 'boards' }).map((b) => ({
    ...asRecord(b),
    views: sub(b.path, 'views'),
    automations: sub(b.path, 'automations'),
    counter: db.getDoc(`${b.path}/meta/counter`)?.data ?? null,
    items: sub(b.path, 'items'),
  }));
  return {
    format: 'sorted-backup',
    version: 1,
    createdAt: nowIso,
    workspace: ws ? asRecord(ws) : { id: wid },
    members: sub(root, 'members'),
    invites: sub(root, 'invites'),
    folders: sub(root, 'folders'),
    boards,
  };
}

/** JSON with every non-ASCII character escaped, so the byte length equals the string length. */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u0080-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function ensureBackupsFolder(p: Platform, parent: string): string {
  const q = `name='Backups' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
  const found = driveJson<{ files?: Array<{ id: string }> }>(p, 'find backups folder', {
    url: `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`,
  }).files?.[0];
  if (found) return found.id;
  return driveJson<{ id: string }>(p, 'create backups folder', {
    url: `${DRIVE}/files?fields=id`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Backups',
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parent],
    }),
  }).id;
}

function uploadJson(p: Platform, folderId: string, name: string, body: string): string {
  const start = p.http({
    url: `${UPLOAD}?uploadType=resumable&fields=id`,
    method: 'POST',
    oauth: true,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/json',
      'X-Upload-Content-Length': String(body.length),
    },
    body: JSON.stringify({ name, mimeType: 'application/json', parents: [folderId] }),
  });
  const session = start.headers?.['location'];
  if (start.status !== 200 || !session)
    throw new HelperError('internal', `Drive refused the backup upload (${start.status}).`);
  const put = p.http({
    url: session,
    method: 'PUT',
    oauth: true,
    headers: { 'Content-Range': `bytes 0-${body.length - 1}/${body.length}` },
    body,
    followRedirects: false,
  });
  if (put.status !== 200 && put.status !== 201)
    throw new HelperError('internal', `Drive refused the backup file (${put.status}).`);
  return (JSON.parse(put.body) as { id: string }).id;
}

function pruneOld(p: Platform, folderId: string, keep: number): number {
  const list = driveJson<{ files?: Array<{ id: string; name: string }> }>(p, 'list backups', {
    url:
      `${DRIVE}/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false and name contains 'backup-'`)}` +
      `&orderBy=${encodeURIComponent('createdTime desc')}&fields=files(id,name)&pageSize=100`,
  }).files;
  const old = (list ?? []).slice(keep);
  for (const f of old)
    p.http({
      url: `${DRIVE}/files/${f.id}`,
      method: 'PATCH',
      oauth: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  return old.length;
}

export interface BackupResult {
  workspaceId: string;
  ok: boolean;
  bytes?: number;
  removed?: number;
  error?: string;
}

export function backupWorkspace(
  p: Platform,
  cfg: HelperConfig,
  db: FirestoreClient,
  wid: string,
): BackupResult {
  try {
    const now = new Date(p.nowMs());
    const data = collectWorkspace(db, wid, now.toISOString());
    const body = asciiJson(data);
    const folder = ensureBackupsFolder(p, ensureWorkspaceFolder(p, cfg, db, wid));
    uploadJson(p, folder, `backup-${now.toISOString().slice(0, 10)}.json`, body);
    const removed = pruneOld(p, folder, BACKUPS_TO_KEEP);
    return { workspaceId: wid, ok: true, bytes: body.length, removed };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    p.log(`Backup of ${wid} failed: ${error}`);
    return { workspaceId: wid, ok: false, error: error.slice(0, 200) };
  }
}

function lastTimes(p: Platform): Record<string, number> {
  try {
    return JSON.parse(p.prop(PROP) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/** Backs up every workspace that hasn't been backed up for a week (so: weekly). */
export function backupDue(
  p: Platform,
  cfg: HelperConfig,
  db: FirestoreClient,
  opts: { force?: boolean; deadline?: number } = {},
): BackupResult[] {
  const last = lastTimes(p);
  const results: BackupResult[] = [];
  for (const w of db.query({ collection: 'workspaces', limit: 100 })) {
    if (opts.deadline && p.nowMs() >= opts.deadline) break;
    if (!opts.force && p.nowMs() - (last[w.id] ?? 0) < WEEK_MS) continue;
    const r = backupWorkspace(p, cfg, db, w.id);
    results.push(r);
    if (r.ok) {
      last[w.id] = p.nowMs();
      p.setProp(PROP, JSON.stringify(last));
    }
  }
  return results;
}

export function lastBackups(p: Platform): Record<string, number> {
  return lastTimes(p);
}
