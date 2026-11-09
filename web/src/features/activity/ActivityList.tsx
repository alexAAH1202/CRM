import { describeActivity } from '@app/shared';
import { formatDistanceToNow } from 'date-fns';
import { Skeleton } from '../../components/ui';
import { useActivity } from './useActivity';

/** Item activity (itemId set) or the board's recent activity (itemId null). */
export function ActivityList({
  wid,
  bid,
  itemId,
  memberName,
  onOpenItem,
}: {
  wid: string;
  bid: string;
  itemId: string | null;
  memberName: (uid: string) => string;
  onOpenItem?: (id: string) => void;
}) {
  const { entries, ready, error } = useActivity(wid, bid, itemId, true);
  if (!ready) return <Skeleton className="h-16 w-full" />;
  if (error)
    return (
      <p role="alert" className="text-sm text-danger">
        Couldn’t load activity: {error}
      </p>
    );
  if (entries.length === 0)
    return (
      <p className="text-sm text-muted">
        Nothing yet. Status, people and date changes, moves, new items and deletions show up here.
      </p>
    );
  return (
    <ol className="space-y-3" aria-label="Activity">
      {entries.map((e) => (
        <li key={e.id} className="text-sm">
          <span className="font-bold">{memberName(e.actor)}</span>{' '}
          {itemId === null && e.itemId && e.itemName ? (
            onOpenItem ? (
              <button
                type="button"
                onClick={() => onOpenItem(e.itemId as string)}
                className="font-semibold text-primary underline underline-offset-2"
              >
                {e.itemName}
              </button>
            ) : (
              <span className="font-semibold">{e.itemName}</span>
            )
          ) : null}{' '}
          {describeActivity(e)}
          <span className="block text-xs text-muted">
            {formatDistanceToNow(e.atMs, { addSuffix: true })}
          </span>
        </li>
      ))}
    </ol>
  );
}
