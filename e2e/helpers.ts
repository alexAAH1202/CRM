import { expect, type Browser, type Page } from '@playwright/test';

/** Opens a fresh browser context signed in (via the emulator-only hook) as `email`. */
export async function signedInPage(browser: Browser, email: string, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/signin');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await page.waitForFunction(() => typeof window.__emulatorSignIn === 'function');
  await page.evaluate(([e, n]) => window.__emulatorSignIn!(e!, n), [email, name]);
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
  return page;
}
