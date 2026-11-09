import { assertFails } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createEnv } from './setup';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createEnv();
});

afterAll(async () => {
  await env.cleanup();
});

describe('baseline: deny by default', () => {
  it('denies unauthenticated reads and writes', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'anything/x')));
    await assertFails(setDoc(doc(db, 'anything/x'), { a: 1 }));
  });

  it('denies authenticated access to unknown paths', async () => {
    const db = env
      .authenticatedContext('alice', { email: 'alice@example.com', email_verified: true })
      .firestore();
    await assertFails(getDoc(doc(db, 'unknownCollection/x')));
    await assertFails(setDoc(doc(db, 'unknownCollection/x'), { a: 1 }));
  });
});
