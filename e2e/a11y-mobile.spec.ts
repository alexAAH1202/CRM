import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page } from '@playwright/test';
import { signedInPage } from './helpers';

const run = Date.now().toString(36);

async function chores(p: Page, label: string) {
  await p.goto('/new');
  await p
    .getByLabel('Household name')
    .fill(`${label} ${run} ${Math.random().toString(36).slice(2, 5)}`);
  await p.getByRole('button', { name: 'Create household' }).click();
  await p.getByRole('button', { name: 'Choose a template' }).click();
  await p.getByRole('radio', { name: /Household chores/ }).click();
  await p.getByRole('button', { name: 'Create list' }).click();
  await expect(p.getByRole('grid')).toBeVisible();
}

async function addView(p: Page, kind: string, tab: string) {
  await p.getByRole('button', { name: 'Add view' }).click();
  await p.getByRole('dialog', { name: 'Add view' }).getByRole('button', { name: kind }).click();
  await expect(p.getByRole('tab', { name: tab, selected: true })).toBeVisible();
}

/** Serious/critical WCAG A/AA problems on the current screen (printed, then asserted empty). */
async function scan(p: Page, name: string) {
  await p.waitForTimeout(400);
  const r = await new AxeBuilder({ page: p })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of bad)
    console.log(
      `A11Y ${name}: ${v.id} (${v.impact}) x${v.nodes.length} - ${v.help} :: ${v.nodes
        .slice(0, 2)
        .map((n) => (n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 500))
        .join(' || ')}`,
    );
  return bad.map((v) => `${name}: ${v.id}`);
}

test('accessibility: no serious or critical WCAG A/AA violations on the main screens', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  const found: string[] = [];
  await chores(ada, 'A11y');
  found.push(...(await scan(ada, 'table')));

  await ada.getByRole('button', { name: 'Open Dishes' }).click({ force: true });
  found.push(...(await scan(ada, 'item panel')));
  await ada.keyboard.press('Escape');

  await ada.getByRole('button', { name: 'Automations' }).click();
  found.push(...(await scan(ada, 'automations list')));
  await ada.getByRole('button', { name: 'Add automation' }).click();
  await ada.getByRole('button', { name: 'Start from scratch' }).click();
  found.push(...(await scan(ada, 'automation builder')));
  await ada.keyboard.press('Escape');

  await ada
    .getByRole('button', { name: /^Notifications/ })
    .first()
    .click();
  found.push(...(await scan(ada, 'notifications')));
  await ada.keyboard.press('Escape');

  await ada.keyboard.press('Control+k');
  found.push(...(await scan(ada, 'search')));
  await ada.keyboard.press('Escape');

  await ada.getByRole('heading', { level: 1 }).first().click();
  await ada.keyboard.press('?');
  await expect(ada.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('Undo');
  found.push(...(await scan(ada, 'shortcuts')));
  await ada.keyboard.press('Escape');

  for (const [kind, tab] of [
    ['Kanban', 'Kanban'],
    ['Calendar', 'Calendar'],
    ['Gantt', 'Timeline'],
    ['Workload', 'Workload'],
    ['Chart', 'Chart'],
  ] as const) {
    await addView(ada, kind, tab);
    found.push(...(await scan(ada, kind)));
  }
  await ada.getByRole('link', { name: 'My work' }).click();
  found.push(...(await scan(ada, 'my work')));
  await ada.getByRole('link', { name: 'Members' }).click();
  found.push(...(await scan(ada, 'members')));
  await ada.getByRole('link', { name: 'Timesheet' }).click();
  found.push(...(await scan(ada, 'timesheet')));
  await ada.getByRole('link', { name: 'Dashboards' }).click();
  found.push(...(await scan(ada, 'dashboards')));
  await ada.getByRole('button', { name: 'New dashboard' }).first().click();
  found.push(...(await scan(ada, 'new dashboard dialog')));
  await ada.getByLabel('Dashboard name').fill('A11y');
  await ada.getByRole('checkbox').first().check();
  await ada.getByRole('button', { name: 'Create dashboard' }).click();
  await ada.getByRole('button', { name: 'Edit', exact: true }).click();
  await ada.getByRole('button', { name: 'Add widget' }).click();
  found.push(...(await scan(ada, 'add widget')));
  await ada
    .getByRole('dialog', { name: 'Add widget' })
    .getByRole('button', { name: /^Progress/ })
    .click();
  await ada
    .getByRole('dialog', { name: /settings$/ })
    .getByRole('button', { name: 'Save' })
    .click();
  found.push(...(await scan(ada, 'dashboard')));
  // dark mode too
  await ada.getByRole('radio', { name: /dark/i }).click();
  found.push(...(await scan(ada, 'dashboard (dark)')));
  await ada.getByRole('link', { name: 'Timesheet' }).click();
  found.push(...(await scan(ada, 'timesheet (dark)')));
  expect([...new Set(found)]).toEqual([]);
});

