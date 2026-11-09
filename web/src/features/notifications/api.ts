import { paths, planMarkRead, type WriteOp } from '@app/shared';
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
