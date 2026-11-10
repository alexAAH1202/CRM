/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles and loose JSON */
import {
  boardPaths,
  makeColumn,
  planAutomationSchedule,
  planItemSchedule,
  type Automation,
  type Column,
} from '@app/shared';
import { describe, expect, it } from 'vitest';
import { FirestoreClient } from '../src/firestore';
import { rebuildSchedule, queueStatus, runDueEvents, RUN_BUDGET_MS } from '../src/scheduler';
import { FakeFirestore } from './fakeFirestore';
import { fakePlatform } from './fakes';

const W = 'w1';
const B = 'b1';
const TZ = 'Australia/Melbourne';
const NOW = Date.parse('2026-03-17T00:00:00Z'); // Tue 17 Mar 11:00 Melbourne
const status = makeColumn('status', 'Status', {
  labels: [
    { id: 'todo', name: 'To do', color: 'gray' },
    { id: 'done', name: 'Done', color: 'green' },
  ],
  defaultLabelId: 'todo',
});
const due = makeColumn('date', 'Due');
const note = makeColumn('text', 'Note');
const columns: Column[] = [status, due, note];
const groups = [{ id: 'g1', name: 'Bills', color: 'blue' }];
const bpath = `workspaces/${W}/boards/${B}`;

const reminder: Automation = {
  id: 'a1',
  name: 'Bill reminder',
  enabled: true,
  ownerUid: 'owner',
  trigger: { type: 'dateArrives', columnId: due.id, which: 'end', offsetDays: -3, atTime: '09:00' },
  conditions: [],
  actions: [{ type: 'notify', to: 'owner', uid: null, message: '{item} is due soon' }],
};

function world(autos: Automation[] = [reminder]) {
  const fs = new FakeFirestore();
  fs.now = () => new Date(NOW);
  fs.set(`workspaces/${W}`, { name: 'Home', settings: { timezone: TZ }, adminUids: ['owner'] });
  fs.set(`workspaces/${W}/members/owner`, { role: 'admin', displayName: 'Olive Owner' });
  fs.set(`workspaces/${W}/members/bob`, { role: 'member', displayName: 'Bob' });
  fs.set(bpath, { name: 'Bills', columns, groups, visibility: 'main' });
  fs.set(`${bpath}/meta/counter`, { next: 10 });
  for (const a of autos)
    fs.set(`${bpath}/automations/${a.id}`, {
      name: a.name,
      enabled: a.enabled,
      ownerUid: a.ownerUid,
      trigger: a.trigger,
      conditions: a.conditions,
      actions: a.actions,
    });
  const f = fakePlatform({ now: NOW, respond: fs.respond });
  return { fs, ...f };
}

const addItem = (
  fs: FakeFirestore,
  id: string,
  values: Record<string, unknown>,
  over: Record<string, unknown> = {},
) =>
  fs.set(`${bpath}/items/${id}`, {
    name: id,
    groupId: 'g1',
    order: 'a0',
    parentId: null,
    itemNumber: 1,
    values,
    assigneeUids: [],
    archived: false,
    deletedAt: null,
    ...over,
  });

/** Register events exactly as the browser does, then apply them to the fake database. */
function register(
  fs: FakeFirestore,
  autos: Automation[],
  items: Array<{ id: string; values: Record<string, unknown> }>,
  nowMs = NOW - 5 * 86400_000,
) {
  for (const a of autos) {
    const ops = planAutomationSchedule({
      wid: W,
      bid: B,
      columns,
      tz: TZ,
      nowMs,
      automation: a,
      automationId: a.id,
      items: items.map((i) => ({ ...i, archived: false, deleted: false })),
    });
    for (const op of ops) {
      if (op.kind === 'set')
        fs.set(
          op.path,
          (({ updatedAt: _u, ...d }) => {
            void _u;
            return d;
          })(op.data as any),
        );
      else fs.docs.delete(op.path);
    }
  }
}
const evPath = (eid: string) => `${bpath}/scheduledEvents/${eid}`;
const notifications = (fs: FakeFirestore) =>
  fs.list(`workspaces/${W}/notifications/`).map((p) => ({ path: p, ...(fs.get(p) as any) }));

