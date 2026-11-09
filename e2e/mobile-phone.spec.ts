import { expect, test, type Page } from '@playwright/test';
import { signedInPage } from './helpers';

const run = Date.now().toString(36);
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

/** The page itself must never scroll sideways (tables and the like scroll inside their own box). */
const noSidewaysPage = (p: Page) =>
  p.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

test('phone: the list screens fit, names have room, and tapping a name opens the item', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace', PHONE);
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Phone ${run}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  expect(await noSidewaysPage(ada)).toBe(true);
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();

  // the title has the whole row to itself (not squeezed beside six buttons)
  const title = ada.getByRole('heading', { name: 'Household chores', level: 1 });
  const box = (await title.boundingBox())!;
  expect(box.width).toBeGreaterThan(250);
  expect(await noSidewaysPage(ada)).toBe(true);

  // names are readable in full, not cut to "Elec…" (long chores included)
  await expect(ada.getByRole('button', { name: 'Rename Clean out the fridge' })).toBeVisible();
  const nameBox = (await ada
    .getByRole('button', { name: 'Rename Clean out the fridge' })
    .boundingBox())!;
  expect(nameBox.width).toBeGreaterThan(150);
  // the clutter that needs a mouse is gone
  await expect(
    ada.getByRole('button', { name: /^Drag to reorder (?!group)/ }).first(),
  ).toBeHidden();
  await expect(ada.getByRole('button', { name: 'Open Dishes' }).first()).toBeHidden();

  // a tap opens the item panel; renaming lives inside it
  await ada.getByRole('button', { name: 'Rename Clean out the fridge' }).tap();
  const panel = ada.getByRole('dialog');
  await expect(panel.getByRole('tab', { name: 'Updates', selected: true })).toBeVisible();
  await panel.getByRole('tab', { name: 'Fields' }).tap();
  await expect(panel.getByLabel('Name')).toHaveValue('Clean out the fridge');
  await ada.keyboard.press('Escape');

  // the row's ⋯ menu is reachable without hovering
  await ada.getByRole('button', { name: 'Options for Dishes' }).tap();
  await expect(ada.getByRole('button', { name: 'Add subitem' })).toBeVisible();
  await ada.keyboard.press('Escape');

  // every view stays inside the screen
  for (const kind of ['Kanban', 'Calendar'] as const) {
    await ada.getByRole('button', { name: 'Add view' }).tap();
    await ada.getByRole('dialog', { name: 'Add view' }).getByRole('button', { name: kind }).tap();
    await expect(ada.getByRole('tab', { name: kind, selected: true })).toBeVisible();
    await ada.waitForTimeout(400);
    expect(await noSidewaysPage(ada)).toBe(true);
  }
  // the whole calendar month is on screen at once
  const cell = ada.getByRole('gridcell').last();
  const c = (await cell.boundingBox())!;
  expect(c.x + c.width).toBeLessThanOrEqual(390);

  // other pages
  await ada.getByRole('button', { name: 'Open navigation' }).tap();
  await ada.getByRole('link', { name: 'Members' }).tap();
  await expect(ada.getByRole('heading', { name: 'Members' })).toBeVisible();
  expect(await noSidewaysPage(ada)).toBe(true);
});
