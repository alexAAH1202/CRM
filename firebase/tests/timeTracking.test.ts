import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addSession,
  planStartTimer,
  planStopTimer,
  totalMs,
  type RunningTimer,
  type TimeSession,
} from '@app/shared';
import { doc, getDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commitOps, db, MAIN_BOARD, PRIVATE_BOARD, seed, WID } from './helpers';
import { createEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

const COL = 'timeCol';
const H = 3_600_000;
const itemPath = (b: string) => `workspaces/${WID}/boards/${b}/items/i1`;
const timerPath = (uid: string) => `workspaces/${WID}/timers/${uid}`;

async function start(who: 'alice' | 'bob' | 'carol', board = MAIN_BOARD) {
  return commitOps(
    db(env, who),
    planStartTimer({ wid: WID, uid: who, bid: board, iid: 'i1', columnId: COL }),
  );
}
async function stop(who: 'alice' | 'bob', board = MAIN_BOARD, startedAgoMs = 2 * H) {
  const timer: RunningTimer = {
    boardId: board,
    itemId: 'i1',
    columnId: COL,
    startedAtMs: Date.now() - startedAgoMs,
  };
  const fs = db(env, who);
  const cur = (await getDoc(doc(fs, itemPath(board)))).data()?.['values']?.[COL] ?? null;
  const { ops } = planStopTimer({
    wid: WID,
    uid: who,
    timer,
    nowMs: Date.now(),
    current: cur,
    newId: () => `s-${who}`,
  });
  return commitOps(fs, ops);
}

describe('the running timer', () => {
  it('members start and stop their own; the stop saves the session and clears the timer in one batch', async () => {
    await assertSucceeds(start('bob'));
    expect((await getDoc(doc(db(env, 'bob'), timerPath('bob')))).exists()).toBe(true);
    await assertSucceeds(stop('bob'));
    const fs = db(env, 'bob');
    expect((await getDoc(doc(fs, timerPath('bob')))).exists()).toBe(false);
    const v = (await getDoc(doc(fs, itemPath(MAIN_BOARD)))).data()?.['values'][COL];
    expect(v.sessions).toHaveLength(1);
    expect(v.sessions[0].uid).toBe('bob');
    expect(totalMs(v)).toBeGreaterThan(1.9 * H);
  });
  it('a viewer cannot start a timer or log time; nobody touches someone else’s timer', async () => {
    await assertFails(start('carol'));
    await assertFails(
      commitOps(
        db(env, 'bob'),
        planStartTimer({ wid: WID, uid: 'alice', bid: MAIN_BOARD, iid: 'i1', columnId: COL }),
      ),
    );
    await assertSucceeds(start('alice'));
    await assertFails(commitOps(db(env, 'bob'), [{ kind: 'delete', path: timerPath('alice') }]));
    await assertFails(getDoc(doc(db(env, 'bob'), timerPath('alice'))));
    // the viewer can't write sessions straight into the cell either
    const session: TimeSession = { id: 's', uid: 'carol', start: Date.now() - H, end: Date.now() };
    await assertFails(
      commitOps(db(env, 'carol'), [
        {
          kind: 'update',
          path: itemPath(MAIN_BOARD),
          data: { [`values.${COL}`]: addSession(null, session) },
        },
      ]),
    );
  });
  it('time on a private list is saved through its items, which only its people (and admins) can write', async () => {
    await assertSucceeds(start('bob', PRIVATE_BOARD));
    await assertSucceeds(stop('bob', PRIVATE_BOARD));
    // carol is only a viewer and is not on it: she can neither time nor log anything there
    await assertFails(start('carol', PRIVATE_BOARD));
  });
  it('the timer document is only what the rules allow (ids and the server time)', async () => {
    const fs = db(env, 'bob');
    await assertFails(
      commitOps(fs, [
        {
          kind: 'set',
          path: timerPath('bob'),
          data: { boardId: 'b', itemId: 'i', columnId: 'c', startedAt: new Date(0) },
        },
      ]),
    );
    await assertFails(
      commitOps(fs, [
        {
          kind: 'set',
          path: timerPath('bob'),
          data: { boardId: 'b', itemId: 'i', columnId: 'c', startedAt: new Date(), extra: 1 },
        },
      ]),
    );
  });
});
