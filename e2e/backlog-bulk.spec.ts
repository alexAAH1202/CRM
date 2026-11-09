import { expect, test } from '@playwright/test';
import { format } from 'date-fns';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

test('bulk “set value” fires the board’s automations for every selected item', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Workspace name').fill(`Bulk ${run}`);
  await ada.getByRole('button', { name: 'Create workspace' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create board' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();

  // Recipe: stamp “Last done” when status becomes Done
  await ada.getByRole('button', { name: 'Automations' }).click();
  await ada.getByRole('button', { name: 'Add automation' }).click();
  await ada.getByRole('button', { name: /Stamp “Last done” when it’s done/ }).click();
  await ada.getByRole('button', { name: 'Add automation' }).click();
  await ada.keyboard.press('Escape');

  const names = ['Dishes', 'Feed the pets', 'Take out the bins'];
  for (const n of names) await ada.getByRole('checkbox', { name: `Select ${n}` }).check();
  await ada.getByRole('button', { name: 'Set value' }).click();
  const dlg = ada.getByRole('dialog', { name: 'Set a value' });
  await dlg.getByLabel('Column').selectOption({ label: 'Status (Status)' });
  await dlg.getByRole('button', { name: /Change for selected items/ }).click();
  await ada.getByRole('dialog').last().getByRole('button', { name: 'Done', exact: true }).click();
  await dlg.getByRole('button', { name: 'Apply to selected' }).click();

  const today = format(new Date(), 'd MMM');
  for (const n of names)
    await expect(ada.getByRole('row').filter({ hasText: n }).first()).toContainText(today);
  // an item that wasn't selected is untouched
  await expect(
    ada.getByRole('row').filter({ hasText: 'Vacuum and mop' }).first(),
  ).not.toContainText(today);

  await ada.reload();
  for (const n of names)
    await expect(ada.getByRole('row').filter({ hasText: n }).first()).toContainText(today);
  expect(permissionErrors(ada)).toEqual([]);
});