describe('scheduler: date reminders', () => {
  it('nothing due: one query, no writes', () => {
    const w = world();
    addItem(w.fs, 'i1', { [due.id]: '2026-03-30' });
    register(w.fs, [reminder], [{ id: 'i1', values: { [due.id]: '2026-03-30' } }]);
    const sum = runDueEvents(w.p);
    expect(sum).toMatchObject({ due: 0, processed: 0 });
    expect(w.fs.requests.filter((r) => r.kind === 'commit')).toHaveLength(0);
    expect(w.fs.requests.filter((r) => r.kind === 'query')).toHaveLength(1);
  });

  it('a due reminder notifies the owner once, marks the event done, and leaves a run record and activity entry', () => {
    const w = world();
    addItem(w.fs, 'i1', { [due.id]: '2026-03-20' }, { name: 'Electricity' }); // reminder was 17 Mar 09:00 (-3 days)
    register(
      w.fs,
      [reminder],
      [{ id: 'i1', values: { [due.id]: '2026-03-20' } }],
      NOW - 86400_000 * 3,
    );
    expect((w.fs.get(evPath('a1_i1')) as any).status).toBe('pending');
    const sum = runDueEvents(w.p);
    expect(sum).toMatchObject({ due: 1, fired: 1, failed: 0 });
    const n = notifications(w.fs);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      type: 'automation',
      title: 'Electricity is due soon',
      actor: 'owner',
      read: false,
      link: `/w/${W}/b/${B}?item=i1`,
    });
    expect(n[0]!.path).toContain('/notifications/owner/');
    const ev = w.fs.get(evPath('a1_i1')) as any;
    expect(ev).toMatchObject({ status: 'done', attempts: 1 });
    expect(ev.doneAt).toBeInstanceOf(Date);
    expect(w.fs.list(`${bpath}/automationRuns/`)).toHaveLength(1);
    const run = w.fs.get(w.fs.list(`${bpath}/automationRuns/`)[0]!) as any;
    expect(run).toMatchObject({ automationId: 'a1', status: 'ok', itemId: 'i1', actor: 'owner' });
    const act = w.fs.list(`${bpath}/activity/`).map((p) => w.fs.get(p) as any);
    expect(act).toHaveLength(1);
    expect(act[0]).toMatchObject({
      type: 'automation',
      itemId: 'i1',
      actor: 'owner',
      data: { text: 'Automation “Bill reminder” ran' },
    });
  });

  it('is idempotent: running again (or twice at once) sends nothing more', () => {
    const w = world();
    addItem(w.fs, 'i1', { [due.id]: '2026-03-20' });
    register(
      w.fs,
      [reminder],
      [{ id: 'i1', values: { [due.id]: '2026-03-20' } }],
      NOW - 86400_000 * 3,
    );
    runDueEvents(w.p);
    expect(runDueEvents(w.p)).toMatchObject({ due: 0 });
    expect(notifications(w.fs)).toHaveLength(1);
  });

  it('two schedulers overlapping: the one that loses the race changes nothing (exactly-once)', () => {
    const w = world();
    addItem(w.fs, 'i1', { [due.id]: '2026-03-20' });
    register(
      w.fs,
      [reminder],
      [{ id: 'i1', values: { [due.id]: '2026-03-20' } }],
      NOW - 86400_000 * 3,
    );
    // Just before our commit lands, a second run handles the same event.
    let raced = false;
    w.fs.beforeCommit = () => {
      if (raced) return;
      raced = true;
      w.fs.beforeCommit = null;
      runDueEvents(w.p); // the "other" run, nested inside ours
    };
    const sum = runDueEvents(w.p);
    expect(notifications(w.fs)).toHaveLength(1); // not two
    expect(sum.skipped + sum.fired).toBe(1);
    expect((w.fs.get(evPath('a1_i1')) as any).status).toBe('done');
  });

  it('if the date moved after registering, it reschedules instead of firing', () => {
    const w = world();
    addItem(w.fs, 'i1', { [due.id]: '2026-03-20' });
    register(
      w.fs,
      [reminder],
      [{ id: 'i1', values: { [due.id]: '2026-03-20' } }],
      NOW - 86400_000 * 3,
    );
    // someone moved the date without the event being updated (e.g. an old client)
    w.fs.touch(`${bpath}/items/i1`, { values: { [due.id]: '2026-04-10' } });
    const sum = runDueEvents(w.p);
    expect(sum).toMatchObject({ fired: 0, skipped: 1 });
    expect(notifications(w.fs)).toHaveLength(0);
    const ev = w.fs.get(evPath('a1_i1')) as any;
    expect(ev).toMatchObject({ status: 'pending', dateValue: '2026-04-10' });
    expect(ev.fireAt.toISOString()).toBe('2026-04-06T23:00:00.000Z'); // 7 Apr 09:00 Melbourne (+10: clocks went back on 5 Apr)
  });

  it('deleted / archived items and removed automations just drop the event', () => {
    const w = world();
    for (const id of ['gone', 'arch', 'ok']) addItem(w.fs, id, { [due.id]: '2026-03-20' });
    w.fs.touch(`${bpath}/items/gone`, { deletedAt: new Date(NOW) });
    w.fs.touch(`${bpath}/items/arch`, { archived: true });
    register(
      w.fs,
      [reminder],
      ['gone', 'arch', 'ok'].map((id) => ({ id, values: { [due.id]: '2026-03-20' } })),
      NOW - 86400_000 * 3,
    );
    const sum = runDueEvents(w.p);
    expect(sum.fired).toBe(1);
    expect(w.fs.get(evPath('a1_gone'))).toBeUndefined();
    expect(w.fs.get(evPath('a1_arch'))).toBeUndefined();
    expect(notifications(w.fs)).toHaveLength(1);
    // automation switched off after events were registered
    const w2 = world([{ ...reminder, enabled: false }]);
    addItem(w2.fs, 'i1', { [due.id]: '2026-03-20' });
    register(
      w2.fs,
      [reminder],
      [{ id: 'i1', values: { [due.id]: '2026-03-20' } }],
      NOW - 86400_000 * 3,
    );
    runDueEvents(w2.p);
    expect(notifications(w2.fs)).toHaveLength(0);
    expect(w2.fs.get(evPath('a1_i1'))).toBeUndefined();
    // the owner left the household (or became a viewer): the automation stops acting for them
    const w3 = world();
    w3.fs.set(`workspaces/${W}/members/owner`, { role: 'viewer', displayName: 'Olive Owner' });
    addItem(w3.fs, 'i1', { [due.id]: '2026-03-20' });
    register(
      w3.fs,
      [reminder],
      [{ id: 'i1', values: { [due.id]: '2026-03-20' } }],
      NOW - 86400_000 * 3,
    );
    runDueEvents(w3.p);
    expect(notifications(w3.fs)).toHaveLength(0);
    expect(w3.fs.get(evPath('a1_i1'))).toBeUndefined();
  });

  it('overdue fires only for items that are not done', () => {
    const od: Automation = {
      ...reminder,
      id: 'od',
      name: 'Overdue',
      trigger: { type: 'overdue', columnId: due.id, atTime: '09:00' },
      actions: [{ type: 'notify', to: 'owner', uid: null, message: '{item} is overdue' }],
    };
    const w = world([od]);
    addItem(w.fs, 'late', { [due.id]: '2026-03-15' });
    addItem(w.fs, 'paid', { [due.id]: '2026-03-15', [status.id]: 'done' });
    register(
      w.fs,
      [od],
      [
        { id: 'late', values: { [due.id]: '2026-03-15' } },
        { id: 'paid', values: { [due.id]: '2026-03-15' } },
      ],
      NOW - 4 * 86400_000,
    );
    runDueEvents(w.p);
    expect(notifications(w.fs).map((n) => n.title)).toEqual(['late is overdue']);
    expect(w.fs.get(evPath('od_paid'))).toBeUndefined();
  });
});

