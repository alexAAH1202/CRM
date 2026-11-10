import { UPLOAD_CHUNK_BYTES } from '@app/shared';
import { describe, expect, it } from 'vitest';
import { planSharing, syncAllFolders } from '../src/drive';
import { loadConfig } from '../src/config';
import { FirestoreClient } from '../src/firestore';
import { handleRequest } from '../src/router';
import { FakeDrive } from './fakeDrive';
import { FakeFirestore } from './fakeFirestore';
import { fakeJwt, fakePlatform, json } from './fakes';

const NOW = Date.parse('2026-03-17T00:00:00Z');

function world(role: 'admin' | 'member' | 'viewer' | null = 'member', uid = 'u1') {
  let who = uid;
  const fs = new FakeFirestore();
  const drive = new FakeDrive();
  fs.set('workspaces/w1', { name: 'Home', driveFolderId: null });
  fs.set('workspaces/w1/members/u1', { role: 'admin', email: 'Ada@Example.com' });
  fs.set('workspaces/w1/members/u2', { role: 'member', email: 'bob@example.com' });
  fs.set('workspaces/w1/members/u3', { role: 'viewer', email: 'cy@example.com' });
  const f = fakePlatform({
    now: NOW,
    respond: (req) =>
      req.url.includes('accounts:lookup')
        ? json(200, { users: [{ localId: who, email: `${who}@example.com` }] })
        : (drive.respond(req) ?? fs.respond(req)),
  });
  if (role && uid !== 'u1') fs.set(`workspaces/w1/members/${uid}`, { role, email: `${uid}@x.com` });
  if (role && uid === 'u1') fs.set('workspaces/w1/members/u1', { role, email: 'Ada@Example.com' });
  const call = (action: string, extra: object = {}, wid = 'w1') =>
    handleRequest(
      f.p,
      JSON.stringify({
        action,
        idToken: fakeJwt({ exp: Math.floor(NOW / 1000) + 3600, sub: who }),
        workspaceId: wid,
        ...extra,
      }),
    ) as {
      ok: boolean;
      data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      error?: { code: string; message: string };
    };
  return {
    fs,
    drive,
    f,
    call,
    as: (u: string) => {
      who = u;
    },
  };
}

const b64 = (b: Buffer) => b.toString('base64');
const bytesOf = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => i % 251));

/** Sends a whole file the way the browser does. */
function uploadAll(
  w: ReturnType<typeof world>,
  data: Buffer,
  name = 'rates.pdf',
  mime = 'application/pdf',
) {
  const start = w.call('uploadStart', { name, mimeType: mime, size: data.length });
  expect(start.ok).toBe(true);
  const id = start.data.uploadId as string;
  let off = 0;
  let last: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  while (off < data.length) {
    const piece = data.subarray(off, Math.min(off + start.data.chunkBytes, data.length));
    last = w.call('uploadChunk', { uploadId: id, offset: off, data: b64(piece) });
    expect(last.ok).toBe(true);
    off += piece.length;
  }
  return { id, last };
}

