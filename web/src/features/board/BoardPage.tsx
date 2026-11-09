import { EMPTY_VIEW_CONFIG } from '@app/shared';
import { Archive, Lock, Settings, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { FullPageSpinner } from '../../components/FullPageSpinner';
import { Button, EmptyState, Skeleton } from '../../components/ui';
import { useBoards } from '../boards/BoardsProvider';
import type { Board } from '../boards/types';
import { useBoardDoc, useBoardItems } from '../boards/useBoardData';
import { useViewConfig } from '../boards/useViewConfig';
import { useViews, type BoardView } from '../boards/useViews';
import { useWorkspace } from '../workspaces/WorkspaceProvider';
import { BoardSettingsDialog } from './BoardSettingsDialog';
import { BoardTable } from './BoardTable';
import { BoardToolbar } from './BoardToolbar';
import { CalendarView } from './CalendarView';
import { KanbanView } from './KanbanView';
import { ViewTabs } from './ViewTabs';

function BoardView({ board: b }: { board: Board }) {
  const { workspace, role } = useWorkspace();
  const { members, memberName } = useBoards();
  const items = useBoardItems(workspace.id, b.id);
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState(false);
  const canEdit = role !== 'viewer' && !b.archived;
  const { views } = useViews(workspace.id, b.id);
  const [params, setParams] = useSearchParams();
  // A board with no saved view doc yet shows an implicit "Main table".
  const list = useMemo<BoardView[]>(
    () =>
      views && views.length > 0
        ? views
        : [{ id: 'main', type: 'table', name: 'Main table', order: '', config: EMPTY_VIEW_CONFIG }],
    [views],
  );
  const active = list.find((v) => v.id === params.get('view')) ?? list[0]!;
  const view = useViewConfig(
    workspace.id,
    b.id,
    active,
    views !== null && views.some((v) => v.id === active.id),
    canEdit,
    b.columns,
  );
  const viewProps = {
    wid: workspace.id,
    board: b,
    items: items.status === 'ready' ? items.data : new Map(),
    members: members ?? [],
    canEdit,
    search,
    config: view.config,
    onConfig: view.update,
    memberName,
  };

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
          {role !== 'viewer' && (
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
        <div className="flex flex-wrap items-center gap-2">
          {views !== null && (
            <ViewTabs
              wid={workspace.id}
              bid={b.id}
              views={list}
              activeId={active.id}
              canEdit={canEdit}
              onSelect={(vid) => setParams({ view: vid }, { replace: true })}
            />
          )}
          <div className="min-w-0 flex-1">
            <BoardToolbar
              columns={b.columns}
              members={members ?? []}
              config={view.config}
              onChange={view.update}
              search={search}
              onSearch={setSearch}
              shared={view.shared}
              viewType={active.type}
            />
          </div>
        </div>
      </header>
      {items.status === 'ready' && members && views !== null ? (
        active.type === 'kanban' ? (
          <KanbanView {...viewProps} />
        ) : active.type === 'calendar' ? (
          <CalendarView {...viewProps} />
        ) : (
          <BoardTable {...viewProps} />
        )
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

export default function BoardPage() {
  const { bid = '' } = useParams();
  const { workspace } = useWorkspace();
  const board = useBoardDoc(workspace.id, bid);

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
  return <BoardView key={board.data.id} board={board.data} />;
}
