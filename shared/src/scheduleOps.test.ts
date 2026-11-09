/* eslint-disable @typescript-eslint/no-explicit-any -- loose test data */
import { describe, expect, it } from 'vitest';
import {
  parseAutomation,
  resolveDateToken,
  scheduledActionProblem,
  describeAutomation,
  type Automation,
} from './automations';
import { makeColumn } from './columns';
import {
  eventId,
  itemFireAt,
  planAutomationSchedule,
  planItemSchedule,
  triggerDate,
  type SchedItem,
} from './scheduleOps';

const due = makeColumn('date', 'Due date');
const when = makeColumn('timeline', 'When');
const note = makeColumn('text', 'Note');
const columns = [due, when, note];
const TZ = 'Australia/Melbourne';
const NOW = Date.parse('2026-03-10T00:00:00Z'); // 10 Mar 11:00 Melbourne
const ctx = { wid: 'w', bid: 'b', columns, tz: TZ, nowMs: NOW };

const item = (
  id: string,
  values: Record<string, unknown>,
  over: Partial<SchedItem> = {},
): SchedItem => ({ id, values, archived: false, deleted: false, ...over });
const auto = (
  id: string,
  trigger: Automation['trigger'],
  over: Partial<Automation> = {},
): Automation => ({
  id,
  name: id,
  enabled: true,
  ownerUid: 'o',
  trigger,
  conditions: [],
  actions: [{ type: 'notify', to: 'owner', uid: null, message: 'x' }],
  ...over,
});
const remind = (offset = -3, atTime = '09:00') =>
  auto('r', { type: 'dateArrives', columnId: due.id, which: 'end', offsetDays: offset, atTime });
const data = (op: { kind: string }) => (op as unknown as { data: Record<string, any> }).data;

describe('event planning for items', () => {
  it('registers a reminder N days before the date, at the time, in the zone', () => {
    const ops = planItemSchedule({
      ...ctx,
      automations: [remind(-3)],
      item: item('i1', { [due.id]: '2026-03-20' }),
    });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      kind: 'set',
      path: 'workspaces/w/boards/b/scheduledEvents/r_i1',
    });
    const d = data(ops[0]!);
    expect(d['fireAt'].toISOString()).toBe('2026-03-16T22:00:00.000Z'); // 17 Mar 09:00 Melbourne
    expect(d).toMatchObject({
      kind: 'date',
      automationId: 'r',
      itemId: 'i1',
      boardId: 'b',
      status: 'pending',
      attempts: 0,
      dateValue: '2026-03-20',
    });
    expect(d['idempotencyKey']).toBe('r:i1:2026-03-20:-3');
  });
  it('a changed date gives a new fire time (overwrites the same event id)', () => {
    const a = planItemSchedule({
      ...ctx,
      automations: [remind()],
      item: item('i1', { [due.id]: '2026-03-20' }),
    });
    const b = planItemSchedule({
      ...ctx,
      automations: [remind()],
      item: item('i1', { [due.id]: '2026-03-25' }),
    });
    expect(a[0]!.path).toBe(b[0]!.path);
    expect(data(a[0]!)['fireAt']).not.toEqual(data(b[0]!)['fireAt']);
  });
  it('removes the event when the date is cleared, the item is deleted/archived, or the moment has passed', () => {
    const autos = [remind()];
    const gone = (it: SchedItem) => planItemSchedule({ ...ctx, automations: autos, item: it });
    expect(gone(item('i1', {}))).toEqual([
      { kind: 'delete', path: 'workspaces/w/boards/b/scheduledEvents/r_i1' },
    ]);
    expect(gone(item('i1', { [due.id]: '2026-03-20' }, { deleted: true }))[0]!.kind).toBe('delete');
    expect(gone(item('i1', { [due.id]: '2026-03-20' }, { archived: true }))[0]!.kind).toBe(
      'delete',
    );
    expect(gone(item('i1', { [due.id]: '2026-03-01' }))[0]!.kind).toBe('delete'); // reminder moment long past
  });
  it('a moment only a few hours old is still registered (so a slow save is not lost)', () => {
    // due 13 Mar, offset -3 → 10 Mar 09:00 Melbourne = 9 Mar 22:00Z, 2h before NOW
    expect(
      planItemSchedule({
        ...ctx,
        automations: [remind(-3)],
        item: item('i1', { [due.id]: '2026-03-13' }),
      })[0]!.kind,
    ).toBe('set');
  });
  it('overdue fires the day after the date, using the same date column', () => {
    const od = auto('o1', { type: 'overdue', columnId: due.id, atTime: '08:00' });
    const [op] = planItemSchedule({
      ...ctx,
      automations: [od],
      item: item('i1', { [due.id]: '2026-03-20' }),
    });
    expect(data(op!)['fireAt'].toISOString()).toBe('2026-03-20T21:00:00.000Z'); // 21 Mar 08:00 Melbourne
    expect(data(op!)['kind']).toBe('overdue');
  });
  it('timelines: start or end', () => {
    const tl = { [when.id]: { start: '2026-04-01', end: '2026-04-09' } };
    const t = (which: 'start' | 'end') =>
      ({ type: 'dateArrives', columnId: when.id, which, offsetDays: 0, atTime: '09:00' }) as const;
    expect(triggerDate(t('start'), { values: tl }, columns)).toBe('2026-04-01');
    expect(triggerDate(t('end'), { values: tl }, columns)).toBe('2026-04-09');
    expect(itemFireAt(t('end'), { values: tl }, columns, 'UTC')!.fireAt).toBe(
      Date.parse('2026-04-09T09:00:00Z'),
    );
  });
  it('ignores instant automations, disabled ones (removed) and non-date columns', () => {
    const instant = auto('x', { type: 'itemCreated' });
    expect(planItemSchedule({ ...ctx, automations: [instant], item: item('i', {}) })).toEqual([]);
    expect(
      planItemSchedule({
        ...ctx,
        automations: [{ ...remind(), enabled: false }],
        item: item('i', { [due.id]: '2026-03-20' }),
      })[0]!.kind,
    ).toBe('delete');
    const bad = auto('b', {
      type: 'dateArrives',
      columnId: note.id,
      which: 'end',
      offsetDays: 0,
      atTime: '09:00',
    });
    expect(
      planItemSchedule({
        ...ctx,
        automations: [bad],
        item: item('i', { [note.id]: '2026-03-20' }),
      })[0]!.kind,
    ).toBe('delete');
  });
  it('deterministic ids', () => {
    expect(eventId('a', 'i')).toBe('a_i');
    expect(eventId('a', null)).toBe('a');
  });
});

