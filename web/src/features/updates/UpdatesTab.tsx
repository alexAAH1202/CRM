import { formatDistanceToNow } from 'date-fns';
import { Pencil, Reply, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Avatar, Skeleton } from '../../components/ui';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import type { WorkspaceMember } from '../boards/types';
import { addUpdate, deleteUpdate, editUpdate } from './api';
import { Composer } from './Composer';
import { RichText } from './RichText';
import { useUpdates, UPDATES_LIMIT, type UpdateDoc } from './useUpdates';

interface Props {
  wid: string;
  bid: string;
  iid: string;
  itemName: string;
  members: WorkspaceMember[];
  canEdit: boolean;
  isAdmin: boolean;
  memberName: (uid: string) => string;
}

export function UpdatesTab({
  wid,
  bid,
  iid,
  itemName,
  members,
  canEdit,
  isAdmin,
  memberName,
}: Props) {
  const user = useCurrentUser();
  const { updates, ready, error } = useUpdates(wid, bid, iid, true);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<UpdateDoc | null>(null);

  const people = useMemo(() => members.map((m) => ({ uid: m.uid, name: m.name })), [members]);
  const ctx = {
    wid,
    bid,
    iid,
    itemName,
    authorUid: user.uid,
    authorName: user.displayName ?? user.email ?? 'Someone',
    people,
  };
  const fail = (e: unknown) => toast.error(friendlyError(e));

  // Newest conversation first; replies oldest-first under their parent. A reply whose parent
  // is gone (deleted, or older than the loaded window) stands on its own.
  const { roots, replies } = useMemo(() => {
    const ids = new Set(updates.map((u) => u.id));
    const rep = new Map<string, UpdateDoc[]>();
    const top: UpdateDoc[] = [];
    for (const u of updates) {
      if (u.parentId && ids.has(u.parentId))
        rep.set(u.parentId, [...(rep.get(u.parentId) ?? []), u]);
      else top.push(u);
    }
    for (const list of rep.values()) list.sort((a, b) => a.createdAtMs - b.createdAtMs);
    return { roots: top, replies: rep };
  }, [updates]);

  const one = (u: UpdateDoc, nested: boolean) => {
    const mine = u.author === user.uid;
    return (
      <article
        key={u.id}
        aria-label={`Update by ${memberName(u.author)}`}
        className={nested ? 'flex gap-2 pt-3' : 'flex gap-3'}
      >
        <Avatar
          name={memberName(u.author)}
          photoURL={members.find((m) => m.uid === u.author)?.photoURL ?? null}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-bold">{memberName(u.author)}</span>{' '}
            <span className="text-xs text-muted">
              {formatDistanceToNow(u.createdAtMs, { addSuffix: true })}
              {u.edited && ' · edited'}
            </span>
          </p>
          {editing === u.id ? (
            <div className="mt-1">
              <Composer
                label="Edit update"
                people={people}
                submitLabel="Save"
                initial={u.body}
                autoFocus
                onCancel={() => setEditing(null)}
                onSubmit={(body) => {
                  setEditing(null);
                  return editUpdate(ctx, u.id, body, u.mentions);
                }}
              />
            </div>
          ) : (
            <div className="mt-0.5">
              <RichText body={u.body} people={people} me={user.uid} />
            </div>
          )}
          {editing !== u.id && (
            <div className="mt-1 flex gap-1 text-xs text-muted">
              {canEdit && !nested && (
                <button
                  type="button"
                  onClick={() => setReplyTo(replyTo === u.id ? null : u.id)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-surface-3 hover:text-fg"
                >
                  <Reply size={12} aria-hidden /> Reply
                </button>
              )}
              {canEdit && mine && (
                <button
                  type="button"
                  aria-label="Edit update"
                  onClick={() => setEditing(u.id)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-surface-3 hover:text-fg"
                >
                  <Pencil size={12} aria-hidden /> Edit
                </button>
              )}
              {(isAdmin || (canEdit && mine)) && (
                <button
                  type="button"
                  aria-label="Delete update"
                  onClick={() => setDeleting(u)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-surface-3 hover:text-danger"
                >
                  <Trash2 size={12} aria-hidden /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-4">
      {canEdit ? (
        <Composer
          label="Write an update"
          people={people}
          submitLabel="Update"
          onSubmit={(body) =>
            addUpdate(ctx, body, null)
              .catch(fail)
              .then(() => undefined)
          }
        />
      ) : (
        <p className="text-sm text-muted">Viewers can read updates but not write them.</p>
      )}
      {!ready ? (
        <Skeleton className="h-16 w-full" />
      ) : error ? (
        <p role="alert" className="text-sm text-danger">
          Couldn’t load updates: {error}
        </p>
      ) : roots.length === 0 ? (
        <p className="text-sm text-muted">No updates yet. Start the conversation.</p>
      ) : (
        <ol className="space-y-5">
          {roots.map((u) => (
            <li key={u.id} className="border-b border-border pb-4 last:border-0">
              {one(u, false)}
              {(replies.get(u.id) ?? []).length > 0 && (
                <ul className="mt-1 ml-6 border-l border-border pl-3">
                  {(replies.get(u.id) ?? []).map((r) => (
                    <li key={r.id}>{one(r, true)}</li>
                  ))}
                </ul>
              )}
              {replyTo === u.id && canEdit && (
                <div className="mt-3 ml-6">
                  <Composer
                    label={`Reply to ${memberName(u.author)}`}
                    people={people}
                    submitLabel="Reply"
                    autoFocus
                    onCancel={() => setReplyTo(null)}
                    onSubmit={(body) => {
                      setReplyTo(null);
                      return addUpdate(ctx, body, u.id);
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {updates.length >= UPDATES_LIMIT && (
        <p className="text-xs text-muted">Showing the newest {UPDATES_LIMIT} updates.</p>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this update?"
        body="It will be removed for everyone. Replies to it stay."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (deleting) await deleteUpdate(ctx, deleting.id).catch(fail);
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
