import { expect, test } from '@playwright/test';
import { signedInPage } from './helpers';

test('the timeline lists items earliest first, undated last', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Gantt ${Date.now().toString(36)}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Trip planner/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();
  await ada.getByRole('button', { name: 'Add view' }).click();
  await ada
    .getByRole('dialog', { name: 'Add view' })
    .getByRole('button', { name: 'Gantt' })
    .click();

  const order = () =>
    ada.evaluate(() => {
      const t = document.body.innerText;
      return [t.indexOf('Flights'), t.indexOf('Accommodation')];
    });
  // In the template Flights comes before Accommodation; neither has dates.
  let [f, a] = await order();
  expect(f).toBeLessThan(a);
  // Give only Accommodation dates: it moves up.
  await ada.getByRole('button', { name: 'Set dates for Accommodation' }).click();
  await expect(ada.getByRole('button', { name: /^Bar: Accommodation/ })).toBeVisible();
  await expect
    .poll(async () => {
      [f, a] = await order();
      return a < f;
    })
    .toBe(true);
});
