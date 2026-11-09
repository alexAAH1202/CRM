import { expect, test, type Page } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

async function freshBoard(page: Page, template: RegExp, title: string) {
  await page.goto('/new');
  await page
    .getByLabel('Household name')
    .fill(`P3 ${run} ${Math.random().toString(36).slice(2, 6)}`);
  await page.getByRole('button', { name: 'Create household' }).click();
  await page.getByRole('button', { name: 'Choose a template' }).click();
  await page.getByRole('radio', { name: template }).click();
  await page.getByRole('button', { name: 'Create list' }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(page.getByRole('grid')).toBeVisible();
}

async function addColumn(page: Page, name: RegExp) {
  await page.getByRole('button', { name: 'Add column' }).first().click();
  // Scope to the picker: column headers can have the same names (e.g. a column called "Formula").
  await page
    .getByRole('dialog', { name: 'Add column' })
    .getByRole('button', { name })
    .first()
    .click();
}

const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name }).first();

test('formula columns: live validation, results, errors, and renaming a referenced column', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await freshBoard(ada, /Bills & subscriptions/, 'Bills & subscriptions');

  // The template ships with a "days until due" formula.
  await ada.getByRole('button', { name: 'Edit Due date for Electricity' }).click();
  await ada.keyboard.type('01012099');
  await ada.keyboard.press('Enter');
  await expect(row(ada, 'Electricity')).toContainText(/\d{4,}/);

  await ada.getByRole('button', { name: 'Edit Amount for Water' }).click();
  await ada.keyboard.type('100');
  await ada.keyboard.press('Enter');

  // New formula column: the dialog opens straight away and refuses a broken formula.
  await addColumn(ada, /^Formula/);
  const dlg = ada.getByRole('dialog', { name: /Formula for/ });
  await dlg.getByLabel('Formula', { exact: true }).fill('{Amount} * 2 +');
  await expect(dlg.getByRole('status')).toContainText('The formula ends too soon');
  await expect(dlg.getByRole('button', { name: 'Save formula' })).toBeDisabled();
  await dlg.getByLabel('Formula', { exact: true }).fill('{Nope} + 1');
  await expect(dlg.getByRole('status')).toContainText("There's no column called {Nope}");
  await dlg.getByLabel('Formula', { exact: true }).fill('ROUND({Amount} * 1.1, 2)');
  await expect(dlg.getByRole('status')).toHaveText('Looks good');
  await dlg.getByRole('button', { name: 'Save formula' }).click();
  await expect(row(ada, 'Water')).toContainText('110');

  // A formula that can fail shows the problem inline, only on the affected item.
  await addColumn(ada, /^Formula/);
  const dlg2 = ada.getByRole('dialog', { name: /Formula for/ });
  await dlg2.getByLabel('Formula', { exact: true }).fill('100 / {Amount}');
  await dlg2.getByRole('button', { name: 'Save formula' }).click();
  await expect(row(ada, 'Water')).toContainText('1'); // 100 / 100
  await expect(row(ada, 'Internet')).toContainText('#ERROR — Division by zero');

  // Renaming "Amount" rewrites formulas that use it; results stay the same.
  await ada
    .getByRole('columnheader', { name: /^Amount/ })
    .first()
    .getByRole('button')
    .first()
    .click();
  await ada.getByRole('button', { name: 'Rename', exact: true }).click();
  await ada.getByLabel('Column name').fill('Cost');
  await ada.keyboard.press('Enter');
  await expect(ada.getByRole('columnheader', { name: /^Cost/ }).first()).toBeVisible();
  await expect(row(ada, 'Water')).toContainText('110');

  // Survives a reload (the formula text is saved; values are recomputed).
  await ada.waitForTimeout(800);
  await ada.reload();
  await expect(row(ada, 'Water')).toContainText('110');
  expect(permissionErrors(ada)).toEqual([]);
});

