import { boardPaths, paths, toCandidate, type BoardDoc, type FocusCandidate } from '@app/shared';
import { collection, doc, query, where, type DocumentData } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { commitOps, readDoc, readQuery } from '../../lib/firestore';
import type { Board, BoardItem, BoardSummary } from '../boards/types';

export interface FocusData {
  candidates: FocusCandidate[];
  /** For acting on a candidate (marking done, adding steps). */
  lookup: Map<string, { board: Board; item: BoardItem }>;
  failed: string[];
}

export function toBoardItem(id: string, x: DocumentData): BoardItem {
  return {
    id,
    name: String(x['name'] ?? ''),
    groupId: String(x['groupId'] ?? ''),
    order: String(x['order'] ?? ''),
    parentId: typeof x['parentId'] === 'string' ? x['parentId'] : null,
    itemNumber: typeof x['itemNumber'] === 'number' ? x['itemNumber'] : 0,
    values: (x['values'] ?? {}) as Record<string, unknown>,
    assigneeUids: Array.isArray(x['assigneeUids']) ? (x['assigneeUids'] as string[]) : [],
    archived: x['archived'] === true,
    deleted: x['deletedAt'] != null,
    deletedAtMs: null,
    createdBy: String(x['createdBy'] ?? ''),
    createdAtMs: null,
    updatedAtMs: null,
  };
}

/**
 * Things for you to do: only items assigned to you. One read of each list per visit, kept for a
 * minute.
 */
const cache = new Map<string, { at: number; data: FocusData }>();
export async function loadFocus(
  wid: string,
  uid: string,
  boards: readonly BoardSummary[],
  force = false,
): Promise<FocusData> {
  const key = `${wid}:${uid}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < 60_000) return hit.data;
  const data: FocusData = { candidates: [], lookup: new Map(), failed: [] };
  await Promise.all(
    boards.map(async (b) => {
      try {
        const bd = (await readDoc('focus:board', doc(db, paths.board(wid, b.id)))).data() as
          BoardDoc | undefined;
        if (!bd) return;
        const board: Board = { ...bd, id: b.id };
        const snap = await readQuery(
          'focus:items',
          query(collection(db, boardPaths.items(wid, b.id)), where('deletedAt', '==', null)),
        );
        for (const d of snap.docs) {
          const item = toBoardItem(d.id, d.data());
          if (item.deleted || item.archived || item.parentId) continue;
          // only what's assigned to you
          if (!item.assigneeUids.includes(uid)) continue;
          const c = toCandidate(b.id, item, board.columns);
          data.candidates.push(c);
          data.lookup.set(c.key, { board, item });
        }
      } catch {
        data.failed.push(b.name);
      }
    }),
  );
  cache.set(key, { at: Date.now(), data });
  return data;
}
export const forgetFocus = () => cache.clear();

/** The item's subitems, in order (its "steps"). */
export async function loadSteps(wid: string, bid: string, iid: string): Promise<BoardItem[]> {
  const snap = await readQuery(
    'focus:steps',
    query(collection(db, boardPaths.items(wid, bid)), where('parentId', '==', iid)),
  );
  return snap.docs
    .map((d) => toBoardItem(d.id, d.data()))
    .filter((i) => !i.deleted && !i.archived)
    .sort((a, b) => a.order.localeCompare(b.order));
}

export function saveTodayPlan(uid: string, date: string, picks: string[]) {
  return commitOps('focus:plan', [
    {
      kind: 'update',
      path: paths.user(uid),
      data: { 'settings.todayPlan': { date, picks: picks.slice(0, 3) } },
    },
  ]);
}
