import { expect, test } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

test('empty-list guidance, inline status labels, recently deleted, due-toggle note, installable app', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Polish ${run}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Blank/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();

  // ---- A brand-new board explains how to add the first item
  const hint = ada.getByRole('status').filter({ hasText: 'This list is empty' });
  await expect(hint).toBeVisible();
  await ada.getByLabel('Add item to To do').fill('Pay rates');
  await ada.getByRole('heading', { name: 'Blank list' }).click(); // click away saves it
  await expect(ada.getByRole('button', { name: 'Rename Pay rates' })).toBeVisible();
  await expect(hint).toHaveCount(0);

  // ---- A status label can be created right from the cell
  await ada.getByRole('button', { name: /Status: .*Change for Pay rates/ }).click();
  const pop = ada.getByRole('dialog', { name: /Status for Pay rates/ });
  await pop.getByLabel('New label').fill('Waiting on bank');
  await pop.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(ada.getByRole('button', { name: /Status: Waiting on bank/ })).toBeVisible();
  await ada.waitForTimeout(800);
  await ada.reload();
  await expect(ada.getByRole('button', { name: /Status: Waiting on bank/ })).toBeVisible();
  await ada.getByRole('button', { name: /Status: Waiting on bank/ }).click();
  await expect(
    ada
      .getByRole('dialog', { name: /Status for Pay rates/ })
      .getByText('Waiting on bank')
      .first(),
  ).toBeVisible();
  await ada.keyboard.press('Escape');

  // ---- Delete, let the Undo toast go, then bring it back from "Recently deleted"
  await ada.getByLabel('Add item to To do').fill('Book MOT');
  await ada.keyboard.press('Enter');
  await expect(ada.getByRole('button', { name: 'Rename Book MOT' })).toBeVisible();
  await ada.getByRole('button', { name: 'Options for Book MOT' }).click();
  await ada.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(ada.getByRole('button', { name: 'Rename Book MOT' })).toHaveCount(0);
  await ada.getByRole('button', { name: 'Recently deleted' }).click();
  const trash = ada.getByRole('dialog', { name: 'Recently deleted' });
  await expect(trash.getByRole('list', { name: 'Deleted items' })).toContainText('Book MOT');
  await trash.getByRole('button', { name: 'Restore Book MOT' }).click();
  await ada.keyboard.press('Escape');
  await expect(ada.getByRole('button', { name: 'Rename Book MOT' })).toBeVisible();
  await ada.waitForTimeout(800);
  await ada.reload();
  await expect(ada.getByRole('button', { name: 'Rename Book MOT' })).toBeVisible();

  // ---- The "due" notification switch says it's not live yet
  await ada
    .getByRole('button', { name: /^Notifications/ })
    .first()
    .click();
  await ada.getByRole('button', { name: 'Notification settings' }).click();
  await expect(ada.getByLabel(/When something I own is due/)).toBeDisabled();
  await expect(ada.getByText(/coming soon: reminders/)).toBeVisible();
  await ada.keyboard.press('Escape');

  // ---- Named, and installable on a phone
  await expect(ada).toHaveTitle('Sorted');
  const manifest = await ada.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? '';
    const m = await (await fetch(href)).json();
    const ok = await Promise.all(
      m.icons.map(async (i: { src: string }) => (await fetch(i.src)).ok),
    );
    return { name: m.name, display: m.display, start: m.start_url, icons: ok };
  });
  expect(manifest).toEqual({
    name: 'Sorted',
    display: 'standalone',
    start: '/',
    icons: [true, true, true],
  });
  await expect(ada.getByText('Sorted').first()).toBeVisible(); // the logo text in the sidebar
  expect(permissionErrors(ada)).toEqual([]);
});
