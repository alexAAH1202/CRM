/** The product name (shown in the sidebar, sign-in page and browser tab). */
export const APP_NAME = 'Sorted';

const env = import.meta.env;

/** Dev builds use the local emulators unless VITE_USE_EMULATORS=false. */
export const USE_EMULATORS =
  env.VITE_USE_EMULATORS === 'true' || (env.DEV && env.VITE_USE_EMULATORS !== 'false');

export const FIREBASE_CONFIG = USE_EMULATORS
  ? {
      apiKey: 'demo-api-key',
      authDomain: 'demo-app.firebaseapp.com',
      projectId: 'demo-app',
      appId: 'demo-app-id',
    }
  : {
      apiKey: env.VITE_FIREBASE_API_KEY as string,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string,
      projectId: env.VITE_FIREBASE_PROJECT_ID as string,
      appId: env.VITE_FIREBASE_APP_ID as string,
    };

export const APPS_SCRIPT_URL = (env.VITE_APPS_SCRIPT_URL as string | undefined) ?? '';
