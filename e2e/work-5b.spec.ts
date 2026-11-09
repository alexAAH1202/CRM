import { expect, test } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

test('activity log, My work and search', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Workspace name').fill(`P5b ${run}`);
  await ada.getByRole('button', { name: 'Create workspace' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create board' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();

  // ---- Activity: a status change, a new item
  await ada.getByRole('button', { name: /Status: .*Change for Dishes/ }).click();
  await ada.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await ada.keyboard.press('Escape');
  await ada.getByLabel('Add item to Daily').fill('Water the plants');
  await ada.keyboard.press('Enter');
  await expect(ada.getByRole('button', { name: 'Rename Water the plants' })).toBeVisible();

  await ada.getByRole('button', { name: 'Open Dishes' }).click({ force: true });
  await ada.getByRole('tab', { name: 'Activity' }).click();
  await expect(ada.getByRole('list', { name: 'Activity' })).toContainText('changed Status from');
  await expect(ada.getByRole('list', { name: 'Activity' })).toContainText('“Done”');
  await ada.keyboard.press('Escape');

  await ada.getByRole('button', { name: 'Board activity' }).click();
  const board = ada.getByRole('dialog', { name: /Activity on/ });
  await expect(board).toContainText('Water the plants');
  await expect(board).toContainText('created this item');
  await board.getByRole('button', { name: 'Water the plants' }).click();
  await expect(ada.getByRole('dialog').getByRole('tab', { name: 'Updates' })).toBeVisible();
  await ada.keyboard.press('Escape');

  // ---- My work: assigned to me, overdue
  await ada.getByRole('button', { name: 'Edit Who for Feed the pets' }).click();
  await ada
    .getByRole('dialog', { name: /Who for Feed the pets/ })
    .getByRole('button', { name: /Ada Lovelace/ })
    .click();
  await ada.keyboard.press('Escape');
  await ada.getByRole('button', { name: 'Edit Next due for Feed the pets' }).click();
  await ada.keyboard.type('01012000');
  await ada.keyboard.press('Enter');
  await ada.getByRole('button', { name: 'Edit Who for Dishes' }).click();
  await ada
    .getByRole('dialog', { name: /Who for Dishes/ })
    .getByRole('button', { name: /Ada Lovelace/ })
    .click();
  await ada.keyboard.press('Escape');
  await ada.waitForTimeout(800);

  await ada.getByRole('link', { name: 'My work' }).click();
  const overdue = ada.getByRole('region', { name: 'Overdue' });
  await expect(overdue.getByRole('link', { name: /Feed the pets/ })).toBeVisible();
  // Dishes is Done: hidden until asked for.
  await expect(ada.getByRole('link', { name: /Dishes/ })).toHaveCount(0);
  await ada.getByLabel(/Show done/).check();
  await expect(ada.getByRole('link', { name: /Dishes/ })).toBeVisible();
  await overdue.getByRole('link', { name: /Feed the pets/ }).click();
  await expect(ada.getByRole('dialog').getByRole('tab', { name: 'Updates' })).toBeVisible();
  await expect(ada).toHaveURL(/\?item=/);
  await ada.keyboard.press('Escape');

  // ---- Search (Ctrl+K): items from boards opened on this device, and boards
  await ada.keyboard.press('Control+k');
  const search = ada.getByRole('combobox', { name: 'Search boards and items' });
  await expect(search).toBeFocused();
  await search.fill('vacuum');
  await expect(ada.getByRole('option', { name: /Vacuum and mop/ })).toBeVisible();
  await search.fill('household');
  await expect(ada.getByRole('option', { name: /Household chores/ })).toBeVisible();
  await search.fill('water');
  await ada.keyboard.press('Enter');
  await expect(ada.getByRole('dialog').getByRole('tab', { name: 'Updates' })).toBeVisible();
  await expect(ada).toHaveURL(/\?item=/);

  expect(permissionErrors(ada)).toEqual([]);
});
