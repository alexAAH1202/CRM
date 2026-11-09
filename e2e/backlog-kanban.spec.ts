import { expect, test, type Locator, type Page } from '@playwright/test';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);

async function drag(
  page: Page,
  from: Locator,
  to: Locator,
  where: 'center' | 'top' | 'bottom' = 'center',
) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  const ty =
    where === 'top' ? b.y + 6 : where === 'bottom' ? b.y + b.height - 6 : b.y + b.height / 2;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, ty, { steps: 14 });
  await page.mouse.up();
}

const order = async (lane: Locator) =>
  await lane
    .getByRole('button', { name: /^Card:/ })
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace('Card: ', '')));

test('Kanban: reorder cards within a lane; a card dropped on another lane lands where you put it; it sticks after reload', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  await ada.setViewportSize({ width: 1400, height: 1400 }); // all seven cards on screen at once
  await ada.goto('/new');
  await ada.getByLabel('Household name').fill(`Kanban ${run}`);
  await ada.getByRole('button', { name: 'Create household' }).click();
  await ada.getByRole('button', { name: 'Choose a template' }).click();
  await ada.getByRole('radio', { name: /Household chores/ }).click();
  await ada.getByRole('button', { name: 'Create list' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();
  await ada.getByRole('button', { name: 'Add view' }).click();
  await ada
    .getByRole('dialog', { name: 'Add view' })
    .getByRole('button', { name: 'Kanban' })
    .click();

  const todo = ada.getByRole('region', { name: 'Lane To do' });
  const done = ada.getByRole('region', { name: 'Lane Done' });
  await expect(todo.getByRole('button', { name: /^Card:/ })).toHaveCount(7);
  const start = await order(todo);

  // drag the first card down onto the third: it goes below it
  await drag(
    ada,
    todo.getByRole('button', { name: `Card: ${start[0]}` }),
    todo.getByRole('button', { name: `Card: ${start[2]}` }),
  );
  await expect.poll(() => order(todo)).toEqual([start[1], start[2], start[0], ...start.slice(3)]);
  const afterFirst = await order(todo);

  // drag the last card up onto the second: it goes above it
  await drag(
    ada,
    todo.getByRole('button', { name: `Card: ${afterFirst[6]}` }),
    todo.getByRole('button', { name: `Card: ${afterFirst[1]}` }),
  );
  await expect
    .poll(() => order(todo))
    .toEqual([afterFirst[0], afterFirst[6], afterFirst[1], ...afterFirst.slice(2, 6)]);
  const wanted = await order(todo);

  // to another lane, onto a card: the status changes and it sits above that card
  await drag(ada, todo.getByRole('button', { name: `Card: ${wanted[0]}` }), done);
  await expect(done.getByRole('button', { name: `Card: ${wanted[0]}` })).toBeVisible();
  await ada.waitForTimeout(600); // let the first drop settle
  await drag(
    ada,
    todo.getByRole('button', { name: `Card: ${wanted[1]}` }),
    done.getByRole('button', { name: `Card: ${wanted[0]}` }),
    'top',
  );
  await expect.poll(() => order(done)).toEqual([wanted[1], wanted[0]]);

  // it all survives a reload (order is saved with the view; status with the item)
  await ada.waitForTimeout(1200); // the view's settings save a moment after the last change
  await ada.reload();
  const todo2 = ada.getByRole('region', { name: 'Lane To do' });
  const done2 = ada.getByRole('region', { name: 'Lane Done' });
  await expect.poll(() => order(done2)).toEqual([wanted[1], wanted[0]]);
  await expect.poll(() => order(todo2)).toEqual(wanted.slice(2));

  // the table is not disturbed by Kanban ordering
  await ada.getByRole('tab', { name: 'Main table' }).click();
  await expect(ada.getByRole('grid')).toBeVisible();
  await expect(ada.getByRole('row').filter({ hasText: 'Dishes' }).first()).toBeVisible();
  expect(permissionErrors(ada)).toEqual([]);
});
