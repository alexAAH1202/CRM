import {
  automationData,
  boardPaths,
  MAX_AUTOMATIONS,
  SERVER_TIME,
  type Automation,
} from '@app/shared';
import { collection, doc, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { commitOps, readCount, readQuery } from '../../lib/firestore';

export type AutomationDraft = Omit<Automation, 'id'>;
export const AUTOMATION_LIMIT = MAX_AUTOMATIONS;

export function createAutomation(
  wid: string,
  bid: string,
  draft: AutomationDraft,
): Promise<string> {
  const id = doc(collection(db, boardPaths.automations(wid, bid))).id;
  return commitOps('automation:create', [
    {
      kind: 'set',
      path: boardPaths.automation(wid, bid, id),
      data: { ...automationData(draft), createdAt: SERVER_TIME, updatedAt: SERVER_TIME },
    },
  ]).then(() => id);
}

/** Saves edits (the owner stays the same). */
export function updateAutomation(wid: string, bid: string, id: string, draft: AutomationDraft) {
  const { ownerUid: _owner, ...rest } = automationData(draft) as Record<string, unknown> & {
    ownerUid: string;
  };
  void _owner;
  return commitOps('automation:update', [
    {
      kind: 'update',
      path: boardPaths.automation(wid, bid, id),
      data: { ...rest, updatedAt: SERVER_TIME },
    },
  ]);
}

export function setAutomationEnabled(wid: string, bid: string, a: Automation, enabled: boolean) {
  return updateAutomation(wid, bid, a.id, { ...a, enabled });
}

export function deleteAutomation(wid: string, bid: string, id: string) {
  return commitOps('automation:delete', [
    { kind: 'delete', path: boardPaths.automation(wid, bid, id) },
  ]);
}

/** Keeps run history to the newest 50 by deleting the rest (editors may; see the rules). */
export function pruneRuns(wid: string, bid: string, ids: string[]) {
  return ids.length
    ? commitOps(
        'automation:prune',
        ids
          .slice(0, 100)
          .map((id) => ({ kind: 'delete' as const, path: `${boardPaths.runs(wid, bid)}/${id}` })),
      )
    : Promise.resolve();
}

export const RUNS_KEPT = 50;
const trimmed = new Set<string>();

/**
 * Keeps the run history to the newest 50. Done once per board per session when an editor
 * opens it: one count (1 read), and only if there are too many, a read of just the surplus
 * (oldest first) which is then deleted. So history can't grow without anyone looking at it.
 */
export async function trimRunHistory(wid: string, bid: string): Promise<void> {
  const key = `${wid}/${bid}`;
  if (trimmed.has(key)) return;
  trimmed.add(key);
  const col = collection(db, boardPaths.runs(wid, bid));
  const n = await readCount('automationRuns:count', query(col));
  if (n <= RUNS_KEPT + 10) return; // leave a little slack so this isn't constant churn
  const surplus = await readQuery(
    'automationRuns:trim',
    query(col, orderBy('at', 'asc'), limit(Math.min(n - RUNS_KEPT, 200))),
  );
  await pruneRuns(
    wid,
    bid,
    surplus.docs.map((d) => d.id),
  );
}
