import type { Role } from './roles';

/**
 * Firestore document shapes. The authoritative description lives in
 * docs/DATA_MODEL.md. Timestamps are typed structurally so this package does
 * not depend on the Firebase SDK (it is shared with Apps Script).
 */
export interface TimestampLike {
  toMillis(): number;
}

export interface UserDoc {
  displayName: string;
  email: string;
  photoURL: string | null;
  lastWorkspaceId: string | null;
  settings: UserSettings;
}

export interface UserSettings {
  theme?: 'light' | 'dark' | 'system';
}

export interface WorkspaceDoc {
  name: string;
  createdBy: string;
  createdAt: TimestampLike;
  /** uids of all admins. Kept in sync with members/{uid}.role by rules (getAfter). */
  adminUids: string[];
  driveFolderId: string | null;
  settings: WorkspaceSettings;
}

export interface WorkspaceSettings {
  capacityHoursPerWeek: number;
  weekStart: 0 | 1; // 0 = Sunday, 1 = Monday
  timezone: string; // IANA, e.g. Australia/Melbourne
}

export interface MemberDoc {
  /** Equals the document id; duplicated for the 'my workspaces' collection-group query. */
  uid: string;
  role: Role;
  email: string;
  displayName: string;
  photoURL: string | null;
  joinedAt: TimestampLike;
}

export interface InviteDoc {
  /** Lowercased email; equals the document id. Stored for collection-group lookup. */
  email: string;
  role: Role;
  workspaceName: string;
  invitedBy: string;
  createdAt: TimestampLike;
}
