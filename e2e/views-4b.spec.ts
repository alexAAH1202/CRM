import { expect, test, type Page } from '@playwright/test';
import { addDays, format } from 'date-fns';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

async function freshTripBoard(page: Page) {
  await page.goto('/new');
  await page
    .getByLabel('Workspace name')
    .fill(`P4b ${run} ${Math.random().toString(36).slice(2, 6)}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'Choose a template' }).click();
  await page.getByRole('radio', { name: /Trip planner/ }).click();
  await page.getByRole('button', { name: 'Create board' }).click();
  await expect(page.getByRole('heading', { name: 'Trip planner', level: 1 })).toBeVisible();
  await expect(page.getByRole('grid')).toBeVisible();
}

async function addView(page: Page, kind: string, tab = kind) {
  await page.getByRole('button', { name: 'Add view' }).click();
  await page.getByRole('dialog', { name: 'Add view' }).getByRole('button', { name: kind }).click();
  await expect(page.getByRole('tab', { name: tab, selected: true })).toBeVisible();
}

test('Gantt: dates, dependency arrow, drag, shift dependents; Workload capacity; Chart', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await freshTripBoard(ada);

  // Accommodation waits for Flights (set up in the table).
  await ada.getByRole('button', { name: 'Add column' }).first().click();
  await ada
    .getByRole('dialog', { name: 'Add column' })
    .getByRole('button', { name: /^Dependency/ })
    .first()
    .click();
  await ada.getByRole('button', { name: 'Edit Dependency for Accommodation' }).click();
  await ada
    .getByRole('dialog', { name: 'Dependency for Accommodation' })
    .getByRole('option', { name: /^Flights/ })
    .getByRole('button')
    .click();
  await ada.keyboard.press('Escape');

  // Flights is Ada's; both get dates.
  await ada.getByRole('button', { name: 'Edit Who for Flights' }).click();
  await ada
    .getByRole('dialog', { name: /Who for Flights/ })
    .getByRole('button', { name: /Ada Lovelace/ })
    .click();
  await ada.keyboard.press('Escape');

  // ---- Gantt
  await addView(ada, 'Gantt', 'Timeline');
  await ada.getByRole('button', { name: 'Set dates for Flights' }).click();
  await ada.getByRole('button', { name: 'Set dates for Accommodation' }).click();
  const flights = ada.getByRole('button', { name: /^Bar: Flights/ });
  const stay = ada.getByRole('button', { name: /^Bar: Accommodation/ });
  await expect(flights).toBeVisible();
  await expect(stay).toBeVisible();
  const today = format(new Date(), 'yyyy-MM-dd');
  await expect(flights).toHaveAttribute('data-start', today);

  // Both start today, so the arrow is drawn as a broken constraint.
  await expect(ada.locator('path[data-violated]')).toHaveCount(1);

  // Drag Flights later: the dependent is offered a shift.
  const box = (await flights.boundingBox())!;
  await ada.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ada.mouse.down();
  await ada.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
  await ada.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, { steps: 5 });
  await ada.mouse.up();
  await expect(flights).not.toHaveAttribute('data-start', today);
  const newEnd = (await flights.getAttribute('data-end'))!;
  expect(newEnd > format(addDays(new Date(), 2), 'yyyy-MM-dd')).toBe(true);
  await expect(ada.getByText(/dependent item now starts too early/)).toBeVisible();
  await ada.getByRole('button', { name: 'Shift it' }).click();
  await expect(stay).toHaveAttribute(
    'data-start',
    format(addDays(new Date(`${newEnd}T12:00:00`), 1), 'yyyy-MM-dd'),
  );
  await expect(ada.locator('path[data-violated]')).toHaveCount(0);

  // Keyboard: arrow keys move a bar a day at a time.
  const before = (await stay.getAttribute('data-start'))!;
  await stay.focus();
  await ada.keyboard.press('ArrowRight');
  await expect(stay).not.toHaveAttribute('data-start', before);

  // Zoom
  await ada.getByLabel('Zoom').selectOption('month');
  await expect(ada.getByText(/^[A-Z][a-z]{2} \d{4}$/).first()).toBeVisible();

  // ---- Workload: Flights is Ada's (8h per working day), so she is flagged over a tiny capacity.
  await addView(ada, 'Workload');
  await expect(ada.getByRole('row', { name: /Ada Lovelace/ })).toBeVisible();
  await expect(ada.getByRole('row', { name: /Unassigned/ })).toBeVisible();
  const cap = ada.getByLabel('Weekly capacity for Ada Lovelace');
  await cap.fill('1');
  await cap.blur();
  await expect(ada.getByRole('cell', { name: /over capacity of 1/ }).first()).toBeVisible();

  // ---- Chart
  await addView(ada, 'Chart');
  await expect(ada.getByRole('table', { name: /Items by/ })).toBeVisible();
  await ada.getByLabel('Chart', { exact: true }).selectOption('pie');
  await expect(ada.locator('.recharts-pie')).toBeVisible();

  // ---- It all survived a reload (view settings save after a short pause)
  await ada.waitForTimeout(1200);
  await ada.reload();
  await ada.getByRole('tab', { name: 'Workload' }).click();
  await expect(ada.getByLabel('Weekly capacity for Ada Lovelace')).toHaveValue('1');
  await ada.getByRole('tab', { name: 'Chart' }).click();
  await expect(ada.getByLabel('Chart', { exact: true })).toHaveValue('pie');
  await ada.getByRole('tab', { name: 'Timeline' }).click();
  await expect(ada.getByRole('button', { name: /^Bar: Accommodation/ })).toBeVisible();
  expect(permissionErrors(ada)).toEqual([]);
});
