import {
  buildHelperBody,
  helperBackoffMs,
  HelperError,
  isRetryableHelperError,
  parseHelperResponse,
  type HelperActionName,
  type HelperActions,
} from '@app/shared';
import { APPS_SCRIPT_URL } from '../config';
import { auth } from './firebase';

export { HelperError } from '@app/shared';

/** True once the helper's web app URL has been configured for this build. */
export function helperConfigured(): boolean {
  return APPS_SCRIPT_URL !== '';
}

interface CallOptions {
  /** Per attempt. Apps Script can take a few seconds to wake up. */
  timeoutMs?: number;
  /** Extra attempts after the first, for blips only (never for "forbidden" and friends). */
  retries?: number;
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Calls the Apps Script helper. text/plain keeps it a "simple" CORS request (Apps Script can't
 * answer a preflight); the Firebase ID token travels in the body and is verified server-side.
 * Network blips and 5xx-style problems are retried with backoff; real answers are not.
 */
export async function callHelper<A extends HelperActionName>(
  action: A,
  payload: HelperActions[A]['request'],
  options: CallOptions = {},
): Promise<HelperActions[A]['response']> {
  if (!helperConfigured())
    throw new HelperError('unavailable', 'The Sorted helper hasn’t been set up yet.');
  const { timeoutMs = 25_000, retries = 2 } = options;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // A fresh token each attempt (cached by the SDK until close to expiry).
      const token = action === 'ping' ? null : ((await auth.currentUser?.getIdToken()) ?? null);
      if (action !== 'ping' && !token) throw new HelperError('unauthenticated', 'Sign in again.');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      options.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
      let text: string;
      try {
        const res = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: buildHelperBody(action, token, payload),
          signal: ctrl.signal,
          redirect: 'follow',
        });
        text = await res.text();
      } catch {
        throw new HelperError(
          'unavailable',
          ctrl.signal.aborted
            ? 'The helper took too long to answer.'
            : 'Couldn’t reach the helper. Check your connection.',
        );
      } finally {
        clearTimeout(timer);
      }
      return parseHelperResponse<HelperActions[A]['response']>(text);
    } catch (e) {
      lastError = e;
      if (options.signal?.aborted || !isRetryableHelperError(e) || attempt === retries) throw e;
      await sleep(helperBackoffMs(attempt) + Math.random() * 250);
    }
  }
  throw lastError;
}
