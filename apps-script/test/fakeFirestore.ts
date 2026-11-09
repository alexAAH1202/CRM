/* eslint-disable @typescript-eslint/no-explicit-any -- a loose fake of a JSON API */
import type { HttpRequest, HttpResponse } from '../src/platform';
import {
  fromFields,
  fromValue,
  toFields,
  toValue,
  type FsFields,
  type FsValue,
} from '../src/firestoreCodec';

const ROOT = 'projects/life-management-de315/databases/(default)/documents';

interface Stored {
  data: Record<string, unknown>;
  updateTime: string;
}

/**
 * A small in-memory Firestore speaking the REST dialect the helper uses (get, batchGet, runQuery,
 * commit with masks, transforms and preconditions). Not complete, but strict about what it supports,
 * so a test failing here means the helper sent something Firestore would reject too.
 */
export class FakeFirestore {
  docs = new Map<string, Stored>();
  private clock = 0;
  requests: Array<{ kind: string; detail: string }> = [];
  /** Runs just before a commit is applied (tests use it to simulate someone else writing first). */
  beforeCommit: ((writes: any[]) => void) | null = null;
  /** Make the next N commits fail with this HTTP status. */
  failCommits: { status: number; count: number } | null = null;
  now = () => new Date('2026-03-10T00:00:00Z');

  private tick = () => `t${String(++this.clock).padStart(8, '0')}`;

