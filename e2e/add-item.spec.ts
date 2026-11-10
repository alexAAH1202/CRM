import { expect, test } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

test('typing an item name and clicking away saves it; Escape cancels', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Add ${Date.now().toString(36)}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Blank/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();

  const add = ada.getByLabel('Add item to To do');
  await add.fill('Test Test');
  await expect(ada.getByText('Enter to add')).toHaveCount(0);
  await ada.getByRole('heading', { name: 'Blank list' }).click(); // click away
  await expect(ada.getByRole('button', { name: /^Rename Test Test$/ })).toBeVisible();
  await expect(add).toHaveValue('');
  // The new item's cells are real and editable.
  await ada.getByRole('button', { name: /Status: .*Change for Test Test/ }).click();
  await ada.getByRole('dialog').getByRole('button').first().click();

  // A brand-new Dropdown column has no options: add them right from the cell.
  await ada.getByRole('button', { name: 'Add column' }).first().click();
  await ada
    .getByRole('dialog', { name: 'Add column' })
    .getByRole('button', { name: /^Dropdown/ })
    .first()
    .click();
  await ada.getByRole('button', { name: /Edit Dropdown for Test Test/ }).click();
  const pop = ada.getByRole('dialog', { name: /Dropdown for Test Test/ });
  await pop.getByLabel('New option').fill('Red');
  await pop.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    ada.getByRole('row').filter({ hasText: 'Test Test' }).getByText('Red'),
  ).toBeVisible();
  await ada.getByRole('button', { name: /Edit Dropdown for Test Test/ }).click();
  await ada
    .getByRole('dialog', { name: /Dropdown for Test Test/ })
    .getByLabel('New option')
    .fill('Blue');
  await ada.keyboard.press('Enter');
  await ada.waitForTimeout(800);
  await ada.reload();
  await expect(
    ada.getByRole('row').filter({ hasText: 'Test Test' }).getByText('Red'),
  ).toBeVisible();
  await ada.getByRole('button', { name: /Edit Dropdown for Test Test/ }).click();
  await expect(
    ada.getByRole('dialog', { name: /Dropdown for Test Test/ }).getByText('Blue'),
  ).toBeVisible();
  await ada.keyboard.press('Escape');

  await add.fill('Never added');
  await ada.keyboard.press('Escape');
  await ada.getByRole('heading', { name: 'Blank list' }).click();
  await expect(ada.getByRole('button', { name: /Rename Never added/ })).toHaveCount(0);
  expect(permissionErrors(ada)).toEqual([]);
});
