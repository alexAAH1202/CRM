import { Archive, Lock, Search, Settings, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FullPageSpinner } from '../../components/FullPageSpinner';
import { Button, EmptyState, Skeleton } from '../../components/ui';
import { useBoards } from '../boards/BoardsProvider';
import { useBoardDoc, useBoardItems } from '../boards/useBoardData';
import { useWorkspace } from '../workspaces/WorkspaceProvider';
import { BoardSettingsDialog } from './BoardSettingsDialog';
import { BoardTable } from './BoardTable';

export default function BoardPage() {
  const { bid = '' } = useParams();
  const { workspace, role } = useWorkspace();
  const { members, memberName } = useBoards();
  const board = useBoardDoc(workspace.id, bid);
  const items = useBoardItems(workspace.id, bid);
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState(false);

  if (board.status === 'loading') return <FullPageSpinner label="Opening board" />;
  if (board.status !== 'ready') {
    return (
      <EmptyState
        icon={<ShieldAlert size={28} />}
        title={board.status === 'missing' ? 'Board not found' : 'Could not open this board'}
        body={
          board.status === 'error' ? board.message : "It may have been deleted, or it's private."
        }
        action={
          <Link
            to={`/w/${workspace.id}`}
            className="font-semibold text-primary underline underline-offset-2"
          >
            Back to home
          </Link>
        }
      />
    );
  }
  const b = board.data;
  const canEdit = role !== 'viewer';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-3 border-b border-border bg-surface px-4 pt-4 pb-3 sm:px-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 truncate text-2xl font-extrabold">
              {b.name}
              {b.visibility === 'private' && (
                <Lock size={18} aria-label="Private board" className="text-muted" />
              )}
              {b.archived && (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-xs font-semibold text-muted">
                  <Archive size={12} aria-hidden /> Archived
                </span>
              )}
            </h1>
            {b.description && (
              <p className="mt-1 line-clamp-2 text-sm text-muted">{b.description}</p>
            )}
          </div>
          {canEdit && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSettings(true)}
              aria-label="Board settings"
            >
              <Settings size={14} aria-hidden />{' '}
              <span className="hidden sm:inline">Board settings</span>
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-primary">
            Main table
          </span>
          <label className="ml-auto flex h-9 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm focus-within:border-primary">
            <Search size={14} aria-hidden className="text-muted" />
            <span className="sr-only">Search items</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-36 bg-transparent outline-none sm:w-56"
            />
          </label>
        </div>
      </header>
      {items.status === 'ready' && members ? (
        <BoardTable
          wid={workspace.id}
          board={b}
          items={items.data}
          members={members}
          canEdit={canEdit && !b.archived}
          search={search}
          memberName={memberName}
        />
      ) : items.status === 'error' ? (
        <EmptyState title="Could not load items" body={items.message} />
      ) : (
        <div className="space-y-2 p-6" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full max-w-4xl" />
          ))}
        </div>
      )}
      {settings && <BoardSettingsDialog board={b} open onClose={() => setSettings(false)} />}
    </div>
  );
}
