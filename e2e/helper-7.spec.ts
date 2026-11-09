import { expect, test, type Page } from '@playwright/test';
import { HELPER_VERSION } from '../shared/src/helperProtocol';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);
const URL_GLOB = 'https://helper.test/**';
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

async function adminWorkspace(page: Page) {
  await page.goto('/new');
  await page
    .getByLabel('Workspace name')
    .fill(`Helper ${run} ${Math.random().toString(36).slice(2, 5)}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('link', { name: 'Members' }).click();
}

const reply = (data: unknown) => ({
  status: 200,
  headers: cors,
  body: JSON.stringify({ ok: true, data }),
});
const failure = (code: string, message: string) => ({
  status: 200,
  headers: cors,
  body: JSON.stringify({ ok: false, error: { code, message } }),
});

test('Helper status card: connected, out of date, refused, unreachable (with the real client and a faked helper)', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  const seen: Array<Record<string, unknown>> = [];
  let mode: 'ok' | 'old' | 'forbidden' | 'down' = 'ok';
  await ada.route(URL_GLOB, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    seen.push(body);
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors });
    if (mode === 'down') return route.abort('failed');
    if (mode === 'forbidden')
      return route.fulfill(failure('forbidden', 'You are not a member of this workspace.'));
    return route.fulfill(
      reply({
        uid: 'u1',
        email: 'ada@example.com',
        role: 'admin',
        workspaceId: body['workspaceId'] ?? null,
        version: mode === 'old' ? '0.0.1' : HELPER_VERSION,
        serverTime: new Date().toISOString(),
        config: { driveFolder: true, timeZone: 'Australia/Melbourne' },
      }),
    );
  });
  await adminWorkspace(ada);
  const card = ada.getByRole('region', { name: 'Sorted helper' });

  // connected: the request is text/plain JSON, carries a real ID token, and asks about this workspace
  await expect(card).toContainText('Connected');
  await expect(card).toContainText('you are an admin');
  await expect(card).toContainText(`Helper version ${HELPER_VERSION}`);
  await expect(card).toContainText('Australia/Melbourne');
  const first = seen.find((b) => b['action'] === 'whoami')!;
  expect(typeof first['idToken']).toBe('string');
  expect((first['idToken'] as string).split('.')).toHaveLength(3);
  expect(first['workspaceId']).toMatch(/\w+/);

  // an out-of-date deployment is called out
  mode = 'old';
  await card.getByRole('button', { name: 'Check again' }).click();
  await expect(card).toContainText('expects ' + HELPER_VERSION);

  // a refusal shows the helper's message and code (and is not retried)
  mode = 'forbidden';
  const before = seen.length;
  await card.getByRole('button', { name: 'Check again' }).click();
  await expect(card.getByRole('alert')).toContainText('You are not a member of this workspace.');
  await expect(card.getByRole('alert')).toContainText('forbidden');
  expect(seen.length - before).toBe(1);

  // unreachable: retried, then a friendly message
  mode = 'down';
  const before2 = seen.length;
  await card.getByRole('button', { name: 'Check again' }).click();
  await expect(card.getByRole('alert')).toContainText('Couldn’t reach the helper', {
    timeout: 15_000,
  });
  expect(seen.length - before2).toBe(2); // the first attempt plus one retry (whoami is called with retries: 1)
  expect(permissionErrors(ada)).toEqual([]);
});

test('Helper status card is for admins only: a viewer does not see it, and the helper is not called for them', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await adminWorkspace(ada);
  const email = `viewer-${run}@example.com`;
  await ada.getByLabel('Email').fill(email);
  await ada.getByLabel('Role', { exact: true }).selectOption('viewer');
  await ada.getByRole('button', { name: 'Send invite' }).click();
  await expect(ada.getByText(email, { exact: true })).toBeVisible();

  const vi = await signedInPage(browser, email, 'Vera Viewer');
  let calls = 0;
  await vi.route(URL_GLOB, (route) => {
    // Joining asks the helper to share the Drive folder with the new member (any role); that is the
    // only call a non-admin is expected to cause. The admin-only card must not call anything.
    const action = (JSON.parse(route.request().postData() ?? '{}') as { action?: string }).action;
    if (action !== 'syncFolderSharing') calls++;
    return route.fulfill(failure('forbidden', 'no'));
  });
  await vi.getByRole('button', { name: 'Join workspace' }).click();
  await vi.getByRole('link', { name: 'Members' }).click();
  await expect(
    vi
      .getByRole('heading', { name: 'Workspace members' })
      .or(vi.getByText('Ada Lovelace', { exact: true })),
  ).toBeVisible();
  await expect(vi.getByRole('region', { name: 'Sorted helper' })).toHaveCount(0);
  expect(calls).toBe(0);
});
