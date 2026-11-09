import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  boardPaths,
  makeColumn,
  planAutomationSchedule,
  planItemSchedule,
  type Automation,
} from '@app/shared';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commitOps, db, MAIN_BOARD, PRIVATE_BOARD, seed, WID } from './helpers';
import { createEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => seed(env));

const due = makeColumn('date', 'Due');
const columns = [due];
const NOW = Date.parse('2026-03-10T00:00:00Z');
const remind: Automation = {
  id: 'r1',
  name: 'Bill reminder',
  enabled: true,
  ownerUid: 'bob',
  trigger: { type: 'dateArrives', columnId: due.id, which: 'end', offsetDays: -3, atTime: '09:00' },
  conditions: [],
  actions: [{ type: 'notify', to: 'owner', uid: null, message: 'x' }],
};
const base = { wid: WID, bid: MAIN_BOARD, columns, tz: 'Australia/Melbourne', nowMs: NOW };
const item = (id: string, date: string | null) => ({
  id,
  values: date ? { [due.id]: date } : {},
  archived: false,
  deleted: false,
});
const evPath = (eid: string, bid = MAIN_BOARD) => boardPaths.event(WID, bid, eid);

describe('scheduledEvents: what the app writes (the real planner output)', () => {
  it('members and admins register events; viewers and outsiders cannot', async () => {
    const ops = planItemSchedule({
      ...base,
      automations: [remind],
      item: item('i1', '2026-03-20'),
    });
    expect(ops[0]!.kind).toBe('set');
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
    await assertSucceeds(commitOps(db(env, 'alice'), ops));
    await assertFails(commitOps(db(env, 'carol'), ops));
    await assertFails(commitOps(db(env, 'dave'), ops));
  });
  it('registering for a whole automation (every dated item, plus removals) is one accepted batch', async () => {
    const ops = planAutomationSchedule({
      ...base,
      automation: remind,
      automationId: 'r1',
      items: [item('i1', '2026-03-20'), item('i2', '2026-04-01'), item('i3', null)],
    });
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
    expect((await getDoc(doc(db(env, 'alice'), evPath('r1_i1')))).exists()).toBe(true);
    expect((await getDoc(doc(db(env, 'alice'), evPath('r1_i3')))).exists()).toBe(false);
  });
  it('removing events needs no lookup and works whether or not they exist', async () => {
    const off = planAutomationSchedule({
      ...base,
      automation: null,
      automationId: 'r1',
      items: [item('i1', null), item('i2', null)],
    });
    expect(off.every((o) => o.kind === 'delete')).toBe(true);
    await assertSucceeds(commitOps(db(env, 'bob'), off)); // none exist yet
    await commitOps(
      db(env, 'bob'),
      planItemSchedule({ ...base, automations: [remind], item: item('i1', '2026-03-20') }),
    );
    await assertSucceeds(commitOps(db(env, 'bob'), off));
    await assertFails(commitOps(db(env, 'carol'), off));
  });
  it('private boards: only people on the board can register', async () => {
    const ops = planItemSchedule({
      ...base,
      bid: PRIVATE_BOARD,
      automations: [remind],
      item: item('i1', '2026-03-20'),
    });
    await assertSucceeds(commitOps(db(env, 'bob'), ops));
    await assertFails(commitOps(db(env, 'carol'), ops));
  });
  it('a recurring schedule is accepted', async () => {
    const rec: Automation = {
      ...remind,
      id: 'rc',
      trigger: {
        type: 'recurring',
        scope: 'board',
        schedule: {
          recurrence: { kind: 'weekly', every: 1, weekdays: [1] },
          atTime: '08:00',
          startDate: '2026-03-02',
        },
      },
    };
    await assertSucceeds(
      commitOps(
        db(env, 'bob'),
        planAutomationSchedule({ ...base, automation: rec, automationId: 'rc', items: [] }),
      ),
    );
  });
});

describe('scheduledEvents: tampering is refused', () => {
  const good = () =>
    (
      planItemSchedule({
        ...base,
        automations: [remind],
        item: item('i1', '2026-03-20'),
      })[0] as unknown as { data: Record<string, unknown> }
    ).data;
  const put = (id: string, data: Record<string, unknown>, who: 'bob' | 'alice' = 'bob') =>
    setDoc(doc(db(env, who), evPath(id)), data);
  it('clients can only write fresh pending events with zero attempts', async () => {
    const { updatedAt: _u, ...rest } = good();
    void _u;
    const withTime = { ...rest, updatedAt: (await import('firebase/firestore')).serverTimestamp() };
    await assertSucceeds(put('r1_i1', withTime));
    await assertFails(put('r1_i1', { ...withTime, status: 'done' }));
    await assertFails(put('r1_i1', { ...withTime, attempts: 2 }));
    await assertFails(put('r1_i1', { ...withTime, kind: 'weird' }));
    await assertFails(put('r1_i1', { ...withTime, fireAt: '2026-03-20' }));
    await assertFails(put('r1_i1', { ...withTime, extra: 1 }));
    await assertFails(put('r1_i1', { ...withTime, boardId: PRIVATE_BOARD })); // must be this board
    await assertFails(put('r1_i1', { ...withTime, updatedAt: new Date(0) }));
  });
  it('the document id must match the automation and item (no stuffing the queue with arbitrary ids)', async () => {
    const { updatedAt: _u, ...rest } = good();
    void _u;
    const t = { ...rest, updatedAt: (await import('firebase/firestore')).serverTimestamp() };
    await assertFails(put('anything', t));
    await assertFails(put('r1_other', t));
  });
  it('only admins can read the queue; clients cannot list or read it', async () => {
    await commitOps(
      db(env, 'bob'),
      planItemSchedule({ ...base, automations: [remind], item: item('i1', '2026-03-20') }),
    );
    await assertSucceeds(getDoc(doc(db(env, 'alice'), evPath('r1_i1'))));
    await assertFails(getDoc(doc(db(env, 'bob'), evPath('r1_i1'))));
    await assertFails(getDoc(doc(db(env, 'carol'), evPath('r1_i1'))));
  });
  it('viewers cannot delete', async () => {
    await commitOps(
      db(env, 'bob'),
      planItemSchedule({ ...base, automations: [remind], item: item('i1', '2026-03-20') }),
    );
    await assertFails(deleteDoc(doc(db(env, 'carol'), evPath('r1_i1'))));
    await assertSucceeds(deleteDoc(doc(db(env, 'bob'), evPath('r1_i1'))));
  });
});