describe('scheduler: recurring', () => {
  const weekly = (
    scope: 'board' | 'items',
    actions: Automation['actions'],
    over: Partial<Automation> = {},
  ): Automation => ({
    id: 'wk',
    name: 'Weekly',
    enabled: true,
    ownerUid: 'owner',
    conditions: [],
    actions,
    trigger: {
      type: 'recurring',
      scope,
      schedule: {
        recurrence: { kind: 'weekly', every: 1, weekdays: [2] },
        atTime: '08:00',
        startDate: '2026-03-02',
      },
    },
    ...over,
  });
  // Tue 17 Mar 08:00 Melbourne = 16 Mar 21:00Z: due by NOW (17 Mar 00:00Z = 11:00 local)
  const due17 = (fs: FakeFirestore, a: Automation, items: any[] = []) =>
    register(fs, [a], items, Date.parse('2026-03-10T00:00:00Z'));

  it('board-wide: creates a numbered item, advances the counter, and schedules next week', () => {
    const a = weekly('board', [
      { type: 'createItem', name: 'Take out the bins', groupId: null, subitem: false },
    ]);
    const w = world([a]);
    due17(w.fs, a);
    const ev0 = w.fs.get(evPath('wk')) as any;
    expect(ev0.fireAt.toISOString()).toBe('2026-03-16T21:00:00.000Z');
    expect(runDueEvents(w.p)).toMatchObject({ fired: 1 });
    const items = w.fs.list(`${bpath}/items/`);
    expect(items).toHaveLength(1);
    expect(w.fs.get(items[0]!)).toMatchObject({
      name: 'Take out the bins',
      itemNumber: 10,
      groupId: 'g1',
      parentId: null,
      createdBy: 'owner',
    });
    expect(w.fs.get(`${bpath}/meta/counter`)).toEqual({ next: 11 });
    const ev = w.fs.get(evPath('wk')) as any;
    expect(ev.status).toBe('pending');
    expect(ev.fireAt.toISOString()).toBe('2026-03-23T21:00:00.000Z'); // next Tue 24 Mar 08:00 (+11)
    expect(ev.idempotencyKey).toBe(`wk:${ev.fireAt.getTime()}`);
    expect(runDueEvents(w.p)).toMatchObject({ due: 0 }); // not again until next week
    expect(w.fs.list(`${bpath}/items/`)).toHaveLength(1);
  });

  it('per item: resets every Done item to To do (conditions apply), one batch', () => {
    const a = weekly('items', [{ type: 'setValue', columnId: status.id, value: 'todo' }], {
      conditions: [{ id: 'c', columnId: status.id, op: 'is', value: ['done'] }],
    });
    const w = world([a]);
    addItem(w.fs, 'a', { [status.id]: 'done' });
    addItem(w.fs, 'b', { [status.id]: 'done' });
    addItem(w.fs, 'c', { [status.id]: 'todo' });
    addItem(w.fs, 'd', {}, { archived: true });
    due17(w.fs, a);
    expect(runDueEvents(w.p)).toMatchObject({ fired: 1 });
    expect((w.fs.get(`${bpath}/items/a`) as any).values[status.id]).toBe('todo');
    expect((w.fs.get(`${bpath}/items/b`) as any).values[status.id]).toBe('todo');
    expect((w.fs.get(`${bpath}/items/c`) as any).values[status.id]).toBe('todo');
    expect(w.fs.get(`${bpath}/items/a`)).toMatchObject({ updatedBy: 'owner' });
    expect(w.fs.list(`${bpath}/automationRuns/`)).toHaveLength(2); // one run per item that matched
  });

  it('with nothing matching it still reschedules and writes nothing else', () => {
    const a = weekly('items', [{ type: 'setValue', columnId: status.id, value: 'todo' }], {
      conditions: [{ id: 'c', columnId: status.id, op: 'is', value: ['done'] }],
    });
    const w = world([a]);
    addItem(w.fs, 'c', { [status.id]: 'todo' });
    due17(w.fs, a);
    expect(runDueEvents(w.p)).toMatchObject({ skipped: 1, fired: 0 });
    expect((w.fs.get(evPath('wk')) as any).fireAt.toISOString()).toBe('2026-03-23T21:00:00.000Z');
    expect(w.fs.list(`${bpath}/automationRuns/`)).toHaveLength(0);
  });

  it('a run that cannot work (a deleted column) is recorded as failed but the series carries on', () => {
    const a = weekly('items', [{ type: 'setValue', columnId: 'deleted-column', value: 'x' }]);
    const w = world([a]);
    addItem(w.fs, 'a', {});
    due17(w.fs, a);
    expect(runDueEvents(w.p)).toMatchObject({ failed: 1 });
    const run = w.fs.get(w.fs.list(`${bpath}/automationRuns/`)[0]!) as any;
    expect(run).toMatchObject({ status: 'failed' });
    const ev = w.fs.get(evPath('wk')) as any;
    expect(ev.status).toBe('pending');
    expect(ev.lastError).toMatch(/deleted/);
    expect(ev.fireAt.toISOString()).toBe('2026-03-23T21:00:00.000Z');
  });

  it('the board counter moving under us is retried, never reused', () => {
    const a = weekly('board', [
      { type: 'createItem', name: 'Chore', groupId: null, subitem: false },
    ]);
    const w = world([a]);
    due17(w.fs, a);
    let bumped = false;
    w.fs.beforeCommit = () => {
      if (bumped) return;
      bumped = true;
      w.fs.touch(`${bpath}/meta/counter`, { next: 15 }); // someone created items meanwhile
    };
    expect(runDueEvents(w.p)).toMatchObject({ fired: 1 });
    const created = w.fs.list(`${bpath}/items/`).map((p) => w.fs.get(p) as any);
    expect(created).toHaveLength(1);
    expect(created[0].itemNumber).toBe(15); // took the new counter value
    expect(w.fs.get(`${bpath}/meta/counter`)).toEqual({ next: 16 });
  });
});