describe('uploads', () => {
  it('creates the workspace folder once, uploads in pieces, and returns the file', () => {
    const w = world('member');
    const data = bytesOf(UPLOAD_CHUNK_BYTES * 2 + 1234);
    const { last } = uploadAll(w, data);
    expect(last.data.done).toBe(true);
    expect(last.data.file).toMatchObject({
      name: 'rates.pdf',
      mimeType: 'application/pdf',
      size: data.length,
    });
    expect(last.data.file.url).toBe(
      `https://drive.google.com/file/d/${last.data.file.driveFileId}/view`,
    );
    const stored = w.drive.files.get(last.data.file.driveFileId)!;
    expect(stored.bytes.equals(data)).toBe(true); // byte-for-byte
    expect(w.drive.folders.size).toBe(1);
    const folder = [...w.drive.folders.keys()][0];
    expect(stored.parents).toEqual([folder]);
    expect(w.fs.get('workspaces/w1')!['driveFolderId']).toBe(folder);
    // a second upload reuses the folder
    uploadAll(w, bytesOf(10), 'b.txt', 'text/plain');
    expect(w.drive.folders.size).toBe(1);
  });

  it('handles a single small piece and an exact multiple of the piece size', () => {
    const w = world('member');
    expect(uploadAll(w, bytesOf(5)).last.data.done).toBe(true);
    expect(
      uploadAll(w, bytesOf(UPLOAD_CHUNK_BYTES), 'x.bin', 'application/octet-stream').last.data.done,
    ).toBe(true);
  });

  it('a repeated piece is acknowledged without being sent to Drive twice', () => {
    const w = world('member');
    const data = bytesOf(UPLOAD_CHUNK_BYTES + 10);
    const s = w.call('uploadStart', {
      name: 'a.pdf',
      mimeType: 'application/pdf',
      size: data.length,
    });
    const piece = b64(data.subarray(0, UPLOAD_CHUNK_BYTES));
    expect(
      w.call('uploadChunk', { uploadId: s.data.uploadId, offset: 0, data: piece }).data,
    ).toEqual({ done: false, next: UPLOAD_CHUNK_BYTES });
    const puts = w.f.calls.filter((c) => c.method === 'PUT').length;
    expect(
      w.call('uploadChunk', { uploadId: s.data.uploadId, offset: 0, data: piece }).data,
    ).toEqual({ done: false, next: UPLOAD_CHUNK_BYTES });
    expect(w.f.calls.filter((c) => c.method === 'PUT').length).toBe(puts);
  });

  it('refuses bad pieces: gaps, wrong sizes, junk, unknown ids', () => {
    const w = world('member');
    const s = w.call('uploadStart', {
      name: 'a.pdf',
      mimeType: 'application/pdf',
      size: UPLOAD_CHUNK_BYTES * 2,
    });
    const id = s.data.uploadId;
    const full = b64(bytesOf(UPLOAD_CHUNK_BYTES));
    expect(
      w.call('uploadChunk', { uploadId: id, offset: UPLOAD_CHUNK_BYTES, data: full }).error?.code,
    ).toBe('bad_request'); // gap
    expect(
      w.call('uploadChunk', { uploadId: id, offset: 0, data: b64(bytesOf(100)) }).error?.code,
    ).toBe('bad_request'); // wrong size
    expect(
      w.call('uploadChunk', { uploadId: id, offset: 0, data: 'not base64!' }).error?.code,
    ).toBe('bad_request');
    expect(w.call('uploadChunk', { uploadId: id, offset: -1, data: full }).error?.code).toBe(
      'bad_request',
    );
    expect(w.call('uploadChunk', { uploadId: 'nope', offset: 0, data: full }).error?.code).toBe(
      'bad_request',
    );
    expect(
      w.call('uploadChunk', { uploadId: 'abcdefgh12', offset: 0, data: full }).error?.code,
    ).toBe('not_found');
    expect(w.drive.sessions.size).toBe(1);
    expect([...w.drive.sessions.values()][0]!.received).toHaveLength(0); // nothing reached Drive
  });

  it('refuses before any bytes move: too big, empty, programs, junk', () => {
    const w = world('member');
    expect(
      w.call('uploadStart', { name: 'a.pdf', mimeType: 'x/y', size: 10 * 1024 * 1024 + 1 }).error
        ?.code,
    ).toBe('too_large');
    expect(w.call('uploadStart', { name: 'a.pdf', mimeType: 'x/y', size: 0 }).error?.code).toBe(
      'bad_request',
    );
    expect(w.call('uploadStart', { name: 'setup.EXE', mimeType: 'x/y', size: 5 }).error?.code).toBe(
      'bad_request',
    );
    expect(w.call('uploadStart', { name: 'a.pdf', mimeType: 'x/y', size: 1.5 }).error?.code).toBe(
      'bad_request',
    );
    expect(w.call('uploadStart', { name: 'a.pdf', mimeType: 'x/y', size: '5' }).error?.code).toBe(
      'bad_request',
    );
    expect(w.drive.folders.size).toBe(0);
    expect(w.drive.sessions.size).toBe(0);
  });

  it('cleans names and mime types before they reach Drive', () => {
    const w = world('member');
    uploadAll(w, bytesOf(4), '../../etc/pass:wd?.pdf', 'text/html; <script>');
    const f = [...w.drive.files.values()][0]!;
    expect(f.name).not.toMatch(/[/\\:?]/);
    expect(f.mime).toBe('application/octet-stream');
  });

  it('creates a Google Doc in the folder that members (not viewers) can edit', () => {
    const w = world('member');
    const r = w.call('createDoc', { name: 'Essay / draft' });
    expect(r.ok).toBe(true);
    expect(r.data.mimeType).toBe('application/vnd.google-apps.document');
    expect(r.data.url).toBe(`https://docs.google.com/document/d/${r.data.driveFileId}/edit`);
    expect(r.data.name).toBe('Essay draft');
    const editors = (w.drive.perms.get(r.data.driveFileId) ?? []).map((p) => p.emailAddress);
    expect(editors.sort()).toEqual(['ada@example.com', 'bob@example.com']);
    expect(world('viewer', 'u3').call('createDoc', { name: 'x' }).error?.code).toBe('forbidden');
    // Bob becomes a viewer: the next sync takes away his edit access to the document.
    w.fs.set('workspaces/w1/members/u2', { role: 'viewer', email: 'bob@example.com' });
    expect(w.call('syncFolderSharing').ok).toBe(true);
    const after = (w.drive.perms.get(r.data.driveFileId) ?? []).map((p) => p.emailAddress);
    expect(after).toEqual(['ada@example.com']);
  });

  it('viewers and strangers cannot upload; only the starter can continue an upload', () => {
    const v = world('viewer', 'u3');
    expect(v.call('uploadStart', { name: 'a.pdf', mimeType: 'a/b', size: 5 }).error?.code).toBe(
      'forbidden',
    );
    const out = world(null, 'u9');
    expect(out.call('uploadStart', { name: 'a.pdf', mimeType: 'a/b', size: 5 }).error?.code).toBe(
      'forbidden',
    );
    // someone else (another member) can't use u1's upload id
    const w = world('member');
    const s = w.call('uploadStart', { name: 'a.pdf', mimeType: 'a/b', size: 5 });
    w.fs.set('workspaces/w1/members/u2', { role: 'member', email: 'bob@example.com' });
    w.as('u2');
    const other = w.call('uploadChunk', {
      uploadId: s.data.uploadId,
      offset: 0,
      data: b64(bytesOf(5)),
    });
    expect(other.ok).toBe(false);
    expect(other.error?.code).toBe('not_found');
  });

  it('rate-limits a person who starts too many uploads', () => {
    const w = world('member');
    for (let i = 0; i < 40; i++)
      expect(w.call('uploadStart', { name: 'a.pdf', mimeType: 'a/b', size: 5 }).ok).toBe(true);
    expect(w.call('uploadStart', { name: 'a.pdf', mimeType: 'a/b', size: 5 }).error?.code).toBe(
      'rate_limited',
    );
  });

  it('Drive trouble becomes a friendly retryable error, and an expired session says so', () => {
    const w = world('member');
    w.drive.failNext = { match: /uploadType=resumable/, status: 503 };
    expect(w.call('uploadStart', { name: 'a.pdf', mimeType: 'a/b', size: 5 }).error?.code).toBe(
      'unavailable',
    );
    const s = w.call('uploadStart', { name: 'a.pdf', mimeType: 'a/b', size: 5 });
    w.drive.sessions.clear(); // Drive forgot the session
    expect(
      w.call('uploadChunk', { uploadId: s.data.uploadId, offset: 0, data: b64(bytesOf(5)) }).error
        ?.code,
    ).toBe('not_found');
  });

  it('a lost race for the folder uses the winner’s folder and bins its own', () => {
    const w = world('member');
    w.fs.beforeCommit = () => {
      w.fs.beforeCommit = null;
      w.fs.touch('workspaces/w1', { driveFolderId: 'winner' });
    };
    uploadAll(w, bytesOf(5));
    expect([...w.drive.files.values()][0]!.parents).toEqual(['winner']);
    expect([...w.drive.folders.values()].every((f) => f.trashed)).toBe(true);
  });
});

