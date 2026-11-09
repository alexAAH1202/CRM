import type { Column } from './columns';
import { valueToText } from './columns';
import { boardPaths } from './boardOps';
import { SERVER_TIME, type WriteOp } from './ops';

/** Only events people care about are logged (each is one write): not every cell edit. */
export const ACTIVITY_TYPES = [
  'create',
  'delete',
  'status',
  'people',
  'date',
  'move',
  'bulk',
  'automation',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityData {
  column?: string;
  from?: string;
  to?: string;
  group?: string;
  count?: number;
  text?: string;
}

export interface ActivityInput {
  wid: string;
  bid: string;
  id: string;
  actor: string;
  type: ActivityType;
  /** null for events about many items at once. */
  itemId: string | null;
  itemName: string;
  data?: ActivityData;
}

const clip = (s: string | undefined, n = 200) => (s === undefined ? undefined : s.slice(0, n));

export function planActivity(i: ActivityInput): WriteOp {
  const d = i.data ?? {};
  const data: Record<string, unknown> = {};
  for (const k of ['column', 'from', 'to', 'group', 'text'] as const) {
    const v = clip(d[k]);
    if (v !== undefined) data[k] = v;
  }
  if (typeof d.count === 'number') data['count'] = Math.trunc(d.count);
  return {
    kind: 'set',
    path: boardPaths.activityDoc(i.wid, i.bid, i.id),
    data: {
      type: i.type,
      itemId: i.itemId,
      itemName: i.itemName.slice(0, 200),
      actor: i.actor,
      data,
      at: SERVER_TIME,
    },
  };
}

/** Which activity type a column's change is logged as (null = not logged). */
export function activityTypeForColumn(col: Column): ActivityType | null {
  if (col.type === 'status') return 'status';
  if (col.type === 'people') return 'people';
  if (col.type === 'date' || col.type === 'timeline') return 'date';
  return null;
}

/** The activity entry for a cell change, or null if it isn't worth logging / didn't change. */
export function cellActivity(input: {
  column: Column;
  before: unknown;
  after: unknown;
  memberName: (uid: string) => string;
}): { type: ActivityType; data: ActivityData } | null {
  const type = activityTypeForColumn(input.column);
  if (!type) return null;
  const opts = { peopleName: input.memberName };
  const from = valueToText(input.column, input.before, opts);
  const to = valueToText(input.column, input.after, opts);
  if (from === to) return null;
  return { type, data: { column: input.column.title, from, to } };
}

/** One readable line: "changed Status from To do to Done". */
export function describeActivity(a: { type: string; data: ActivityData }): string {
  const d = a.data;
  const q = (s: string | undefined) => (s ? `“${s}”` : 'empty');
  switch (a.type) {
    case 'create':
      return 'created this item';
    case 'delete':
      return 'deleted this item';
    case 'move':
      return d.group ? `moved this to ${d.group}` : 'moved this item';
    case 'bulk':
      return `${d.text ?? 'changed'} on ${d.count ?? 'several'} items`;
    case 'automation':
      return d.text ?? 'ran an automation';
    default:
      return `changed ${d.column ?? 'a field'} from ${q(d.from)} to ${q(d.to)}`;
  }
}
