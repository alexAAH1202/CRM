import { expect, test } from '@playwright/test';
import { signedInPage } from './helpers';

const run = Date.now().toString(36);
const WORKSPACE = `E2E Team ${run}`;
const INVITEE = `bob-${run}@example.com`;

test('create household → invite → accept → change role → outsider blocked', async ({ browser }) => {
  // 1. Ada (on the dev creator allowlist) creates a workspace.
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(WORKSPACE);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await expect(ada.getByRole('heading', { name: WORKSPACE })).toBeVisible();
  const workspaceUrl = new URL(ada.url()).pathname;

  // 2. Ada invites Bob as a Member.
  await ada.getByRole('link', { name: 'Members' }).click();
  await ada.getByLabel('Email').fill(INVITEE);
  await ada.getByLabel('Role', { exact: true }).selectOption('member');
  await ada.getByRole('button', { name: 'Send invite' }).click();
  await expect(ada.getByText('Pending invitations')).toBeVisible();
  await expect(ada.getByText(INVITEE, { exact: true })).toBeVisible();

  // 3. Bob signs in, sees the invite and joins.
  const bob = await signedInPage(browser, INVITEE, 'Bob Builder');
  await expect(bob).toHaveURL(/\/invites$/);
  await expect(bob.getByText(WORKSPACE, { exact: true })).toBeVisible();
  await bob.getByRole('button', { name: 'Join household' }).click();
  await expect(bob.getByRole('heading', { name: WORKSPACE })).toBeVisible();
  await bob.getByRole('link', { name: 'Members' }).click();
  await expect(bob.getByText('Ada Lovelace', { exact: true })).toBeVisible();
  await expect(bob.getByRole('heading', { name: 'Invite people' })).toHaveCount(0); // members can't invite

  // The invite is consumed and Bob appears for Ada (live listener).
  await expect(ada.getByText('Pending invitations')).toHaveCount(0);
  await expect(ada.getByText('Bob Builder', { exact: true })).toBeVisible();

  // 4. Ada demotes Bob to Viewer; Bob's UI updates live. Ada can't demote herself (last admin).
  await ada.getByLabel('Role for Bob Builder').selectOption('viewer');
  await expect(bob.getByText('viewer', { exact: true }).first()).toBeVisible();
  await expect(ada.getByLabel('Role for Ada Lovelace')).toBeDisabled();

  // 5. An outsider can't open the workspace and sees the "ask for an invite" screen.
  const zed = await signedInPage(browser, `zed-${run}@example.com`, 'Zed');
  await expect(zed.getByRole('heading', { name: "You're not in a household yet" })).toBeVisible();
  await zed.goto(workspaceUrl);
  await expect(
    zed.getByRole('heading', { name: "You don't have access to this household" }),
  ).toBeVisible();
});
