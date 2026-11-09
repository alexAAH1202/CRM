import { expect, test, type Page } from '@playwright/test';
import { HELPER_VERSION } from '../shared/src/helperProtocol';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
const CHUNK = 1024 * 1024;

/** A stand-in helper that records what it is sent and behaves like the real upload protocol. */
async function mockHelper(page: Page, opts: { failFirstChunk?: boolean } = {}) {
  const log: Array<{ action: string; offset?: number; bytes?: number; size?: number }> = [];
  let failed = !opts.failFirstChunk;
  let size = 0;
  await page.route('https://helper.test/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    const ok = (data: unknown) =>
      route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, data }) });
    const action = String(body['action']);
    if (action === 'whoami')
      return ok({
        uid: 'u',
        email: null,
        role: 'admin',
        workspaceId: body['workspaceId'],
        version: HELPER_VERSION,
        serverTime: '',
        config: { driveFolder: true, timeZone: 'Australia/Melbourne' },
      });
    if (action === 'schedulerStatus')
      return ok({ pending: 0, failed: 0, nextDue: null, stalled: false });
    if (action === 'uploadStart') {
      size = Number(body['size']);
      log.push({ action, size });
      return ok({ uploadId: 'upl12345678', chunkBytes: CHUNK });
    }
    if (action === 'uploadChunk') {
      const offset = Number(body['offset']);
      const bytes = Buffer.from(String(body['data']), 'base64').length;
      log.push({ action, offset, bytes });
      if (!failed) {
        failed = true;
        return route.fulfill({
          status: 200,
          headers: cors,
          body: JSON.stringify({ ok: false, error: { code: 'unavailable', message: 'busy' } }),
        });
      }
      if (offset + bytes >= size)
        return ok({
          done: true,
          file: {
            driveFileId: 'drvFile12345',
            name: 'Lease agreement.pdf',
            mimeType: 'application/pdf',
            size,
            url: 'https://drive.google.com/file/d/drvFile12345/view',
          },
        });
      return ok({ done: false, next: offset + bytes });
    }
    if (action === 'syncFolderSharing') {
      log.push({ action });
      return ok({ shared: 1, added: 1, removed: 0, skipped: false });
    }
    return route.fulfill({
      status: 200,
      headers: cors,
      body: JSON.stringify({ ok: false, error: { code: 'unknown_action', message: 'x' } }),
    });
  });
  return log;
}

async function boardWithFiles(page: Page) {
  await page.goto('/new');
  await page
    .getByLabel('Workspace name')
    .fill(`Files ${run} ${Math.random().toString(36).slice(2, 5)}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'Choose a template' }).click();
  await page.getByRole('radio', { name: /Bills & subscriptions/ }).click();
  await page.getByRole('button', { name: 'Create board' }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await page.getByRole('button', { name: 'Add column' }).first().click();
  await page
    .getByRole('dialog', { name: 'Add column' })
    .getByRole('button', { name: /^Files/ })
    .first()
    .click();
}

test('upload a file: sent in pieces, a hiccup is retried, the link is saved and survives a reload', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  const log = await mockHelper(ada, { failFirstChunk: true });
  await boardWithFiles(ada);

  await ada.getByRole('button', { name: 'Edit Files for Electricity' }).click();
  const dlg = ada.getByRole('dialog', { name: 'Files for Electricity' });
  const total = CHUNK * 2 + 500_000;

  // A program is refused before anything is sent
  await dlg.getByLabel('Choose a file to upload').setInputFiles({
    name: 'virus.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(10),
  });
  await expect(dlg.getByText(/can’t be uploaded/)).toBeVisible();
  expect(log.filter((l) => l.action === 'uploadStart')).toHaveLength(0);

  // Too big, refused locally too
  await dlg.getByLabel('Choose a file to upload').setInputFiles({
    name: 'big.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(11 * 1024 * 1024),
  });
  await expect(dlg.getByText(/up to 10 MB/)).toBeVisible();
  expect(log.filter((l) => l.action === 'uploadStart')).toHaveLength(0);

  await dlg.getByLabel('Choose a file to upload').setInputFiles({
    name: 'Lease agreement.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(total, 7),
  });
  await expect(dlg.getByRole('link', { name: 'Lease agreement.pdf' })).toHaveAttribute(
    'href',
    'https://drive.google.com/file/d/drvFile12345/view',
  );
  await expect(dlg.getByText('2.5 MB')).toBeVisible();

  // pieces: 0, (retry of 0), 1 MiB, 2 MiB(last, 500000 bytes)
  const chunks = log.filter((l) => l.action === 'uploadChunk');
  expect(chunks.map((c) => c.offset)).toEqual([0, 0, CHUNK, CHUNK * 2]);
  expect(chunks.map((c) => c.bytes)).toEqual([CHUNK, CHUNK, CHUNK, 500_000]);

  // preview button for a PDF
  await dlg.getByRole('button', { name: 'Preview Lease agreement.pdf' }).click();
  await expect(ada.getByTitle('Preview of Lease agreement.pdf')).toHaveAttribute(
    'src',
    'https://drive.google.com/file/d/drvFile12345/preview',
  );
  await ada.keyboard.press('Escape');
  await ada.keyboard.press('Escape');

  // persisted on the item, with the details
  await ada.reload();
  await expect(
    ada
      .getByRole('row')
      .filter({ hasText: 'Electricity' })
      .getByRole('link', { name: 'Lease agreement.pdf' }),
  ).toBeVisible();
  expect(permissionErrors(ada)).toEqual([]);
});

test('a new member’s join asks the helper to share the Drive folder; admins can sync by hand', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  const log = await mockHelper(ada);
  await ada.goto('/new');
  await ada.getByLabel('Workspace name').fill(`Share ${run}`);
  await ada.getByRole('button', { name: 'Create workspace' }).click();
  await ada.getByRole('link', { name: 'Members' }).click();
  const card = ada.getByRole('region', { name: 'Sorted helper' });
  await card.getByRole('button', { name: 'Sync Drive access now' }).click();
  await expect(
    ada.getByText('Drive access updated: 1 added, 0 removed (1 members).'),
  ).toBeVisible();
  expect(log.filter((l) => l.action === 'syncFolderSharing')).toHaveLength(1);
});
