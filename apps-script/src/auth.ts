import { HelperError } from '@app/shared';
import type { HelperConfig } from './config';
import type { FirestoreClient } from './firestore';
import type { Platform } from './platform';

export interface Caller {
  uid: string;
  email: string | null;
}

export type Role = 'admin' | 'member' | 'viewer';
const ROLES: readonly Role[] = ['admin', 'member', 'viewer'];

/** The `exp` (seconds since 1970) inside a JWT, or null if it isn't a readable JWT. */
export function jwtExpiry(p: Platform, token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const exp = (JSON.parse(p.b64urlDecode(parts[1] as string)) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

const CACHE_SECONDS = 300;

/**
 * Who is calling? Never trusts a client-supplied uid: the Firebase ID token is checked with
 * Google's Identity Toolkit (`accounts:lookup`), which fails for forged, expired or
 * other-project tokens. Successful lookups are cached briefly (keyed by a hash of the token)
 * to keep URL Fetch usage low.
 */
export function verifyIdToken(p: Platform, cfg: HelperConfig, idToken: unknown): Caller {
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 4096)
    throw new HelperError('unauthenticated', 'Sign in again.');
  const exp = jwtExpiry(p, idToken);
  const now = p.nowMs();
  if (exp !== null && exp * 1000 <= now)
    throw new HelperError('unauthenticated', 'Your sign-in has expired. Reload the page.');

  const key = `tok:${p.sha256Hex(idToken)}`;
  const hit = p.cacheGet(key);
  if (hit) {
    try {
      return JSON.parse(hit) as Caller;
    } catch {
      /* fall through to a real check */
    }
  }
  const res = p.http({
    url: `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(cfg.apiKey)}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (res.status === 400 || res.status === 401 || res.status === 403)
    throw new HelperError(
      'unauthenticated',
      'Your sign-in could not be verified. Reload the page.',
    );
  if (res.status !== 200) {
    p.log(`accounts:lookup returned ${res.status}`);
    throw new HelperError('unavailable', 'Could not check your sign-in right now.');
  }
  let user: { localId?: unknown; email?: unknown } | undefined;
  try {
    user = (JSON.parse(res.body) as { users?: Array<{ localId?: unknown; email?: unknown }> })
      .users?.[0];
  } catch {
    user = undefined;
  }
  if (!user || typeof user.localId !== 'string')
    throw new HelperError('unauthenticated', 'Your sign-in could not be verified.');
  const caller: Caller = {
    uid: user.localId,
    email: typeof user.email === 'string' ? user.email : null,
  };
  const ttl =
    exp === null
      ? CACHE_SECONDS
      : Math.max(1, Math.min(CACHE_SECONDS, Math.floor(exp - now / 1000)));
  p.cachePut(key, JSON.stringify(caller), ttl);
  return caller;
}

/** The caller's role in a workspace; `forbidden` if they're not a member. */
export function roleIn(db: FirestoreClient, uid: string, workspaceId: unknown): Role {
  if (typeof workspaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId))
    throw new HelperError('bad_request', 'A household is required.');
  const m = db.getDoc(`workspaces/${workspaceId}/members/${uid}`);
  const role = m?.data['role'];
  if (!m || typeof role !== 'string' || !(ROLES as readonly string[]).includes(role))
    throw new HelperError('forbidden', 'You are not a member of this household.');
  return role as Role;
}