describe('event planning for an automation', () => {
  const items = [
    item('i1', { [due.id]: '2026-03-20' }),
    item('i2', { [due.id]: '2026-03-30' }),
    item('i3', {}),
  ];
  const plan = (a: Automation | null, id = 'r') =>
    planAutomationSchedule({ ...ctx, automation: a, automationId: id, items });
  it('creating / enabling registers an event per dated item (and clears the rest)', () => {
    const ops = plan(remind());
    expect(ops.filter((o) => o.kind === 'set').map((o) => o.path.split('/').pop())).toEqual([
      'r_i1',
      'r_i2',
    ]);
    expect(ops.filter((o) => o.kind === 'delete').map((o) => o.path.split('/').pop())).toEqual([
      'r',
      'r_i3',
    ]);
  });
  it('switching off or deleting removes every event, with no lookups needed', () => {
    for (const a of [{ ...remind(), enabled: false }, null]) {
      const ops = plan(a);
      expect(ops.every((o) => o.kind === 'delete')).toBe(true);
      expect(ops.map((o) => o.path.split('/').pop())).toEqual(['r', 'r_i1', 'r_i2', 'r_i3']);
    }
  });
  it('recurring: one event for the automation at the next occurrence', () => {
    const rec = auto('rc', {
      type: 'recurring',
      scope: 'items',
      schedule: {
        recurrence: { kind: 'weekly', every: 1, weekdays: [1] },
        atTime: '08:00',
        startDate: '2026-03-02',
      },
    });
    const ops = plan(rec, 'rc');
    const set = ops.filter((o) => o.kind === 'set');
    expect(set).toHaveLength(1);
    expect(set[0]!.path).toBe('workspaces/w/boards/b/scheduledEvents/rc');
    expect(data(set[0]!)['fireAt'].toISOString()).toBe('2026-03-15T21:00:00.000Z'); // Mon 16 Mar 08:00 Melbourne
    expect(data(set[0]!)).toMatchObject({ kind: 'recurring', itemId: null });
  });
  it('a recurring schedule that can never fire registers nothing', () => {
    const never = auto('rc', {
      type: 'recurring',
      scope: 'board',
      schedule: {
        recurrence: { kind: 'monthly', every: 52, dayOfMonth: 31 },
        atTime: '08:00',
        startDate: '2026-02-01',
      },
    });
    expect(plan(never, 'rc').every((o) => o.kind === 'delete')).toBe(true);
  });
});

