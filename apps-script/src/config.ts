import { HELPER_VERSION } from '@app/shared';
import type { Platform } from './platform';

/** Public identifiers (not secrets). Script Properties can override them. */
export const PROJECT_ID = 'life-management-de315';
// The Firebase web API key identifies the project and is already public in the web app.
export const DEFAULT_API_KEY = 'AIzaSyDaSy0Z-YZT4XK1283aF_ZUCkdN3xzHf1U';
export const DEFAULT_DRIVE_ROOT = '1RinTNsHtgeK0yjycf339SL0TQ3S7gRcV';
export const TIME_ZONE = 'Australia/Melbourne';
export const VERSION = HELPER_VERSION;

export interface HelperConfig {
  projectId: string;
  apiKey: string;
  driveRootFolderId: string | null;
}

export function loadConfig(p: Platform): HelperConfig {
  return {
    projectId: p.prop('FIREBASE_PROJECT_ID') ?? PROJECT_ID,
    apiKey: p.prop('FIREBASE_API_KEY') ?? DEFAULT_API_KEY,
    driveRootFolderId: p.prop('DRIVE_ROOT_FOLDER_ID') ?? DEFAULT_DRIVE_ROOT,
  };
}
