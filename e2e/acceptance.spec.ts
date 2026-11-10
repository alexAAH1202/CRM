import { expect, test } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

test('assignments wait for acceptance: accept from the inbox, decline from the item', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Acc ${run}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('link', { name: 'Members' }).click();
  const bobEmail = `bobacc-${run}@example.com`;
  await ada.getByLabel('Email').fill(bobEmail);
  await ada.getByLabel('Role', { exact: true }).selectOption('member');
  await ada.getByRole('button', { name: 'Send invite' }).click();
  await expect(ada.getByText(bobEmail, { exact: true })).toBeVisible();
  const bob = await signedInPage(browser, bobEmail, 'Bob Builder');
  await bob.getByRole('button', { name: 'Join household' }).click();
  await expect(bob.getByRole('heading', { name: `Acc ${run}` })).toBeVisible();

  await ada.getByRole('link', { name: 'Home' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();

  const assign = async (item: string) => {
    await ada.getByRole('button', { name: `Edit Who for ${item}` }).click();
    await ada
      .getByRole('dialog', { name: new RegExp(`Who for ${item}`) })
      .getByRole('button', { name: /Bob Builder/ })
      .click();
    await ada.keyboard.press('Escape');
  };

  // ---- Accept from the notification
  await assign('Dishes');
  await bob.getByRole('button', { name: 'Notifications, 1 unread' }).click();
  await expect(bob.getByText('Ada Lovelace assigned you to Dishes')).toBeVisible();
  await bob.getByRole('button', { name: 'Accept Dishes' }).click();
  await expect(bob.getByRole('button', { name: 'Accept Dishes' })).toHaveCount(0);
  await bob.keyboard.press('Escape');
  await expect(ada.getByRole('button', { name: /^Notifications, 1 unread/ })).toBeVisible();
  await ada.getByRole('button', { name: 'Open Dishes' }).click({ force: true });
  const panel = ada.getByRole('dialog');
  await expect(panel.getByRole('region', { name: 'Acceptance' })).toContainText(
    'Bob Builder: accepted',
  );
  await ada.keyboard.press('Escape');

  // ---- Decline from the item panel
  await assign('Feed the pets');
  await bob.getByRole('button', { name: /^Notifications, 1 unread/ }).click();
  await bob.getByText('Ada Lovelace assigned you to Feed the pets').click();
  const bobPanel = bob.getByRole('dialog');
  await expect(bobPanel.getByText('Waiting for your acceptance.')).toBeVisible();
  await bobPanel.getByRole('button', { name: 'Reject' }).click();
  await expect(bobPanel.getByRole('region', { name: 'Acceptance' })).toContainText(
    'Bob Builder: declined',
  );
  await ada.getByRole('button', { name: /^Notifications/ }).click();
  await expect(ada.getByText('Bob Builder declined “Feed the pets”')).toBeVisible();

  expect(permissionErrors(ada)).toEqual([]);
  expect(permissionErrors(bob)).toEqual([]);
});