describe('model: parsing, tokens and text', () => {
  const parse = (trigger: unknown, actions: unknown = [{ type: 'archive' }]) =>
    parseAutomation('a', {
      name: 'n',
      enabled: true,
      ownerUid: 'o',
      trigger,
      conditions: [],
      actions,
    });
  it('parses the three scheduled triggers and rejects nonsense', () => {
    expect(
      parse({ type: 'dateArrives', columnId: 'c', offsetDays: -2, atTime: '07:30' })!.trigger,
    ).toEqual({
      type: 'dateArrives',
      columnId: 'c',
      which: 'end',
      offsetDays: -2,
      atTime: '07:30',
    });
    expect(parse({ type: 'dateArrives', columnId: 'c', offsetDays: 9999 })).toBeNull();
    expect(parse({ type: 'dateArrives', columnId: 'c', offsetDays: 1.5 })).toBeNull();
    expect(
      parse({ type: 'dateArrives', columnId: 'c', offsetDays: 1, atTime: 'noon' })!.trigger,
    ).toMatchObject({ atTime: '09:00' });
    expect(parse({ type: 'overdue', columnId: 'c' })!.trigger).toEqual({
      type: 'overdue',
      columnId: 'c',
      atTime: '09:00',
    });
    expect(parse({ type: 'overdue' })).toBeNull();
    const rec = {
      type: 'recurring',
      scope: 'items',
      schedule: { recurrence: { kind: 'daily' }, atTime: '06:00', startDate: '2026-03-02' },
    };
    expect(parse(rec)!.trigger).toEqual({
      type: 'recurring',
      scope: 'items',
      schedule: {
        recurrence: { kind: 'daily', every: 1 },
        atTime: '06:00',
        startDate: '2026-03-02',
      },
    });
    expect(parse({ ...rec, schedule: { ...rec.schedule, startDate: 'x' } })).toBeNull();
    expect(
      parse({
        ...rec,
        schedule: { ...rec.schedule, recurrence: { kind: 'weekly', weekdays: [] } },
      }),
    ).toBeNull();
    expect((parse({ ...rec, scope: 'weird' })!.trigger as { scope: string }).scope).toBe('board');
  });
  it('date tokens: @today, @today+N, @today-N', () => {
    expect(resolveDateToken('@today', '2026-03-10')).toBe('2026-03-10');
    expect(resolveDateToken('@today+7', '2026-03-10')).toBe('2026-03-17');
    expect(resolveDateToken('@today-10', '2026-03-10')).toBe('2026-02-28');
    expect(resolveDateToken('@today+0', '2026-03-10')).toBe('2026-03-10');
    for (const bad of [
      'today',
      '@now',
      '@today+',
      '@today+x',
      '@today*2',
      '@today+99999',
      5,
      null,
      undefined,
    ])
      expect(resolveDateToken(bad, '2026-03-10')).toBeNull();
  });
  it('a board-wide schedule may only create items and notify', () => {
    const rec = (actions: Automation['actions']) => ({
      trigger: {
        type: 'recurring',
        scope: 'board',
        schedule: {
          recurrence: { kind: 'daily', every: 1 },
          atTime: '09:00',
          startDate: '2026-03-02',
        },
      } as Automation['trigger'],
      actions,
    });
    expect(
      scheduledActionProblem(
        rec([
          { type: 'createItem', name: 'x', groupId: null, subitem: false },
          { type: 'notify', to: 'owner', uid: null, message: 'm' },
        ]),
      ),
    ).toBeNull();
    expect(scheduledActionProblem(rec([{ type: 'archive' }]))).toMatch(/no single item/);
    expect(
      scheduledActionProblem(rec([{ type: 'notify', to: 'assignees', uid: null, message: 'm' }])),
    ).toMatch(/no single item/);
    expect(
      scheduledActionProblem(
        rec([{ type: 'createItem', name: 'x', groupId: null, subitem: true }]),
      ),
    ).toMatch(/no single item/);
    expect(
      scheduledActionProblem({ trigger: { type: 'itemCreated' }, actions: [{ type: 'archive' }] }),
    ).toBeNull();
  });
  it('describes scheduled automations in plain English', () => {
    const b = { columns, groups: [] };
    const d = (t: Automation['trigger']) => describeAutomation(auto('x', t), b, (u) => u);
    expect(
      d({ type: 'dateArrives', columnId: due.id, which: 'end', offsetDays: -3, atTime: '09:00' }),
    ).toContain('it is 3 days before Due date, at 9am');
    expect(
      d({ type: 'dateArrives', columnId: due.id, which: 'end', offsetDays: 0, atTime: '09:00' }),
    ).toContain('the day of Due date');
    expect(
      d({ type: 'dateArrives', columnId: due.id, which: 'end', offsetDays: 1, atTime: '18:30' }),
    ).toContain('1 day after Due date, at 6:30pm');
    expect(d({ type: 'overdue', columnId: due.id, atTime: '09:00' })).toContain(
      'Due date has passed and it isn’t done',
    );
    expect(
      d({
        type: 'recurring',
        scope: 'items',
        schedule: {
          recurrence: { kind: 'weekly', every: 1, weekdays: [1] },
          atTime: '08:00',
          startDate: '2026-03-02',
        },
      }),
    ).toContain('every week on Mon at 8am, for each matching item');
  });
});