describe('scheduler: failures and limits', () => {
  it('a database outage is retried later with backoff, then given up after three attempts', () => {
    const w = world();
    addItem(w.fs, 'i1', { [due.id]: '2026-03-20' });
    register(
      w.fs,
      [reminder],
      [{ id: 'i1', values: { [due.id]: '2026-03-20' } }],
      NOW - 86400_000 * 3,
    );
    w.fs.failCommits = { status: 503, count: 1 };
    expect(runDueEvents(w.p)).toMatchObject({ retried: 1 });
    let ev = w.fs.get(evPath('a1_i1')) as any;
    expect(ev).toMatchObject({ status: 'pending', attempts: 1 });
    expect(ev.fireAt.getTime()).toBe(NOW + 10 * 60 * 1000);
    expect(notifications(w.fs)).toHaveLength(0);
    // not due again for 10 minutes
    expect(runDueEvents(w.p)).toMatchObject({ due: 0 });
    w.advance(11 * 60 * 1000);
    w.fs.failCommits = { status: 503, count: 1 };
    expect(runDueEvents(w.p)).toMatchObject({ retried: 1 });
    ev = w.fs.get(evPath('a1_i1')) as any;
    expect(ev.attempts).toBe(2);
    w.advance(30 * 60 * 1000);
    w.fs.failCommits = { status: 503, count: 1 };
    expect(runDueEvents(w.p)).toMatchObject({ failed: 1 });
    ev = w.fs.get(evPath('a1_i1')) as any;
    expect(ev).toMatchObject({ status: 'failed', attempts: 3 });
    expect(ev.lastError).toBeTruthy();
    expect(runDueEvents(w.p)).toMatchObject({ due: 0 }); // failed events are left alone
  });

  it('a transient failure followed by success fires exactly once', () => {
    const w = world();
    addItem(w.fs, 'i1', { [due.id]: '2026-03-20' });
    register(
      w.fs,
      [reminder],
      [{ id: 'i1', values: { [due.id]: '2026-03-20' } }],
      NOW - 86400_000 * 3,
    );
    w.fs.failCommits = { status: 503, count: 1 };
    runDueEvents(w.p);
    w.advance(11 * 60 * 1000);
    expect(runDueEvents(w.p)).toMatchObject({ fired: 1 });
    expect(notifications(w.fs)).toHaveLength(1);
  });

  it('stops starting new events when out of time; the rest stay pending for next run', () => {
    const w = world();
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `i${i}`,
      values: { [due.id]: '2026-03-20' },
    }));
    items.forEach((i) => addItem(w.fs, i.id, i.values));
    register(w.fs, [reminder], items, NOW - 86400_000 * 3);
    // every network call "takes" 1 minute of the 4-minute budget
    const orig = w.fs.respond;
    // eslint-disable-next-line prefer-const
    let clock: { advance: (ms: number) => number };
    const p = fakePlatform({
      now: NOW,
      respond: (req) => {
        clock.advance(60_000);
        return orig(req);
      },
    });
    clock = p;
    const sum = runDueEvents(p.p, { budgetMs: RUN_BUDGET_MS });
    expect(sum.due).toBe(6);
    expect(sum.deferred).toBeGreaterThan(0);
    expect(sum.fired).toBeLessThan(6);
    const pending = [...w.fs.docs.entries()].filter(
      ([k, v]) => k.includes('/scheduledEvents/') && (v.data as any).status === 'pending',
    );
    expect(pending.length).toBe(6 - sum.fired);
    expect(notifications(w.fs)).toHaveLength(sum.fired);
  });

  it('the per-run cap limits how many are taken at once', () => {
    const w = world();
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `i${i}`,
      values: { [due.id]: '2026-03-20' },
    }));
    items.forEach((i) => addItem(w.fs, i.id, i.values));
    register(w.fs, [reminder], items, NOW - 86400_000 * 3);
    expect(runDueEvents(w.p, { limit: 2 })).toMatchObject({ due: 2, fired: 2 });
    expect(runDueEvents(w.p, { limit: 2 })).toMatchObject({ due: 2, fired: 2 });
    expect(runDueEvents(w.p, { limit: 2 })).toMatchObject({ due: 1, fired: 1 });
  });

  it('events for a board that no longer exists are removed; malformed ones are ignored safely', () => {
    const w = world();
    w.fs.set('workspaces/gone/boards/b/scheduledEvents/x', {
      kind: 'date',
      automationId: 'a',
      itemId: 'i',
      boardId: 'b',
      fireAt: new Date(NOW - 1000),
      status: 'pending',
      attempts: 0,
      dateValue: '2026-03-20',
      idempotencyKey: 'k',
    });
    w.fs.set(`${bpath}/scheduledEvents/junk`, { status: 'pending', fireAt: new Date(NOW - 1000) });
    expect(() => runDueEvents(w.p)).not.toThrow();
    expect(w.fs.get('workspaces/gone/boards/b/scheduledEvents/x')).toBeUndefined();
  });

  it('what notifications go to: only current members, never made-up uids', () => {
    const a: Automation = {
      ...reminder,
      actions: [
        { type: 'notify', to: 'person', uid: 'bob', message: 'hi' },
        { type: 'notify', to: 'person', uid: 'ghost', message: 'hi' },
      ],
    };
    const w = world([a]);
    addItem(w.fs, 'i1', { [due.id]: '2026-03-20' });
    register(w.fs, [a], [{ id: 'i1', values: { [due.id]: '2026-03-20' } }], NOW - 86400_000 * 3);
    runDueEvents(w.p);
    expect(notifications(w.fs).map((n) => n.path.split('/')[3])).toEqual(['bob']);
  });
});

