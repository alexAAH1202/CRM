/** The item fields the shared view logic needs (web's BoardItem satisfies this). */
export interface ItemLike {
  id: string;
  name: string;
  groupId: string;
  order: string;
  parentId: string | null;
  itemNumber: number;
  values: Record<string, unknown>;
  archived: boolean;
  deleted: boolean;
}
