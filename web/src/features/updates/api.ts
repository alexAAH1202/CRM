import {
  mentionsIn,
  paths,
  planAddUpdate,
  planDeleteUpdate,
  planEditUpdate,
  type Person,
} from '@app/shared';
import { collection, doc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { commitOps } from '../../lib/firestore';

const newId = (path: string) => doc(collection(db, path)).id;

interface Ctx {
  wid: string;
  bid: string;
  iid: string;
  itemName: string;
  authorUid: string;
  authorName: string;
  people: readonly Person[];
}

export function addUpdate(c: Ctx, body: string, parentId: string | null) {
  const updates = paths.updates(c.wid, c.bid, c.iid);
  return commitOps(
    'update:add',
    planAddUpdate({
      wid: c.wid,
      bid: c.bid,
      iid: c.iid,
      uid: newId(updates),
      author: c.authorUid,
      authorName: c.authorName,
      body,
      mentions: mentionsIn(body, c.people),
      parentId,
      itemName: c.itemName,
      newId: () => newId(updates),
    }),
  );
}

export function editUpdate(c: Ctx, id: string, body: string, previousMentions: readonly string[]) {
  return commitOps(
    'update:edit',
    planEditUpdate({
      wid: c.wid,
      bid: c.bid,
      iid: c.iid,
      uid: id,
      author: c.authorUid,
      authorName: c.authorName,
      body,
      mentions: mentionsIn(body, c.people),
      previousMentions,
      itemName: c.itemName,
      newId: () => newId(paths.updates(c.wid, c.bid, c.iid)),
    }),
  );
}

export function deleteUpdate(c: Pick<Ctx, 'wid' | 'bid' | 'iid'>, id: string) {
  return commitOps('update:delete', planDeleteUpdate(c.wid, c.bid, c.iid, id));
}
