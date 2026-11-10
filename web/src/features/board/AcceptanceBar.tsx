import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import type { BoardItem } from '../boards/types';
import { respondToAssignment } from '../notifications/api';

const LABEL = {
  pending: 'waiting acceptance',
  accepted: 'accepted',
  rejected: 'declined',
} as const;

/**
 * Who has accepted this item (D99). The current user, if waiting, gets Accept / Reject buttons.
 */
export function AcceptanceBar(p: {
  wid: string;
  bid: string;
  item: BoardItem;
  memberName: (uid: string) => string;
}) {
  const user = useCurrentUser();
  const entries = p.item.assigneeUids
    .map((u) => [u, p.item.acceptance?.[u]] as const)
    .filter((e): e is readonly [string, NonNullable<(typeof e)[1]>] => !!e[1]);
  if (entries.length === 0) return null;
  const mine = p.item.acceptance?.[user.uid];
  const respond = (response: 'accepted' | 'rejected') =>
    void respondToAssignment({
      wid: p.wid,
      bid: p.bid,
      iid: p.item.id,
      uid: user.uid,
      responderName: user.displayName ?? user.email ?? 'Someone',
      response,
      assigner: mine?.by ?? '',
      itemName: p.item.name,
    }).catch((e: unknown) => toast.error(friendlyError(e)));
  return (
    <section aria-label="Acceptance" className="mb-4 space-y-2">
      {mine?.state === 'pending' && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm"
        >
          <span className="flex-1 font-semibold">
            {p.memberName(mine.by)} assigned this to you. Waiting for your acceptance.
          </span>
          <button
            type="button"
            onClick={() => respond('accepted')}
            className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-on-primary"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => respond('rejected')}
            className="rounded-lg px-3 py-1 text-xs font-semibold text-danger hover:bg-surface-3"
          >
            Reject
          </button>
        </div>
      )}
      <ul className="flex flex-wrap gap-1.5 text-xs">
        {entries.map(([u, a]) => (
          <li
            key={u}
            className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5"
            data-state={a.state}
          >
            {a.state === 'accepted' ? (
              <CheckCircle2 size={12} aria-hidden className="text-primary" />
            ) : a.state === 'rejected' ? (
              <XCircle size={12} aria-hidden className="text-danger" />
            ) : (
              <CircleDashed size={12} aria-hidden className="text-muted" />
            )}
            {p.memberName(u)}: {LABEL[a.state]}
          </li>
        ))}
      </ul>
    </section>
  );
}
