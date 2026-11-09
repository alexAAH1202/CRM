import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';

/** Opens a fresh browser context signed in (via the emulator-only hook) as `email`. */
const permissionLog = new WeakMap<Page, string[]>();

/**
 * Firestore applies writes locally first, so a UI can look right even when the server
 * (security rules) refused the write. The SDK logs those refusals; tests assert there are none.
 */
export function permissionErrors(page: Page): string[] {
  return permissionLog.get(page) ?? [];
}

export async function signedInPage(
  browser: Browser,
  email: string,
  name: string,
  contextOptions: BrowserContextOptions = {},
): Promise<Page> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const log: string[] = [];
  permissionLog.set(page, log);
  page.on('console', (m) => {
    if (m.type() === 'error' && /permission[-_ ]denied|insufficient permissions/i.test(m.text()))
      log.push(m.text());
  });
  await page.goto('/signin');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await page.waitForFunction(() => typeof window.__emulatorSignIn === 'function');
  await page.evaluate(([e, n]) => window.__emulatorSignIn!(e!, n), [email, name]);
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
  return page;
}
