import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { FIREBASE_CONFIG, USE_EMULATORS } from '../config';

export const firebaseApp = initializeApp(FIREBASE_CONFIG);

/**
 * Persistent IndexedDB cache shared across tabs: repeat board opens are served
 * from cache and listeners resume with only the changed documents billed.
 */
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const auth = getAuth(firebaseApp);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

declare global {
  interface Window {
    /** Emulator-only test hook: sign in as a fake Google user with a verified email. */
    __emulatorSignIn?: (email: string, displayName?: string) => Promise<void>;
  }
}

if (USE_EMULATORS && typeof window !== 'undefined') {
  window.__emulatorSignIn = async (email, displayName) => {
    const { GoogleAuthProvider, signInWithCredential } = await import('firebase/auth');
    // The Auth emulator accepts an unsigned JSON "ID token" for the Google provider.
    const fakeIdToken = JSON.stringify({
      sub: `google-${email}`,
      email,
      email_verified: true,
      name: displayName ?? email.split('@')[0],
    });
    await signInWithCredential(auth, GoogleAuthProvider.credential(fakeIdToken));
  };
}
