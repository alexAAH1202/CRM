/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles and loose JSON */
import {
  arrayRemove,
  arrayUnion,
  DELETE_FIELD,
  SERVER_TIME,
  HelperError,
  type WriteOp,
} from '@app/shared';
import { describe, expect, it } from 'vitest';
import { decodeDoc, fromValue, toFields, toValue } from '../src/firestoreCodec';
import { buildQuery, FirestoreClient, opsToWrites } from '../src/firestore';
import { fakePlatform, fsDoc, json } from './fakes';

const root = 'projects/pid/databases/(default)/documents';

describe('codec', () => {
  it('round-trips every supported type', () => {
    const v = {
      s: 'hi',
      i: 5,
      neg: -3,
      d: 1.5,
      t: true,
      f: false,
      n: null,
      when: new Date('2026-03-10T01:02:03.000Z'),
      list: [1, 'a', { x: 2 }],
      map: { a: { b: [true] } },
    };
    const back = fromValue({ mapValue: { fields: toFields(v) } }) as Record<string, unknown>;
    expect(back).toEqual(v);
  });
  it('integers are integerValue (as strings), fractions are doubleValue', () => {
    expect(toValue(7)).toEqual({ integerValue: '7' });
    expect(toValue(7.25)).toEqual({ doubleValue: 7.25 });
    expect(toValue(2 ** 60)).toEqual({ doubleValue: 2 ** 60 });
  });
  it('skips undefined properties and refuses NaN / functions', () => {
    expect(toFields({ a: 1, b: undefined })).toEqual({ a: { integerValue: '1' } });
    expect(() => toValue(NaN)).toThrow();
    expect(() => toValue(Infinity)).toThrow();
    expect(() => toValue(() => 1)).toThrow();
  });
  it('decodes a document into a path, id and data', () => {
    const d = decodeDoc(fsDoc('workspaces/w1/members/u1', { role: { stringValue: 'admin' } }));
    expect(d).toMatchObject({
      path: 'workspaces/w1/members/u1',
      id: 'u1',
      data: { role: 'admin' },
    });
    expect(fromValue(undefined)).toBeNull();
    expect(fromValue({ weird: 1 })).toBeNull();
  });
});

describe('opsToWrites', () => {
  const w = (ops: WriteOp[]) => opsToWrites('pid', ops);
  it('set: fields only, server time becomes a transform and never a stored field', () => {
    const [x] = w([
      {
        kind: 'set',
        path: 'a/b',
        data: { name: 'n', at: SERVER_TIME, nested: { when: SERVER_TIME, k: 1 } },
      },
    ]);
    expect(x!.update!.name).toBe(`${root}/a/b`);
    expect(x!.update!.fields).toEqual({
      name: { stringValue: 'n' },
      nested: { mapValue: { fields: { k: { integerValue: '1' } } } },
    });
    expect(x!.updateMask).toBeUndefined();
    expect(x!.updateTransforms).toEqual([
      { fieldPath: 'at', setToServerValue: 'REQUEST_TIME' },
      { fieldPath: 'nested.when', setToServerValue: 'REQUEST_TIME' },
    ]);
  });
  it('update: dotted keys become nested fields with an update mask and require the doc to exist', () => {
    const [x] = w([
      {
        kind: 'update',
        path: 'a/b',
        data: { 'values.col1': 5, archived: true, updatedAt: SERVER_TIME },
      },
    ]);
    expect(x!.update!.fields).toEqual({
      values: { mapValue: { fields: { col1: { integerValue: '5' } } } },
      archived: { booleanValue: true },
    });
    expect(x!.updateMask!.fieldPaths.sort()).toEqual(['archived', 'values.col1']);
    expect(x!.updateTransforms).toEqual([
      { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
    ]);
    expect(x!.currentDocument).toEqual({ exists: true });
  });
  it('update: deleting a field puts it in the mask but not the fields', () => {
    const [x] = w([{ kind: 'update', path: 'a/b', data: { 'values.gone': DELETE_FIELD } }]);
    expect(x!.updateMask!.fieldPaths).toEqual(['values.gone']);
    expect(x!.update!.fields).toEqual({});
  });
  it('array union / remove become transforms', () => {
    const [x] = w([
      { kind: 'update', path: 'a/b', data: { tags: arrayUnion('a', 'b'), old: arrayRemove('z') } },
    ]);
    expect(x!.updateTransforms).toEqual([
      {
        fieldPath: 'tags',
        appendMissingElements: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] },
      },
      { fieldPath: 'old', removeAllFromArray: { values: [{ stringValue: 'z' }] } },
    ]);
  });
  it('delete', () => {
    expect(w([{ kind: 'delete', path: 'a/b' }])).toEqual([{ delete: `${root}/a/b` }]);
  });
  it('field names with odd characters are quoted in the mask', () => {
    const [x] = w([{ kind: 'update', path: 'a/b', data: { 'values.we-ird': 1 } }]);
    expect(x!.updateMask!.fieldPaths).toEqual(['values.`we-ird`']);
  });
});

