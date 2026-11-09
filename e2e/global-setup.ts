/**
 * `npm run dev` starts Vite, the emulators and the seed script together.
 * Playwright's webServer only waits for Vite, so wait here until the Auth and
 * Firestore emulators answer and the seed data exists.
 */
const SEED_DOC =
  'http://127.0.0.1:8080/v1/projects/demo-app/databases/(default)/documents/appConfig/workspaceCreators';

async function waitFor(name: string, check: () => Promise<boolean>, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await check()) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${name}`);
}

export default async function globalSetup() {
  await waitFor('Vite', async () => (await fetch('http://localhost:5173/')).ok);
  await waitFor('Auth emulator', async () => (await fetch('http://127.0.0.1:9099/')).status < 500);
  await waitFor('Firestore emulator', async () => (await fetch('http://127.0.0.1:8080/')).ok);
  await waitFor(
    'seed data',
    async () => (await fetch(SEED_DOC, { headers: { Authorization: 'Bearer owner' } })).ok,
  );
}
