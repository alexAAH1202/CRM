import {
  boardPaths,
  dueDateOf,
  groupMyWork,
  isDone,
  paths,
  todayIso,
  type BoardDoc,
  type MyWorkEntry,
} from '@app/shared';
import { format, parseISO } from 'date-fns';
import { collection, doc, query, where } from 'firebase/firestore';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Skeleton } from '../../components/ui';
import { cx } from '../../lib/cx';
import { db } from '../../lib/firebase';
import { readDoc, readQuery } from '../../lib/firestore';
import { useCurrentUser } from '../auth/AuthProvider';
import { useBoards } from '../boards/BoardsProvider';
import { useWorkspace } from '../workspaces/WorkspaceProvider';

/** One read per matching item, plus one per board; so we don't refetch on every visit. */
const FRESH_MS = 60_000;
const cache = new Map<string, { at: number; entries: MyWorkEntry[]; failed: string[] }>();

export default function MyWorkPage() {
  const user = useCurrentUser();
  const { workspace } = useWorkspace();
  const { boards } = useBoards();
  const [state, setState] = useState<{ entries: MyWorkEntry[]; failed: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const run = useRef(0);
  const key = `${workspace.id}:${user.uid}`;

  const load = useCallback(
    async (force: boolean) => {
      if (!boards) return;
      const hit = cache.get(key);
      if (!force && hit && Date.now() - hit.at < FRESH_MS) {
        setState(hit);
        return;
      }
      const my = ++run.current;
      setLoading(true);
      const entries: MyWorkEntry[] = [];
      const failed: string[] = [];
      await Promise.all(
        boards.map(async (b) => {
          try {
            const snap = await readQuery(
              'mywork:items',
              query(
                collection(db, boardPaths.items(workspace.id, b.id)),
                where('assigneeUids', 'array-contains', user.uid),
              ),
            );
            const live = snap.docs.filter(
              (d) => d.data()['deletedAt'] == null && d.data()['archived'] !== true,
            );
            if (live.length === 0) return;
            // The board's columns say which date is "due" and what "done" means.
            const board = (
              await readDoc('mywork:board', doc(db, paths.board(workspace.id, b.id)))
            ).data() as BoardDoc | undefined;
            const columns = board?.columns ?? [];
            for (const d of live) {
              const x = d.data();
              const values = (x['values'] ?? {}) as Record<string, unknown>;
              entries.push({
                key: `${b.id}:${d.id}`,
                bid: b.id,
                boardName: b.name,
                iid: d.id,
                name: String(x['name'] ?? ''),
                due: dueDateOf(columns, values),
                done: isDone(columns, values),
              });
            }
          } catch {
            failed.push(b.name);
          }
        }),
      );
      if (my !== run.current) return;
      const next = { at: Date.now(), entries, failed };
      cache.set(key, next);
      setState(next);
      setLoading(false);
    },
    [boards, key, workspace.id, user.uid],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const today = todayIso();
  const groups = state ? groupMyWork(state.entries, today, showDone) : [];
  const doneCount = state ? state.entries.filter((e) => e.done).length : 0;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-extrabold">My work</h1>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="h-4 w-4 accent-[var(--c-primary)]"
          />
          Show done{doneCount ? ` (${doneCount})` : ''}
        </label>
        <Button variant="secondary" size="sm" disabled={loading} onClick={() => void load(true)}>
          <RefreshCw size={14} aria-hidden className={cx(loading && 'animate-spin')} /> Refresh
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted">
        Everything assigned to you across your boards, by due date. Updated when you open this page,
        or press Refresh.
      </p>
      {state === null ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nothing assigned to you"
          body="When someone puts you on an item (or you put yourself on one), it shows up here."
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.bucket} aria-label={g.label}>
              <h2
                className={cx(
                  'mb-1 text-sm font-bold',
                  g.bucket === 'overdue' ? 'text-danger' : 'text-muted',
                )}
              >
                {g.label} <span className="font-normal">({g.entries.length})</span>
              </h2>
              <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
                {g.entries.map((e) => (
                  <li key={e.key}>
                    <Link
                      to={`/w/${workspace.id}/b/${e.bid}?item=${e.iid}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"
                    >
                      <span
                        className={cx(
                          'min-w-0 flex-1 truncate text-sm font-semibold',
                          e.done && 'line-through opacity-60',
                        )}
                      >
                        {e.name || 'Untitled'}
                      </span>
                      <span className="hidden truncate text-xs text-muted sm:block">
                        {e.boardName}
                      </span>
                      {e.due && (
                        <span className="shrink-0 text-xs text-muted">
                          {format(parseISO(e.due), 'd MMM')}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {state && state.failed.length > 0 && (
        <p role="status" className="mt-4 text-sm text-muted">
          Couldn’t check: {state.failed.join(', ')}.
        </p>
      )}
    </div>
  );
}
