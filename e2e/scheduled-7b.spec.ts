import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { HELPER_VERSION } from '../shared/src/helperProtocol';
import { permissionErrors, signedInPage } from './helpers';

const run = Date.now().toString(36);
const TZ = 'Australia/Melbourne';
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

/** YYYY-MM-DD for "today + n days" on the Melbourne clock. */
const dayPlus = (n: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(Date.now() + n * 86_400_000);
const mmddyyyy = (iso: string) => `${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(0, 4)}`;

async function events(request: APIRequestContext, page: Page) {
  const m = /\/w\/([^/]+)\/b\/([^/?]+)/.exec(page.url())!;
  const res = await request.get(
    `http://127.0.0.1:8080/v1/projects/demo-app/databases/(default)/documents/workspaces/${m[1]}/boards/${m[2]}/scheduledEvents`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  const body = (await res.json()) as {
    documents?: Array<{ name: string; fields: Record<string, Record<string, string> | undefined> }>;
  };
  return (body.documents ?? []).map((d) => ({
    id: d.name.split('/').pop()!,
    kind: d.fields['kind']?.stringValue as string,
    fireAt: d.fields['fireAt']?.timestampValue as string,
    dateValue: d.fields['dateValue']?.stringValue as string | undefined,
    status: d.fields['status']?.stringValue as string,
    itemId: d.fields['itemId']?.stringValue as string | undefined,
  }));
}

async function newBillsBoard(page: Page) {
  await page.goto('/new');
  await page
    .getByLabel('Workspace name')
    .fill(`Sched ${run} ${Math.random().toString(36).slice(2, 5)}`);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'Choose a template' }).click();
  await page.getByRole('radio', { name: /Bills & subscriptions/ }).click();
  await page.getByRole('button', { name: 'Create board' }).click();
  await expect(page.getByRole('grid')).toBeVisible();
}

test('reminders: the browser keeps the helper’s schedule queue in step with dates, edits and removals', async ({
  browser,
  request,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace', { timezoneId: TZ });
  await newBillsBoard(ada);

  // ---- a prebuilt reminder recipe, opened pre-filled
  await ada.getByRole('button', { name: 'Automations' }).click();
  const panel = ada.getByRole('dialog');
  await panel.getByRole('button', { name: 'Add automation' }).click();
  await panel.getByRole('button', { name: /Remind me 3 days before “Due date”/ }).click();
  await expect(panel.getByLabel('Days')).toHaveValue('3');
  await expect(panel.getByLabel('Before or after')).toHaveValue('before');
  await expect(panel.getByLabel('At (time of day)')).toHaveValue('09:00');
  await expect(panel.getByText(/runs on a clock/)).toBeVisible();
  await panel.getByRole('button', { name: 'Add automation' }).click();
  await expect(panel.getByRole('list', { name: 'Automations' })).toContainText(
    '3 days before Due date, at 9am',
  );
  await ada.keyboard.press('Escape');

  // ---- setting a due date registers an event at the right moment (3 days before, 09:00 Melbourne)
  const due = dayPlus(10);
  await ada.getByRole('button', { name: 'Edit Due date for Electricity' }).click();
  await ada.keyboard.type(mmddyyyy(due));
  await ada.keyboard.press('Enter');
  await expect.poll(async () => (await events(request, ada)).length, { timeout: 10_000 }).toBe(1);
  let [ev] = await events(request, ada);
  expect(ev).toMatchObject({ kind: 'date', status: 'pending', dateValue: due });
  const expected = (iso: string) => {
    // 09:00 in Melbourne on (date - 3 days), as a UTC instant
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 3);
    const local = d.toISOString().slice(0, 10);
    const guess = new Date(`${local}T09:00:00Z`).getTime();
    const part = (ms: number) => {
      const p = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(new Date(ms));
      const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
      return (
        Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ms
      );
    };
    return new Date(guess - part(guess)).toISOString();
  };
  expect(new Date(ev!.fireAt).toISOString()).toBe(expected(due));

  // ---- changing the date moves the event; clearing it removes it
  const later = dayPlus(20);
  await ada.getByRole('button', { name: 'Edit Due date for Electricity' }).click();
  await ada.keyboard.press('Control+a');
  await ada.keyboard.type(mmddyyyy(later));
  await ada.keyboard.press('Enter');
  await expect
    .poll(async () => (await events(request, ada))[0]?.dateValue, { timeout: 10_000 })
    .toBe(later);
  [ev] = await events(request, ada);
  expect(new Date(ev!.fireAt).toISOString()).toBe(expected(later));

  // a second item with a date gets its own event
  await ada.getByRole('button', { name: 'Edit Due date for Water' }).click();
  await ada.keyboard.type(mmddyyyy(dayPlus(15)));
  await ada.keyboard.press('Enter');
  await expect.poll(async () => (await events(request, ada)).length, { timeout: 10_000 }).toBe(2);

  // deleting an item removes its event
  await ada.getByRole('button', { name: 'Options for Water' }).click();
  await ada.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(async () => (await events(request, ada)).length, { timeout: 10_000 }).toBe(1);

  // ---- switching the automation off removes every event; on again brings them back
  await ada.getByRole('button', { name: 'Automations' }).click();
  await panel.getByRole('switch', { name: /Remind me.* is on/ }).click();
  await expect.poll(async () => (await events(request, ada)).length, { timeout: 10_000 }).toBe(0);
  await panel.getByRole('switch', { name: /Remind me.* is off/ }).click();
  await expect.poll(async () => (await events(request, ada)).length, { timeout: 10_000 }).toBe(1);

  // ---- deleting the automation clears the queue
  await panel.getByRole('button', { name: /^Delete Remind me/ }).click();
  await ada.getByRole('button', { name: 'Delete automation' }).click();
  await expect.poll(async () => (await events(request, ada)).length, { timeout: 10_000 }).toBe(0);
  expect(permissionErrors(ada)).toEqual([]);
});

