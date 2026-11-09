import {
  parseDashboard,
  paths,
  planCreateDashboard,
  planDeleteDashboard,
  planUpdateDashboard,
  type DashboardDoc,
  type DashboardVisibility,
} from '@app/shared';
import { collection, doc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { commitOps, readDoc, readQuery } from '../../lib/firestore';

export interface Dashboard extends DashboardDoc {
  id: string;
  createdBy: string;
}

const col = (wid: string) => `${paths.workspace(wid)}/dashboards`;

const toDashboard = (id: string, d: Record<string, unknown>): Dashboard => ({
  id,
  ...parseDashboard(d),
  createdBy: typeof d['createdBy'] === 'string' ? d['createdBy'] : '',
});

/** The dashboards you're allowed to see (the rules filter the rest out). One read each. */
export async function listDashboards(wid: string): Promise<Dashboard[]> {
  const snap = await readQuery('dashboards:list', collection(db, col(wid)));
  return snap.docs
    .map((d) => toDashboard(d.id, d.data()))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function getDashboard(wid: string, did: string): Promise<Dashboard | null> {
  const snap = await readDoc('dashboards:get', doc(db, col(wid), did));
  return snap.exists() ? toDashboard(snap.id, snap.data()) : null;
}

export async function createDashboard(input: {
  wid: string;
  uid: string;
  name: string;
  boardIds: string[];
  visibility: DashboardVisibility;
  memberIds?: string[];
}): Promise<string> {
  const did = doc(collection(db, col(input.wid))).id;
  await commitOps('dashboard:create', planCreateDashboard({ ...input, did }));
  return did;
}

export function saveDashboard(
  wid: string,
  did: string,
  patch: Parameters<typeof planUpdateDashboard>[2],
  lists: readonly string[],
) {
  return commitOps('dashboard:save', planUpdateDashboard(wid, did, patch, lists));
}

export const deleteDashboard = (wid: string, did: string) =>
  commitOps('dashboard:delete', planDeleteDashboard(wid, did));
