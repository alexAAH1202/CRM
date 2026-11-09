import { expect, test } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

test('import a CSV: mapping is suggested, bad cells are listed and left empty, items persist', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Import ${run}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Bills & subscriptions/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();

  await ada.getByRole('button', { name: 'Import CSV' }).click();
  const dlg = ada.getByRole('dialog', { name: 'Import from CSV' });
  const csv = [
    'Name,Amount,Due date,Group,Notes',
    'Council rates,"$1,250.50",17/3/2099,Utilities,ignored',
    'Streaming,cheap,2099-04-01,Subscriptions,',
    ',5,,,',
    '"Gym, the good one",30,someday,Nowhere,',
  ].join('\n');
  await dlg.getByLabel('Choose a CSV file').setInputFiles({
    name: 'bills.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });

  // Mapping guessed from the headings; the unknown "Notes" heading is not imported
  await expect(dlg.getByLabel('Column Name is')).toHaveValue('name');
  await expect(dlg.getByLabel('Column Amount is')).not.toHaveValue('');
  await expect(dlg.getByLabel('Column Group is')).toHaveValue('group');
  await expect(dlg.getByLabel('Column Notes is')).toHaveValue('');

  await expect(dlg.getByRole('status')).toContainText('3 items will be added');
  await expect(dlg.getByRole('status')).toContainText('1 row with no name skipped');
  await dlg.getByText(/cells? can’t be used/).click();
  await expect(dlg.getByText(/Row 3, Amount: “cheap” is not a number/)).toBeVisible();
  await expect(dlg.getByText(/Row 5, Due date: “someday” is not a date/)).toBeVisible();
  await expect(dlg.getByText(/Row 5, Group: “Nowhere”/)).toBeVisible();

  // Moving a column to a target already used elsewhere frees the old one (no double mapping)
  await dlg.getByLabel('Column Notes is').selectOption({ label: 'Item name' });
  await expect(dlg.getByLabel('Column Name is')).toHaveValue('');
  await dlg.getByLabel('Column Notes is').selectOption('');
  await dlg.getByLabel('Column Name is').selectOption('name');
  await expect(dlg.getByRole('button', { name: 'Import 3 items' })).toBeEnabled();

  await dlg.getByRole('button', { name: 'Import 3 items' }).click();
  await expect(ada.getByText('Imported 3 items.')).toBeVisible();

  const row = (n: string) => ada.getByRole('row').filter({ hasText: n }).first();
  await expect(row('Council rates')).toContainText('$1,250.50');
  await expect(row('Council rates')).toContainText('2099');
  await expect(row('Streaming')).toBeVisible();
  await expect(row('Gym, the good one')).toContainText('$30.00');

  await ada.reload();
  await expect(row('Council rates')).toContainText('$1,250.50');
  await expect(row('Gym, the good one')).toBeVisible();
  expect(permissionErrors(ada)).toEqual([]);
});

test('a bad file is refused with a reason, and the import button stays off', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Import2 ${run}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Blank list/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await ada.getByRole('button', { name: 'Import CSV' }).click();
  const dlg = ada.getByRole('dialog', { name: 'Import from CSV' });
  await dlg.getByLabel('Choose a CSV file').setInputFiles({
    name: 'x.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('a,b\n"oops'),
  });
  await expect(dlg.getByRole('alert')).toContainText('quote that never closes');
  await expect(dlg.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
});
