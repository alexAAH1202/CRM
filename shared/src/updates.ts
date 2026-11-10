import { SERVER_TIME, type WriteOp } from './ops';
import { paths } from './paths';
import { boardPaths } from './boardOps';
import { MAX_UPDATE_LENGTH, plainText } from './richText';

export const NOTIFICATION_TYPES = [
  'mention',
  'assignment',
  'automation',
  'due',
  'invite',
  'system',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
/** Types a person can mute (their own inbox only). */
export const MUTABLE_NOTIFICATION_TYPES: readonly NotificationType[] = [
  'mention',
  'assignment',
  'due',
];

export function itemLink(wid: string, bid: string, iid: string): string {
  return `/w/${wid}/b/${bid}?item=${iid}`;
}

interface NotifyInput {
  wid: string;
  recipient: string;
  nid: string;
  actor: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
}

export function notificationOp(n: NotifyInput): WriteOp {
  return {
    kind: 'set',
    path: paths.notification(n.wid, n.recipient, n.nid),
    data: {
      type: n.type,
      title: n.title.slice(0, 200),
      body: n.body.slice(0, 1000),
      link: n.link.slice(0, 500),
      actor: n.actor,
      read: false,
      createdAt: SERVER_TIME,
    },
  };
}

export interface AddUpdateInput {
  wid: string;
  bid: string;
  iid: string;
  /** The new update's document id. */
  uid: string;
  author: string;
  authorName: string;
  body: string;
  /** Already filtered to people actually named in the body. */
  mentions: readonly string[];
  parentId: string | null;
  itemName: string;
  newId: () => string;
}

/** A comment plus one notification per mentioned person (not the author), in one batch. */
export function planAddUpdate(i: AddUpdateInput): WriteOp[] {
  const body = i.body.trim().slice(0, MAX_UPDATE_LENGTH);
  const mentions = [...new Set(i.mentions)].slice(0, 20);
  const ops: WriteOp[] = [
    {
      kind: 'set',
      path: paths.update(i.wid, i.bid, i.iid, i.uid),
      data: {
        author: i.author,
        body,
        mentions,
        parentId: i.parentId,
        createdAt: SERVER_TIME,
        editedAt: null,
      },
    },
  ];
  for (const r of mentions) {
    if (r === i.author) continue;
    ops.push(
      notificationOp({
        wid: i.wid,
        recipient: r,
        nid: i.newId(),
        actor: i.author,
        type: 'mention',
        title: `${i.authorName} mentioned you`,
        body: `${i.itemName}: ${plainText(body, 140)}`,
        link: itemLink(i.wid, i.bid, i.iid),
      }),
    );
  }
  return ops;
}

/** Editing your own comment. New mentions are notified; people already notified are not. */
export function planEditUpdate(
  i: Omit<AddUpdateInput, 'parentId' | 'newId'> & {
    previousMentions: readonly string[];
    newId: () => string;
  },
): WriteOp[] {
  const body = i.body.trim().slice(0, MAX_UPDATE_LENGTH);
  const mentions = [...new Set(i.mentions)].slice(0, 20);
  const ops: WriteOp[] = [
    {
      kind: 'update',
      path: paths.update(i.wid, i.bid, i.iid, i.uid),
      data: { body, mentions, editedAt: SERVER_TIME },
    },
  ];
  const before = new Set(i.previousMentions);
  for (const r of mentions) {
    if (r === i.author || before.has(r)) continue;
    ops.push(
      notificationOp({
        wid: i.wid,
        recipient: r,
        nid: i.newId(),
        actor: i.author,
        type: 'mention',
        title: `${i.authorName} mentioned you`,
        body: `${i.itemName}: ${plainText(body, 140)}`,
        link: itemLink(i.wid, i.bid, i.iid),
      }),
    );
  }
  return ops;
}

export function planDeleteUpdate(wid: string, bid: string, iid: string, uid: string): WriteOp[] {
  return [{ kind: 'delete', path: paths.update(wid, bid, iid, uid) }];
}

/** "You were assigned" notifications for people newly added to an item. */
export function planAssignmentNotifications(i: {
  wid: string;
  bid: string;
  iid: string;
  actor: string;
  actorName: string;
  itemName: string;
  boardName: string;
  before: readonly string[];
  after: readonly string[];
  newId: () => string;
}): WriteOp[] {
  const had = new Set(i.before);
  return [...new Set(i.after)]
    .filter((u) => !had.has(u) && u !== i.actor)
    .slice(0, 20)
    .map((r) =>
      notificationOp({
        wid: i.wid,
        recipient: r,
        nid: i.newId(),
        actor: i.actor,
        type: 'assignment',
        title: `${i.actorName} assigned you to ${i.itemName}`,
        body: i.boardName,
        link: itemLink(i.wid, i.bid, i.iid),
      }),
    );
}

export function planMarkRead(wid: string, uid: string, nid: string, read: boolean): WriteOp[] {
  return [{ kind: 'update', path: paths.notification(wid, uid, nid), data: { read } }];
}

/**
 * An assignee accepts or declines an item: records it on the item, marks the assignment
 * notification read, and tells whoever assigned them.
 */
export function planRespondToAssignment(i: {
  wid: string;
  bid: string;
  iid: string;
  uid: string;
  responderName: string;
  response: 'accepted' | 'rejected';
  assigner: string;
  itemName: string;
  nid?: string;
  newId: () => string;
}): WriteOp[] {
  const ops: WriteOp[] = [
    {
      kind: 'update',
      path: boardPaths.item(i.wid, i.bid, i.iid),
      data: {
        [`acceptance.${i.uid}`]: { state: i.response, by: i.assigner },
        updatedBy: i.uid,
        updatedAt: SERVER_TIME,
      },
    },
  ];
  if (i.nid) ops.push(...planMarkRead(i.wid, i.uid, i.nid, true));
  if (i.assigner && i.assigner !== i.uid)
    ops.push(
      notificationOp({
        wid: i.wid,
        recipient: i.assigner,
        nid: i.newId(),
        actor: i.uid,
        type: 'assignment',
        title: `${i.responderName} ${i.response === 'accepted' ? 'accepted' : 'declined'} “${i.itemName}”`,
        body: '',
        link: itemLink(i.wid, i.bid, i.iid),
      }),
    );
  return ops;
}
