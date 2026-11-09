import { describe, expect, it } from 'vitest';
import {
  MAX_DEPTH,
  TOKEN_ME,
  TOKEN_TODAY,
  type Action,
  type Automation,
  type Trigger,
} from './automations';
import {
  runAutomations,
  withFinalCounter,
  type AutoEvent,
  type EngineItem,
} from './automationEngine';
import { makeColumn } from './columns';
import { DELETE_FIELD, type WriteOp } from './ops';

const status = makeColumn('status', 'Status', {
  labels: [
    { id: 'todo', name: 'To do', color: 'gray' },
    { id: 'work', name: 'Working', color: 'blue' },
    { id: 'done', name: 'Done', color: 'green' },
  ],
  defaultLabelId: 'todo',
});
const who = makeColumn('people', 'Who');
const due = makeColumn('date', 'Due');
const note = makeColumn('text', 'Note');
const calc = makeColumn('formula', 'Calc', { formula: '1' });
const columns = [status, who, due, note, calc];
const groups = [
  { id: 'g1', name: 'Todo', color: 'blue' as const },
  { id: 'g2', name: 'Done group', color: 'green' as const },
];

const item = (id: string, over: Partial<EngineItem> = {}): EngineItem => ({
  id,
  name: id,
  groupId: 'g1',
  order: 'a0',
  parentId: null,
  itemNumber: 1,
  values: {},
  archived: false,
  deleted: false,
  ...over,
});
const auto = (
  id: string,
  trigger: Trigger,
  actions: Action[],
  over: Partial<Automation> = {},
): Automation => ({
  id,
  name: `Auto ${id}`,
  enabled: true,
  ownerUid: 'owner',
  trigger,
  conditions: [],
  actions,
  ...over,
});

let n = 0;
function run(opts: {
  automations: Automation[];
  items: EngineItem[];
  event: AutoEvent;
  startNumber?: number | null;
  members?: string[];
  actor?: string;
}) {
  n = 0;
  return runAutomations({
    wid: 'w',
    bid: 'b',
    boardName: 'Board',
    event: opts.event,
    items: new Map(opts.items.map((i) => [i.id, i])),
    columns,
    groups,
    automations: opts.automations,
    actor: opts.actor ?? 'me',
    memberUids: new Set(opts.members ?? ['me', 'owner', 'bob']),
    memberName: (u) => u,
    today: '2026-03-10',
    startNumber: opts.startNumber === undefined ? 5 : opts.startNumber,
    newId: (k) => `${k}${++n}`,
  });
}
const updates = (ops: WriteOp[]) => ops.filter((o) => o.kind === 'update');
const sets = (ops: WriteOp[], part: string) =>
  ops.filter((o) => o.kind === 'set' && o.path.includes(part));
const dataOf = (o: WriteOp) => (o as unknown as { data: Record<string, unknown> }).data;
const cell = (itemId: string, columnId: string, before: unknown, after: unknown): AutoEvent => ({
  kind: 'cell',
  itemId,
  columnId,
  before,
  after,
});

