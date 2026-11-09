import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);
const row = (p: Page, name: string) => p.getByRole('row').filter({ hasText: name }).first();

test('time tracking: timer, manual time, one timer at a time, timesheet and CSV', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Time ${run}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();

  // A Time tracking column
  await ada.getByRole('button', { name: 'Add column' }).first().click();
  await ada
    .getByRole('dialog', { name: 'Add column' })
    .getByRole('button', { name: /^Time tracking/ })
    .first()
    .click();
  await expect(ada.getByRole('button', { name: 'Start timer for Dishes' })).toBeVisible();

  // ---- start a timer: the pill shows up and ticks; stopping saves a session
  await ada.getByRole('button', { name: 'Start timer for Dishes' }).click();
  const pill = ada.getByRole('status', { name: 'Timer running' });
  await expect(pill).toBeVisible();
  await expect(ada.getByRole('button', { name: 'Stop timer for Dishes' })).toBeVisible();
  await ada.waitForTimeout(2200);
  await expect(pill).toContainText(/0:00:0[2-9]/);

  // ---- one timer at a time: starting another saves the first
  await ada.getByRole('button', { name: 'Start timer for Feed the pets' }).click();
  await expect(ada.getByRole('button', { name: 'Stop timer for Feed the pets' })).toBeVisible();
  await expect(ada.getByRole('button', { name: 'Start timer for Dishes' })).toBeVisible();
  await expect(row(ada, 'Dishes')).toContainText(/\ds/); // a few seconds were saved on Dishes
  await ada.waitForTimeout(1500); // under a second would not be worth recording
  await ada.getByRole('button', { name: 'Stop timer for Feed the pets' }).click();
  await expect(pill).toHaveCount(0);

  // ---- manual time: 1 h 30 m on Dishes
  await ada.getByRole('button', { name: 'Edit Time tracking for Dishes' }).click();
  const dlg = ada.getByRole('dialog', { name: 'Time tracking for Dishes' });
  await dlg.getByLabel('Hours').fill('1');
  await dlg.getByLabel('Minutes').fill('30');
  await dlg.getByLabel('Note').fill('deep clean');
  await dlg.getByRole('button', { name: 'Add time' }).click();
  await expect(dlg.getByText(/Total 1h 30m/)).toBeVisible();
  await expect(dlg.getByRole('list', { name: 'Logged time' })).toContainText('deep clean');
  // nonsense is refused with a reason
  await dlg.getByLabel('Hours').fill('0');
  await dlg.getByLabel('Minutes').fill('0');
  await dlg.getByRole('button', { name: 'Add time' }).click();
  await expect(dlg.getByRole('alert')).toContainText('how long it took');
  await ada.keyboard.press('Escape');
  await expect(row(ada, 'Dishes')).toContainText('1h 30m');

  // ---- it survives a reload
  await ada.reload();
  await expect(row(ada, 'Dishes')).toContainText('1h 30m');

  // ---- timesheet
  await ada.getByRole('link', { name: 'Timesheet' }).click();
  await expect(ada.getByRole('heading', { name: 'Timesheet', level: 1 })).toBeVisible();
  await expect(ada.getByRole('status').filter({ hasText: /1h 3\dm/ })).toBeVisible();
  const person = ada.getByRole('region', { name: 'Ada Lovelace' });
  await expect(person).toContainText('Dishes');
  await expect(person).toContainText('Feed the pets');
  await expect(person).toContainText('deep clean');
  await ada.getByRole('button', { name: 'Item', exact: true }).click();
  await expect(ada.getByRole('region', { name: 'Dishes' })).toContainText('1h 3');
  // a period with nothing in it
  await ada.getByLabel('From', { exact: true }).fill('2001-01-01');
  await ada.getByLabel('To', { exact: true }).fill('2001-01-31');
  await expect(ada.getByText('No time logged in this period')).toBeVisible();
  await ada.getByRole('button', { name: 'All time' }).click();
  await expect(ada.getByRole('region', { name: 'Dishes' })).toBeVisible();

  // ---- CSV: decimal hours a spreadsheet can add up
  const [download] = await Promise.all([
    ada.waitForEvent('download'),
    ada.getByRole('button', { name: 'Export timesheet CSV' }).click(),
  ]);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv).toContain('Date,Start,End,Person,List,Item,Hours,Note');
  expect(csv).toMatch(/Ada Lovelace,Household chores,Dishes,1\.5,deep clean/);
  expect(permissionErrors(ada)).toEqual([]);
});

test('a board footer sums the time, and a copy of a list starts with none', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Time2 ${run}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await ada.getByRole('button', { name: 'Add column' }).first().click();
  await ada
    .getByRole('dialog', { name: 'Add column' })
    .getByRole('button', { name: /^Time tracking/ })
    .first()
    .click();
  for (const [item, h] of [
    ['Dishes', '2'],
    ['Feed the pets', '1'],
  ] as const) {
    await ada.getByRole('button', { name: `Edit Time tracking for ${item}` }).click();
    const d = ada.getByRole('dialog', { name: `Time tracking for ${item}` });
    await d.getByLabel('Hours').fill(h);
    await d.getByLabel('Minutes').fill('0');
    await d.getByRole('button', { name: 'Add time' }).click();
    await expect(d.getByText(new RegExp(`Total ${h}h`))).toBeVisible();
    await ada.keyboard.press('Escape');
  }
  // Daily group footer adds Dishes and Feed the pets: 3h
  await expect(ada.getByText('3h', { exact: true }).first()).toBeVisible();

  // Duplicating an item gives a copy with no logged time
  await ada.getByRole('button', { name: 'Options for Dishes' }).click({ force: true });
  await ada.getByRole('button', { name: 'Duplicate' }).click();
  await expect(row(ada, 'Dishes (copy)')).toBeVisible();
  await expect(row(ada, 'Dishes (copy)')).not.toContainText('2h');
  await expect(row(ada, 'Dishes').first()).toContainText('2h');
  expect(permissionErrors(ada)).toEqual([]);
});