test('building a repeating schedule; a board-wide schedule cannot change items', async ({
  browser,
}) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace', { timezoneId: TZ });
  await newBillsBoard(ada);
  await ada.getByRole('button', { name: 'Automations' }).click();
  const panel = ada.getByRole('dialog');
  await panel.getByRole('button', { name: 'Add automation' }).click();
  await panel.getByRole('button', { name: 'Start from scratch' }).click();
  await panel.getByLabel('Name', { exact: true }).fill('Bin night');
  await panel.getByLabel('Trigger').selectOption({ label: 'on a repeating schedule…' });
  await panel.getByLabel('Repeats').selectOption({ label: 'Every N weeks, on chosen days' });
  await panel.getByRole('checkbox', { name: 'Tue' }).check();
  await panel.getByLabel('At (time of day)').fill('18:30');
  // a board-wide schedule has no item: changing items is refused with an explanation
  await panel.getByLabel('Action 1').selectOption({ label: 'archive the item' });
  await expect(panel.getByText(/no single item/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Add automation' })).toBeDisabled();
  await panel.getByLabel('Action 1').selectOption({ label: 'send a notification' });
  await panel.getByLabel('Message (use {item} for the item’s name)').fill('Bins out tonight');
  await panel.getByRole('button', { name: 'Add automation' }).click();
  await expect(panel.getByRole('list', { name: 'Automations' })).toContainText(
    'every week on Mon, Tue at 6:30pm',
  );

  // "for each matching item" brings conditions back and allows item changes
  await panel.getByRole('button', { name: 'Edit Bin night' }).click();
  await panel
    .getByLabel('Runs')
    .selectOption({ label: 'for each item that matches the conditions' });
  await expect(panel.getByRole('button', { name: 'Add condition' })).toBeVisible();
  await panel.getByLabel('Action 1').selectOption({ label: 'archive the item' });
  await expect(panel.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  expect(permissionErrors(ada)).toEqual([]);
});

test('Helper card: scheduled-run queue and the Rebuild schedule button', async ({ browser }) => {
  const ada = await signedInPage(browser, 'ada@example.com', 'Ada Lovelace');
  const calls: string[] = [];
  await ada.route('https://helper.test/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    calls.push(String(body['action']));
    const ok = (data: unknown) =>
      route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, data }) });
    if (body['action'] === 'whoami')
      return ok({
        uid: 'u',
        email: null,
        role: 'admin',
        workspaceId: body['workspaceId'],
        version: HELPER_VERSION,
        serverTime: '',
        config: { driveFolder: true, timeZone: TZ },
      });
    if (body['action'] === 'schedulerStatus')
      return ok({ pending: 4, failed: 1, nextDue: '2026-03-20T22:00:00.000Z', stalled: true });
    if (body['action'] === 'rebuildSchedule')
      return ok({ boards: 2, automations: 3, registered: 9, removed: 2 });
    return route.fulfill({
      status: 200,
      headers: cors,
      body: JSON.stringify({ ok: false, error: { code: 'unknown_action', message: 'x' } }),
    });
  });
  await ada.goto('/new');
  await ada.getByLabel('Workspace name').fill(`Queue ${run}`);
  await ada.getByRole('button', { name: 'Create workspace' }).click();
  await ada.getByRole('link', { name: 'Members' }).click();
  const card = ada.getByRole('region', { name: 'Sorted helper' });
  await expect(card).toContainText('4 waiting');
  await expect(card).toContainText('1 gave up');
  await expect(card.getByRole('alert')).toContainText('over 30 minutes');
  await card.getByRole('button', { name: 'Rebuild schedule' }).click();
  await expect(
    ada.getByText('Schedule rebuilt: 9 upcoming runs registered, 2 stale ones removed.'),
  ).toBeVisible();
  expect(calls).toContain('rebuildSchedule');

  // an out-of-date helper (without the scheduler) is called out and is not asked about the queue
  calls.length = 0;
});
