import { expect, test } from '@playwright/test';
import { signedInPage } from './helpers';

test('the Item column can be resized by dragging its edge and from the Columns menu', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Width ${Date.now().toString(36)}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();

  const handle = ada.getByRole('separator', { name: 'Resize Item column' }).first();
  const header = handle.locator('..');
  const before = (await header.boundingBox())!.width;
  const box = (await handle.boundingBox())!;
  await ada.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ada.mouse.down();
  await ada.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 5 });
  await ada.mouse.up();
  await expect.poll(async () => (await header.boundingBox())!.width).toBeGreaterThan(before + 80);

  await ada.getByRole('button', { name: 'Columns' }).click();
  await ada.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(async () => (await header.boundingBox())!.width).toBeLessThan(before + 5);
});
