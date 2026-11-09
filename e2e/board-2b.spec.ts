import { expect, test, type Page } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

async function freshBoard(page: Page, template: RegExp, boardTitle: string) {
  await page.goto('/new');
  await page
    .getByLabel('Household name')
    .fill(`2b ${run} ${Math.random().toString(36).slice(2, 6)}`);
  await page.getByRole('button', { name: 'Create household' }).click();
  await page.getByRole('button', { name: 'Choose a template' }).click();
  await page.getByRole('radio', { name: template }).click();
  await page.getByRole('button', { name: 'Create list' }).click();
  await expect(page.getByRole('heading', { name: boardTitle, level: 1 })).toBeVisible();
  await expect(page.getByRole('grid')).toBeVisible();
}

const names = (page: Page, re: RegExp) =>
  page
    .getByRole('button', { name: re })
    .evaluateAll((els) =>
      els.map((e) => (e.getAttribute('aria-label') ?? '').replace('Rename ', '')),
    );

test('subitems, filter saved to the view, archive, group-by, drag reorder, bulk', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await freshBoard(ada, /Household chores/, 'Household chores');

  // Subitems
  await ada.getByRole('button', { name: 'Options for Dishes' }).click();
  await ada.getByRole('button', { name: 'Add subitem' }).click();
  await ada.keyboard.type('Rinse and dry');
  await ada.keyboard.press('Enter');
  await expect(ada.getByText('Rinse and dry', { exact: true })).toBeVisible();
  await expect(ada.getByRole('button', { name: /Hide subitems of Dishes \(1\)/ })).toBeVisible();

  // Status → Done on Dishes, then filter on Done. The filter is saved to the view (survives reload).
  await ada.getByRole('button', { name: /Status: To do\. Change for Dishes/ }).click();
  await ada
    .getByRole('dialog', { name: 'Status for Dishes' })
    .getByRole('button', { name: 'Done' })
    .click();
  await ada.getByRole('button', { name: 'Filter', exact: true }).click();
  await ada.getByRole('button', { name: 'Add filter' }).click();
  await ada.getByLabel('Filter 1 column').selectOption({ label: 'Status' });
  await ada.getByRole('button', { name: 'Done', exact: true }).click();
  await ada.keyboard.press('Escape');
  await expect(ada.getByText('Take out the bins', { exact: true })).toHaveCount(0);
  await expect(ada.getByText('Dishes', { exact: true })).toBeVisible();
  await ada.waitForTimeout(1500); // view settings save after a short pause
  await ada.reload();
  await expect(ada.getByRole('button', { name: /Filter/ })).toContainText('1');
  await expect(ada.getByText('Take out the bins', { exact: true })).toHaveCount(0);
  await ada.getByRole('button', { name: /Filter/ }).click();
  await ada.getByRole('button', { name: 'Clear all' }).click();
  await ada.keyboard.press('Escape');
  await expect(ada.getByText('Take out the bins', { exact: true })).toBeVisible();

  // Archive via bulk bar, then show archived
  await ada.getByLabel('Select Take out the bins').check();
  await ada
    .getByRole('toolbar', { name: 'Bulk actions' })
    .getByRole('button', { name: 'Archive' })
    .click();
  await expect(ada.getByText('Take out the bins', { exact: true })).toHaveCount(0);
  await ada.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(ada.getByText('Take out the bins', { exact: true })).toBeVisible();
  await ada.getByRole('button', { name: 'Archived', exact: true }).click();

  // Group by status
  await ada.getByRole('button', { name: 'Group by' }).click();
  await ada.getByRole('radio', { name: 'Status' }).click();
  await expect(ada.getByRole('heading', { name: 'Done', level: 2 })).toBeVisible();
  await expect(ada.getByRole('heading', { name: 'To do', level: 2 })).toBeVisible();
  await ada.getByRole('button', { name: /Grouped: Status/ }).click();
  await ada.getByRole('radio', { name: /List groups/ }).click();

  // Drag "Feed the pets" above "Dishes"
  const before = await names(ada, /^Rename (Dishes|Feed the pets)$/);
  expect(before).toEqual(['Dishes', 'Feed the pets']);
  const row = ada.getByRole('row').filter({ hasText: 'Feed the pets' }).first();
  await row.hover();
  const hb = (await row
    .getByRole('button', { name: /Drag to reorder Feed the pets/ })
    .boundingBox())!;
  const target = (await ada.getByRole('row').filter({ hasText: 'Dishes' }).first().boundingBox())!;
  await ada.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await ada.mouse.down();
  await ada.mouse.move(hb.x + 10, hb.y - 10, { steps: 4 });
  await ada.mouse.move(hb.x + 30, target.y + 6, { steps: 10 });
  await ada.mouse.up();
  await expect
    .poll(() => names(ada, /^Rename (Dishes|Feed the pets)$/))
    .toEqual(['Feed the pets', 'Dishes']);

  // Bulk delete + undo
  await ada.getByLabel('Select Feed the pets').check();
  await ada
    .getByRole('toolbar', { name: 'Bulk actions' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(ada.getByText('Deleted 1 item')).toBeVisible();
  await expect(ada.getByRole('button', { name: 'Rename Feed the pets' })).toHaveCount(0);
  await ada.getByRole('button', { name: 'Undo' }).last().click();
  await expect(ada.getByRole('button', { name: 'Rename Feed the pets' })).toBeVisible();
  expect(permissionErrors(ada)).toEqual([]);
});

test('favourites, folders, duplicate list, change column type, summaries', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await freshBoard(ada, /Bills & subscriptions/, 'Bills & subscriptions');

  // Summary footer sums the Amount column
  await ada.getByRole('button', { name: 'Edit Amount for Electricity' }).click();
  await ada.keyboard.type('120');
  await ada.keyboard.press('Enter');
  await ada.getByRole('button', { name: 'Edit Amount for Water' }).click();
  await ada.keyboard.type('80.5');
  await ada.keyboard.press('Enter');
  await expect(ada.getByText('$200.50', { exact: true })).toBeVisible();

  // Favourite
  await ada.getByRole('button', { name: 'Add Bills & subscriptions to favourites' }).click();
  await expect(ada.getByRole('region', { name: 'Favourites' })).toBeVisible();
  // Local writes show instantly even if the server refuses them, so prove it really saved.
  await ada.waitForTimeout(1000);
  await ada.reload();
  await expect(ada.getByRole('region', { name: 'Favourites' })).toBeVisible();

  // Folder
  await ada.getByRole('button', { name: 'New list or folder' }).click();
  await ada.getByRole('button', { name: 'New folder' }).click();
  await ada.getByLabel('Folder name').fill('Money');
  await ada.getByRole('button', { name: 'Save' }).click();
  await expect(ada.getByRole('region', { name: 'Folder Money' })).toBeVisible();
  await ada.getByRole('button', { name: 'List settings' }).click();
  await ada.getByLabel('Folder', { exact: true }).selectOption({ label: 'Money' });
  await ada.getByRole('button', { name: 'Save' }).click();
  await expect(
    ada.getByRole('region', { name: 'Folder Money' }).getByText('Bills & subscriptions'),
  ).toBeVisible();

  // Duplicate board (items and their values come along)
  await ada.getByRole('button', { name: 'List settings' }).click();
  await ada.getByRole('button', { name: 'Duplicate list' }).click();
  await expect(
    ada.getByRole('heading', { name: 'Bills & subscriptions (copy)', level: 1 }),
  ).toBeVisible();
  await expect(ada.getByText('Electricity', { exact: true })).toBeVisible();
  await expect(ada.getByText('$200.50', { exact: true })).toBeVisible();

  // Change a column's type (Auto-pay checkbox → text) with a preview, values carry over
  await ada
    .getByRole('columnheader', { name: /Repeats/ })
    .first()
    .getByRole('button')
    .first()
    .click();
  await ada.getByRole('button', { name: 'Change type' }).click();
  await ada.getByLabel('New type').selectOption('text');
  await expect(ada.getByText(/value[s]? will carry over/)).toBeVisible();
  await ada.getByRole('button', { name: 'Change to Text' }).click();
  await expect(ada.getByRole('button', { name: 'Edit Repeats for Electricity' })).toHaveText(
    'Quarterly',
  );
  await ada.waitForTimeout(500);
  expect(permissionErrors(ada)).toEqual([]);
});

