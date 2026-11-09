import { expect, test, type Page } from '@playwright/test';
import { signedInPage } from './helpers';

/**
 * Measures what the app itself bills (reads/writes the client can observe; see the meter's
 * notes in docs/QUOTA_BUDGET.md) for typical sessions, and fails if a flow gets much dearer.
 * Numbers are printed so docs/QUOTA_BUDGET.md can quote them.
 */
const run = Date.now().toString(36);

interface Snap {
  reads: number;
  writes: number;
  deletes: number;
  byLabel: Record<string, { reads: number; writes: number }>;
}
const snap = (p: Page) => p.evaluate(() => window.__meter!.snapshot() as unknown as Snap);
const reset = (p: Page) => p.evaluate(() => window.__meter!.reset());
async function measure(p: Page, name: string, fn: () => Promise<void>): Promise<Snap> {
  await reset(p);
  await fn();
  await p.waitForTimeout(1500); // let listeners settle
  const s = await snap(p);
  const labels = Object.entries(s.byLabel)
    .filter(([, v]) => v.reads || v.writes)
    .map(([k, v]) => `${k}:${v.reads}r/${v.writes}w`)
    .join(' ');
  console.log(
    `QUOTA ${name}: reads=${s.reads} writes=${s.writes} deletes=${s.deletes} [${labels}]`,
  );
  return s;
}

test('typical flows stay within their read/write budgets', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Q ${run}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('link', { name: 'Members' }).click();
  const bobEmail = `bobq-${run}@example.com`;
  await ada.getByLabel('Email').fill(bobEmail);
  await ada.getByLabel('Role', { exact: true }).selectOption('member');
  await ada.getByRole('button', { name: 'Send invite' }).click();
  await expect(ada.getByText(bobEmail, { exact: true })).toBeVisible();
  const bob = await signedInPage(browser, bobEmail, 'Bob Builder');
  await bob.getByRole('button', { name: 'Join household' }).click();
  await expect(bob.getByRole('heading', { name: `Q ${run}` })).toBeVisible();

  // Create a board (13-ish docs: board, view, counter, items).
  await ada.getByRole('link', { name: 'Home' }).click();
  const create = await measure(ada, 'create list from template', async () => {
    await ada.getByRole('button', { name: 'Choose a template' }).click();
    await ada.getByRole('radio', { name: /Household chores/ }).click();
    await ada.getByRole('button', { name: 'Create list' }).click();
    await expect(ada.getByRole('grid')).toBeVisible();
  });
  expect(create.writes).toBeLessThanOrEqual(12);

  // Warm reopen of the same board (persistent cache): the point of delta sync.
  const boardUrl = ada.url();
  await ada.waitForTimeout(1500); // let the local cache reach disk before reloading
  const warm = await measure(ada, 'reload list (warm cache)', async () => {
    await ada.reload();
    await expect(ada.getByRole('grid')).toBeVisible();
  });
  // ~10 when run alone. Under CPU load the cache may not have flushed to disk before the
  // reload, so allow a full cold read of this small board; a regression that re-reads big boards
  // on every open would still blow well past this.
  // Opening the app also reads the list of workspaces the person belongs to (and each one's name),
  // and the shared test user belongs to more of them with every test run. That is not what this
  // asserts, so leave those two out and measure what the board itself costs.
  const perWorkspace =
    (warm.byLabel['members:mine']?.reads ?? 0) + (warm.byLabel['workspace:name']?.reads ?? 0);
  expect(warm.reads - perWorkspace).toBeLessThanOrEqual(80);

  // Bob opens it cold, then someone else's single edit costs ~1 read for him.
  const cold = await measure(bob, 'open list (cold cache)', async () => {
    await bob.goto(boardUrl);
    await expect(bob.getByRole('grid')).toBeVisible();
  });
  expect(cold.reads).toBeLessThanOrEqual(40);
  const delta = await measure(bob, 'a teammate edits one cell (bob sees it)', async () => {
    await ada.getByRole('button', { name: /Status: .*Change for Dishes/ }).click();
    await ada.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
    await ada.keyboard.press('Escape');
    await expect(bob.getByRole('button', { name: /Status: Done/ }).first()).toBeVisible();
  });
  expect(delta.reads).toBeLessThanOrEqual(3);

  const edits = await measure(ada, '5 cell edits', async () => {
    for (const item of [
      'Feed the pets',
      'Take out the bins',
      'Vacuum and mop',
      'Clean the bathroom',
      'Change bed sheets',
    ]) {
      await ada.getByRole('button', { name: new RegExp(`Status: .*Change for ${item}`) }).click();
      await ada
        .getByRole('dialog')
        .getByRole('button', { name: 'Working on it', exact: true })
        .or(ada.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }))
        .first()
        .click();
      await ada.keyboard.press('Escape');
    }
  });
  // one item write + one activity write per logged edit
  expect(edits.writes).toBeLessThanOrEqual(12);

  const panel = await measure(ada, 'open an item panel (updates + 1 comment)', async () => {
    await ada.getByRole('button', { name: 'Open Dishes' }).click({ force: true });
    await ada.getByRole('combobox', { name: 'Write an update' }).fill('hi @Bob');
    await ada.getByRole('option', { name: 'Bob Builder' }).click();
    await ada.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(ada.getByRole('article', { name: /Update by Ada/ })).toBeVisible();
  });
  expect(panel.writes).toBeLessThanOrEqual(3); // comment + mention notification
  expect(panel.reads).toBeLessThanOrEqual(10);
  await ada.keyboard.press('Escape');

  const mywork = await measure(ada, 'open My work (1 list)', async () => {
    await ada.getByRole('link', { name: 'My work' }).click();
    await expect(ada.getByRole('heading', { name: 'My work' })).toBeVisible();
  });
  expect(mywork.reads).toBeLessThanOrEqual(6);

  const home = await measure(ada, 'household home (warm)', async () => {
    await ada.getByRole('link', { name: 'Home' }).click();
    await expect(ada.getByRole('heading', { name: `Q ${run}` })).toBeVisible();
  });
  expect(home.reads).toBeLessThanOrEqual(10);
});
