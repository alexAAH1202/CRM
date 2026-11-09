import type { BoardDoc, Role } from '@app/shared';

export interface BoardSummary {
  id: string;
  name: string;
  visibility: 'main' | 'private';
  archived: boolean;
  order: string;
  createdBy: string;
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
  createdBy: string;
  updatedAtMs: number | null;
}

export interface WorkspaceMember {
  uid: string;
  name: string;
  email: string;
  photoURL: string | null;
  role: Role;
}
