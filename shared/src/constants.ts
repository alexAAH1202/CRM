/**
 * Product-wide limits. Firestore security rules mirror several of these numbers
 * (rules cannot import TS), so any change here must also be made in
 * firebase/firestore.rules — the rules tests import these constants to catch drift.
 */
export const LIMITS = {
  /** Max boards a single dashboard may combine (protects read quota). */
  MAX_DASHBOARD_BOARDS: 5,
  /** Max upload size for Drive-backed files. */
  MAX_FILE_MB: 10,
  /** Time-tracking sessions kept inline on an item before archiving to a subcollection. */
  MAX_INLINE_TIME_SESSIONS: 200,
  /** Automation run history kept per board. */
  MAX_AUTOMATION_RUNS_PER_BOARD: 50,
  /** Max nested automation depth (loop guard). */
  MAX_AUTOMATION_DEPTH: 3,
  /** Firestore writeBatch hard limit. */
  MAX_BATCH_WRITES: 500,
  /** Daily email budget for Apps Script digests (consumer cap is ~100 recipients). */
  MAX_DIGEST_EMAILS_PER_DAY: 80,
  /** String length caps enforced in rules. */
  MAX_NAME_LENGTH: 200,
  MAX_WORKSPACE_NAME_LENGTH: 80,
  MAX_DISPLAY_NAME_LENGTH: 120,
  MAX_URL_LENGTH: 2048,
  MAX_BOARD_MEMBERS: 50,
  MAX_BOARD_COLUMNS: 100,
  MAX_BOARD_GROUPS: 100,
  MAX_ITEM_NAME_LENGTH: 500,
  MAX_DESCRIPTION_LENGTH: 5000,
  MAX_EMAIL_LENGTH: 254,
  /** Members per workspace (small-team product; keeps rule arrays bounded). */
  MAX_WORKSPACE_MEMBERS: 50,
} as const;

/** Project id used for the local Firebase Emulator Suite. The `demo-` prefix
 * guarantees the emulators never talk to a real cloud project. */
export const EMULATOR_PROJECT_ID = 'demo-app';
