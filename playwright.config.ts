import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the local Emulator Suite + Vite (`npm run dev`).
 * They create uniquely-named data, so they don't wipe your local dev data.
 */
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    // Makes the app believe a helper is deployed; tests answer its calls themselves (e2e/helper-7).
    env: { VITE_APPS_SCRIPT_URL: 'https://helper.test/exec' },
    timeout: 180_000,
  },
});
