import { describe, expect, it } from 'vitest';
import { resolveSentinels, SERVER_TIME } from './ops';
import {
  isLastAdmin,
  planAcceptInvite,
  planChangeRole,
  planCreateWorkspace,
  planInvite,
  planRemoveMember,
} from './workspaceOps';

const me = { uid: 'u1', email: 'Me@Example.com', displayName: 'Me', photoURL: null };

describe('workspace op planners', () => {
  it('creates workspace + admin member with matching adminUids', () => {
    const ops = planCreateWorkspace({ wid: 'w1', name: '  Team  ', creator: me });
    expect(ops).toHaveLength(2);
    const [ws, member] = ops;
    expect(ws?.kind === 'set' && ws.data['adminUids']).toEqual(['u1']);
    expect(ws?.kind === 'set' && ws.data['name']).toBe('Team');
    expect(member?.path).toBe('workspaces/w1/members/u1');
    expect(member?.kind === 'set' && member.data['email']).toBe('me@example.com');
  });

  it('normalizes invite emails into the doc id', () => {
    const [op] = planInvite({
      wid: 'w1',
      email: ' Bob@X.COM ',
      role: 'member',
      invitedBy: 'u1',
      workspaceName: 'T',
    });
    expect(op?.path).toBe('workspaces/w1/invites/bob@x.com');
  });

  it('accepting an admin invite also adds to adminUids', () => {
    expect(planAcceptInvite({ wid: 'w1', role: 'member', me })).toHaveLength(2);
    const ops = planAcceptInvite({ wid: 'w1', role: 'admin', me });
    expect(ops.map((o) => o.kind)).toEqual(['set', 'delete', 'update']);
  });

  it('syncs adminUids on promotion/demotion only', () => {
    expect(planChangeRole({ wid: 'w', uid: 'x', from: 'member', to: 'viewer' })).toHaveLength(1);
    expect(planChangeRole({ wid: 'w', uid: 'x', from: 'member', to: 'admin' })).toHaveLength(2);
    expect(planChangeRole({ wid: 'w', uid: 'x', from: 'admin', to: 'member' })).toHaveLength(2);
    expect(planChangeRole({ wid: 'w', uid: 'x', from: 'admin', to: 'admin' })).toHaveLength(0);
    expect(planRemoveMember({ wid: 'w', uid: 'x', role: 'admin' })).toHaveLength(2);
    expect(planRemoveMember({ wid: 'w', uid: 'x', role: 'viewer' })).toHaveLength(1);
  });

  it('detects the last admin', () => {
    expect(isLastAdmin(['a'], 'a')).toBe(true);
    expect(isLastAdmin(['a', 'b'], 'a')).toBe(false);
    expect(isLastAdmin(['a'], 'b')).toBe(false);
  });

  it('resolves sentinels recursively', () => {
    const out = resolveSentinels(
      { a: SERVER_TIME, b: { c: [SERVER_TIME] }, d: 1 },
      {
        serverTime: () => 'NOW',
        deleteField: () => 'DEL',
        arrayUnion: () => 'U',
        arrayRemove: () => 'R',
      },
    );
    expect(out).toEqual({ a: 'NOW', b: { c: ['NOW'] }, d: 1 });
  });
});
