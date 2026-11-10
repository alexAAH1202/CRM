import { expect, test } from '@playwright/test';
import { signedInPage } from './helpers';

test('database usage pop-up: today’s reads from this device, against the free limits', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Usage ${Date.now().toString(36)}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();
  await ada.waitForTimeout(1500);

  await ada.getByRole('button', { name: /^Database usage/ }).click();
  const pop = ada.getByRole('dialog', { name: 'Database usage' });
  await expect(pop).toContainText('Today, from this device');
  await expect(pop.getByText(/ \/ 50,000$/)).toBeVisible();
  const reads = Number(
    (await pop.getByRole('progressbar', { name: 'Reads today' }).getAttribute('aria-valuenow')) ??
      -1,
  );
  expect(reads).toBeGreaterThanOrEqual(0);
  expect(await pop.getByText(/^\d[\d,]* \/ 50,000$/).textContent()).not.toMatch(/^0 /); // something was counted
  await expect(pop.getByRole('link', { name: /Firebase console/ })).toHaveAttribute(
    'href',
    /console\.firebase\.google\.com\/project\/life-management-de315/,
  );

  // it's kept on this device for the day and keeps counting after a reload
  const stored = () =>
    ada.evaluate(() => {
      const log = JSON.parse(localStorage.getItem('usage:days') ?? '{}') as Record<
        string,
        { reads: number }
      >;
      return Object.values(log).reduce((n, d) => n + d.reads, 0);
    });
  const before = await stored();
  expect(before).toBeGreaterThan(0);
  await ada.keyboard.press('Escape');
  await ada.reload();
  await expect(ada.getByRole('grid')).toBeVisible();
  await expect.poll(stored, { timeout: 10_000 }).toBeGreaterThan(before);
});