test.describe('phone-sized screens', () => {
  const phone = { ...devices['Pixel 5'] };

  const noSideScroll = async (p: Page, name: string) => {
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `${name}: page scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
  };
  const within = async (p: Page, loc: ReturnType<Page['getByRole']>, name: string) => {
    const box = (await loc.boundingBox())!;
    const vw = p.viewportSize()!.width;
    expect(box.x, `${name} starts off-screen`).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `${name} runs off-screen`).toBeLessThanOrEqual(vw + 1);
  };

  test('the app is usable at 393px wide', async ({ browser }) => {
    test.setTimeout(120_000);
    const p = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace', phone);
    await chores(p, 'Phone');
    await noSideScroll(p, 'list table');

    // The navigation lives in a drawer on phones.
    await p.getByRole('button', { name: 'Open navigation' }).click();
    const nav = p.getByRole('dialog', { name: 'Navigation' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'My work' })).toBeVisible();
    await within(p, nav, 'navigation drawer');
    // (the backdrop's centre is behind the drawer: press its visible right-hand edge)
    await p
      .getByRole('button', { name: 'Close navigation' })
      .click({ position: { x: 385, y: 400 }, force: true });

    // Item panel fits the screen and is usable.
    // (on a phone the item's name itself opens it)
    await p.getByRole('button', { name: 'Rename Dishes' }).tap();
    const panel = p.getByRole('dialog').first();
    await within(p, panel, 'item panel');
    await noSideScroll(p, 'item panel open');
    await p.getByRole('combobox', { name: 'Write an update' }).fill('from my phone');
    await p.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(p.getByRole('article', { name: /Update by Ada/ })).toContainText('from my phone');
    await p.keyboard.press('Escape');

    // Other views don't break the page layout.
    for (const [kind, tab] of [
      ['Kanban', 'Kanban'],
      ['Calendar', 'Calendar'],
      ['Gantt', 'Timeline'],
      ['Workload', 'Workload'],
      ['Chart', 'Chart'],
    ] as const) {
      await addView(p, kind, tab);
      await noSideScroll(p, kind);
    }

    // Panels and popovers fit.
    await p.getByRole('button', { name: 'Automations' }).click();
    await within(p, p.getByRole('dialog', { name: 'Automations' }), 'automations panel');
    await p.keyboard.press('Escape');
    await p
      .getByRole('button', { name: /^Notifications/ })
      .first()
      .click();
    await within(p, p.getByRole('dialog', { name: 'Notifications' }), 'notifications popover');
    await p.keyboard.press('Escape');
    await noSideScroll(p, 'after panels');

    // Offline banner shows when the connection drops.
    await p.context().setOffline(true);
    await expect(p.getByRole('status').filter({ hasText: /You’re offline/ })).toBeVisible();
    await p.context().setOffline(false);
    await expect(p.getByRole('status').filter({ hasText: /You’re offline/ })).toHaveCount(0);
  });
});

test('CSV export downloads the list with readable values and safe cells', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await chores(ada, 'Csv');
  // a hostile-looking name must come out neutralised
  await ada.getByLabel('Add item to Daily').fill('=HYPERLINK("http://evil","x")');
  await ada.keyboard.press('Enter');
  await expect(ada.getByRole('button', { name: /^Rename =HYPERLINK/ })).toBeVisible();
  const [download] = await Promise.all([
    ada.waitForEvent('download'),
    ada.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const path = await download.path();
  const text = (await import('node:fs')).readFileSync(path!, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.trim().split('\r\n');
  expect(lines[0]).toMatch(/^Item,Group,Parent,/);
  expect(text).toContain('Dishes,Daily');
  expect(text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
  expect(lines.some((l) => l.startsWith('=HYPERLINK'))).toBe(false);
});