describe('triggers', () => {
  const setNote = [{ type: 'setValue', columnId: note.id, value: 'ran' }] as Action[];
  const ran = (r: ReturnType<typeof run>) => r.runs.filter((x) => x.status === 'ok').length;

  it('item created', () => {
    const r = run({
      automations: [auto('a', { type: 'itemCreated' }, setNote)],
      items: [item('i')],
      event: { kind: 'created', itemId: 'i' },
    });
    expect(ran(r)).toBe(1);
    expect(dataOf(updates(r.ops)[0]!)[`values.${note.id}`]).toBe('ran');
    expect(
      ran(
        run({
          automations: [auto('a', { type: 'itemCreated' }, setNote)],
          items: [item('i')],
          event: cell('i', note.id, null, 'x'),
        }),
      ),
    ).toBe(0);
  });
  it('column changes: a given column, or any', () => {
    const items = [item('i', { values: { [due.id]: '2026-01-01' } })];
    const ev = cell('i', due.id, null, '2026-01-01');
    expect(
      ran(
        run({
          automations: [auto('a', { type: 'columnChanged', columnId: due.id }, setNote)],
          items,
          event: ev,
        }),
      ),
    ).toBe(1);
    expect(
      ran(
        run({
          automations: [auto('a', { type: 'columnChanged', columnId: null }, setNote)],
          items,
          event: ev,
        }),
      ),
    ).toBe(1);
    expect(
      ran(
        run({
          automations: [auto('a', { type: 'columnChanged', columnId: who.id }, setNote)],
          items,
          event: ev,
        }),
      ),
    ).toBe(0);
  });
  it('status changes to a label — only that label, only on a real change', () => {
    const t: Trigger = { type: 'statusChangedTo', columnId: status.id, labelId: 'done' };
    const items = [item('i', { values: { [status.id]: 'done' } })];
    expect(
      ran(
        run({
          automations: [auto('a', t, setNote)],
          items,
          event: cell('i', status.id, 'work', 'done'),
        }),
      ),
    ).toBe(1);
    expect(
      ran(
        run({
          automations: [auto('a', t, setNote)],
          items,
          event: cell('i', status.id, 'done', 'done'),
        }),
      ),
    ).toBe(0);
    const w = [item('i', { values: { [status.id]: 'work' } })];
    expect(
      ran(
        run({
          automations: [auto('a', t, setNote)],
          items: w,
          event: cell('i', status.id, 'todo', 'work'),
        }),
      ),
    ).toBe(0);
  });
  it('person assigned: anyone, or a particular person; only people newly added', () => {
    const items = [item('i', { values: { [who.id]: ['bob', 'me'] } })];
    const any: Trigger = { type: 'personAssigned', columnId: null, uid: null };
    const bob: Trigger = { type: 'personAssigned', columnId: who.id, uid: 'bob' };
    const ev = cell('i', who.id, ['me'], ['bob', 'me']);
    expect(ran(run({ automations: [auto('a', any, setNote)], items, event: ev }))).toBe(1);
    expect(ran(run({ automations: [auto('a', bob, setNote)], items, event: ev }))).toBe(1);
    expect(
      ran(run({ automations: [auto('a', { ...bob, uid: 'zed' }, setNote)], items, event: ev })),
    ).toBe(0);
    expect(
      ran(
        run({
          automations: [auto('a', any, setNote)],
          items,
          event: cell('i', who.id, ['bob', 'me'], ['me']),
        }),
      ),
    ).toBe(0); // removal
  });
  it('moved to group', () => {
    const ev: AutoEvent = { kind: 'moved', itemId: 'i', fromGroupId: 'g1', toGroupId: 'g2' };
    expect(
      ran(
        run({
          automations: [auto('a', { type: 'movedToGroup', groupId: 'g2' }, setNote)],
          items: [item('i', { groupId: 'g2' })],
          event: ev,
        }),
      ),
    ).toBe(1);
    expect(
      ran(
        run({
          automations: [auto('a', { type: 'movedToGroup', groupId: 'g1' }, setNote)],
          items: [item('i', { groupId: 'g2' })],
          event: ev,
        }),
      ),
    ).toBe(0);
  });
  it('all subitems done: acts on the parent, only when every live subitem is done', () => {
    const t: Trigger = { type: 'subitemsAllDone', columnId: status.id, labelId: 'done' };
    const act: Action[] = [{ type: 'setValue', columnId: status.id, value: 'done' }];
    const sub = (id: string, s: string, extra: Partial<EngineItem> = {}) =>
      item(id, { parentId: 'p', values: { [status.id]: s }, ...extra });
    const all = [item('p'), sub('s1', 'done'), sub('s2', 'done')];
    const r = run({
      automations: [auto('a', t, act)],
      items: all,
      event: cell('s2', status.id, 'work', 'done'),
    });
    expect(updates(r.ops)[0]!.path).toContain('/items/p');
    const notAll = [item('p'), sub('s1', 'done'), sub('s2', 'work')];
    expect(
      ran(
        run({
          automations: [auto('a', t, act)],
          items: notAll,
          event: cell('s1', status.id, 'work', 'done'),
        }),
      ),
    ).toBe(0);
    const ignoreArchived = [item('p'), sub('s1', 'done'), sub('s2', 'work', { archived: true })];
    expect(
      ran(
        run({
          automations: [auto('a', t, act)],
          items: ignoreArchived,
          event: cell('s1', status.id, 'work', 'done'),
        }),
      ),
    ).toBe(1);
    // a top-level item has no parent to act on
    expect(
      ran(
        run({
          automations: [auto('a', t, act)],
          items: [item('p', { values: { [status.id]: 'done' } })],
          event: cell('p', status.id, 'work', 'done'),
        }),
      ),
    ).toBe(0);
  });
  it('disabled automations, deleted items and unknown targets are ignored', () => {
    const base = { items: [item('i')], event: { kind: 'created', itemId: 'i' } as AutoEvent };
    expect(
      run({
        ...base,
        automations: [auto('a', { type: 'itemCreated' }, setNote, { enabled: false })],
      }).runs,
    ).toEqual([]);
    expect(
      run({
        ...base,
        items: [item('i', { deleted: true })],
        automations: [auto('a', { type: 'itemCreated' }, setNote)],
      }).runs,
    ).toEqual([]);
  });
});

