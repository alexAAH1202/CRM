import { expect, test } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

test('list types set the groups; changing the Group column moves the item', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Grp ${Date.now().toString(36)}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Blank/ }).click();
  await ada.getByRole('radio', { name: /^Custom/ }).click();
  await ada.getByLabel('Your groups, separated by commas').fill('This week, Next week, Someday');
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();
  await expect(ada.getByRole('heading', { name: 'Next week' })).toBeVisible();

  await ada.getByLabel('Add item to This week').fill('Book dentist');
  await ada.keyboard.press('Enter');
  const cell = ada.getByRole('button', { name: /^Group: This week\. Change for Book dentist/ });
  await expect(cell).toBeVisible();
  await cell.click();
  await ada
    .getByRole('dialog', { name: 'Group for Book dentist' })
    .getByRole('button', { name: 'Someday' })
    .click();
  await expect(
    ada.getByRole('button', { name: /^Group: Someday\. Change for Book dentist/ }),
  ).toBeVisible();
  // it now sits under the Someday heading: Ctrl+Z puts it back
  await ada.keyboard.press('Control+z');
  await expect(
    ada.getByRole('button', { name: /^Group: This week\. Change for Book dentist/ }),
  ).toBeVisible();
  expect(permissionErrors(ada)).toEqual([]);
});
