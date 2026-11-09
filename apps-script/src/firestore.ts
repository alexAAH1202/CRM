import { DELETE_FIELD, type WriteOp } from '@app/shared';
import {
  decodeDoc,
  toFields,
  toValue,
  type Doc,
  type FsDocument,
  type FsFields,
  type FsValue,
} from './firestoreCodec';
import type { Platform } from './platform';
import { HelperError } from '@app/shared';

export type { Doc } from './firestoreCodec';

interface FieldTransform {
  fieldPath: string;
  setToServerValue?: 'REQUEST_TIME';
  appendMissingElements?: { values: FsValue[] };
  removeAllFromArray?: { values: FsValue[] };
}

export interface RestWrite {
  update?: { name: string; fields: FsFields };
  updateMask?: { fieldPaths: string[] };
  updateTransforms?: FieldTransform[];
  currentDocument?: { exists: boolean };
  delete?: string;
}

const isSentinel = (v: unknown): v is { __op: string; values?: unknown[] } =>
  typeof v === 'object' && v !== null && '__op' in (v as object);

/** A path segment safe to use in a field path (letters, digits, underscore) or backtick-quoted. */
const seg = (s: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `\`${s.replace(/`/g, '\\`')}\``;

interface Walked {
  value: Record<string, unknown>;
  transforms: FieldTransform[];
  /** Field paths of values being set or deleted (for the update mask). */
  paths: string[];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  !(v instanceof Date) &&
  !isSentinel(v);

/** Removes sentinels nested inside a value, turning them into transforms at their field path. */
function strip(v: unknown, path: string[], transforms: FieldTransform[]): unknown {
  if (!isPlainObject(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const here = [...path, k];
    if (isSentinel(x)) {
      const fp = here.map(seg).join('.');
      if (x.__op === 'serverTime')
        transforms.push({ fieldPath: fp, setToServerValue: 'REQUEST_TIME' });
      else if (x.__op === 'arrayUnion')
        transforms.push({
          fieldPath: fp,
          appendMissingElements: { values: (x.values ?? []).map(toValue) },
        });
      else if (x.__op === 'arrayRemove')
        transforms.push({
          fieldPath: fp,
          removeAllFromArray: { values: (x.values ?? []).map(toValue) },
        });
      continue; // deleteField inside a nested value has no meaning: it is simply absent
    }
    out[k] = strip(x, here, transforms);
  }
  return out;
}

/** Splits a data object into plain values, server-side transforms and the paths touched. */
function walk(data: Record<string, unknown>, prefix: string[], mask: boolean): Walked {
  const value: Record<string, unknown> = {};
  const transforms: FieldTransform[] = [];
  const paths: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    // In updates, "a.b" keys address nested fields, exactly like the web SDK.
    const here = mask && k.includes('.') ? [...prefix, ...k.split('.')] : [...prefix, k];
    const fp = here.map(seg).join('.');
    if (isSentinel(v)) {
      if (v.__op === 'serverTime')
        transforms.push({ fieldPath: fp, setToServerValue: 'REQUEST_TIME' });
      else if (v.__op === 'deleteField') paths.push(fp);
      else if (v.__op === 'arrayUnion')
        transforms.push({
          fieldPath: fp,
          appendMissingElements: { values: (v.values ?? []).map(toValue) },
        });
      else if (v.__op === 'arrayRemove')
        transforms.push({
          fieldPath: fp,
          removeAllFromArray: { values: (v.values ?? []).map(toValue) },
        });
      continue;
    }
    if (v === undefined) continue;
    const clean = strip(v, here, transforms);
    if (mask && k.includes('.')) {
      // build nested object for a dotted key
      let cur = value;
      const parts = k.split('.');
      parts.slice(0, -1).forEach((p) => {
        cur[p] = (cur[p] as Record<string, unknown> | undefined) ?? {};
        cur = cur[p] as Record<string, unknown>;
      });
      cur[parts[parts.length - 1] as string] = clean;
      paths.push(fp);
    } else if (
      mask &&
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      !(v instanceof Date)
    ) {
      // a whole map replaces the field
      value[k] = clean;
      paths.push(fp);
    } else {
      value[k] = clean;
      paths.push(fp);
    }
  }
  return { value, transforms, paths };
}

/**
 * The same WriteOps the web app and the rules tests execute, turned into REST writes. This is
 * what lets the helper reuse the shared planners and the automation engine unchanged.
 */
export function opsToWrites(projectId: string, ops: readonly WriteOp[]): RestWrite[] {
  const root = `projects/${projectId}/databases/(default)/documents`;
  return ops.map((op): RestWrite => {
    const name = `${root}/${op.path}`;
    if (op.kind === 'delete') return { delete: name };
    if (op.kind === 'set') {
      const w = walk(op.data, [], false);
      return {
        update: { name, fields: toFields(w.value) },
        ...(w.transforms.length ? { updateTransforms: w.transforms } : {}),
      };
    }
    const w = walk(op.data, [], true);
    return {
      update: { name, fields: toFields(w.value) },
      updateMask: { fieldPaths: w.paths },
      ...(w.transforms.length ? { updateTransforms: w.transforms } : {}),
      currentDocument: { exists: true },
    };
  });
}

export const DELETE = DELETE_FIELD;

export type Filter = {
  field: string;
  op:
    | 'EQUAL'
    | 'LESS_THAN'
    | 'LESS_THAN_OR_EQUAL'
    | 'GREATER_THAN'
    | 'GREATER_THAN_OR_EQUAL'
    | 'ARRAY_CONTAINS'
    | 'IN';
  value: unknown;
};

export interface QuerySpec {
  /** Collection id (e.g. "scheduledEvents") */
  collection: string;
  /** true = every collection with that id (needs a collection-group index). */
  group?: boolean;
  where?: Filter[];
  orderBy?: Array<{ field: string; dir?: 'ASCENDING' | 'DESCENDING' }>;
  limit?: number;
  /** Parent document path for sub-collections ("workspaces/w1/boards/b1"). */
  parent?: string;
}

export function buildQuery(q: QuerySpec): Record<string, unknown> {
  const filters = (q.where ?? []).map((f) => ({
    fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: toValue(f.value) },
  }));
  return {
    from: [{ collectionId: q.collection, ...(q.group ? { allDescendants: true } : {}) }],
    ...(filters.length === 1
      ? { where: filters[0] }
      : filters.length > 1
        ? { where: { compositeFilter: { op: 'AND', filters } } }
        : {}),
    ...(q.orderBy?.length
      ? {
          orderBy: q.orderBy.map((o) => ({
            field: { fieldPath: o.field },
            direction: o.dir ?? 'ASCENDING',
          })),
        }
      : {}),
    ...(q.limit ? { limit: q.limit } : {}),
  };
}

