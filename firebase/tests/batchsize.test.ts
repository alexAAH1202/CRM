import { assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { makeColumn, planCreateItem, planSetCell, type WriteOp } from '@app/shared';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { commitOps, db, MAIN_BOARD, seed, WID } from './helpers';
import { createEnv } from './setup';

/**
 * Bulk actions, group deletes and board duplication write many items per batch.
 * Rule lookups of the same member/board docs are cached per request, so large
 * batches stay under Firestore's 20-lookup limit. This guards against a rules
 * change that would break that (measured OK up to 450 writes).
 */
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

const cols = [makeColumn('text')];
const creates = (n: number): WriteOp[] =>
  Array.from(
    { length: n },
    (_, i) =>
      planCreateItem({
        wid: WID,
        bid: MAIN_BOARD,
        iid: `bulk${i}`,
        uid: 'bob',
        columns: cols,
        counterExists: true,
        item: {
          name: `Item ${i}`,
          groupId: 'g1',
          order: `a${String(i).padStart(3, '0')}`,
          itemNumber: 2 + i,
        },
      })[1]!,
  );

describe('large batches pass the rules', () => {
  it('200 item creates in one batch', async () => {
    await assertSucceeds(commitOps(db(env, 'bob'), creates(200)));
  });

  it('200 cell updates in one batch', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await commitOps(ctx.firestore() as never, creates(200));
    });
    const ops = Array.from(
      { length: 200 },
      (_, i) =>
        planSetCell({
          wid: WID,
          bid: MAIN_BOARD,
          iid: `bulk${i}`,
          uid: 'bob',
          columns: cols,
          column: cols[0]!,
          currentValues: {},
          value: 'x',
        })[0]!,
    );
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
  });
});
