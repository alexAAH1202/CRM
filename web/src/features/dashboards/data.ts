import {
  aggregateSpec,
  boardPaths,
  paths,
  rowsFromItems,
  type BoardDoc,
  type DashItem,
  type ListData,
  type TimesheetRow,
  type WidgetConfig,
} from '@app/shared';
import { collection, doc, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { readAggregate, readDoc, readQuery } from '../../lib/firestore';

/**
 * Dashboard data is read once (never a live listener) and kept for a minute, shared by every
 * widget that needs it: three charts over one list cost one read of that list, not three.
 */
const FRESH_MS = 60_000;
const boardDocs = new Map<string, { at: number; value: Promise<BoardDoc | null> }>();
const lists = new Map<string, { at: number; value: Promise<ListData | null> }>();
const times = new Map<string, { at: number; value: Promise<TimesheetRow[]> }>();
const numbers = new Map<string, { at: number; value: Promise<number> }>();

const fresh = <T extends { at: number }>(hit: T | undefined, force: boolean) =>
  !force && hit && Date.now() - hit.at < FRESH_MS ? hit : undefined;

export function forgetDashboardData(wid: string) {
  for (const m of [boardDocs, lists, times, numbers])
    for (const k of m.keys()) if (k.startsWith(`${wid}:`)) m.delete(k);
}

/** A list's own document (name, columns): one read, shared. */
export function loadBoardDoc(wid: string, bid: string, force = false): Promise<BoardDoc | null> {
  const key = `${wid}:${bid}`;
  const hit = fresh(boardDocs.get(key), force);
  if (hit) return hit.value;
  const value = readDoc('dash:board', doc(db, paths.board(wid, bid))).then(
    (s) => (s.data() as BoardDoc | undefined) ?? null,
  );
  boardDocs.set(key, { at: Date.now(), value });
  value.catch(() => boardDocs.delete(key));
  return value;
}

/** A list's columns and its live items (deleted ones left out on the server). */
export function loadList(
  wid: string,
  bid: string,
  name: string,
  force = false,
): Promise<ListData | null> {
  const key = `${wid}:${bid}`;
  const hit = fresh(lists.get(key), force);
  if (hit) return hit.value;
  const value = (async (): Promise<ListData | null> => {
    const board = await loadBoardDoc(wid, bid, force);
    if (!board) return null;
    const snap = await readQuery(
      'dash:items',
      query(collection(db, boardPaths.items(wid, bid)), where('deletedAt', '==', null)),
    );
    const items: DashItem[] = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        name: String(x['name'] ?? ''),
        groupId: String(x['groupId'] ?? ''),
        order: String(x['order'] ?? ''),
        parentId: typeof x['parentId'] === 'string' ? x['parentId'] : null,
        itemNumber: typeof x['itemNumber'] === 'number' ? x['itemNumber'] : 0,
        values: (x['values'] ?? {}) as Record<string, unknown>,
        archived: x['archived'] === true,
        deleted: false,
        assigneeUids: Array.isArray(x['assigneeUids']) ? (x['assigneeUids'] as string[]) : [],
      };
    });
    return { boardId: bid, boardName: board.name || name, columns: board.columns ?? [], items };
  })();
  lists.set(key, { at: Date.now(), value });
  value.catch(() => lists.delete(key));
  return value;
}

/** Time sessions in a list: only items that have time logged (one read each). */
export function loadTime(wid: string, list: ListData, force = false): Promise<TimesheetRow[]> {
  const key = `${wid}:${list.boardId}`;
  const hit = fresh(times.get(key), force);
  if (hit) return hit.value;
  const cols = list.columns.filter((c) => c.type === 'time');
  const value = (async () => {
    const rows: TimesheetRow[] = [];
    for (const col of cols) {
      const snap = await readQuery(
        'dash:time',
        query(collection(db, boardPaths.items(wid, list.boardId)), orderBy(`values.${col.id}`)),
      );
      rows.push(
        ...rowsFromItems(
          snap.docs.map((d) => ({
            id: d.id,
            name: String(d.data()['name'] ?? ''),
            values: (d.data()['values'] ?? {}) as Record<string, unknown>,
            deleted: d.data()['deletedAt'] != null,
          })),
          list.boardId,
          [col.id],
        ),
      );
    }
    return rows;
  })();
  times.set(key, { at: Date.now(), value });
  value.catch(() => times.delete(key));
  return value;
}

/** A "numbers" widget's answer, worked out by the server. */
export function loadNumber(
  wid: string,
  bid: string,
  config: WidgetConfig,
  force = false,
): Promise<number> {
  const key = `${wid}:${bid}:${JSON.stringify(config)}`;
  const hit = fresh(numbers.get(key), force);
  if (hit) return hit.value;
  const value = (async () => {
    // The list's columns say which Status label / Numbers column the settings mean.
    const needsColumns =
      !!config.statusColumnId || (!!config.columnId && config.measure !== 'count');
    const board = needsColumns ? await loadBoardDoc(wid, bid, force) : null;
    const spec = aggregateSpec(config, board?.columns ?? []);
    const q = query(
      collection(db, boardPaths.items(wid, bid)),
      ...spec.filters.map((f) => where(f.field, '==', f.value)),
    );
    return readAggregate('dash:number', q, { measure: spec.measure, field: spec.valueField });
  })();
  numbers.set(key, { at: Date.now(), value });
  value.catch(() => numbers.delete(key));
  return value;
}
