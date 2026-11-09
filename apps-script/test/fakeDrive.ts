import type { HttpRequest, HttpResponse } from '../src/platform';

interface Perm {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
}

/** A small fake of the Drive REST calls the helper makes (folders, resumable upload, permissions). */
export class FakeDrive {
  folders = new Map<string, { name: string; parents: string[]; trashed: boolean }>();
  perms = new Map<string, Perm[]>();
  sessions = new Map<string, { size: number; received: Buffer[]; meta: Record<string, unknown> }>();
  files = new Map<
    string,
    { name: string; mime: string; bytes: Buffer; parents: string[]; trashed?: boolean; seq: number }
  >();
  failNext: { match: RegExp; status: number } | null = null;
  rejectEmails = new Set<string>();
  private n = 0;

  respond = (req: HttpRequest): HttpResponse | undefined => {
    const u = req.url;
    if (!u.startsWith('https://www.googleapis.com/') && !u.startsWith('https://upload.test/'))
      return undefined;
    if (!req.oauth) return res(401, { error: 'no token' });
    if (this.failNext && this.failNext.match.test(u)) {
      const s = this.failNext.status;
      this.failNext = null;
      return res(s, { error: 'forced' });
    }
    const m = req.method ?? 'GET';
    if (u.startsWith('https://upload.test/')) return this.put(req);

    if (u.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      if (!u.includes('uploadType=resumable') || m !== 'POST') return res(400, {});
      const meta = JSON.parse(req.body ?? '{}') as Record<string, unknown>;
      const size = Number(req.headers?.['X-Upload-Content-Length']);
      const id = `sess${++this.n}`;
      this.sessions.set(id, { size, received: [], meta });
      return { status: 200, body: '', headers: { location: `https://upload.test/${id}` } };
    }
    let r = /\/drive\/v3\/files\/([^/?]+)\/permissions\/([^/?]+)$/.exec(u);
    if (r && m === 'DELETE') {
      const list = this.perms.get(r[1]!) ?? [];
      const i = list.findIndex((p) => p.id === r![2]);
      if (i < 0) return res(404, {});
      list.splice(i, 1);
      return { status: 204, body: '' };
    }
    r = /\/drive\/v3\/files\/([^/?]+)\/permissions/.exec(u);
    if (r) {
      const fid = r[1]!;
      const list = this.perms.get(fid) ?? [];
      if (m === 'GET') return res(200, { permissions: list });
      if (m === 'POST') {
        const b = JSON.parse(req.body ?? '{}') as {
          emailAddress: string;
          role: string;
          type: string;
        };
        if (this.rejectEmails.has(b.emailAddress))
          return res(400, { error: 'not a google account' });
        list.push({ id: `p${++this.n}`, type: b.type, role: b.role, emailAddress: b.emailAddress });
        this.perms.set(fid, list);
        return res(200, { id: list[list.length - 1]!.id });
      }
    }
    if (/\/drive\/v3\/files\?q=/.test(u) && m === 'GET') {
      const q = decodeURIComponent(/q=([^&]*)/.exec(u)![1]!);
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      if (q.includes("name='Backups'")) {
        const hit = [...this.folders].find(
          ([, f]) => f.name === 'Backups' && f.parents.includes(parent!) && !f.trashed,
        );
        return res(200, { files: hit ? [{ id: hit[0] }] : [] });
      }
      const files = [...this.files]
        .filter(([, f]) => f.parents.includes(parent!) && !f.trashed && f.name.includes('backup-'))
        .sort(([, a], [, b]) => b.seq - a.seq)
        .map(([id, f]) => ({ id, name: f.name }));
      return res(200, { files });
    }
    r = /\/drive\/v3\/files\/([^/?]+)(\?|$)/.exec(u);
    if (r && m === 'PATCH') {
      const f = this.folders.get(r[1]!) ?? this.files.get(r[1]!);
      if (!f) return res(404, {});
      Object.assign(f, JSON.parse(req.body ?? '{}'));
      return res(200, {});
    }
    if (/\/drive\/v3\/files(\?|$)/.test(u) && m === 'POST') {
      const b = JSON.parse(req.body ?? '{}') as { name: string; parents: string[] };
      const id = `folder${++this.n}`;
      this.folders.set(id, { name: b.name, parents: b.parents, trashed: false });
      return res(200, { id });
    }
    return res(404, { error: `no route ${m} ${u}` });
  };

  private put(req: HttpRequest): HttpResponse {
    const id = req.url.split('/').pop()!;
    const s = this.sessions.get(id);
    if (!s) return res(404, {});
    if (req.followRedirects !== false) return res(500, { error: '308 must not be followed' });
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers?.['Content-Range'] ?? '');
    if (!range) return res(400, {});
    const [start, end, total] = [Number(range[1]), Number(range[2]), Number(range[3])];
    const have = s.received.reduce((a, b) => a + b.length, 0);
    if (start !== have || total !== s.size) return res(400, { error: 'bad range' });
    const bytes =
      req.bodyBase64 !== undefined
        ? Buffer.from(req.bodyBase64, 'base64')
        : Buffer.from(req.body ?? '', 'utf8');
    if (bytes.length !== end - start + 1) return res(400, { error: 'length mismatch' });
    s.received.push(bytes);
    if (end + 1 < s.size) return { status: 308, body: '', headers: { range: `bytes=0-${end}` } };
    const fid = `file${++this.n}`;
    const all = Buffer.concat(s.received);
    this.files.set(fid, {
      name: String(s.meta['name']),
      mime: String(s.meta['mimeType']),
      bytes: all,
      parents: s.meta['parents'] as string[],
      seq: this.n,
    });
    return res(200, {
      id: fid,
      name: s.meta['name'],
      mimeType: s.meta['mimeType'],
      size: String(all.length),
    });
  }
}

const res = (status: number, body: unknown): HttpResponse => ({
  status,
  body: JSON.stringify(body),
});
