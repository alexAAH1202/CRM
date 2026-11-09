/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles and loose JSON */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Runs the built file exactly as it will be pasted into Apps Script (a single script, no modules),
 * against stand-ins for Apps Script's services. Catches bundling mistakes the unit tests can't.
 */
function loadRelease() {
  const code = readFileSync(new URL('../release/Code.js', import.meta.url), 'utf8');
  const triggers: Array<{ fn: string; kind: string }> = [];
  const deleted: string[] = [];
  const props = new Map<string, string>();
  const fetchCalls: Array<{ url: string; opts: any }> = [];
  const sandbox: Record<string, unknown> = {
    console: { log: () => undefined },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (t: string) => ({
        text: t,
        setMimeType() {
          return this;
        },
      }),
    },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => undefined }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => void props.set(k, v),
      }),
    },
    UrlFetchApp: {
      fetch: (url: string, opts: unknown) => {
        fetchCalls.push({ url, opts });
        return { getResponseCode: () => 404, getContentText: () => '{}' };
      },
    },
    ScriptApp: {
      getOAuthToken: () => 'oauth',
      getProjectTriggers: () => [
        { getHandlerFunction: () => 'runScheduler' },
        { getHandlerFunction: () => 'someoneElses' },
      ],
      deleteTrigger: (t: { getHandlerFunction: () => string }) =>
        void deleted.push(t.getHandlerFunction()),
      newTrigger: (fn: string) => {
        const t = { fn, kind: '' } as { fn: string; kind: string };
        const chain: any = {
          timeBased: () => chain,
          everyMinutes: (n: number) => ((t.kind = `every ${n} min`), chain),
          everyDays: (n: number) => ((t.kind = `every ${n} day`), chain),
          atHour: (h: number) => ((t.kind += ` at ${h}`), chain),
          inTimezone: (z: string) => ((t.kind += ` ${z}`), chain),
          create: () => void triggers.push(t),
        };
        return chain;
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: () => [1, -1, 2],
      newBlob: () => ({ getDataAsString: () => '{}' }),
      base64DecodeWebSafe: () => [],
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, triggers, deleted, props, fetchCalls };
}

describe('the built Code.js (as pasted into Apps Script)', () => {
  it('defines every entry point as a top-level function (the editor and triggers need them by name)', () => {
    const { sandbox } = loadRelease();
    for (const fn of ['doGet', 'doPost', 'setup', 'runScheduler', 'runHousekeeping', 'runDigest'])
      expect(typeof sandbox[fn], fn).toBe('function');
  });
  it('doGet answers, so opening the web app URL shows it is alive', () => {
    const { sandbox } = loadRelease();
    const out = (sandbox['doGet'] as () => { text: string })();
    expect(JSON.parse(out.text)).toMatchObject({ ok: true, data: { name: 'Sorted helper' } });
  });
  it('doPost ping works end to end, and unknown things are refused', () => {
    const { sandbox, fetchCalls } = loadRelease();
    const post = sandbox['doPost'] as (e: unknown) => { text: string };
    expect(JSON.parse(post({ postData: { contents: '{"action":"ping"}' } }).text)).toMatchObject({
      ok: true,
      data: { pong: true },
    });
    expect(JSON.parse(post({ postData: { contents: '{"action":"whoami"}' } }).text)).toMatchObject({
      ok: false,
      error: { code: 'unauthenticated' },
    });
    expect(JSON.parse(post({ postData: { contents: 'junk' } }).text)).toMatchObject({
      ok: false,
      error: { code: 'bad_request' },
    });
    expect(JSON.parse(post({}).text)).toMatchObject({ ok: false, error: { code: 'bad_request' } });
    expect(fetchCalls).toHaveLength(0); // none of that needed the network
  });
  it('setup stores the Drive folder, replaces only its own triggers, and creates the three schedules', () => {
    const { sandbox, triggers, deleted, props } = loadRelease();
    (sandbox['setup'] as () => void)();
    expect(props.get('DRIVE_ROOT_FOLDER_ID')).toBeTruthy();
    expect(deleted).toEqual(['runScheduler']); // not someone else's trigger
    expect(triggers).toEqual([
      { fn: 'runScheduler', kind: 'every 10 min' },
      { fn: 'runHousekeeping', kind: 'every 1 day at 3 Australia/Melbourne' },
      { fn: 'runDigest', kind: 'every 1 day at 7 Australia/Melbourne' },
    ]);
  });
  it('does not rely on anything Apps Script lacks (no atob, crypto, fetch, Buffer, require, import)', () => {
    const code = readFileSync(new URL('../release/Code.js', import.meta.url), 'utf8');
    expect(code).not.toMatch(/\batob\(|\bBuffer\b|\brequire\(|\bimport\s*\(|^import |\bprocess\./m);
  });
});
