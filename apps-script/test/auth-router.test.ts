import { HelperError } from '@app/shared';
import { describe, expect, it } from 'vitest';
import { jwtExpiry, roleIn, verifyIdToken } from '../src/auth';
import { loadConfig } from '../src/config';
import { FirestoreClient } from '../src/firestore';
import { handleRequest, MAX_REQUEST_CHARS, registerAction } from '../src/router';
import { fakeJwt, fakePlatform, fsDoc, json } from './fakes';

const NOW = Date.parse('2026-03-10T00:00:00Z');
const inFuture = (s: number) => Math.floor(NOW / 1000) + s;
const goodToken = () => fakeJwt({ exp: inFuture(3600), sub: 'u1' });

const lookupOk = (uid = 'u1', email = 'u1@example.com') =>
  json(200, { users: [{ localId: uid, email }] });

describe('verifyIdToken', () => {
  const cfg = (p: ReturnType<typeof fakePlatform>['p']) => loadConfig(p);
  it('accepts a token Google verifies, asks with the project API key, and caches the answer', () => {
    const f = fakePlatform({ now: NOW, respond: () => lookupOk() });
    const t = goodToken();
    expect(verifyIdToken(f.p, cfg(f.p), t)).toEqual({ uid: 'u1', email: 'u1@example.com' });
    expect(verifyIdToken(f.p, cfg(f.p), t)).toEqual({ uid: 'u1', email: 'u1@example.com' });
    expect(f.calls).toHaveLength(1); // second call served from the cache
    expect(f.calls[0]!.url).toContain('accounts:lookup?key=');
    expect(JSON.parse(f.calls[0]!.body!)).toEqual({ idToken: t });
    expect(f.calls[0]!.oauth).toBeUndefined(); // the user's token, not the owner's
  });
  it('caches no longer than the token lives', () => {
    const f = fakePlatform({ now: NOW, respond: () => lookupOk() });
    verifyIdToken(f.p, cfg(f.p), fakeJwt({ exp: inFuture(60) }));
    expect([...f.cache.values()][0]!.ttl).toBe(60);
    const g = fakePlatform({ now: NOW, respond: () => lookupOk() });
    verifyIdToken(g.p, cfg(g.p), fakeJwt({ exp: inFuture(99999) }));
    expect([...g.cache.values()][0]!.ttl).toBe(300);
  });
  it('rejects junk, expired and unverifiable tokens without calling Google when it can tell', () => {
    const f = fakePlatform({
      now: NOW,
      respond: () => json(400, { error: { message: 'INVALID_ID_TOKEN' } }),
    });
    for (const bad of [undefined, null, 5, '', 'short', 'x'.repeat(5000), {}]) {
      expect(() => verifyIdToken(f.p, cfg(f.p), bad)).toThrowError(
        expect.objectContaining({ code: 'unauthenticated' }),
      );
    }
    expect(f.calls).toHaveLength(0);
    expect(() => verifyIdToken(f.p, cfg(f.p), fakeJwt({ exp: inFuture(-10) }))).toThrowError(
      /expired/,
    );
    expect(f.calls).toHaveLength(0);
    expect(() => verifyIdToken(f.p, cfg(f.p), goodToken())).toThrowError(
      expect.objectContaining({ code: 'unauthenticated' }),
    );
  });
  it('a forged token Google rejects is never cached or trusted', () => {
    const f = fakePlatform({ now: NOW, respond: () => json(400, {}) });
    const t = goodToken();
    expect(() => verifyIdToken(f.p, cfg(f.p), t)).toThrow();
    expect(f.cache.size).toBe(0);
  });
  it('Google being down is "unavailable" (retryable), not "unauthenticated"', () => {
    const f = fakePlatform({ now: NOW, respond: () => json(500, {}) });
    expect(() => verifyIdToken(f.p, cfg(f.p), goodToken())).toThrowError(
      expect.objectContaining({ code: 'unavailable' }),
    );
    const g = fakePlatform({ now: NOW, respond: () => json(200, { users: [] }) });
    expect(() => verifyIdToken(g.p, cfg(g.p), goodToken())).toThrowError(
      expect.objectContaining({ code: 'unauthenticated' }),
    );
    const h = fakePlatform({ now: NOW, respond: () => ({ status: 200, body: 'not json' }) });
    expect(() => verifyIdToken(h.p, cfg(h.p), goodToken())).toThrowError(
      expect.objectContaining({ code: 'unauthenticated' }),
    );
  });
  it('reads exp from a JWT, and returns null for anything else', () => {
    const f = fakePlatform();
    expect(jwtExpiry(f.p, fakeJwt({ exp: 123 }))).toBe(123);
    expect(jwtExpiry(f.p, 'a.b')).toBeNull();
    expect(jwtExpiry(f.p, 'a.%%%.c')).toBeNull();
    expect(jwtExpiry(f.p, fakeJwt({ nope: 1 }))).toBeNull();
  });
});