  set(path: string, data: Record<string, unknown>) {
    this.docs.set(path, { data: structuredClone(data), updateTime: this.tick() });
  }
  get(path: string): Record<string, unknown> | undefined {
    return this.docs.get(path)?.data;
  }
  list(prefix: string): string[] {
    return [...this.docs.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
  /** Simulate another writer touching a document. */
  touch(path: string, patch: Record<string, unknown> = {}) {
    const d = this.docs.get(path);
    if (d) this.docs.set(path, { data: { ...d.data, ...patch }, updateTime: this.tick() });
  }

  private encodeDoc(path: string, s: Stored) {
    return { name: `${ROOT}/${path}`, fields: toFields(s.data), updateTime: s.updateTime };
  }

  respond = (req: HttpRequest): HttpResponse | undefined => {
    if (!req.url.startsWith('https://firestore.googleapis.com/v1/')) return undefined;
    if (!req.oauth) return err(401, 'UNAUTHENTICATED', 'missing OAuth');
    const rel = req.url.slice(
      `https://firestore.googleapis.com/v1/${ROOT.replace(/\/documents$/, '')}/documents`.length,
    );
    if (req.method === 'GET') {
      const path = rel.replace(/^\//, '');
      this.requests.push({ kind: 'get', detail: path });
      const d = this.docs.get(path);
      return d ? ok(this.encodeDoc(path, d)) : err(404, 'NOT_FOUND', 'no such document');
    }
    const body = req.body ? JSON.parse(req.body) : {};
    if (rel.endsWith(':batchGet')) {
      const names: string[] = body.documents ?? [];
      this.requests.push({ kind: 'batchGet', detail: String(names.length) });
      return ok(
        names.map((n) => {
          const path = n.replace(`${ROOT}/`, '');
          const d = this.docs.get(path);
          return d ? { found: this.encodeDoc(path, d) } : { missing: n };
        }),
      );
    }
    if (rel.endsWith(':runQuery'))
      return this.query(rel.replace(/:runQuery$/, '').replace(/^\//, ''), body.structuredQuery);
    if (rel.endsWith(':commit')) return this.commit(body.writes ?? []);
    return err(404, 'NOT_FOUND', `no route for ${rel}`);
  };

  private query(parent: string, q: any): HttpResponse {
    const from = q.from[0] as { collectionId: string; allDescendants?: boolean };
    this.requests.push({
      kind: 'query',
      detail: `${parent || '(root)'} ${from.collectionId}${from.allDescendants ? ' (group)' : ''}`,
    });
    let rows = [...this.docs.entries()].filter(([path]) => {
      const seg = path.split('/');
      const coll = seg[seg.length - 2];
      if (coll !== from.collectionId) return false;
      if (from.allDescendants) return !parent || path.startsWith(`${parent}/`);
      const want = parent ? parent.split('/').length + 1 : 1;
      return seg.length - 1 === want && (!parent || path.startsWith(`${parent}/`));
    });
    const test = (f: any, data: Record<string, unknown>): boolean => {
      if (f.compositeFilter) return f.compositeFilter.filters.every((x: any) => test(x, data));
      const { field, op, value } = f.fieldFilter;
      const have = getPath(data, field.fieldPath);
      const want = fromValue(value);
      const cmp = (a: unknown, b: unknown) =>
        a instanceof Date && b instanceof Date
          ? a.getTime() - b.getTime()
          : (a as number) < (b as number)
            ? -1
            : (a as number) > (b as number)
              ? 1
              : 0;
      switch (op) {
        case 'EQUAL':
          return have instanceof Date && want instanceof Date
            ? have.getTime() === want.getTime()
            : (have ?? null) === (want ?? null);
        case 'LESS_THAN':
          return have != null && cmp(have, want) < 0;
        case 'LESS_THAN_OR_EQUAL':
          return have != null && cmp(have, want) <= 0;
        case 'GREATER_THAN':
          return have != null && cmp(have, want) > 0;
        case 'GREATER_THAN_OR_EQUAL':
          return have != null && cmp(have, want) >= 0;
        case 'ARRAY_CONTAINS':
          return (
            Array.isArray(have) && have.some((x) => JSON.stringify(x) === JSON.stringify(want))
          );
        default:
          throw new Error(`fake: unsupported op ${op}`);
      }
    };
    if (q.where) rows = rows.filter(([, s]) => test(q.where, s.data));
    if (q.orderBy) {
      const o = q.orderBy[0];
      rows.sort(([, a], [, b]) => {
        const x = getPath(a.data, o.field.fieldPath);
        const y = getPath(b.data, o.field.fieldPath);
        const d =
          x instanceof Date && y instanceof Date
            ? x.getTime() - y.getTime()
            : (x as number) < (y as number)
              ? -1
              : (x as number) > (y as number)
                ? 1
                : 0;
        return o.direction === 'DESCENDING' ? -d : d;
      });
    }
    if (q.limit) rows = rows.slice(0, q.limit);
    return ok(
      rows.length
        ? rows.map(([p, s]) => ({ document: this.encodeDoc(p, s) }))
        : [{ readTime: 'x' }],
    );
  }

  private commit(writes: any[]): HttpResponse {
    this.requests.push({ kind: 'commit', detail: `${writes.length} writes` });
    if (this.failCommits && this.failCommits.count > 0) {
      this.failCommits.count--;
      return err(this.failCommits.status, 'UNAVAILABLE', 'simulated outage');
    }
    this.beforeCommit?.(writes);
    // validate every precondition first: commits are atomic
    for (const w of writes) {
      const name: string = (w.update ?? { name: w.delete }).name;
      const path = name.replace(`${ROOT}/`, '');
      const cur = this.docs.get(path);
      const pre = w.currentDocument;
      if (pre?.exists === true && !cur)
        return err(404, 'NOT_FOUND', `no document to update: ${path}`);
      if (pre?.exists === false && cur) return err(409, 'ALREADY_EXISTS', `exists: ${path}`);
      if (pre?.updateTime && cur?.updateTime !== pre.updateTime)
        return err(400, 'FAILED_PRECONDITION', `changed: ${path}`);
      if (pre?.updateTime && !cur) return err(400, 'FAILED_PRECONDITION', `gone: ${path}`);
    }
    const next = new Map(this.docs);
    for (const w of writes) {
      if (w.delete) {
        next.delete(w.delete.replace(`${ROOT}/`, ''));
        continue;
      }
      const path = w.update.name.replace(`${ROOT}/`, '');
      const prev = next.get(path);
      let data: Record<string, unknown>;
      const incoming = fromFields((w.update.fields ?? {}) as FsFields);
      if (w.updateMask) {
        data = structuredClone(prev?.data ?? {});
        for (const fp of w.updateMask.fieldPaths as string[]) {
          const parts = fp.split('.').map((s) => s.replace(/^`|`$/g, ''));
          const v = getPath(incoming, parts.join('.'));
          if (v === undefined) deletePath(data, parts);
          else setPath(data, parts, v);
        }
      } else data = incoming;
      for (const t of (w.updateTransforms ?? []) as any[]) {
        const parts = (t.fieldPath as string).split('.').map((s) => s.replace(/^`|`$/g, ''));
        if (t.setToServerValue === 'REQUEST_TIME') setPath(data, parts, this.now());
        else if (t.appendMissingElements) {
          const cur = (getPath(data, parts.join('.')) as unknown[]) ?? [];
          const add = t.appendMissingElements.values.map(fromValue);
          setPath(data, parts, [
            ...cur,
            ...add.filter(
              (a: unknown) => !cur.some((c) => JSON.stringify(c) === JSON.stringify(a)),
            ),
          ]);
        } else if (t.removeAllFromArray) {
          const rm = t.removeAllFromArray.values
            .map(fromValue)
            .map((x: unknown) => JSON.stringify(x));
          setPath(
            data,
            parts,
            ((getPath(data, parts.join('.')) as unknown[]) ?? []).filter(
              (c) => !rm.includes(JSON.stringify(c)),
            ),
          );
        }
      }
      next.set(path, { data, updateTime: this.tick() });
    }
    this.docs = next;
    return ok({ writeResults: [] });
  }
}

function getPath(o: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (a, k) =>
        a && typeof a === 'object'
          ? (a as Record<string, unknown>)[k.replace(/^`|`$/g, '')]
          : undefined,
      o,
    );
}
function setPath(o: Record<string, unknown>, parts: string[], v: unknown) {
  let cur = o;
  for (const p of parts.slice(0, -1))
    cur = (cur[p] = (cur[p] as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  cur[parts[parts.length - 1] as string] = v;
}
function deletePath(o: Record<string, unknown>, parts: string[]) {
  let cur: any = o;
  for (const p of parts.slice(0, -1)) {
    cur = cur?.[p];
    if (!cur) return;
  }
  delete cur[parts[parts.length - 1] as string];
}
const ok = (body: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(body) });
const err = (status: number, code: string, message: string): HttpResponse => ({
  status,
  body: JSON.stringify({ error: { code: status, status: code, message } }),
});
export { toValue, type FsValue };
