import { makeColumn, type Automation } from '@app/shared';
import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/router';
import { FakeFirestore } from './fakeFirestore';
import { fakeJwt, fakePlatform, json } from './fakes';

const NOW = Date.parse('2026-03-17T00:00:00Z');
const due = makeColumn('date', 'Due');
const reminder: Automation = {
  id: 'a1',
  name: 'Reminder',
  enabled: true,
  ownerUid: 'u-admin',
  trigger: { type: 'dateArrives', columnId: due.id, which: 'end', offsetDays: -3, atTime: '09:00' },
  conditions: [],
  actions: [{ type: 'notify', to: 'owner', uid: null, message: 'x' }],
};

function world(callerRole: 'admin' | 'member' | 'viewer' | null) {
  const fs = new FakeFirestore();
  fs.now = () => new Date(NOW);
  fs.set('workspaces/w1', { name: 'Home', settings: { timezone: 'Australia/Melbourne' } });
  if (callerRole) fs.set('workspaces/w1/members/u1', { role: callerRole, displayName: 'Caller' });
  fs.set('workspaces/w1/boards/b1', {
    name: 'Bills',
    columns: [due],
    groups: [{ id: 'g', name: 'G', color: 'blue' }],
  });
  fs.set('workspaces/w1/boards/b1/automations/a1', {
    name: reminder.name,
    enabled: true,
    ownerUid: 'u-admin',
    trigger: reminder.trigger,
    conditions: [],
    actions: reminder.actions,
  });
  fs.set('workspaces/w1/boards/b1/items/i1', {
    name: 'Rates',
    groupId: 'g',
    order: 'a0',
    parentId: null,
    itemNumber: 1,
    values: { [due.id]: '2026-04-20' },
    archived: false,
    deletedAt: null,
  });
  const f = fakePlatform({
    now: NOW,
    respond: (req) =>
      req.url.includes('accounts:lookup')
        ? json(200, { users: [{ localId: 'u1', email: 'u1@example.com' }] })
        : fs.respond(req),
  });
  const call = (action: string, extra: object = {}) =>
    handleRequest(
      f.p,
      JSON.stringify({
        action,
        idToken: fakeJwt({ exp: Math.floor(NOW / 1000) + 3600 }),
        workspaceId: 'w1',
        ...extra,
      }),
    );
  return { fs, call };
}

describe('scheduler admin actions through the router', () => {
  it('rebuildSchedule: admins only', () => {
    for (const role of ['member', 'viewer', null] as const) {
      const w = world(role);
      expect(w.call('rebuildSchedule')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(w.fs.list('workspaces/w1/boards/b1/scheduledEvents/')).toHaveLength(0); // nothing was touched
    }
    const w = world('admin');
    const r = w.call('rebuildSchedule');
    expect(r).toMatchObject({
      ok: true,
      data: { boards: 1, automations: 1, registered: 1, removed: 0 },
    });
    expect(w.fs.list('workspaces/w1/boards/b1/scheduledEvents/')).toEqual([
      'workspaces/w1/boards/b1/scheduledEvents/a1_i1',
    ]);
  });
  it('schedulerStatus: admins only, reports the queue', () => {
    expect(world('member').call('schedulerStatus')).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    const w = world('admin');
    w.call('rebuildSchedule');
    expect(w.call('schedulerStatus')).toMatchObject({
      ok: true,
      data: { pending: 1, failed: 0, stalled: false },
    });
  });
  it('a workspace id has to be given (and be sane)', () => {
    const w = world('admin');
    expect(w.call('rebuildSchedule', { workspaceId: undefined })).toMatchObject({
      ok: false,
      error: { code: 'bad_request' },
    });
    expect(w.call('rebuildSchedule', { workspaceId: '../other' })).toMatchObject({
      ok: false,
      error: { code: 'bad_request' },
    });
    expect(w.call('rebuildSchedule', { workspaceId: 'someone-elses' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });
});
