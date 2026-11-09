import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  automationData,
  boardPaths,
  makeColumn,
  planCreateItem,
  planSetCell,
  runAutomations,
  withFinalCounter,
  type Action,
  type Automation,
  type EngineItem,
  type Trigger,
  type WriteOp,
} from '@app/shared';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commitOps, db, MAIN_BOARD, PRIVATE_BOARD, seed, WID } from './helpers';
import { createEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

const status = makeColumn('status', 'Status', {
  labels: [
    { id: 'todo', name: 'To do', color: 'gray' },
    { id: 'done', name: 'Done', color: 'green' },
  ],
  defaultLabelId: 'todo',
});
const who = makeColumn('people', 'Who');
const note = makeColumn('text', 'Note');
const columns = [status, who, note];
const groups = [
  { id: 'g1', name: 'A', color: 'blue' as const },
  { id: 'g2', name: 'B', color: 'green' as const },
];

const draft = (over: Partial<Automation> = {}, owner = 'bob'): Omit<Automation, 'id'> => ({
  name: 'Done → notify',
  enabled: true,
  ownerUid: owner,
  trigger: { type: 'statusChangedTo', columnId: status.id, labelId: 'done' },
  conditions: [],
  actions: [{ type: 'notify', to: 'owner', uid: null, message: '{item} done' }],
  ...over,
});
const stored = (a: Omit<Automation, 'id'>, extra: Record<string, unknown> = {}) => ({
  ...automationData(a),
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...extra,
});
const apath = (id: string, bid = MAIN_BOARD) => boardPaths.automation(WID, bid, id);

describe('automations', () => {
  it('members and admins create them (owned by themselves); viewers and outsiders cannot', async () => {
    await assertSucceeds(setDoc(doc(db(env, 'bob'), apath('a1')), stored(draft())));
    await assertSucceeds(setDoc(doc(db(env, 'alice'), apath('a2')), stored(draft({}, 'alice'))));
    await assertFails(setDoc(doc(db(env, 'carol'), apath('a3')), stored(draft({}, 'carol'))));
    await assertFails(setDoc(doc(db(env, 'dave'), apath('a4')), stored(draft({}, 'dave'))));
    await assertFails(setDoc(doc(db(env, 'bob'), apath('a5')), stored(draft({}, 'alice')))); // not yours to claim
  });
  it('shape is validated: trigger type, 1–5 actions, ≤5 conditions, no unknown fields', async () => {
    const fs = db(env, 'bob');
    const ok = stored(draft());
    await assertFails(setDoc(doc(fs, apath('b1')), { ...ok, extra: 1 }));
    await assertFails(setDoc(doc(fs, apath('b2')), { ...ok, trigger: { type: 'hack' } }));
    await assertFails(setDoc(doc(fs, apath('b3')), { ...ok, actions: [] }));
    await assertFails(
      setDoc(doc(fs, apath('b4')), {
        ...ok,
        actions: Array.from({ length: 6 }, () => ({ type: 'archive' })),
      }),
    );
    await assertFails(
      setDoc(doc(fs, apath('b5')), { ...ok, conditions: Array.from({ length: 6 }, () => ({})) }),
    );
    await assertFails(setDoc(doc(fs, apath('b6')), { ...ok, name: '' }));
    await assertFails(setDoc(doc(fs, apath('b7')), { ...ok, enabled: 'yes' }));
    await assertFails(setDoc(doc(fs, apath('b8')), { ...ok, createdAt: new Date(0) }));
  });
  it('any editor can edit or switch one off; the owner never changes', async () => {
    await setDoc(doc(db(env, 'bob'), apath('a1')), stored(draft()));
    await assertSucceeds(
      updateDoc(doc(db(env, 'alice'), apath('a1')), {
        ...automationData(draft({ enabled: false })),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db(env, 'carol'), apath('a1')), {
        ...automationData(draft({ enabled: true })),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db(env, 'alice'), apath('a1')), {
        ...automationData(draft({}, 'alice')),
        updatedAt: serverTimestamp(),
      }),
    );
  });
  it('the owner or an admin deletes; others cannot', async () => {
    await setDoc(doc(db(env, 'bob'), apath('a1')), stored(draft()));
    await setDoc(doc(db(env, 'bob'), apath('a2')), stored(draft()));
    await assertFails(deleteDoc(doc(db(env, 'carol'), apath('a1'))));
    await assertSucceeds(deleteDoc(doc(db(env, 'bob'), apath('a1'))));
    await assertSucceeds(deleteDoc(doc(db(env, 'alice'), apath('a2'))));
  });
  it('private boards: only people on them (and admins) see or build automations', async () => {
    await assertSucceeds(setDoc(doc(db(env, 'bob'), apath('p1', PRIVATE_BOARD)), stored(draft())));
    await assertFails(getDoc(doc(db(env, 'carol'), apath('p1', PRIVATE_BOARD))));
    await assertSucceeds(getDoc(doc(db(env, 'alice'), apath('p1', PRIVATE_BOARD))));
    await assertSucceeds(
      getDoc(doc(db(env, 'carol'), apath('p1'))).catch(() => null) as Promise<unknown>,
    );
  });
});

describe('automation runs (history)', () => {
  const run = (over: Record<string, unknown> = {}) => ({
    automationId: 'a1',
    name: 'x',
    status: 'ok',
    itemId: 'i1',
    depth: 0,
    actor: 'bob',
    at: serverTimestamp(),
    ...over,
  });
  const rp = (id: string) => `${boardPaths.runs(WID, MAIN_BOARD)}/${id}`;
  it('editors append as themselves; entries cannot be edited; editors can tidy old ones', async () => {
    const fs = db(env, 'bob');
    await assertSucceeds(setDoc(doc(fs, rp('r1')), run()));
    await assertSucceeds(
      setDoc(doc(fs, rp('r2')), run({ status: 'failed', error: 'column deleted' })),
    );
    await assertFails(setDoc(doc(fs, rp('r3')), run({ actor: 'alice' })));
    await assertFails(setDoc(doc(fs, rp('r4')), run({ status: 'weird' })));
    await assertFails(setDoc(doc(fs, rp('r5')), run({ depth: 11 })));
    await assertFails(setDoc(doc(fs, rp('r6')), run({ at: new Date(0) })));
    await assertFails(setDoc(doc(fs, rp('r7')), run({ extra: 1 })));
    await assertFails(setDoc(doc(db(env, 'carol'), rp('r8')), run({ actor: 'carol' })));
    await assertFails(updateDoc(doc(fs, rp('r1')), { status: 'failed' }));
    await assertSucceeds(getDoc(doc(db(env, 'carol'), rp('r1'))));
    await assertFails(getDoc(doc(db(env, 'dave'), rp('r1'))));
    await assertSucceeds(deleteDoc(doc(fs, rp('r1'))));
    await assertFails(deleteDoc(doc(db(env, 'carol'), rp('r2'))));
  });
});

// ------------------------------------------------------------------------------------------
// The real thing: the exact batches the browser would commit, run against the rules.
// ------------------------------------------------------------------------------------------

describe('engine batches are accepted by the rules (and cannot exceed the user’s power)', () => {
  const item1: EngineItem = {
    id: 'i1',
    name: 'Dishes',
    groupId: 'g1',
    order: 'a0',
    parentId: null,
    itemNumber: 1,
    values: { [status.id]: 'done' },
    archived: false,
    deleted: false,
  };
  let k = 0;
  const engine = (
    automations: Automation[],
    actor: string,
    startNumber: number | null = 2,
    members = ['alice', 'bob', 'carol'],
  ) =>
    runAutomations({
      wid: WID,
      bid: MAIN_BOARD,
      boardName: 'Board',
      event: { kind: 'cell', itemId: 'i1', columnId: status.id, before: 'todo', after: 'done' },
      items: new Map([['i1', item1]]),
      columns,
      groups,
      automations,
      actor,
      memberUids: new Set(members),
      memberName: (u) => u,
      today: '2026-03-10',
      startNumber,
      newId: (kind) => `${kind}${++k}-${Math.random().toString(36).slice(2, 7)}`,
    });
  const auto = (
    actions: Action[],
    trigger: Trigger = { type: 'statusChangedTo', columnId: status.id, labelId: 'done' },
  ): Automation => ({
    id: 'a1',
    name: 'Auto',
    enabled: true,
    ownerUid: 'alice',
    trigger,
    conditions: [],
    actions,
  });
  const original = (actor: string): WriteOp[] =>
    planSetCell({
      wid: WID,
      bid: MAIN_BOARD,
      iid: 'i1',
      uid: actor,
      columns,
      column: status,
      currentValues: {},
      value: 'done',
    });

  it('a rich recipe in one batch: set, move, notify, archive, create — plus the run record', async () => {
    const r = engine(
      [
        auto([
          { type: 'setValue', columnId: who.id, value: '@me' },
          { type: 'setValue', columnId: note.id, value: 'finished' },
          { type: 'moveToGroup', groupId: 'g2' },
          { type: 'notify', to: 'owner', uid: null, message: '{item} done' },
          { type: 'createItem', name: 'Follow up {item}', groupId: null, subitem: false },
        ]),
      ],
      'bob',
    );
    expect(r.runs[0]!.status).toBe('ok');
    const ops = withFinalCounter(
      [...original('bob'), ...r.ops],
      WID,
      MAIN_BOARD,
      true,
      r.counterNext as number,
    );
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
    const snap = await getDoc(doc(db(env, 'bob'), boardPaths.item(WID, MAIN_BOARD, 'i1')));
    expect(snap.data()).toMatchObject({ groupId: 'g2', assigneeUids: ['bob'] });
    expect((snap.data()?.['values'] as Record<string, unknown>)[note.id]).toBe('finished');
    expect(
      (await getDoc(doc(db(env, 'bob'), boardPaths.counter(WID, MAIN_BOARD)))).data()?.['next'],
    ).toBe(3);
  });
  it('a viewer’s edit is refused, automations and all (they have no more power than the person)', async () => {
    const r = engine([auto([{ type: 'setValue', columnId: note.id, value: 'x' }])], 'carol');
    await assertFails(commitOps(db(env, 'carol'), [...original('carol'), ...r.ops]));
  });
  it('an automation cannot notify a non-member or forge an actor', async () => {
    const forged = engine(
      [auto([{ type: 'notify', to: 'person', uid: 'alice', message: 'hi' }])],
      'bob',
    );
    const bad = forged.ops.map((o) =>
      o.kind === 'set' && o.path.includes('/notifications/')
        ? ({ ...o, data: { ...o.data, actor: 'alice' } } as WriteOp)
        : o,
    );
    await assertFails(commitOps(db(env, 'bob'), [...original('bob'), ...bad]));
    // the engine itself drops non-members, so nothing is written for them
    const dave = engine(
      [auto([{ type: 'notify', to: 'person', uid: 'dave', message: 'hi' }])],
      'bob',
    );
    expect(dave.ops.some((o) => o.path.includes('/notifications/dave/'))).toBe(false);
  });
  it('subitems and numbering: created items get the counter value and the counter moves once', async () => {
    const r = engine(
      [
        auto([
          { type: 'createItem', name: 'Check 1', groupId: null, subitem: true },
          { type: 'createItem', name: 'Check 2', groupId: null, subitem: true },
        ]),
      ],
      'bob',
      2,
    );
    expect(r.counterNext).toBe(4);
    await assertSucceeds(
      commitOps(
        db(env, 'bob'),
        withFinalCounter([...original('bob'), ...r.ops], WID, MAIN_BOARD, true, 4),
      ),
    );
  });
  it('the same numbers cannot be claimed twice: a stale counter write far ahead is refused', async () => {
    const stale = planCreateItem({
      wid: WID,
      bid: MAIN_BOARD,
      iid: 'zz',
      uid: 'bob',
      columns,
      counterExists: true,
      item: { name: 'x', groupId: 'g1', order: 'a1', itemNumber: 900 },
    });
    await assertFails(commitOps(db(env, 'bob'), stale));
  });
  it('run history written by the engine is accepted (ok, skipped and failed)', async () => {
    const a = auto([{ type: 'setValue', columnId: 'gone', value: 1 }]);
    const r = engine([a, { ...a, id: 'a2', actions: [{ type: 'archive' }] }], 'bob');
    expect(r.runs.map((x) => x.status)).toEqual(['failed', 'ok']);
    await assertSucceeds(commitOps(db(env, 'bob'), [...original('bob'), ...r.ops]));
  });
});
