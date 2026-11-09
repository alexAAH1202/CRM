import { expect, test, type Page } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

async function setStatus(p: Page, item: string, label: string) {
  await p.getByRole('button', { name: new RegExp(`Status: .*Change for ${item}`) }).click();
  await p.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  await p.keyboard.press('Escape');
}
const row = (p: Page, name: string) => p.getByRole('row').filter({ hasText: name }).first();

test('undo and redo: edits, adds, deletes, bulk sets; never over someone else’s newer change', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Workspace name').fill(`Undo ${run}`);
  await ada.getByRole('button', { name: 'Create workspace' }).click();
  await ada.getByRole('link', { name: 'Members' }).click();
  const bobEmail = `bobu-${run}@example.com`;
  await ada.getByLabel('Email').fill(bobEmail);
  await ada.getByLabel('Role', { exact: true }).selectOption('member');
  await ada.getByRole('button', { name: 'Send invite' }).click();
  await expect(ada.getByText(bobEmail, { exact: true })).toBeVisible();
  const bob = await signedInPage(browser, bobEmail, 'Bob Builder');
  await bob.getByRole('button', { name: 'Join workspace' }).click();
  await expect(bob.getByRole('heading', { name: `Undo ${run}` })).toBeVisible();

  await ada.getByRole('link', { name: 'Home' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create board' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();
  const undo = ada.locator('button[aria-label="Undo"]');
  const redo = ada.locator('button[aria-label="Redo"]');
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  // ---- a cell edit: button, then keyboard
  await setStatus(ada, 'Dishes', 'Done');
  await expect(row(ada, 'Dishes')).toContainText('Done');
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(ada.getByText(/Undid: edit Status on “Dishes”/)).toBeVisible();
  await expect(row(ada, 'Dishes')).not.toContainText('Done');
  await expect(redo).toBeEnabled();
  await ada.getByRole('heading', { name: 'Household chores' }).click();
  await ada.keyboard.press('Control+Shift+Z');
  await expect(row(ada, 'Dishes')).toContainText('Done');
  await ada.keyboard.press('Control+z');
  await expect(row(ada, 'Dishes')).not.toContainText('Done');

  // ---- typing in a field keeps the field's own undo (the board's isn't triggered)
  await ada.getByLabel('Add item to Daily').fill('Water plants');
  await ada.keyboard.press('Control+z');
  await expect(ada.getByLabel('Add item to Daily')).toBeVisible();
  await ada.getByLabel('Add item to Daily').fill('');

  // ---- add an item, undo removes it, redo brings it back
  await ada.getByLabel('Add item to Daily').fill('Water plants');
  await ada.getByRole('heading', { name: 'Household chores' }).click();
  await expect(row(ada, 'Water plants')).toBeVisible();
  await ada.getByRole('heading', { name: 'Household chores' }).click();
  await ada.keyboard.press('Control+z');
  await expect(row(ada, 'Water plants')).toHaveCount(0);
  await ada.keyboard.press('Control+y');
  await expect(row(ada, 'Water plants')).toBeVisible();

  // ---- delete, then undo
  await ada.getByRole('checkbox', { name: 'Select Water plants' }).check();
  await ada
    .getByRole('toolbar', { name: 'Bulk actions' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(row(ada, 'Water plants')).toHaveCount(0);
  await ada.getByRole('heading', { name: 'Household chores' }).click();
  await ada.keyboard.press('Control+z');
  await expect(row(ada, 'Water plants')).toBeVisible();

  // ---- a bulk set, undone in one step
  await expect(ada.getByText(/\d+ selected/)).toHaveCount(0);
  for (const n of ['Dishes', 'Feed the pets'])
    await ada.getByRole('checkbox', { name: `Select ${n}` }).check();
  await expect(ada.getByText('2 selected')).toBeVisible();
  await ada.getByRole('button', { name: 'Set value' }).click();
  const dlg = ada.getByRole('dialog', { name: 'Set a value' });
  await dlg.getByLabel('Column').selectOption({ label: 'Status (Status)' });
  await dlg.getByRole('button', { name: /Change for selected items/ }).click();
  await ada
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Skipped', exact: true })
    .click();
  await dlg.getByRole('button', { name: 'Apply to selected' }).click();
  await expect(row(ada, 'Dishes')).toContainText('Skipped');
  await expect(row(ada, 'Feed the pets')).toContainText('Skipped');
  await undo.click();
  await expect(row(ada, 'Dishes')).not.toContainText('Skipped');
  await expect(row(ada, 'Feed the pets')).not.toContainText('Skipped');

  // ---- someone else changes the same cell afterwards: undo must not overwrite it
  await setStatus(ada, 'Vacuum and mop', 'Done');
  await expect(row(ada, 'Vacuum and mop')).toContainText('Done');
  await bob.getByRole('link', { name: 'Household chores', exact: true }).click();
  await expect(bob.getByRole('grid')).toBeVisible();
  await setStatus(bob, 'Vacuum and mop', 'Skipped');
  await expect(row(ada, 'Vacuum and mop')).toContainText('Skipped'); // arrives live
  await undo.click();
  await expect(ada.getByText(/Couldn’t undo .*changed again since/)).toBeVisible();
  await expect(row(ada, 'Vacuum and mop')).toContainText('Skipped'); // Bob's change stands
  expect(permissionErrors(ada)).toEqual([]);
  expect(permissionErrors(bob)).toEqual([]);
});
