import { formatDistanceToNow } from 'date-fns';
import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { Button, SidePanel } from '../../components/ui';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { restoreItems } from '../boards/api';
import type { Board, BoardItem } from '../boards/types';

/** Deleted items stay recoverable for this long (the helper purges them after, in Phase 7). */
export const TRASH_DAYS = 30;

/**
 * "Recently deleted": every deleted item already sits in the board's loaded data (deletes are
 * tombstones), so this costs no reads. Restoring brings back an item together with the
 * subitems that were deleted with it.
 */
export function TrashPanel({
  wid,
  board,
  items,
  canEdit,
  onClose,
}: {
  wid: string;
  board: Board;
  items: ReadonlyMap<string, BoardItem>;
  canEdit: boolean;
  onClose: () => void;
}) {
  const user = useCurrentUser();
  const rows = useMemo(() => {
    const cutoff = Date.now() - TRASH_DAYS * 24 * 3600 * 1000;
    const all = [...items.values()].filter(
      (i) => i.deleted && (i.deletedAtMs ?? Date.now()) >= cutoff,
    );
    const gone = new Set(all.map((i) => i.id));
    const kids = new Map<string, BoardItem[]>();
    for (const i of all)
      if (i.parentId && gone.has(i.parentId))
        kids.set(i.parentId, [...(kids.get(i.parentId) ?? []), i]);
    return all
      .filter((i) => !(i.parentId && gone.has(i.parentId))) // restored along with their parent
      .map((i) => ({
        item: i,
        children: kids.get(i.id) ?? [],
        parent: i.parentId ? items.get(i.parentId) : undefined,
      }))
      .sort((a, b) => (b.item.deletedAtMs ?? 0) - (a.item.deletedAtMs ?? 0));
  }, [items]);

  const restore = (ids: string[], name: string) =>
    restoreItems(wid, board.id, user.uid, ids)
      .then(() => toast.success(`Restored “${name || 'Untitled'}”`))
      .catch((e: unknown) => toast.error(friendlyError(e)));

  return (
    <SidePanel open onClose={onClose} title="Recently deleted">
      <p className="mb-4 text-sm text-muted">
        Items you delete wait here for {TRASH_DAYS} days before they are removed for good.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing has been deleted recently.</p>
      ) : (
        <ul
          className="divide-y divide-border rounded-2xl border border-border"
          aria-label="Deleted items"
        >
          {rows.map(({ item, children, parent }) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{item.name || 'Untitled'}</p>
                <p className="text-xs text-muted">
                  {item.deletedAtMs
                    ? `Deleted ${formatDistanceToNow(item.deletedAtMs, { addSuffix: true })}`
                    : 'Deleted'}
                  {children.length > 0 &&
                    ` · with ${children.length} subitem${children.length === 1 ? '' : 's'}`}
                  {parent && !parent.deleted && ` · subitem of ${parent.name || 'Untitled'}`}
                </p>
              </div>
              {canEdit && (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Restore ${item.name || 'Untitled'}`}
                  onClick={() => void restore([item.id, ...children.map((c) => c.id)], item.name)}
                >
                  <RotateCcw size={14} aria-hidden /> Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SidePanel>
  );
}
