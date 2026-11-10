import { expect, test, type Page } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);
const yesterday = new Intl.DateTimeFormat('en-US', {
  month: '2-digit',
  day: '2-digit',
  year: 'numeric',
})
  .format(Date.now() - 86_400_000)
  .replace(/\//g, '');

async function setup(p: Page) {
  await p.goto('/new');
  await p
    .getByLabel('Household name')
    .fill(`Focus ${run} ${Math.random().toString(36).slice(2, 5)}`);
  await p.getByRole('button', { name: 'Create household' }).click();
  await p.getByRole('button', { name: 'Choose a template' }).click();
  await p.getByRole('radio', { name: /Household chores/ }).click();
  await p.getByRole('button', { name: 'Create list' }).click();
  await expect(p.getByRole('grid')).toBeVisible();
}

test('countdowns, focus mode, steps, plan for today, done and not now', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await setup(ada);

  // ---- a countdown beside a date
  await ada.getByRole('button', { name: 'Edit Next due for Clean out the fridge' }).click();
  await ada.keyboard.type(yesterday);
  await ada.keyboard.press('Enter');
  await expect(
    ada.getByRole('row').filter({ hasText: 'Clean out the fridge' }).first(),
  ).toContainText('1 day late');
  await ada.waitForTimeout(600);

  // ---- focus: the overdue one comes first
  await ada.getByRole('link', { name: 'Focus' }).click();
  const card = ada.getByRole('region', { name: 'Do this next' });
  await expect(card.getByRole('heading', { name: 'Clean out the fridge' })).toBeVisible();
  await expect(card).toContainText('1 day late');

  // ---- break it down: steps become subitems; the first shows as the tiny step
  const steps = card.getByRole('form', { name: 'Break it down' });
  await steps.getByLabel('Step 1').fill('Find the bin bags');
  await steps.getByLabel('Step 2').fill('Empty the top shelf');
  await steps.getByRole('button', { name: 'Add steps' }).click();
  await expect(card).toContainText('First tiny step: Find the bin bags');
  await card.getByRole('button', { name: 'Step done' }).click();
  await expect(card).toContainText('First tiny step: Empty the top shelf');

  // ---- not now moves on
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(card.getByRole('heading', { name: 'Clean out the fridge' })).toHaveCount(0);

  // ---- plan for today: picked ones come first
  await ada.getByRole('button', { name: /Pick up to 3/ }).click();
  const choose = ada.getByRole('list', { name: 'Choose for today' });
  await choose.getByRole('checkbox', { name: /Vacuum and mop/ }).check();
  await choose.getByRole('checkbox', { name: /Dishes/ }).check();
  await ada.getByRole('button', { name: 'Save plan' }).click();
  const plan = ada.getByRole('list', { name: 'Planned for today' });
  await expect(plan).toContainText('Vacuum and mop');
  await expect(card.getByRole('heading', { name: 'Vacuum and mop' })).toBeVisible();
  await expect(card).toContainText('On today’s plan');

  // ---- timebox shows a countdown
  await card.getByRole('button', { name: '5 min', exact: true }).click();
  await expect(card.getByRole('timer', { name: 'Timebox' })).toContainText(/4:5\d|5:00/);
  await card.getByRole('button', { name: 'Stop' }).click();

  // ---- done: marks the status and moves on
  await card.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(ada.getByText('Done: Vacuum and mop 🎉')).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Dishes' })).toBeVisible();

  // the plan survives a reload; the done one is shown done
  await ada.reload();
  await expect(ada.getByRole('list', { name: 'Planned for today' })).toContainText('Dishes');
  await ada.getByRole('link', { name: 'Household chores' }).click();
  await expect(ada.getByRole('row').filter({ hasText: 'Vacuum and mop' }).first()).toContainText(
    'Done',
  );
  expect(permissionErrors(ada)).toEqual([]);
});

test('quick wins and the escalating-reminders recipe', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await setup(ada);
  // a Quick tag on Dishes
  await ada.getByRole('button', { name: 'Add column' }).first().click();
  await ada
    .getByRole('dialog', { name: 'Add column' })
    .getByRole('button', { name: /^Tags/ })
    .first()
    .click();
  await ada.getByRole('button', { name: 'Edit Tags for Dishes' }).click();
  const tagDlg = ada.getByRole('dialog', { name: 'Tags for Dishes' });
  await tagDlg.getByLabel('New tag').fill('Quick');
  await tagDlg.getByRole('button', { name: 'Add' }).click();
  await ada.keyboard.press('Escape');
  await ada.waitForTimeout(600);

  // escalating reminders: one click adds four
  await ada.getByRole('button', { name: 'Automations' }).click();
  await ada.getByRole('button', { name: 'Add automation' }).click();
  await ada.getByRole('button', { name: /Escalating reminders/ }).click();
  await expect(ada.getByText('Added 4 reminders')).toBeVisible();
  await expect(ada.getByRole('list', { name: 'Automations' }).getByRole('listitem')).toHaveCount(4);
  await ada.keyboard.press('Escape');

  await ada.getByRole('link', { name: 'Focus' }).click();
  await ada.getByLabel('Quick wins only').check();
  const card = ada.getByRole('region', { name: 'Do this next' });
  await expect(card.getByRole('heading', { name: 'Dishes' })).toBeVisible();
  await expect(card).toContainText('Quick win');
  await expect(card.getByRole('list', { name: 'After that' })).toHaveCount(0);
  expect(permissionErrors(ada)).toEqual([]);
});
