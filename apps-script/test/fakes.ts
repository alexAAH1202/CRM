import { createHash } from 'node:crypto';
import type { HttpRequest, HttpResponse, Platform } from '../src/platform';

export interface FakeOptions {
  respond?: (req: HttpRequest) => HttpResponse | undefined;
  props?: Record<string, string>;
  now?: number;
}

/** A Platform whose network is scripted by the test, with a real in-memory cache. */
export function fakePlatform(o: FakeOptions = {}) {
  const cache = new Map<string, { v: string; ttl: number }>();
  const calls: HttpRequest[] = [];
  const logs: string[] = [];
  let now = o.now ?? Date.parse('2026-03-10T00:00:00Z');
  const p: Platform = {
    http(req) {
      calls.push(req);
      return o.respond?.(req) ?? { status: 404, body: '{"error":{"message":"no route"}}' };
    },
    cacheGet: (k) => cache.get(k)?.v ?? null,
    cachePut: (k, v, ttl) => void cache.set(k, { v, ttl }),
    prop: (n) => o.props?.[n] ?? null,
    nowMs: () => now,
    sha256Hex: (t) => createHash('sha256').update(t).digest('hex'),
    b64urlDecode: (t) => Buffer.from(t, 'base64url').toString('utf8'),
    log: (m) => void logs.push(m),
  };
  return { p, calls, logs, cache, advance: (ms: number) => (now += ms) };
}

/** An unsigned JWT-shaped string (the helper reads `exp`; Google does the real verification). */
export function fakeJwt(payload: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'RS256', typ: 'JWT' })}.${b(payload)}.${'x'.repeat(24)}`;
}

export const json = (status: number, body: unknown): HttpResponse => ({
  status,
  body: JSON.stringify(body),
});

export const fsDoc = (path: string, fields: Record<string, unknown>) => ({
  name: `projects/life-management-de315/databases/(default)/documents/${path}`,
  fields,
  updateTime: '2026-03-10T00:00:00Z',
});
