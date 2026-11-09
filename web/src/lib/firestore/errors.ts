import { FirebaseError } from 'firebase/app';

/** Turns Firebase errors into short, user-facing messages. */
export function friendlyError(
  err: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case 'permission-denied':
        return "You don't have permission to do that.";
      case 'unavailable':
        return "You're offline. Changes will sync when you reconnect.";
      case 'resource-exhausted':
        return 'The free daily limit has been reached. Try again tomorrow.';
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return 'Sign-in was cancelled.';
      case 'auth/popup-blocked':
        return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
      case 'auth/unauthorized-domain':
        return 'This domain is not authorised for sign-in. Add it in Firebase Authentication settings.';
      case 'auth/network-request-failed':
        return 'Network error. Check your connection.';
    }
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

export function isPermissionDenied(err: unknown): boolean {
  return err instanceof FirebaseError && err.code === 'permission-denied';
}
