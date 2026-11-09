import { expect, test } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

test('typing an item name and clicking away saves it; Escape cancels', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Workspace name').fill(`Add ${Date.now().toString(36)}`);
  await ada.getByRole('button', { name: 'Create workspace' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Blank/ }).click();
  await ada.getByRole('button', { name: 'Create board' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();

  const add = ada.getByLabel('Add item to To do');
  await add.fill('Test Test');
  await expect(ada.getByText('Enter to add')).toBeVisible();
  await ada.getByRole('heading', { name: 'Blank board' }).click(); // click away
  await expect(ada.getByRole('button', { name: /^Rename Test Test$/ })).toBeVisible();
  await expect(add).toHaveValue('');
  // The new item's cells are real and editable.
  await ada.getByRole('button', { name: /Status: .*Change for Test Test/ }).click();
  await ada.getByRole('dialog').getByRole('button').first().click();

  await add.fill('Never added');
  await ada.keyboard.press('Escape');
  await ada.getByRole('heading', { name: 'Blank board' }).click();
  await expect(ada.getByRole('button', { name: /Rename Never added/ })).toHaveCount(0);
  expect(permissionErrors(ada)).toEqual([]);
});