test('rating, email, tags, files, progress, item ID and dependencies (with loop prevention)', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await freshBoard(ada, /Household chores/, 'Household chores');

  // Rating
  await addColumn(ada, /^Rating/);
  await ada
    .getByRole('group', { name: /Rating for Dishes/ })
    .getByRole('button', { name: '4 stars' })
    .click();
  await expect(ada.getByRole('group', { name: /Rating for Dishes: 4 of 5/ })).toBeVisible();

  // Email (rejects junk, saves a good address)
  await addColumn(ada, /^Email/);
  await ada.getByRole('button', { name: 'Edit Email for Dishes' }).click();
  const emailDlg = ada.getByRole('dialog', { name: 'Email for Dishes' });
  await emailDlg.getByLabel('Email').fill('not-an-email');
  await emailDlg.getByRole('button', { name: 'Save' }).click();
  await expect(emailDlg.getByText('Enter a valid email address')).toBeVisible();
  await emailDlg.getByLabel('Email').fill('ada@example.com');
  await emailDlg.getByRole('button', { name: 'Save' }).click();
  await expect(row(ada, 'Dishes').getByRole('link', { name: 'ada@example.com' })).toHaveAttribute(
    'href',
    'mailto:ada@example.com',
  );

  // Tags: create one on the fly
  await addColumn(ada, /^Tags/);
  await ada.getByRole('button', { name: 'Edit Tags for Dishes' }).click();
  const tagDlg = ada.getByRole('dialog', { name: 'Tags for Dishes' });
  await tagDlg.getByLabel('New tag').fill('Urgent');
  await tagDlg.getByRole('button', { name: 'Add' }).click();
  await expect(row(ada, 'Dishes').getByText('Urgent', { exact: true })).toBeVisible();

  // Files: attach by link; unsafe links are refused
  await addColumn(ada, /^Files/);
  await ada.getByRole('button', { name: 'Edit Files for Dishes' }).click();
  const fileDlg = ada.getByRole('dialog', { name: 'Files for Dishes' });
  await fileDlg.getByLabel('File address').fill('javascript:alert(1)');
  await fileDlg.getByRole('button', { name: 'Add' }).click();
  await expect(fileDlg.getByText(/Enter a web address/)).toBeVisible();
  await fileDlg.getByLabel('File address').fill('drive.google.com/file/d/abc');
  await fileDlg.getByLabel('File name').fill('Roster');
  await fileDlg.getByRole('button', { name: 'Add' }).click();
  await expect(fileDlg.getByRole('link', { name: 'Roster' })).toHaveAttribute(
    'href',
    'https://drive.google.com/file/d/abc',
  );
  await ada.keyboard.press('Escape');

  // Progress from subitems + Item ID
  await addColumn(ada, /^Progress/);
  await ada
    .getByRole('dialog', { name: /Progress settings/ })
    .getByRole('button', { name: 'Save' })
    .click();
  await addColumn(ada, /^Item ID/);
  await expect(row(ada, 'Dishes')).toContainText('#1');
  await ada.getByRole('button', { name: 'Options for Dishes' }).click();
  await ada.getByRole('button', { name: 'Add subitem' }).click();
  await ada.keyboard.type('Rinse');
  await ada.keyboard.press('Enter');
  await ada.keyboard.type('Dry');
  await ada.keyboard.press('Enter');
  await expect(ada.getByText('Dry', { exact: true })).toBeVisible();
  await ada.getByRole('button', { name: /Status: To do\. Change for Rinse/ }).click();
  await ada
    .getByRole('dialog', { name: 'Status for Rinse' })
    .getByRole('button', { name: 'Done' })
    .click();
  await expect(row(ada, 'Dishes').getByRole('progressbar', { name: 'Progress' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );

  // Dependencies: Feed the pets waits for Dishes; the reverse would be a loop and is blocked.
  await addColumn(ada, /^Dependency/);
  await ada.getByRole('button', { name: 'Edit Dependency for Feed the pets' }).click();
  const dep = ada.getByRole('dialog', { name: 'Dependency for Feed the pets' });
  await dep
    .getByRole('option', { name: /^Dishes/ })
    .getByRole('button')
    .click();
  await ada.keyboard.press('Escape');
  await expect(row(ada, 'Feed the pets')).toContainText('Dishes');

  await ada.getByRole('button', { name: 'Edit Dependency for Dishes' }).click();
  const dep2 = ada.getByRole('dialog', { name: 'Dependency for Dishes' });
  const loopy = dep2.getByRole('option', { name: /Feed the pets/ }).getByRole('button');
  await expect(loopy).toBeDisabled();
  await expect(dep2.getByRole('option', { name: /Feed the pets/ })).toContainText('loop');
  await dep2
    .getByRole('option', { name: /Take out the bins/ })
    .getByRole('button')
    .click(); // fine
  await ada.keyboard.press('Escape');

  // Everything is saved, not just shown locally.
  await ada.waitForTimeout(1000);
  await ada.reload();
  await expect(row(ada, 'Dishes').getByText('Urgent', { exact: true })).toBeVisible();
  await expect(row(ada, 'Dishes').getByRole('link', { name: 'Roster' })).toBeVisible();
  await expect(row(ada, 'Dishes').getByRole('progressbar', { name: 'Progress' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
  await expect(row(ada, 'Feed the pets')).toContainText('Dishes');
  await expect(ada.getByRole('group', { name: /Rating for Dishes: 4 of 5/ })).toBeVisible();
  expect(permissionErrors(ada)).toEqual([]);
});
