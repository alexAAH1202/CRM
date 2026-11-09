import { describe, expect, it } from 'vitest';
import {
  buildHelperBody,
  helperBackoffMs,
  HelperError,
  isRetryableHelperError,
  parseHelperResponse,
} from './helperProtocol';

describe('helper protocol', () => {
  it('parses a success reply', () => {
    expect(parseHelperResponse<{ x: number }>('{"ok":true,"data":{"x":1}}')).toEqual({ x: 1 });
  });
  it('turns a failure into a typed error', () => {
    try {
      parseHelperResponse('{"ok":false,"error":{"code":"forbidden","message":"Not a member"}}');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HelperError);
      expect((e as HelperError).code).toBe('forbidden');
      expect((e as HelperError).message).toBe('Not a member');
    }
  });
  it('treats unknown codes and malformed replies safely', () => {
    expect(() =>
      parseHelperResponse('{"ok":false,"error":{"code":"weird","message":"x"}}'),
    ).toThrowError(/x/);
    try {
      parseHelperResponse('{"ok":false,"error":{"code":"weird"}}');
    } catch (e) {
      expect((e as HelperError).code).toBe('internal');
    }
    for (const bad of ['<html>Sign in</html>', '', 'null', '{}', '{"ok":"yes"}', '[]']) {
      try {
        parseHelperResponse(bad);
        expect.unreachable(bad);
      } catch (e) {
        expect((e as HelperError).code).toBe('unavailable');
      }
    }
  });
  it('retries blips, not real answers', () => {
    expect(isRetryableHelperError(new HelperError('unavailable', ''))).toBe(true);
    expect(isRetryableHelperError(new HelperError('rate_limited', ''))).toBe(true);
    expect(isRetryableHelperError(new HelperError('forbidden', ''))).toBe(false);
    expect(isRetryableHelperError(new HelperError('unauthenticated', ''))).toBe(false);
    expect(isRetryableHelperError(new Error('x'))).toBe(false);
  });
  it('backoff grows and is capped', () => {
    expect([0, 1, 2, 3, 10].map(helperBackoffMs)).toEqual([400, 800, 1600, 3200, 5000]);
  });
  it('builds the request body with the token only when given', () => {
    expect(JSON.parse(buildHelperBody('ping', null))).toEqual({ action: 'ping' });
    expect(JSON.parse(buildHelperBody('whoami', 'tok', { workspaceId: 'w' }))).toEqual({
      action: 'whoami',
      idToken: 'tok',
      workspaceId: 'w',
    });
    // a payload can't override the action or token
    expect(JSON.parse(buildHelperBody('a', 't', { action: 'evil', idToken: 'evil' }))).toEqual({
      action: 'a',
      idToken: 't',
    });
  });
});