describe('conditions', () => {
  it('every condition must match the item after the change', () => {
    const a = auto('a', { type: 'itemCreated' }, [{ type: 'archive' }], {
      conditions: [
        { id: 'c1', columnId: status.id, op: 'is', value: ['work'] },
        { id: 'c2', columnId: note.id, op: 'contains', value: 'hi' },
      ],
    });
    const mk = (s: string, t: string) => item('i', { values: { [status.id]: s, [note.id]: t } });
    const ev: AutoEvent = { kind: 'created', itemId: 'i' };
    expect(run({ automations: [a], items: [mk('work', 'say hi')], event: ev }).runs).toHaveLength(
      1,
    );
    expect(run({ automations: [a], items: [mk('work', 'bye')], event: ev }).runs).toHaveLength(0);
    expect(run({ automations: [a], items: [mk('todo', 'say hi')], event: ev }).runs).toHaveLength(
      0,
    );
  });
});

describe('actions', () => {
  const ev: AutoEvent = { kind: 'created', itemId: 'i' };
  const trig: Trigger = { type: 'itemCreated' };
  it('set value: sets, clears, tokens (@me, @today), assignees follow, no-op when unchanged', () => {
    const r = run({
      automations: [
        auto('a', trig, [
          { type: 'setValue', columnId: status.id, value: 'work' },
          { type: 'setValue', columnId: who.id, value: TOKEN_ME },
          { type: 'setValue', columnId: due.id, value: TOKEN_TODAY },
          { type: 'setValue', columnId: note.id, value: null },
        ]),
      ],
      items: [item('i', { values: { [note.id]: 'old' } })],
      event: ev,
    });
    const d = dataOf(updates(r.ops)[0]!);
    expect(d[`values.${status.id}`]).toBe('work');
    expect(d[`values.${who.id}`]).toEqual(['me']);
    expect(d[`values.${due.id}`]).toBe('2026-03-10');
    expect(d[`values.${note.id}`]).toBe(DELETE_FIELD);
    expect(d['assigneeUids']).toEqual(['me']);
    expect(d['updatedBy']).toBe('me');
    const noop = run({
      automations: [auto('a', trig, [{ type: 'setValue', columnId: status.id, value: 'work' }])],
      items: [item('i', { values: { [status.id]: 'work' } })],
      event: ev,
    });
    expect(updates(noop.ops)).toHaveLength(0);
    expect(noop.runs[0]!.status).toBe('ok');
  });
  it('invalid values are cleared by normalisation, not written raw', () => {
    const r = run({
      automations: [
        auto('a', trig, [{ type: 'setValue', columnId: status.id, value: 'not-a-label' }]),
      ],
      items: [item('i', { values: { [status.id]: 'work' } })],
      event: ev,
    });
    expect(dataOf(updates(r.ops)[0]!)[`values.${status.id}`]).toBe(DELETE_FIELD);
  });
  it('move to group: goes to the end of the target; subitems follow; no-op if already there', () => {
    const items = [
      item('i'),
      item('c', { parentId: 'i' }),
      item('x', { groupId: 'g2', order: 'a5' }),
    ];
    const r = run({
      automations: [auto('a', trig, [{ type: 'moveToGroup', groupId: 'g2' }])],
      items,
      event: ev,
    });
    const u = updates(r.ops);
    const parent = dataOf(u.find((o) => o.path.endsWith('/i'))!);
    expect(parent['groupId']).toBe('g2');
    expect(String(parent['order']) > 'a5').toBe(true);
    expect(dataOf(u.find((o) => o.path.endsWith('/c'))!)['groupId']).toBe('g2');
    expect(
      updates(
        run({
          automations: [auto('a', trig, [{ type: 'moveToGroup', groupId: 'g1' }])],
          items: [item('i')],
          event: ev,
        }).ops,
      ),
    ).toHaveLength(0);
  });
  it('archive archives subitems too', () => {
    const r = run({
      automations: [auto('a', trig, [{ type: 'archive' }])],
      items: [item('i'), item('c', { parentId: 'i' })],
      event: ev,
    });
    expect(updates(r.ops).map((o) => dataOf(o)['archived'])).toEqual([true, true]);
  });
  it('create item / subitem / duplicate: numbered from the counter, placed after existing, {item} in names', () => {
    const items = [
      item('i', { name: 'Dishes', values: { [note.id]: 'n' } }),
      item('old', { order: 'a7' }),
    ];
    const r = run({
      automations: [
        auto('a', trig, [
          { type: 'createItem', name: 'Follow up: {item}', groupId: 'g2', subitem: false },
          { type: 'createItem', name: 'Check', groupId: null, subitem: true },
          { type: 'duplicate' },
        ]),
      ],
      items,
      event: ev,
      startNumber: 10,
    });
    expect(r.created).toBe(3);
    expect(r.counterNext).toBe(13);
    const created = sets(r.ops, '/items/').map(dataOf);
    expect(created.map((d) => d['itemNumber'])).toEqual([10, 11, 12]);
    expect(created[0]).toMatchObject({ name: 'Follow up: Dishes', groupId: 'g2', parentId: null });
    expect(created[1]).toMatchObject({ name: 'Check', parentId: 'i' });
    expect(created[2]).toMatchObject({ name: 'Dishes (copy)', parentId: null });
    expect((created[2]!['values'] as Record<string, unknown>)[note.id]).toBe('n');
  });
  it('creating needs the counter; a subitem cannot have subitems; deleted group fails', () => {
    const mk = (a: Action[], items = [item('i')], startNumber: number | null = 5) =>
      run({ automations: [auto('a', trig, a)], items, event: ev, startNumber });
    expect(
      mk([{ type: 'createItem', name: 'x', groupId: null, subitem: false }], [item('i')], null)
        .runs[0],
    ).toMatchObject({ status: 'failed' });
    expect(
      mk(
        [{ type: 'createItem', name: 'x', groupId: null, subitem: true }],
        [item('i', { parentId: 'p' }), item('p')],
      ).runs[0]!.status,
    ).toBe('failed');
    expect(
      mk([{ type: 'createItem', name: 'x', groupId: 'gone', subitem: false }]).runs[0]!.status,
    ).toBe('failed');
  });
  it('notify: resolves recipients, drops non-members, dedupes, links to the item', () => {
    const r = run({
      automations: [
        auto('a', trig, [
          { type: 'notify', to: 'assignees', uid: null, message: '{item} is ready' },
          { type: 'notify', to: 'owner', uid: null, message: 'x' },
          { type: 'notify', to: 'person', uid: 'gone', message: 'x' },
        ]),
      ],
      items: [item('i', { name: 'Dishes', values: { [who.id]: ['bob', 'ghost'] } })],
      event: ev,
    });
    const notes = sets(r.ops, '/notifications/');
    expect(notes.map((o) => o.path.split('/')[3])).toEqual(['bob', 'owner']);
    expect(dataOf(notes[0]!)).toMatchObject({
      type: 'automation',
      title: 'Dishes is ready',
      actor: 'me',
      read: false,
      link: '/w/w/b/b?item=i',
    });
  });
  it('failed validation applies nothing from that automation, but others still run', () => {
    const bad = auto('bad', trig, [
      { type: 'setValue', columnId: note.id, value: 'x' },
      { type: 'setValue', columnId: 'deleted-col', value: 1 },
    ]);
    const good = auto('good', trig, [{ type: 'setValue', columnId: note.id, value: 'ok' }]);
    const r = run({ automations: [bad, good], items: [item('i')], event: ev });
    expect(r.runs.map((x) => [x.automationId, x.status])).toEqual([
      ['bad', 'failed'],
      ['good', 'ok'],
    ]);
    expect(dataOf(updates(r.ops)[0]!)[`values.${note.id}`]).toBe('ok');
    const calcFail = run({
      automations: [auto('c', trig, [{ type: 'setValue', columnId: calc.id, value: 1 }])],
      items: [item('i')],
      event: ev,
    });
    expect(calcFail.runs[0]).toMatchObject({ status: 'failed' });
    const tok = run({
      automations: [auto('c', trig, [{ type: 'setValue', columnId: note.id, value: TOKEN_ME }])],
      items: [item('i')],
      event: ev,
    });
    expect(tok.runs[0]!.status).toBe('failed');
  });
});