describe('rebuild schedule and queue status', () => {
  it('rebuilds missing events from the data and removes ones that belong to nothing', () => {
    const w = world();
    addItem(w.fs, 'i1', { [due.id]: '2026-03-30' });
    addItem(w.fs, 'i2', { [due.id]: '2026-04-02' });
    addItem(w.fs, 'i3', {});
    // an orphan (item deleted long ago) and a stale event for an automation that doesn't exist
    w.fs.set(evPath('a1_oldItem'), {
      kind: 'date',
      automationId: 'a1',
      itemId: 'oldItem',
      boardId: B,
      fireAt: new Date(NOW + 1e9),
      status: 'pending',
      attempts: 0,
      idempotencyKey: 'k',
      dateValue: '2026-03-30',
    });
    w.fs.set(evPath('zz_i1'), {
      kind: 'date',
      automationId: 'zz',
      itemId: 'i1',
      boardId: B,
      fireAt: new Date(NOW + 1e9),
      status: 'pending',
      attempts: 0,
      idempotencyKey: 'k',
      dateValue: '2026-03-30',
    });
    const db = new FirestoreClient(w.p, 'life-management-de315');
    const r = rebuildSchedule(w.p, db, W);
    expect(r).toMatchObject({ boards: 1, automations: 1, registered: 2, removed: 2 });
    expect(w.fs.list(`${bpath}/scheduledEvents/`).map((p) => p.split('/').pop())).toEqual([
      'a1_i1',
      'a1_i2',
    ]);
  });

  it('reports the queue, and flags a stalled scheduler', () => {
    const w = world();
    addItem(w.fs, 'i1', { [due.id]: '2026-03-30' });
    register(w.fs, [reminder], [{ id: 'i1', values: { [due.id]: '2026-03-30' } }]);
    const db = new FirestoreClient(w.p, 'life-management-de315');
    expect(queueStatus(w.p, db, W)).toMatchObject({ pending: 1, failed: 0, stalled: false });
    w.fs.set(evPath('late'), {
      kind: 'date',
      automationId: 'a1',
      itemId: 'x',
      boardId: B,
      fireAt: new Date(NOW - 3 * 3600_000),
      status: 'pending',
      attempts: 0,
      idempotencyKey: 'k',
      dateValue: null,
    });
    w.fs.set(evPath('bad'), {
      kind: 'date',
      automationId: 'a1',
      itemId: 'y',
      boardId: B,
      fireAt: new Date(NOW),
      status: 'failed',
      attempts: 3,
      idempotencyKey: 'k',
      dateValue: null,
    });
    expect(queueStatus(w.p, db, W)).toMatchObject({ pending: 2, failed: 1, stalled: true });
  });
});

void boardPaths;
void planItemSchedule;