test('a viewer can filter locally but cannot edit; their view changes are not saved for others', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await freshBoard(ada, /Home maintenance/, 'Home maintenance');
  const boardUrl = new URL(ada.url()).pathname;
  const viewerEmail = `vee-${run}-${Math.random().toString(36).slice(2, 5)}@example.com`;
  await ada.getByRole('link', { name: 'Members' }).click();
  await ada.getByLabel('Email').fill(viewerEmail);
  await ada.getByLabel('Role', { exact: true }).selectOption('viewer');
  await ada.getByRole('button', { name: 'Send invite' }).click();
  await expect(ada.getByText(viewerEmail, { exact: true })).toBeVisible();

  const vee = await signedInPage(browser, viewerEmail, 'Vee Viewer');
  await vee.getByRole('button', { name: 'Join household' }).click();
  await vee.waitForURL(/\/w\/[^/]+$/); // joined: the workspace home page
  await vee.goto(boardUrl);
  await expect(vee.getByText('Test smoke alarms', { exact: true })).toBeVisible();
  await expect(vee.getByLabel('Select Test smoke alarms')).toHaveCount(0); // no bulk selection
  await expect(vee.getByRole('button', { name: /Options for/ })).toHaveCount(0);
  await vee.getByLabel('Search items').fill('gutters');
  await expect(vee.getByText('Test smoke alarms', { exact: true })).toHaveCount(0);
  await expect(vee.getByText('Clean gutters', { exact: true })).toBeVisible();
  // Ada is unaffected by the viewer's local search
  await ada.goto(boardUrl);
  await expect(ada.getByText('Test smoke alarms', { exact: true })).toBeVisible();
});