/** Firestore REST over the script owner's OAuth token. Rules aren't evaluated (IAM access). */
export class FirestoreClient {
  private readonly base: string;
  constructor(
    private readonly p: Platform,
    readonly projectId: string,
  ) {
    this.base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  }

  private call(
    url: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): { status: number; json: unknown } {
    const res = this.p.http({
      url,
      method,
      oauth: true,
      ...(body !== undefined
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
    let json: unknown = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* non-JSON error page */
    }
    return { status: res.status, json };
  }

  private fail(status: number, json: unknown, what: string): never {
    const msg =
      (json as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${status}`;
    this.p.log(`Firestore ${what} failed: ${status} ${msg}`);
    if (status === 429 || status === 503)
      throw new HelperError('unavailable', 'The database is busy. Try again shortly.');
    if (status === 403 || status === 401)
      throw new HelperError(
        'internal',
        'The helper is not allowed to use the database (check the Firestore API and the Cloud project link).',
      );
    if (status === 404) throw new HelperError('not_found', 'Not found.');
    throw new HelperError('internal', 'The database request failed.');
  }

  getDoc(path: string): Doc | null {
    const { status, json } = this.call(`${this.base}/${path}`, 'GET');
    if (status === 404) return null;
    if (status !== 200) this.fail(status, json, `get ${path}`);
    return decodeDoc(json as FsDocument);
  }

  /** Several documents in one request; missing ones are simply absent from the result. */
  batchGet(paths: readonly string[]): Doc[] {
    if (paths.length === 0) return [];
    const names = paths.map((x) => `projects/${this.projectId}/databases/(default)/documents/${x}`);
    const { status, json } = this.call(`${this.base}:batchGet`, 'POST', { documents: names });
    if (status !== 200) this.fail(status, json, 'batchGet');
    return (json as Array<{ found?: FsDocument }>).flatMap((r) =>
      r.found ? [decodeDoc(r.found)] : [],
    );
  }

  query(q: QuerySpec): Doc[] {
    const url = q.parent ? `${this.base}/${q.parent}:runQuery` : `${this.base}:runQuery`;
    const { status, json } = this.call(url, 'POST', { structuredQuery: buildQuery(q) });
    if (status !== 200) this.fail(status, json, `query ${q.collection}`);
    return (json as Array<{ document?: FsDocument }>).flatMap((r) =>
      r.document ? [decodeDoc(r.document)] : [],
    );
  }

  /** Atomic, like the app's batches. Max 500 writes per commit (Firestore's limit). */
  commit(ops: readonly WriteOp[]): void {
    for (let i = 0; i < ops.length; i += 400) {
      const writes = opsToWrites(this.projectId, ops.slice(i, i + 400));
      const { status, json } = this.call(`${this.base}:commit`, 'POST', { writes });
      if (status !== 200) this.fail(status, json, 'commit');
    }
  }
}
