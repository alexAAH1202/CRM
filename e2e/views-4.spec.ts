import { expect, test, type Locator, type Page } from '@playwright/test';
import { format, addDays, getDay } from 'date-fns';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

async function freshBoard(page: Page) {
  await page.goto('/new');
  await page
    .getByLabel('Workspace name')
    .fill(`P4 ${run} ${Math.random().toString(36).slice(2, 6)}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'Choose a template' }).click();
  await page.getByRole('radio', { name: /Household chores/ }).click();
  await page.getByRole('button', { name: 'Create board' }).click();
  await expect(page.getByRole('heading', { name: 'Household chores', level: 1 })).toBeVisible();
  await expect(page.getByRole('grid')).toBeVisible();
}

async function addView(page: Page, kind: 'Kanban' | 'Calendar') {
  await page.getByRole('button', { name: 'Add view' }).click();
  await page.getByRole('dialog', { name: 'Add view' }).getByRole('button', { name: kind }).click();
  await expect(page.getByRole('tab', { name: kind, selected: true })).toBeVisible();
}

/** A real pointer drag (dnd-kit needs movement past a small threshold). */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('views: add Kanban and Calendar, drag to change status / date, rename, delete, reload', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await freshBoard(ada);
  await expect(ada.getByRole('tab', { name: 'Main table', selected: true })).toBeVisible();

  // ---- Kanban
  await addView(ada, 'Kanban');
  const todo = ada.getByRole('region', { name: 'Lane To do' });
  const done = ada.getByRole('region', { name: 'Lane Done' });
  await expect(todo).toBeVisible();
  const card = todo.getByRole('button', { name: /^Card:/ }).first();
  const label = (await card.getAttribute('aria-label'))!;
  await drag(ada, card, done);
  await expect(done.getByRole('button', { name: label })).toBeVisible();
  await expect(todo.getByRole('button', { name: label })).toHaveCount(0);

  // Opening a card edits the same data as the table.
  await done.getByRole('button', { name: label }).click();
  await ada.getByRole('dialog').getByRole('tab', { name: 'Fields' }).click();
  await expect(ada.getByRole('dialog').getByLabel('Name')).toHaveValue(label.replace('Card: ', ''));
  await ada.keyboard.press('Escape');

  // Add an item straight into a lane.
  await todo.getByRole('button', { name: 'Add item' }).click();
  await ada.getByLabel('New item in To do').fill('Water the plants');
  await ada.keyboard.press('Enter');
  await expect(todo.getByRole('button', { name: 'Card: Water the plants' })).toBeVisible();

  // ---- Calendar
  await addView(ada, 'Calendar');
  const today = new Date();
  const other = getDay(today) === 0 ? addDays(today, -1) : addDays(today, 1);
  const cell = (d: Date) => ada.getByRole('gridcell', { name: format(d, 'EEEE d MMMM') });
  await cell(today).hover();
  await ada.getByRole('button', { name: `Add item on ${format(today, 'd MMMM')}` }).click();
  await ada.getByLabel(`New item on ${format(today, 'd MMMM')}`).fill('Book the plumber');
  await ada.keyboard.press('Enter');
  const chip = cell(today).getByRole('button', { name: 'Event: Book the plumber' });
  await expect(chip).toBeVisible();
  await drag(ada, chip, cell(other));
  await expect(cell(other).getByRole('button', { name: 'Event: Book the plumber' })).toBeVisible();

  // ---- Rename and delete a view
  await ada.getByRole('button', { name: 'Options for Calendar' }).click();
  await ada.getByRole('button', { name: 'Rename view' }).click();
  await ada.getByLabel('View name').fill('Plans');
  await ada.getByRole('button', { name: 'Save' }).click();
  await expect(ada.getByRole('tab', { name: 'Plans' })).toBeVisible();

  // ---- Everything persisted for real (not just optimistic)
  await ada.reload();
  await expect(ada.getByRole('tab', { name: 'Plans', selected: true })).toBeVisible();
  await expect(cell(other).getByRole('button', { name: 'Event: Book the plumber' })).toBeVisible();
  await ada.getByRole('tab', { name: 'Kanban' }).click();
  await expect(
    ada.getByRole('region', { name: 'Lane Done' }).getByRole('button', { name: label }),
  ).toBeVisible();

  await ada.getByRole('button', { name: 'Options for Kanban' }).click();
  await ada.getByRole('button', { name: 'Delete view' }).click();
  await ada.getByRole('button', { name: 'Delete view' }).last().click();
  await expect(ada.getByRole('tab', { name: 'Kanban' })).toHaveCount(0);
  expect(permissionErrors(ada)).toEqual([]);
});
