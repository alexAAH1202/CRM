import { expect, test, type Page } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

async function setStatus(p: Page, item: string, label: string) {
  await p.getByRole('button', { name: new RegExp(`Status: .*Change for ${item}`) }).click();
  await p.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  await p.keyboard.press('Escape');
}

/** Adds a widget; its settings open straight away. Returns them. */
async function addWidget(p: Page, type: RegExp) {
  await p.getByRole('button', { name: 'Add widget' }).click();
  await p.getByRole('dialog', { name: 'Add widget' }).getByRole('button', { name: type }).click();
  const settings = p.getByRole('dialog', { name: /settings$/ });
  await expect(settings).toBeVisible();
  return settings;
}
const save = (d: ReturnType<Page['getByRole']>) => d.getByRole('button', { name: 'Save' }).click();

test('dashboards: numbers come from the server, widgets read the lists, layout persists', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Dash ${run}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();

  // some data: one item done, one overdue
  await setStatus(ada, 'Dishes', 'Done');
  await ada.getByRole('button', { name: 'Edit Next due for Vacuum and mop' }).click();
  await ada.keyboard.type('01012020');
  await ada.keyboard.press('Enter');
  await expect(ada.getByRole('row').filter({ hasText: 'Vacuum and mop' }).first()).toContainText(
    '2020',
  );
  await ada.waitForTimeout(500);

  // ---- make a dashboard on this list
  await ada.getByRole('link', { name: 'Dashboards' }).click();
  await expect(ada.getByText('No dashboards yet')).toBeVisible();
  await ada.getByRole('button', { name: 'New dashboard' }).first().click();
  const dlg = ada.getByRole('dialog', { name: 'New dashboard' });
  await dlg.getByLabel('Dashboard name').fill('Home overview');
  await dlg.getByRole('checkbox', { name: 'Household chores' }).check();
  await dlg.getByRole('button', { name: 'Create dashboard' }).click();
  await expect(ada.getByRole('heading', { name: 'Home overview', level: 1 })).toBeVisible();
  await expect(ada.getByText('Nothing here yet')).toBeVisible();

  // ---- widgets
  await ada.getByRole('button', { name: 'Edit', exact: true }).click();

  // a plain count of items
  await save(await addWidget(ada, /^Number/));
  await expect(ada.getByLabel('Number: 7')).toBeVisible();

  // a count of items whose status is Done: an aggregation with a filter
  const nd = await addWidget(ada, /^Number/);
  await nd.getByLabel('Title (optional)').fill('Done chores');
  await nd.getByLabel('Only items whose status…').selectOption({ label: 'Status is…' });
  await nd.getByLabel('Is', { exact: true }).selectOption({ label: 'Done' });
  await save(nd);
  await expect(ada.getByLabel('Done chores: 1')).toBeVisible();

  // progress
  await save(await addWidget(ada, /^Progress/));
  await expect(ada.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute(
    'aria-valuenow',
    '14',
  );
  await expect(ada.getByText('1 of 7 done')).toBeVisible();

  // overdue
  await save(await addWidget(ada, /^Overdue/));
  const overdue = ada.getByRole('list', { name: 'Overdue items' });
  await expect(overdue).toContainText('Vacuum and mop');
  await expect(overdue).not.toContainText('Dishes');
  await expect(overdue).toContainText(/\d+ days late/);

  // tasks by person
  await save(await addWidget(ada, /^Tasks by person/));
  await expect(ada.getByRole('list', { name: 'Open items by person' })).toContainText('Unassigned');

  // a chart grouped by status
  const cd = await addWidget(ada, /^Chart/);
  await cd.getByLabel('Group by').selectOption({ label: 'Status' });
  await save(cd);
  await expect(ada.getByRole('img', { name: /Chart: .*To do 6.*Done 1/ })).toBeVisible();

  // an items table
  const td = await addWidget(ada, /^Items/);
  await td.getByRole('checkbox', { name: 'Status' }).check();
  await save(td);
  await expect(ada.getByRole('link', { name: 'Vacuum and mop' }).first()).toBeVisible();
  await expect(ada.getByRole('link', { name: 'Dishes' })).toHaveCount(0); // done: hidden by default

  // time tracked, timeline and workload say what they need
  await save(await addWidget(ada, /^Time tracked/));
  await expect(ada.getByText(/No time logged this month/)).toBeVisible();
  await save(await addWidget(ada, /^Timeline/));
  await expect(ada.getByText(/Needs a list with a Timeline column/).first()).toBeVisible();

  // ---- finish, reload: everything is still there
  await ada.getByRole('button', { name: 'Done', exact: true }).click();
  await ada.waitForTimeout(1500);
  await ada.reload();
  await expect(ada.getByRole('heading', { name: 'Done chores', level: 2 })).toBeVisible();
  await expect(ada.getByLabel('Done chores: 1')).toBeVisible();
  await expect(ada.locator('.react-grid-item h2')).toHaveCount(9);

  // ---- it was cheap: the numbers asked the server to count, and nothing is a live listener
  const snap = await ada.evaluate(
    () =>
      window.__meter!.snapshot() as unknown as {
        reads: number;
        byLabel: Record<string, { reads: number }>;
      },
  );
  expect(snap.byLabel['dash:number']?.reads ?? 0).toBeLessThanOrEqual(2);
  expect(snap.byLabel['dash:items']?.reads ?? 0).toBeLessThanOrEqual(7); // the list is read once
  console.log(
    'QUOTA dashboard (9 widgets, 1 list): reads =',
    snap.reads,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(snap.byLabel)
          .filter(([k]) => k.startsWith('dash:'))
          .map(([k, v]) => [k, v.reads]),
      ),
    ),
  );

  // ---- the list shows on the Dashboards page; deleting works
  await ada.getByRole('link', { name: '← Dashboards' }).click();
  await expect(ada.getByRole('link', { name: /Home overview/ })).toContainText('9 widgets');
  await ada.getByRole('link', { name: /Home overview/ }).click();
  await ada.getByRole('button', { name: 'Edit', exact: true }).click();
  await ada.getByRole('button', { name: 'Dashboard settings' }).click();
  await ada
    .getByRole('dialog', { name: 'Dashboard settings' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await ada.getByRole('button', { name: 'Delete dashboard' }).click();
  await expect(ada.getByText('No dashboards yet')).toBeVisible();
  expect(permissionErrors(ada)).toEqual([]);
});

test('dashboards on a phone: one column, nothing sideways, editing off', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace', {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`DashPhone ${run}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();
  await ada.getByRole('button', { name: 'Open navigation' }).tap();
  await ada.getByRole('link', { name: 'Dashboards' }).tap();
  await ada.getByRole('button', { name: 'New dashboard' }).first().tap();
  const dlg = ada.getByRole('dialog', { name: 'New dashboard' });
  await dlg.getByLabel('Dashboard name').fill('Phone');
  await dlg.getByRole('checkbox', { name: 'Household chores' }).check();
  await dlg.getByRole('button', { name: 'Create dashboard' }).tap();
  await ada.getByRole('button', { name: 'Edit', exact: true }).tap();
  await save(await addWidget(ada, /^Progress/));
  await save(await addWidget(ada, /^Overdue/));
  await ada.getByRole('button', { name: 'Done', exact: true }).tap();
  const boxes = await ada.locator('.react-grid-item').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, right: r.right };
    }),
  );
  expect(boxes).toHaveLength(2);
  for (const b of boxes) {
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(391);
  }
  expect(
    await ada.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
});