describe('folder sharing', () => {
  const perm = (id: string, role: string, email: string, type = 'user') => ({
    id,
    role,
    type,
    emailAddress: email,
  });

  it('plans: add missing members, remove only stale readers, never touch owner/writers/links', () => {
    const plan = planSharing(
      ['Ada@Example.com', 'bob@example.com', 'new@example.com', 'not-an-email'],
      [
        perm('1', 'owner', 'me@example.com'),
        perm('2', 'reader', 'ada@example.com'),
        perm('3', 'reader', 'gone@example.com'),
        perm('4', 'writer', 'helper@example.com'),
        { id: '5', type: 'anyone', role: 'reader' },
        perm('6', 'commenter', 'bob@example.com'),
      ],
    );
    expect(plan.add).toEqual(['new@example.com']);
    expect(plan.remove.map((p) => p.id)).toEqual(['3']);
  });

  it('is idempotent: a second run changes nothing', () => {
    const w = world('member');
    const first = w.call('syncFolderSharing');
    expect(first.data).toMatchObject({ shared: 3, added: 3, removed: 0, skipped: false });
    const folder = [...w.drive.folders.keys()][0]!;
    expect(
      w.drive.perms
        .get(folder)!
        .map((p) => p.emailAddress)
        .sort(),
    ).toEqual(['ada@example.com', 'bob@example.com', 'cy@example.com']);
    expect(w.drive.perms.get(folder)!.every((p) => p.role === 'reader')).toBe(true);
    w.f.advance(61_000);
    expect(w.call('syncFolderSharing').data).toMatchObject({ added: 0, removed: 0 });
  });

  it('removes people who left, adds people who joined, and throttles repeat calls', () => {
    const w = world('member');
    w.call('syncFolderSharing');
    const folder = [...w.drive.folders.keys()][0]!;
    w.fs.docs.delete('workspaces/w1/members/u3');
    w.fs.set('workspaces/w1/members/u4', { role: 'member', email: 'dee@example.com' });
    expect(w.call('syncFolderSharing').data.skipped).toBe(true); // within a minute: no work
    w.f.advance(61_000);
    expect(w.call('syncFolderSharing').data).toMatchObject({ added: 1, removed: 1 });
    expect(
      w.drive.perms
        .get(folder)!
        .map((p) => p.emailAddress)
        .sort(),
    ).toEqual(['ada@example.com', 'bob@example.com', 'dee@example.com']);
  });

  it('one address Drive rejects does not stop the others', () => {
    const w = world('member');
    w.drive.rejectEmails.add('bob@example.com');
    expect(w.call('syncFolderSharing').data).toMatchObject({ added: 2 });
  });

  it('strangers can’t trigger it', () => {
    expect(world(null, 'u9').call('syncFolderSharing').error?.code).toBe('forbidden');
  });

  it('the daily run covers every workspace and survives one failing', () => {
    const w = world('member');
    w.fs.set('workspaces/w2', { name: 'Other', driveFolderId: null });
    w.fs.set('workspaces/w2/members/u1', { role: 'admin', email: 'z@example.com' });
    w.drive.failNext = { match: /drive\/v3\/files\?fields=id/, status: 503 }; // first folder create fails
    const cfg = loadConfig(w.f.p);
    const n = syncAllFolders(w.f.p, cfg, new FirestoreClient(w.f.p, cfg.projectId));
    expect(n).toBe(1);
    expect(w.f.logs.some((l) => l.includes('failed'))).toBe(true);
  });
});
