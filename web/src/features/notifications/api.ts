import { paths, planMarkRead, planRespondToAssignment, type WriteOp } from '@app/shared';
import { collection, doc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { commitOps } from '../../lib/firestore';

export function setRead(wid: string, uid: string, nid: string, read: boolean) {
  return commitOps('notification:read', planMarkRead(wid, uid, nid, read));
}

export function markAllRead(wid: string, uid: string, ids: string[]) {
  const ops: WriteOp[] = ids.slice(0, 50).flatMap((id) => planMarkRead(wid, uid, id, true));
  return ops.length ? commitOps('notification:readAll', ops) : Promise.resolve();
}

/** Saves the whole muted list (it's at most a few entries). */
export function saveMuted(uid: string, muted: string[]) {
  return commitOps('notification:mute', [
    { kind: 'update', path: paths.user(uid), data: { 'settings.mutedNotifications': muted } },
  ]);
}

/** The daily summary email (sent by the helper; off unless you switch it on). */
export function saveEmailDigest(uid: string, on: boolean) {
  return commitOps('notification:digest', [
    { kind: 'update', path: paths.user(uid), data: { 'settings.emailDigest': on } },
  ]);
}

/** Accept or decline an item you were assigned to (D99). */
export function respondToAssignment(i: {
  wid: string;
  bid: string;
  iid: string;
  uid: string;
  responderName: string;
  response: 'accepted' | 'rejected';
  assigner: string;
  itemName: string;
  nid?: string;
}) {
  return commitOps(
    `assignment:${i.response}`,
    planRespondToAssignment({
      ...i,
      newId: () => doc(collection(db, paths.notifications(i.wid, i.assigner))).id,
    }),
  );
}

/** Pulls list + item ids and the item name out of an "X assigned you to Y" notification. */
export function parseAssignment(n: { title: string; link: string; actor: string }) {
  const m = /^\/w\/[^/]+\/b\/([^/?]+)\?item=([^&]+)$/.exec(n.link);
  const at = n.title.indexOf(' assigned you to ');
  if (!m || at < 0) return null;
  return { bid: m[1]!, iid: m[2]!, itemName: n.title.slice(at + ' assigned you to '.length) };
}
