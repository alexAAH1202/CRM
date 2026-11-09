import { TEMPLATES } from '@app/shared';
import { LayoutGrid, Lock, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Skeleton } from '../components/ui';
import { useBoards } from '../features/boards/BoardsProvider';
import { CreateBoardDialog } from '../features/boards/CreateBoardDialog';
import { useWorkspace } from '../features/workspaces/WorkspaceProvider';

export default function WorkspaceHomePage() {
  const { workspace, role } = useWorkspace();
  const { boards } = useBoards();
  const [creating, setCreating] = useState(false);
  const canCreate = role !== 'viewer';

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{workspace.name}</h1>
        <div className="flex gap-2">
          {role === 'admin' && (
            <Link
              to={`/w/${workspace.id}/members`}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2"
            >
              <Users size={16} aria-hidden /> Invite people
            </Link>
          )}
          {canCreate && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden /> New list
            </Button>
          )}
        </div>
      </header>

      {boards === null ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : boards.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid size={28} />}
          title="Create your first list"
          body={
            <>
              Start from a template like{' '}
              {TEMPLATES.slice(0, 3)
                .map((t) => `${t.emoji} ${t.name}`)
                .join(', ')}{' '}
              — or a blank board.
            </>
          }
          action={
            canCreate ? (
              <Button onClick={() => setCreating(true)}>Choose a template</Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((b) => (
            <li key={b.id}>
              <Link
                to={`/w/${workspace.id}/b/${b.id}`}
                className="flex h-24 flex-col justify-between rounded-3xl bg-surface p-4 shadow-sm transition-shadow hover:shadow-pop"
              >
                <span className="flex items-center gap-2 font-bold">
                  <LayoutGrid size={18} aria-hidden className="text-primary" />
                  <span className="truncate">{b.name}</span>
                </span>
                <span className="flex items-center gap-1 text-xs text-muted">
                  {b.visibility === 'private' ? (
                    <>
                      <Lock size={12} aria-hidden /> Private
                    </>
                  ) : (
                    'Everyone'
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CreateBoardDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
