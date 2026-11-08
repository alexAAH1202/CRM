import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

const rulesPath = fileURLToPath(new URL('../firestore.rules', import.meta.url));

/** Creates a test environment against the running Firestore emulator (started by emulators:exec). */
export async function createEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: 'demo-app',
    firestore: { rules: readFileSync(rulesPath, 'utf8') },
  });
}
