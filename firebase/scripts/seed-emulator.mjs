// Seeds the local Firestore emulator with the workspace-creator allowlist so
// `npm run dev` works out of the box. Talks to the emulator REST API with the
// special "owner" token (bypasses rules). Never touches a real project.
const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const PROJECT = 'demo-app';
const DEV_CREATORS = ['ada@example.com', 'grace@example.com'];

const url = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents/appConfig/workspaceCreators`;
const headers = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

async function waitForEmulator(timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://${HOST}/`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Firestore emulator not reachable at ${HOST}`);
}

await waitForEmulator();
const existing = await fetch(url, { headers });
if (existing.ok) {
  console.log('[seed] appConfig/workspaceCreators already present — leaving it alone');
} else {
  const body = {
    fields: { emails: { arrayValue: { values: DEV_CREATORS.map((e) => ({ stringValue: e })) } } },
  };
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`[seed] failed: ${res.status} ${await res.text()}`);
  console.log(`[seed] workspace creators: ${DEV_CREATORS.join(', ')}`);
}