describe('buildQuery', () => {
  it('single and composite filters, order, limit, collection group', () => {
    expect(buildQuery({ collection: 'x' })).toEqual({ from: [{ collectionId: 'x' }] });
    const q = buildQuery({
      collection: 'scheduledEvents',
      group: true,
      where: [
        { field: 'status', op: 'EQUAL', value: 'pending' },
        { field: 'fireAt', op: 'LESS_THAN_OR_EQUAL', value: new Date('2026-03-10T00:00:00Z') },
      ],
      orderBy: [{ field: 'fireAt' }],
      limit: 100,
    }) as Record<string, any>;
    expect(q.from).toEqual([{ collectionId: 'scheduledEvents', allDescendants: true }]);
    expect(q.where.compositeFilter.op).toBe('AND');
    expect(q.where.compositeFilter.filters).toHaveLength(2);
    expect(q.orderBy).toEqual([{ field: { fieldPath: 'fireAt' }, direction: 'ASCENDING' }]);
    expect(q.limit).toBe(100);
    expect(
      (buildQuery({ collection: 'x', where: [{ field: 'a', op: 'EQUAL', value: 1 }] }) as any).where
        .fieldFilter.op,
    ).toBe('EQUAL');
  });
});

describe('FirestoreClient', () => {
  const mk = (
    respond: Parameters<typeof fakePlatform>[0] extends infer O ? NonNullable<O>['respond'] : never,
  ) => {
    const f = fakePlatform({ respond });
    return { ...f, db: new FirestoreClient(f.p, 'pid') };
  };
  it('getDoc: found, missing (null) and errors', () => {
    const a = mk(() => json(200, fsDoc('c/d', { x: { stringValue: 'y' } })));
    expect(a.db.getDoc('c/d')!.data).toEqual({ x: 'y' });
    expect(a.calls[0]).toMatchObject({ method: 'GET', oauth: true });
    expect(a.calls[0]!.url).toBe(
      `https://firestore.googleapis.com/v1/projects/pid/databases/(default)/documents/c/d`,
    );
    expect(mk(() => json(404, {})).db.getDoc('c/d')).toBeNull();
    expect(() =>
      mk(() => json(403, { error: { message: 'denied' } })).db.getDoc('c/d'),
    ).toThrowError(/not allowed to use the database/);
    expect(() => mk(() => json(503, {})).db.getDoc('c/d')).toThrowError(HelperError);
    expect(() =>
      mk(() => ({ status: 500, body: '<html>oops</html>' })).db.getDoc('c/d'),
    ).toThrowError(/database request failed/);
  });
  it('batchGet sends full names and drops missing documents', () => {
    const a = mk(() =>
      json(200, [{ found: fsDoc('c/1', {}) }, { missing: 'x' }, { found: fsDoc('c/3', {}) }]),
    );
    expect(a.db.batchGet(['c/1', 'c/2', 'c/3']).map((d) => d.id)).toEqual(['1', '3']);
    expect(JSON.parse(a.calls[0]!.body!).documents).toEqual([
      `${root}/c/1`,
      `${root}/c/2`,
      `${root}/c/3`,
    ]);
    expect(a.db.batchGet([])).toEqual([]);
    expect(a.calls).toHaveLength(1);
  });
  it('query posts to the parent (or root) and decodes documents', () => {
    const a = mk(() =>
      json(200, [{ document: fsDoc('w/1/e/2', { n: { integerValue: '4' } }) }, { readTime: 'x' }]),
    );
    expect(a.db.query({ collection: 'e', parent: 'w/1' })).toHaveLength(1);
    expect(a.calls[0]!.url.endsWith('/documents/w/1:runQuery')).toBe(true);
    a.db.query({ collection: 'e', group: true });
    expect(a.calls[1]!.url.endsWith('/documents:runQuery')).toBe(true);
  });
  it('commit chunks big batches and surfaces failures', () => {
    const a = mk(() => json(200, {}));
    a.db.commit(
      Array.from(
        { length: 450 },
        (_, i) => ({ kind: 'set', path: `c/${i}`, data: { i } }) as WriteOp,
      ),
    );
    expect(a.calls).toHaveLength(2);
    expect(JSON.parse(a.calls[0]!.body!).writes).toHaveLength(400);
    expect(JSON.parse(a.calls[1]!.body!).writes).toHaveLength(50);
    expect(() =>
      mk(() => json(400, { error: { message: 'bad' } })).db.commit([
        { kind: 'delete', path: 'c/1' },
      ]),
    ).toThrowError(HelperError);
  });
});
