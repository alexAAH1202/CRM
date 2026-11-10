import type { Column } from './columns';
import type { LabelColor } from './palette';

export interface Group {
  id: string;
  name: string;
  color: LabelColor;
}

export type BoardVisibility = 'main' | 'private';

export interface BoardDoc {
  name: string;
  description: string;
  folderId: string | null;
  order: string;
  visibility: BoardVisibility;
  memberIds: string[];
  columns: Column[];
  groups: Group[]; // array order = display order
  schemaVersion: number;
  archived: boolean;
  createdBy: string;
}

/** 2: every list has a Group column (D101). */
export const BOARD_SCHEMA_VERSION = 2;

export const GROUP_COLORS: LabelColor[] = [
  'blue',
  'green',
  'purple',
  'orange',
  'pink',
  'teal',
  'red',
  'sky',
  'grape',
  'brown',
];
