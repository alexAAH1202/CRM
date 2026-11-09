import { expect, test } from '@playwright/test';
import { signedInPage } from './helpers';

const run = Date.now().toString(36);

test('board from template → edit cells → add item → viewer sees live, read-only', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Workspace name').fill(`Board test ${run}`);
  await ada.getByRole('button', { name: 'Create workspace' }).click();
  await expect(ada.getByRole('heading', { name: `Board test ${run}` })).toBeVisible();

  // Create a board from the chores template.
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create board' }).click();
  await expect(ada.getByRole('heading', { name: 'Household chores' })).toBeVisible();
  await expect(ada.getByText('Take out the bins', { exact: true })).toBeVisible();

  // Edit a status and add an item.
  await ada.getByRole('button', { name: /Status: To do\. Change for Dishes/ }).click();
  await ada
    .getByRole('dialog', { name: 'Status for Dishes' })
    .getByRole('button', { name: 'Done' })
    .click();
  await expect(ada.getByRole('button', { name: /Status: Done\. Change for Dishes/ })).toBeVisible();
  await ada.getByLabel('Add item to Weekly').fill('Water the plants');
  await ada.keyboard.press('Enter');
  await expect(ada.getByText('Water the plants', { exact: true })).toBeVisible();

  // Survives a reload (served from cache + delta sync).
  await ada.reload();
  await expect(ada.getByText('Water the plants', { exact: true })).toBeVisible();
  await expect(ada.getByRole('button', { name: /Status: Done\. Change for Dishes/ })).toBeVisible();
  const boardUrl = new URL(ada.url()).pathname;

  // Invite a viewer.
  const viewerEmail = `viv-${run}@example.com`;
  await ada.getByRole('link', { name: 'Members' }).click();
  await ada.getByLabel('Email').fill(viewerEmail);
  await ada.getByLabel('Role', { exact: true }).selectOption('viewer');
  await ada.getByRole('button', { name: 'Send invite' }).click();
  await expect(ada.getByText(viewerEmail, { exact: true })).toBeVisible();

  const viv = await signedInPage(browser, viewerEmail, 'Viv Viewer');
  await viv.getByRole('button', { name: 'Join workspace' }).click();
  await expect(viv.getByRole('heading', { name: `Board test ${run}` })).toBeVisible(); // join saved
  await viv.goto(boardUrl);
  await expect(viv.getByText('Water the plants', { exact: true })).toBeVisible();
  await expect(viv.getByLabel('Add item to Weekly')).toHaveCount(0); // read-only
  await expect(viv.getByRole('button', { name: /Change for Dishes/ })).toHaveCount(0);

  // Live update from Ada reaches the viewer.
  await ada.goto(boardUrl);
  await ada.getByRole('button', { name: /Status: To do\. Change for Vacuum and mop/ }).click();
  await ada
    .getByRole('dialog', { name: 'Status for Vacuum and mop' })
    .getByRole('button', { name: 'Skipped' })
    .click();
  await expect(
    viv.getByRole('row').filter({ hasText: 'Vacuum and mop' }).getByText('Skipped'),
  ).toBeVisible();
});
