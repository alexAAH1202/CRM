import { expect, test } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

test('updates with @mentions and replies, notifications inbox, assignments, muting', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`P5 ${run}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('link', { name: 'Members' }).click();
  const bobEmail = `bob5-${run}@example.com`;
  await ada.getByLabel('Email').fill(bobEmail);
  await ada.getByLabel('Role', { exact: true }).selectOption('member');
  await ada.getByRole('button', { name: 'Send invite' }).click();
  await expect(ada.getByText(bobEmail, { exact: true })).toBeVisible();

  const bob = await signedInPage(browser, bobEmail, 'Bob Builder');
  await bob.getByRole('button', { name: 'Join household' }).click();
  await expect(bob.getByRole('heading', { name: `P5 ${run}` })).toBeVisible();

  // Ada makes a chores board and opens "Dishes".
  await ada.getByRole('link', { name: 'Home' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();
  await ada.getByRole('button', { name: 'Open Dishes' }).click({ force: true });
  const panel = ada.getByRole('dialog');
  await expect(panel.getByRole('tab', { name: 'Updates', selected: true })).toBeVisible();

  // ---- An update with formatting and a mention (picked from the @ list)
  const box = panel.getByRole('combobox', { name: 'Write an update' });
  await box.fill('Please check **this** @Bo');
  await panel.getByRole('option', { name: 'Bob Builder' }).click();
  await expect(box).toHaveValue('Please check **this** @Bob Builder ');
  await panel.getByRole('button', { name: 'Update', exact: true }).click();
  const posted = panel.getByRole('article', { name: 'Update by Ada Lovelace' });
  await expect(posted.locator('strong', { hasText: 'this' })).toBeVisible();
  await expect(posted.getByText('@Bob Builder')).toBeVisible();

  // Dangerous input is shown as text, never as a link or element.
  await box.fill('<img src=x onerror=alert(1)> [click](javascript:alert(1))');
  await panel.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(panel.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  await expect(panel.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(panel.locator('img')).toHaveCount(0);

  // ---- Bob's bell lights up live; clicking it opens the item with the update
  await expect(bob.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
  await bob.getByRole('button', { name: /^Notifications/ }).click();
  await expect(bob.getByText('Ada Lovelace mentioned you')).toBeVisible();
  await bob.getByText('Ada Lovelace mentioned you').click();
  const bobPanel = bob.getByRole('dialog');
  await expect(bobPanel.getByText('Please check')).toBeVisible();
  await expect(bob.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible(); // read now

  // ---- Bob replies; Ada sees it live
  await bobPanel
    .getByRole('article', { name: 'Update by Ada Lovelace' })
    .filter({ hasText: 'Please check' })
    .getByRole('button', { name: 'Reply' })
    .click();
  await bobPanel.getByRole('combobox', { name: /Reply to Ada Lovelace/ }).fill('On it');
  await bobPanel.getByRole('button', { name: 'Reply', exact: true }).last().click();
  await expect(panel.getByRole('article', { name: 'Update by Bob Builder' })).toContainText(
    'On it',
  );

  // Bob edits his reply, then Ada (admin) deletes it.
  await bobPanel
    .getByRole('article', { name: 'Update by Bob Builder' })
    .getByRole('button', { name: 'Edit update' })
    .click();
  await bobPanel.getByRole('combobox', { name: 'Edit update' }).fill('On it, thanks');
  await bobPanel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByRole('article', { name: 'Update by Bob Builder' })).toContainText(
    'edited',
  );
  await panel
    .getByRole('article', { name: 'Update by Bob Builder' })
    .getByRole('button', { name: 'Delete update' })
    .click();
  await ada.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(bobPanel.getByRole('article', { name: 'Update by Bob Builder' })).toHaveCount(0);

  // ---- Assigning Bob notifies him; muting assignments hides it
  await ada.keyboard.press('Escape');
  await ada.getByRole('button', { name: 'Edit Who for Dishes' }).click();
  await ada
    .getByRole('dialog', { name: /Who for Dishes/ })
    .getByRole('button', { name: /Bob Builder/ })
    .click();
  await ada.keyboard.press('Escape');
  await expect(bob.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
  await bob.keyboard.press('Escape');
  await bob.getByRole('button', { name: /^Notifications/ }).click();
  await expect(bob.getByText('Ada Lovelace assigned you to Dishes')).toBeVisible();
  await bob.getByRole('button', { name: 'Notification settings' }).click();
  await bob.getByLabel('When I’m assigned to an item').click(); // saved, so it updates a moment later
  await expect(bob.getByLabel('When I’m assigned to an item')).not.toBeChecked();
  await expect(bob.getByText('Ada Lovelace assigned you to Dishes')).toHaveCount(0);
  await bob.waitForTimeout(800);
  await bob.reload();
  await bob.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(bob.getByText('Ada Lovelace assigned you to Dishes')).toHaveCount(0);
  await bob.getByRole('button', { name: 'Notification settings' }).click();
  await expect(bob.getByLabel('When I’m assigned to an item')).not.toBeChecked();

  expect(permissionErrors(ada)).toEqual([]);
  expect(permissionErrors(bob)).toEqual([]);
});