describe('cascades and the loop guard', () => {
  const ev = cell('i', status.id, 'todo', 'work');
  const items = [item('i', { values: { [status.id]: 'work' } })];
  const onStatus = (labelId: string): Trigger => ({
    type: 'statusChangedTo',
    columnId: status.id,
    labelId,
  });
  const setStatus = (v: string): Action => ({ type: 'setValue', columnId: status.id, value: v });

  it('one automation can trigger another in the same batch', () => {
    const r = run({
      automations: [
        auto('a', onStatus('work'), [{ type: 'setValue', columnId: note.id, value: 'started' }]),
        auto('b', { type: 'columnChanged', columnId: note.id }, [setStatus('done')]),
      ],
      items,
      event: ev,
    });
    expect(r.runs.map((x) => x.automationId)).toEqual(['a', 'b']);
    const d = dataOf(updates(r.ops)[0]!);
    expect(d[`values.${note.id}`]).toBe('started');
    expect(d[`values.${status.id}`]).toBe('done');
    expect(updates(r.ops)).toHaveLength(1); // coalesced into one write per item
  });
  it('a ping-pong pair stops: each automation runs once and the rest are skipped', () => {
    // work → done → work → done …
    const r = run({
      automations: [
        auto('a', onStatus('work'), [setStatus('done')]),
        auto('b', onStatus('done'), [setStatus('work')]),
      ],
      items,
      event: ev,
    });
    const ok = r.runs.filter((x) => x.status === 'ok').map((x) => x.automationId);
    expect(ok).toEqual(['a', 'b']);
    expect(r.runs.some((x) => x.status === 'skipped' && /loop guard/.test(x.error ?? ''))).toBe(
      true,
    );
    expect(r.runs.length).toBeLessThan(6);
  });
  it('an automation that triggers on its own change runs once', () => {
    const r = run({
      automations: [
        auto('a', { type: 'columnChanged', columnId: null }, [
          { type: 'setValue', columnId: note.id, value: 'x' },
        ]),
      ],
      items,
      event: ev,
    });
    expect(r.runs.filter((x) => x.status === 'ok')).toHaveLength(1);
    expect(r.runs.filter((x) => x.status === 'skipped')).toHaveLength(1);
  });
  it('an item-creating automation that triggers on creation cannot run away', () => {
    const r = run({
      automations: [
        auto('a', { type: 'itemCreated' }, [
          { type: 'createItem', name: 'again', groupId: null, subitem: false },
        ]),
      ],
      items: [item('i')],
      event: { kind: 'created', itemId: 'i' },
    });
    expect(r.created).toBe(1);
    expect(r.runs.some((x) => x.status === 'skipped')).toBe(true);
  });
  it(`a long chain stops after ${MAX_DEPTH} levels`, () => {
    // a→b→c→d→e: each sets the next note column value; only the first MAX_DEPTH levels run
    const cols = ['1', '2', '3', '4', '5'].map((k) => makeColumn('text', `T${k}`));
    const chain = cols.map((c, k) =>
      auto(
        `c${k}`,
        k === 0 ? { type: 'itemCreated' } : { type: 'columnChanged', columnId: cols[k - 1]!.id },
        [{ type: 'setValue', columnId: c.id, value: 'x' }],
      ),
    );
    n = 0;
    const r = runAutomations({
      wid: 'w',
      bid: 'b',
      boardName: 'B',
      event: { kind: 'created', itemId: 'i' },
      items: new Map([['i', item('i')]]),
      columns: cols,
      groups,
      automations: chain,
      actor: 'me',
      memberUids: new Set(['me']),
      memberName: (u) => u,
      today: '2026-03-10',
      startNumber: 1,
      newId: (k) => `${k}${++n}`,
    });
    expect(r.runs.filter((x) => x.status === 'ok').map((x) => x.automationId)).toEqual([
      'c0',
      'c1',
      'c2',
    ]);
    expect(r.runs.find((x) => x.status === 'skipped')?.error).toMatch(/3 levels/);
  });
  it('creating too many items fails instead of exploding', () => {
    const many = Array.from({ length: 4 }, (_, k) =>
      auto(
        `m${k}`,
        { type: 'itemCreated' },
        Array.from(
          { length: 4 },
          () => ({ type: 'createItem', name: 'x', groupId: null, subitem: false }) as Action,
        ),
      ),
    );
    const r = run({
      automations: many,
      items: [item('i')],
      event: { kind: 'created', itemId: 'i' },
      startNumber: 1,
    });
    expect(r.created).toBeLessThanOrEqual(10);
    expect(r.runs.some((x) => x.status === 'failed' && /at most 10/.test(x.error ?? ''))).toBe(
      true,
    );
  });
});

