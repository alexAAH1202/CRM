import { expect, test } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

test('Add to calendar needs a due date, then toggles on and off', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Cal ${Date.now().toString(36)}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Bills & subscriptions/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();

  await ada.getByRole('button', { name: 'Open Electricity' }).click({ force: true });
  const panel = ada.getByRole('dialog');
  await expect(panel.getByRole('button', { name: 'Add to calendar' })).toBeDisabled();
  await ada.keyboard.press('Escape');

  await ada.getByRole('button', { name: 'Edit Due date for Electricity' }).click();
  await ada.keyboard.type('12152030');
  await ada.keyboard.press('Enter');
  await ada.getByRole('button', { name: 'Open Electricity' }).click({ force: true });
  await panel.getByRole('button', { name: 'Add to calendar' }).click();
  await expect(panel.getByRole('button', { name: /On calendar/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await panel.getByRole('button', { name: /On calendar/ }).click();
  await expect(panel.getByRole('button', { name: 'Add to calendar' })).toBeVisible();
  expect(permissionErrors(ada)).toEqual([]);
});
