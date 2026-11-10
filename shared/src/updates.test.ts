import { describe, expect, it } from 'vitest';
import {
  itemLink,
  planAddUpdate,
  planAssignmentNotifications,
  planDeleteUpdate,
  planEditUpdate,
  planMarkRead,
} from './updates';

let n = 0;
const newId = () => `n${++n}`;
const dataOf = (op: unknown) => (op as { data: Record<string, unknown> }).data;
const base = {
  wid: 'w',
  bid: 'b',
  iid: 'i',
  uid: 'u-1',
  author: 'me',
  authorName: 'Me',
  itemName: 'Dishes',
  newId,
};

describe('update planners', () => {
  it('a comment with mentions notifies each person once, never the author', () => {
    const ops = planAddUpdate({
      ...base,
      body: '  **hi** @Bob  ',
      mentions: ['bob', 'bob', 'me', 'cat'],
      parentId: null,
    });
    expect(ops).toHaveLength(3);
    expect(ops[0]).toMatchObject({
      kind: 'set',
      path: 'workspaces/w/boards/b/items/i/updates/u-1',
    });
    expect(dataOf(ops[0]).body).toBe('**hi** @Bob');
    const to = ops.slice(1).map((o) => o.path);
    expect(to).toEqual([
      'workspaces/w/notifications/bob/items/n1',
      'workspaces/w/notifications/cat/items/n2',
    ]);
    expect(ops[1]).toMatchObject({
      data: { type: 'mention', read: false, actor: 'me', link: '/w/w/b/b?item=i' },
    });
  });
  it('no mentions, no notifications; replies keep their parent', () => {
    const ops = planAddUpdate({ ...base, body: 'ok', mentions: [], parentId: 'p1' });
    expect(ops).toHaveLength(1);
    expect(dataOf(ops[0]).parentId).toBe('p1');
  });
  it('body is capped', () => {
    const ops = planAddUpdate({ ...base, body: 'x'.repeat(9000), mentions: [], parentId: null });
    expect(dataOf(ops[0]).body).toHaveLength(5000);
  });
  it('editing only notifies people newly mentioned', () => {
    const ops = planEditUpdate({
      ...base,
      body: '@Bob @Cat',
      mentions: ['bob', 'cat'],
      previousMentions: ['bob'],
    });
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ kind: 'update' });
    expect(ops[1]!.path).toContain('/cat/');
  });
  it('delete and mark read', () => {
    expect(planDeleteUpdate('w', 'b', 'i', 'u-1')).toEqual([
      { kind: 'delete', path: 'workspaces/w/boards/b/items/i/updates/u-1' },
    ]);
    expect(planMarkRead('w', 'me', 'n9', true)).toEqual([
      { kind: 'update', path: 'workspaces/w/notifications/me/items/n9', data: { read: true } },
    ]);
  });
  it('assignment notifications: only people newly added, not yourself', () => {
    const ops = planAssignmentNotifications({
      wid: 'w',
      bid: 'b',
      iid: 'i',
      actor: 'me',
      actorName: 'Me',
      itemName: 'Dishes',
      boardName: 'Chores',
      before: ['a'],
      after: ['a', 'b', 'me', 'b'],
      newId,
    });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      data: { type: 'assignment', title: 'Me assigned you to Dishes' },
    });
    expect(ops[0]!.path).toContain('/notifications/b/');
  });
  it('link format', () => expect(itemLink('w', 'b', 'i')).toBe('/w/w/b/b?item=i'));
});

describe('assignment acceptance', () => {
  it('responding records it, marks the notification read and tells the assigner', async () => {
    const { planRespondToAssignment } = await import('./updates');
    const ops = planRespondToAssignment({
      wid: 'w',
      bid: 'b',
      iid: 'i',
      uid: 'bob',
      responderName: 'Bob',
      response: 'rejected',
      assigner: 'ada',
      itemName: 'Dishes',
      nid: 'n0',
      newId,
    });
    expect(ops).toHaveLength(3);
    expect(dataOf(ops[0])['acceptance.bob']).toEqual({ state: 'rejected', by: 'ada' });
    expect(dataOf(ops[1])).toEqual({ read: true });
    expect(dataOf(ops[2])['title']).toBe('Bob declined “Dishes”');
  });

  it('assignee changes set pending / accepted and clear removed people', async () => {
    const { acceptanceChanges } = await import('./boardOps');
    const { DELETE_FIELD } = await import('./ops');
    const c = acceptanceChanges(['gone', 'kept'], ['kept', 'bob', 'me'], 'me');
    expect(c['acceptance.bob']).toEqual({ state: 'pending', by: 'me' });
    expect(c['acceptance.me']).toEqual({ state: 'accepted', by: 'me' });
    expect(c['acceptance.kept']).toBeUndefined();
    expect(c['acceptance.gone']).toBe(DELETE_FIELD);
  });
});
