import { expect, test, type Page } from '@playwright/test';
import { format } from 'date-fns';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

async function openAutomations(p: Page) {
  await p.getByRole('button', { name: 'Automations' }).click();
  await expect(p.getByRole('dialog', { name: 'Automations' })).toBeVisible();
}

async function setStatus(p: Page, item: string, label: string) {
  await p.getByRole('button', { name: new RegExp(`Status: .*Change for ${item}`) }).click();
  await p.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  await p.keyboard.press('Escape');
}

test('recipes, a custom automation, the on/off switch, run history and the loop guard', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.goto('/new');
  await ada.getByLabel('Workspace name').fill(`P6 ${run}`);
  await ada.getByRole('button', { name: 'Create workspace' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create board' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();

  // ---- A prebuilt recipe: stamp "Last done" with today's date when status becomes Done
  await openAutomations(ada);
  await ada.getByRole('button', { name: 'Add automation' }).click();
  await ada.getByRole('button', { name: /Stamp “Last done” when it’s done/ }).click();
  await expect(
    ada
      .getByRole('dialog', { name: /automation|Automations/i })
      .getByLabel('Name', { exact: true }),
  ).toHaveValue(/Stamp/);
  await ada.getByRole('button', { name: 'Add automation' }).click();
  const panel = ada.getByRole('dialog', { name: 'Automations' });
  await expect(
    panel.getByText(/When Status changes to Done, set Last done to today/),
  ).toBeVisible();
  await ada.keyboard.press('Escape');

  await setStatus(ada, 'Dishes', 'Done');
  const dishes = ada.getByRole('row').filter({ hasText: 'Dishes' }).first();
  await expect(dishes).toContainText(format(new Date(), 'd MMM'));

  // ---- It's recorded in run history, and survives a reload
  await openAutomations(ada);
  await expect(panel.getByRole('region', { name: 'Recent runs' })).toContainText('Ran');
  await expect(panel.getByRole('region', { name: 'Recent runs' })).toContainText('Stamp');
  // switching it off stops it
  await panel.getByRole('switch', { name: /Stamp.* is on/ }).click();
  await expect(panel.getByRole('switch', { name: /Stamp.* is off/ })).toBeVisible();
  await ada.keyboard.press('Escape');
  await setStatus(ada, 'Feed the pets', 'Done');
  await ada.waitForTimeout(800);
  await expect(ada.getByRole('row').filter({ hasText: 'Feed the pets' }).first()).not.toContainText(
    format(new Date(), 'd MMM'),
  );

  // ---- Two automations that undo each other: the loop guard stops them
  const build = async (name: string, fromLabel: string, toLabel: string) => {
    await openAutomations(ada);
    await ada.getByRole('button', { name: 'Add automation' }).click();
    await ada.getByRole('button', { name: 'Start from scratch' }).click();
    await ada
      .getByRole('dialog', { name: /automation|Automations/i })
      .getByLabel('Name', { exact: true })
      .fill(name);
    await ada.getByLabel('Trigger').selectOption({ label: 'a status changes to…' });
    await ada.getByLabel('Changes to').selectOption({ label: fromLabel });
    await ada.getByLabel('Action 1').selectOption({ label: 'set a column to…' });
    await ada.getByLabel('Column', { exact: true }).selectOption({ label: 'Status' });
    await ada.getByLabel('Value').selectOption({ label: toLabel });
    await ada.getByRole('button', { name: 'Add automation' }).click();
    await expect(
      ada.getByRole('dialog', { name: 'Automations' }).getByText(name, { exact: true }),
    ).toBeVisible();
    await ada.keyboard.press('Escape');
  };
  await build('Ping', 'Skipped', 'To do');
  await build('Pong', 'To do', 'Skipped');
  await setStatus(ada, 'Vacuum and mop', 'Skipped'); // Ping → To do → Pong → Skipped → (Ping blocked)
  await openAutomations(ada);
  const runs = panel.getByRole('region', { name: 'Recent runs' });
  await expect(runs).toContainText('Skipped');
  await expect(runs).toContainText('loop guard');
  await ada.keyboard.press('Escape');
  // it settled (no endless flipping): the final status is stable after a moment
  const row = ada.getByRole('row').filter({ hasText: 'Vacuum and mop' }).first();
  await ada.waitForTimeout(1500);
  const settled = await row.innerText();
  await ada.waitForTimeout(1500);
  expect(await row.innerText()).toBe(settled);

  // ---- Reload: automations and history are real, not just local
  await ada.reload();
  await openAutomations(ada);
  await expect(panel.getByText('Ping', { exact: true })).toBeVisible();
  await expect(panel.getByText('Pong', { exact: true })).toBeVisible();
  expect(permissionErrors(ada)).toEqual([]);
});
