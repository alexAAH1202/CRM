import { expect, test } from '@playwright/test';
import { HELPER_VERSION } from '../shared/src/helperProtocol';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

test('daily-email switch persists; the Helper card shows tidy-up, backup and email status', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.route('https://helper.test/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    const ok = (data: unknown) =>
      route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, data }) });
    switch (body['action']) {
      case 'whoami':
        return ok({
          uid: 'u',
          email: null,
          role: 'admin',
          workspaceId: body['workspaceId'],
          version: HELPER_VERSION,
          serverTime: '',
          config: { driveFolder: true, timeZone: 'Australia/Melbourne' },
        });
      case 'schedulerStatus':
        return ok({ pending: 0, failed: 0, nextDue: null, stalled: false });
      case 'maintenanceStatus':
        return ok({
          nightly: {
            at: '2026-03-17T16:00:00.000Z',
            deleted: 12,
            problems: ['activity log: The query requires an index'],
            backups: { ok: 0, failed: 1 },
          },
          digest: { at: '2026-03-17T20:00:00.000Z', sent: 2, failed: 0 },
          lastBackupAt: null,
        });
    }
    return route.fulfill({
      status: 200,
      headers: cors,
      body: JSON.stringify({ ok: false, error: { code: 'unknown_action', message: 'x' } }),
    });
  });
  await ada.goto('/new');
  await ada.getByLabel('Workspace name').fill(`Maint ${run}`);
  await ada.getByRole('button', { name: 'Create workspace' }).click();

  // the switch lives in the notifications settings
  await ada.getByRole('button', { name: /^Notifications/ }).click();
  await ada.getByRole('button', { name: 'Notification settings' }).click();
  const sw = ada.getByLabel('Email me a daily summary');
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(sw).toBeChecked();
  await ada.reload();
  await ada.getByRole('button', { name: /^Notifications/ }).click();
  await ada.getByRole('button', { name: 'Notification settings' }).click();
  await expect(ada.getByLabel('Email me a daily summary')).toBeChecked();
  await ada.getByLabel('Email me a daily summary').click();
  await expect(ada.getByLabel('Email me a daily summary')).not.toBeChecked();
  await ada.keyboard.press('Escape');

  // the admin card
  await ada.getByRole('link', { name: 'Members' }).click();
  const card = ada.getByRole('region', { name: 'Sorted helper' });
  const list = card.getByRole('list', { name: 'Maintenance' });
  await expect(list).toContainText('removed 12 old records');
  await expect(list).toContainText('activity log: The query requires an index');
  await expect(list).toContainText('no backup yet');
  await expect(list).toContainText('The last backup attempt failed');
  await expect(list).toContainText('2 sent');
  expect(permissionErrors(ada)).toEqual([]);
});
