import type { BoardDoc, Role } from '@app/shared';

export interface BoardSummary {
  id: string;
  name: string;
  visibility: 'main' | 'private';
  archived: boolean;
  order: string;
  createdBy: string;
  folderId: string | null;
}

export interface Folder {
  id: string;
  name: string;
  order: string;
}

export interface Board extends BoardDoc {
  id: string;
}

export interface BoardItem {
  id: string;
  name: string;
  groupId: string;
  order: string;
  parentId: string | null;
  itemNumber: number;
  values: Record<string, unknown>;
  assigneeUids: string[];
  archived: boolean;
  deleted: boolean;
  /** When it was deleted (null if it isn't). Deleted items stay recoverable until they're purged. */
  deletedAtMs: number | null;
  createdBy: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
}

export interface WorkspaceMember {
  uid: string;
  name: string;
  email: string;
  photoURL: string | null;
  role: Role;
}