describe('writes', () => {
  it('records a run per execution, with actor and server time', () => {
    const r = run({
      automations: [auto('a', { type: 'itemCreated' }, [{ type: 'archive' }])],
      items: [item('i')],
      event: { kind: 'created', itemId: 'i' },
    });
    const rec = sets(r.ops, '/automationRuns/');
    expect(rec).toHaveLength(1);
    expect(dataOf(rec[0]!)).toMatchObject({
      automationId: 'a',
      status: 'ok',
      actor: 'me',
      depth: 0,
      itemId: 'i',
    });
  });
  it('nothing fires → no writes at all', () => {
    expect(
      run({ automations: [], items: [item('i')], event: { kind: 'created', itemId: 'i' } }).ops,
    ).toEqual([]);
  });
  it('withFinalCounter leaves exactly one counter write', () => {
    const ops: WriteOp[] = [
      { kind: 'update', path: 'workspaces/w/boards/b/meta/counter', data: { next: 4 } },
      { kind: 'set', path: 'workspaces/w/boards/b/items/x', data: {} },
    ];
    const out = withFinalCounter(ops, 'w', 'b', true, 9);
    expect(out.filter((o) => o.path.endsWith('/counter'))).toEqual([
      { kind: 'update', path: 'workspaces/w/boards/b/meta/counter', data: { next: 9 } },
    ]);
    expect(out).toHaveLength(2);
  });
});