describe('roleIn', () => {
  const member = (role: string) => (req: { url: string }) =>
    req.url.endsWith('/workspaces/w1/members/u1')
      ? json(200, fsDoc('workspaces/w1/members/u1', { role: { stringValue: role } }))
      : json(404, {});
  it('returns the role from the member document', () => {
    for (const r of ['admin', 'member', 'viewer'] as const) {
      const f = fakePlatform({ respond: member(r) });
      expect(roleIn(new FirestoreClient(f.p, 'pid'), 'u1', 'w1')).toBe(r);
    }
  });
  it('refuses non-members, odd roles and malformed workspace ids (no path tricks)', () => {
    const f = fakePlatform({ respond: member('member') });
    const db = new FirestoreClient(f.p, 'pid');
    expect(() => roleIn(db, 'someoneElse', 'w1')).toThrowError(
      expect.objectContaining({ code: 'forbidden' }),
    );
    expect(() =>
      roleIn(new FirestoreClient(fakePlatform({ respond: member('owner') }).p, 'pid'), 'u1', 'w1'),
    ).toThrowError(expect.objectContaining({ code: 'forbidden' }));
    for (const bad of [undefined, 5, '', '../w1', 'w1/members', 'a b', 'x'.repeat(200)]) {
      expect(() => roleIn(db, 'u1', bad)).toThrowError(
        expect.objectContaining({ code: 'bad_request' }),
      );
    }
    expect(f.calls).toHaveLength(1); // only the legitimate lookups hit the database
  });
});

describe('handleRequest', () => {
  const world = (role: string | null = 'member') =>
    fakePlatform({
      now: NOW,
      respond: (req) => {
        if (req.url.includes('accounts:lookup')) return lookupOk();
        if (req.url.endsWith('/workspaces/w1/members/u1') && role)
          return json(200, fsDoc('workspaces/w1/members/u1', { role: { stringValue: role } }));
        return json(404, {});
      },
    });
  const call = (f: ReturnType<typeof world>, body: unknown) =>
    handleRequest(f.p, typeof body === 'string' ? body : JSON.stringify(body));
  const err = (r: ReturnType<typeof handleRequest>) => (r.ok ? null : r.error.code);

  it('ping needs no sign-in and touches nothing', () => {
    const f = world();
    const r = call(f, { action: 'ping' });
    expect(r).toMatchObject({ ok: true, data: { pong: true } });
    expect(f.calls).toHaveLength(0);
  });
  it('rejects malformed requests', () => {
    const f = world();
    expect(err(handleRequest(f.p, undefined))).toBe('bad_request');
    expect(err(handleRequest(f.p, null))).toBe('bad_request');
    expect(err(call(f, ''))).toBe('bad_request');
    expect(err(call(f, 'not json'))).toBe('bad_request');
    expect(err(call(f, '[1,2]'))).toBe('bad_request');
    expect(err(call(f, '"x"'))).toBe('bad_request');
    expect(err(call(f, 'null'))).toBe('bad_request');
    expect(err(handleRequest(f.p, ' '.repeat(MAX_REQUEST_CHARS + 1)))).toBe('too_large');
  });
  it('unknown actions, including prototype names, are refused', () => {
    const f = world();
    for (const a of [
      'nope',
      '',
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
      5,
      null,
    ]) {
      expect(err(call(f, { action: a }))).toBe('unknown_action');
    }
  });
  it('whoami requires a valid token', () => {
    const f = world();
    expect(err(call(f, { action: 'whoami' }))).toBe('unauthenticated');
    expect(err(call(f, { action: 'whoami', idToken: 'nope' }))).toBe('unauthenticated');
  });
  it('whoami: the uid comes from the verified token, never from the request', () => {
    const f = world();
    const r = call(f, { action: 'whoami', idToken: goodToken(), uid: 'attacker', role: 'admin' });
    expect(r).toMatchObject({
      ok: true,
      data: { uid: 'u1', email: 'u1@example.com', role: null, workspaceId: null },
    });
  });
  it('whoami with a workspace: role for members, forbidden for outsiders', () => {
    expect(
      call(world('admin'), { action: 'whoami', idToken: goodToken(), workspaceId: 'w1' }),
    ).toMatchObject({ ok: true, data: { role: 'admin', workspaceId: 'w1' } });
    expect(
      err(call(world(null), { action: 'whoami', idToken: goodToken(), workspaceId: 'w1' })),
    ).toBe('forbidden');
  });
  it('member / admin / write gating for registered actions', () => {
    registerAction('t_member', { auth: 'member', run: () => 'm' });
    registerAction('t_admin', { auth: 'admin', run: () => 'a' });
    registerAction('t_write', { auth: 'member', writes: true, run: () => 'w' });
    const tok = goodToken();
    const req = (action: string) => ({ action, idToken: tok, workspaceId: 'w1' });
    expect(call(world('viewer'), req('t_member'))).toMatchObject({ ok: true });
    expect(err(call(world('viewer'), req('t_write')))).toBe('forbidden');
    expect(call(world('member'), req('t_write'))).toMatchObject({ ok: true });
    expect(err(call(world('member'), req('t_admin')))).toBe('forbidden');
    expect(call(world('admin'), req('t_admin'))).toMatchObject({ ok: true });
    expect(err(call(world('admin'), { action: 't_member', idToken: tok }))).toBe('bad_request'); // no workspace given
    expect(err(call(world(null), req('t_member')))).toBe('forbidden');
  });
  it('unexpected exceptions become a generic error and are logged, never echoed', () => {
    registerAction('t_boom', {
      auth: 'none',
      run: () => {
        throw new Error('SECRET stack detail');
      },
    });
    const f = world();
    const r = call(f, { action: 't_boom' });
    expect(r).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Something went wrong in the helper.' },
    });
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(f.logs.join('\n')).toContain('SECRET');
  });
  it('typed errors keep their code and message', () => {
    registerAction('t_typed', {
      auth: 'none',
      run: () => {
        throw new HelperError('too_large', 'Big');
      },
    });
    expect(call(world(), { action: 't_typed' })).toEqual({
      ok: false,
      error: { code: 'too_large', message: 'Big' },
    });
  });
});
