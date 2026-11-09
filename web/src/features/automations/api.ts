import {
  automationData,
  boardPaths,
  MAX_AUTOMATIONS,
  SERVER_TIME,
  type Automation,
} from '@app/shared';
import { collection, doc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { commitOps } from '../../lib/firestore';

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
