import { expect, test, type Page } from '@playwright/test';
import { signedInPage } from './helpers';

/**
 * The Phase 9 quota audit: measures what one person's day costs the database (reads and writes the
 * app itself makes, through the usage meter), scales it to the 15-person household in
 * docs/QUOTA_BUDGET.md, adds the helper's background work and the other people's live updates, and
 * fails if a normal day would use 60% or more of Firebase's free daily limits.
 *
 * What the meter can't see (rule lookups, the helper's own reads) is added from the documented model.
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
const costs: Record<string, { reads: number; writes: number }> = {};
async function measure(p: Page, name: string, fn: () => Promise<void>, per = 1) {
  await reset(p);
  await fn();
  await p.waitForTimeout(1500);
  const s = await snap(p);
  // "Which households am I in" (and their names) is read at start-up. The shared test user is in
  // every test's household, so count it as a real person's: one household, 2 reads each.
  let reads = s.reads;
  for (const label of ['members:mine', 'workspace:name']) {
    const r = s.byLabel[label]?.reads ?? 0;
    if (r > 0) reads += Math.min(r, 2) - r;
  }
  costs[name] = { reads: reads / per, writes: s.writes / per };
  s.reads = reads;
  console.log(
    `AUDIT ${name}: reads=${(s.reads / per).toFixed(1)} writes=${(s.writes / per).toFixed(1)}${per > 1 ? ` (per action, over ${per})` : ''}`,
  );
}

test('a 15-person household stays well inside the free limits', async ({ browser }) => {
  test.setTimeout(300_000);
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Audit ${run}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('link', { name: 'Members' }).click();
  const bobEmail = `bobaudit-${run}@example.com`;
  await ada.getByLabel('Email').fill(bobEmail);
  await ada.getByLabel('Role', { exact: true }).selectOption('member');
  await ada.getByRole('button', { name: 'Send invite' }).click();
  await expect(ada.getByText(bobEmail, { exact: true })).toBeVisible();
  const bob = await signedInPage(browser, bobEmail, 'Bob Builder');
  await bob.getByRole('button', { name: 'Join household' }).click();
  await expect(bob.getByRole('heading', { name: `Audit ${run}` })).toBeVisible();

  // ---- the household from the budget: 10 lists, one of them a busy 150 items
  await ada.getByRole('link', { name: 'Home' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Bills & subscriptions/ }).click();
  await ada.getByLabel('List name').fill('Main');
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();
  const rows = ['Name', ...Array.from({ length: 143 }, (_, i) => `Item ${i + 1}`)].join('\n');
  await ada.getByRole('button', { name: 'Import CSV' }).click();
  const imp = ada.getByRole('dialog', { name: 'Import from CSV' });
  await imp.getByLabel('Choose a CSV file').setInputFiles({
    name: 'items.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(rows),
  });
  await imp.getByRole('button', { name: /^Import 143 items/ }).click();
  await expect(ada.getByText('Imported 143 items.')).toBeVisible();
  const mainUrl = ada.url();
  for (let i = 1; i <= 9; i++) {
    await ada.getByRole('button', { name: 'New list or folder' }).click();
    await ada.getByRole('button', { name: 'New list', exact: true }).click();
    await ada.getByLabel('List name').fill(`Side ${i}`);
    await ada.getByRole('button', { name: 'Create list' }).click();
    await expect(ada.getByRole('heading', { name: `Side ${i}`, level: 1 })).toBeVisible();
  }
  const sideUrl = ada.url();

  // a dashboard over the busy list (5 widgets)
  await ada.goto(mainUrl.replace(/\/b\/.*/, '/dashboards'));
  await ada.getByRole('button', { name: 'New dashboard' }).first().click();
  const nd = ada.getByRole('dialog', { name: 'New dashboard' });
  await nd.getByLabel('Dashboard name').fill('Overview');
  await nd.getByRole('checkbox', { name: 'Main' }).check();
  await nd.getByRole('button', { name: 'Create dashboard' }).click();
  await ada.getByRole('button', { name: 'Edit', exact: true }).click();
  for (const t of [/^Number/, /^Progress/, /^Overdue/, /^Tasks by person/, /^Chart/]) {
    await ada.getByRole('button', { name: 'Add widget' }).click();
    await ada.getByRole('dialog', { name: 'Add widget' }).getByRole('button', { name: t }).click();
    const d = ada.getByRole('dialog', { name: /settings$/ });
    if (t.source.includes('Chart'))
      await d.getByLabel('Group by').selectOption({ label: 'Status' });
    await d.getByRole('button', { name: 'Save' }).click();
  }
  await ada.getByRole('button', { name: 'Done', exact: true }).click();
  await ada.waitForTimeout(1500);
  const dashUrl = ada.url();

  // ---- measure one person's flows (Ada has a warm cache; Bob is brand new)
  await measure(bob, 'cold open of the 150-item list (a new device)', async () => {
    await bob.goto(mainUrl);
    await expect(bob.getByRole('grid')).toBeVisible();
  });
  await bob.getByRole('button', { name: 'Open navigation' }).count(); // (desktop layout: no-op)

  await ada.goto(mainUrl);
  await expect(ada.getByRole('grid')).toBeVisible();
  await measure(ada, 'app start, warm cache (reload)', async () => {
    await ada.reload();
    await expect(ada.getByRole('grid')).toBeVisible();
  });
  await measure(
    ada,
    'open a list (warm: away and back)',
    async () => {
      await ada.goto(sideUrl);
      await expect(ada.getByRole('heading', { name: 'Side 9', level: 1 })).toBeVisible();
      await ada.goto(mainUrl);
      await expect(ada.getByRole('grid')).toBeVisible();
    },
    2,
  );

  const names = Array.from({ length: 10 }, (_, i) => `Item ${i + 1}`);
  await measure(
    ada,
    'one status edit',
    async () => {
      for (const n of names) {
        await ada
          .getByRole('button', { name: new RegExp(`Status: .*Change for ${n}$`) })
          .first()
          .click();
        await ada.getByRole('dialog').getByRole('button').nth(1).click();
        await ada.keyboard.press('Escape');
      }
    },
    names.length,
  );

  await measure(ada, 'open an item panel', async () => {
    await ada.getByRole('button', { name: 'Open Item 20' }).click({ force: true });
    await expect(ada.getByRole('dialog')).toBeVisible();
    await ada.keyboard.press('Escape');
  });
  await measure(ada, 'open an item panel and post a comment', async () => {
    await ada.getByRole('button', { name: 'Open Item 21' }).click({ force: true });
    await ada.getByRole('combobox', { name: 'Write an update' }).fill('on it');
    await ada.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(ada.getByRole('article', { name: /Update by Ada/ })).toBeVisible();
    await ada.keyboard.press('Escape');
  });

  await measure(
    bob,
    'a teammate’s edit arriving (per edit, listener open)',
    async () => {
      for (const n of ['Item 30', 'Item 31', 'Item 32']) {
        await ada
          .getByRole('button', { name: new RegExp(`Status: .*Change for ${n}$`) })
          .first()
          .click();
        await ada.getByRole('dialog').getByRole('button').nth(2).click();
        await ada.keyboard.press('Escape');
      }
      await bob.waitForTimeout(1200);
    },
    3,
  );

  await measure(ada, 'dashboard load (5 widgets, warm reload)', async () => {
    await ada.goto(dashUrl);
    await expect(ada.locator('.react-grid-item h2')).toHaveCount(5);
    await ada.reload();
    await expect(ada.locator('.react-grid-item h2')).toHaveCount(5);
    await ada.waitForTimeout(1500);
  });
  await measure(ada, 'My work', async () => {
    await ada.getByRole('link', { name: 'My work' }).click();
    await expect(ada.getByRole('heading', { name: 'My work' })).toBeVisible();
  });
  await measure(ada, 'timesheet', async () => {
    await ada.getByRole('link', { name: 'Timesheet' }).click();
    await expect(ada.getByRole('heading', { name: 'Timesheet', level: 1 })).toBeVisible();
  });
  await measure(ada, 'search', async () => {
    await ada.keyboard.press('Control+k');
    await ada.getByRole('combobox', { name: /Search lists and items/ }).fill('Item 9');
    await ada.waitForTimeout(800);
    await ada.keyboard.press('Escape');
  });

  // ---- project a day for 15 people (the assumptions in docs/QUOTA_BUDGET.md section 4)
  const c = costs as Record<string, { reads: number; writes: number }>;
  const g = (k: string) => c[k] as { reads: number; writes: number };
  const U = 15;
  const perPerson = {
    reads:
      4 * g('app start, warm cache (reload)').reads +
      10 * g('open a list (warm: away and back)').reads +
      40 * g('one status edit').reads +
      10 * g('open an item panel and post a comment').reads +
      10 * g('open an item panel').reads +
      3 * g('dashboard load (5 widgets, warm reload)').reads +
      3 * g('My work').reads +
      1 * g('timesheet').reads +
      3 * g('search').reads,
    writes:
      40 * g('one status edit').writes + 10 * g('open an item panel and post a comment').writes,
  };
  const edits = U * 40; // every status edit is seen by about two other open boards
  const others = edits * 2 * (g('a teammate’s edit arriving (per edit, listener open)').reads + 1); // +1 rule lookup
  const newDevices = ((U * 2) / 30) * g('cold open of the 150-item list (a new device)').reads;
  // The helper (estimated from its design; it uses admin access so rules add nothing):
  const helperReads =
    300 /* scheduler */ + 250 /* weekly backup, averaged */ + 300 /* digests */ + 60;
  const helperWrites = 150; /* scheduled events */
  const helperDeletes = 1000; /* nightly clean-up, upper bound */
  const appReads = U * perPerson.reads + others + newDevices;
  const reads = Math.round(appReads + helperReads);
  const writes = Math.round(U * perPerson.writes + helperWrites);
  const peak = Math.round(appReads * 1.5 + helperReads + 1700 /* the weekly backup day */);
  const pct = (n: number, limit: number) => `${((n / limit) * 100).toFixed(0)}%`;
  console.log(
    `AUDIT RESULT reads/day=${reads} (${pct(reads, 50_000)} of 50,000), peak day=${peak} (${pct(peak, 50_000)}), ` +
      `writes/day=${writes} (${pct(writes, 20_000)} of 20,000), deletes/day<=${helperDeletes} (${pct(helperDeletes, 20_000)}), ` +
      `per person: ${Math.round(perPerson.reads)} reads, ${Math.round(perPerson.writes)} writes`,
  );
  console.log(
    `AUDIT BREAKDOWN own=${Math.round(U * perPerson.reads)} others=${Math.round(others)} newDevices=${Math.round(newDevices)} helper=${helperReads}`,
  );

  expect(reads, 'reads on a normal day').toBeLessThan(0.6 * 50_000);
  expect(peak, 'reads on a busy day (1.5× plus the backup)').toBeLessThan(50_000);
  expect(writes, 'writes on a normal day').toBeLessThan(0.6 * 20_000);
  expect(helperDeletes).toBeLessThan(0.6 * 20_000);
});
