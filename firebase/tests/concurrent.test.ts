import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  boardPaths,
  makeColumn,
  planCreateItem,
  resolveSentinels,
  type WriteOp,
} from '@app/shared';
import {
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, MAIN_BOARD, seed, WID } from './helpers';
import { createEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

const cols = [makeColumn('text')];
const sdk = {
  serverTime: () => serverTimestamp(),
  deleteField: () => deleteField(),
  arrayUnion: (...v: unknown[]) => arrayUnion(...v),
  arrayRemove: (...v: unknown[]) => arrayRemove(...v),
};

function create(fs: Firestore, who: string, iid: string) {
  return runTransaction(fs, async (tx) => {
    const counterRef = doc(fs, boardPaths.counter(WID, MAIN_BOARD));
    const counter = await tx.get(counterRef);
    const next = (counter.data()?.['next'] as number) ?? 1;
    const ops: WriteOp[] = planCreateItem({
      wid: WID,
      bid: MAIN_BOARD,
      iid,
      uid: who,
      columns: cols,
      counterExists: counter.exists(),
      item: { name: iid, groupId: 'g1', order: 'a5', itemNumber: next },
    });
    for (const op of ops) {
      const ref = doc(fs, op.path);
      const data = resolveSentinels((op as { data: object }).data, sdk) as Record<string, unknown>;
      if (op.kind === 'set') tx.set(ref, data);
      else if (op.kind === 'update') tx.update(ref, data);
    }
  });
}

// Regression: a strictly-increasing counter rule turned Firestore's retryable
// stale-read conflict into PERMISSION_DENIED for the slower of two simultaneous creates.
describe('concurrent item creation', () => {
  it.each([
    ['same user', 'bob', 'bob'],
    ['two users', 'alice', 'bob'],
  ] as const)('%s: both succeed', async (label, a, b) => {
    const results = await Promise.allSettled([
      create(db(env, a), a, `x1-${label}`),
      create(db(env, b), b, `x2-${label}`),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
  });
});
