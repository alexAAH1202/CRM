import { DEFAULT_TIMEZONE, EMPTY_VIEW_CONFIG } from '@app/shared';
import {
  Activity,
  Archive,
  Download,
  FileUp,
  Redo2,
  Undo2,
  Lock,
  Settings,
  ShieldAlert,
  Trash2,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { FullPageSpinner } from '../../components/FullPageSpinner';
import { Button, EmptyState, SidePanel, Skeleton } from '../../components/ui';
import { useCurrentUser } from '../auth/AuthProvider';
import { useBoards } from '../boards/BoardsProvider';
import type { Board } from '../boards/types';
import { useBoardDoc, useBoardItems } from '../boards/useBoardData';
import { useViewConfig } from '../boards/useViewConfig';
import { useViews, type BoardView } from '../boards/useViews';
import { useWorkspace } from '../workspaces/WorkspaceProvider';
import { trimRunHistory } from '../automations/api';
import { AutomationsPanel } from '../automations/AutomationsPanel';
import { useAutomations, useBoardAutomationsRegistration } from '../automations/useAutomations';
import { ActivityList } from '../activity/ActivityList';
import { BoardSettingsDialog } from './BoardSettingsDialog';
import { BoardTable } from './BoardTable';
import { BoardToolbar } from './BoardToolbar';
import { CalendarView } from './CalendarView';
import { ChartView } from './ChartView';
import { GanttView } from './GanttView';
import { WorkloadView } from './WorkloadView';
import { KanbanView } from './KanbanView';
import { downloadBoardCsv } from './exportCsv';
import { redoLast, undoLast, useUndoState } from '../boards/undoStack';
import { ImportDialog } from './ImportDialog';
import { ItemPanel } from './ItemPanel';
import { TrashPanel } from './TrashPanel';
import { ViewTabs } from './ViewTabs';

function BoardView({ board: b }: { board: Board }) {
  const { workspace, role } = useWorkspace();
  const { members, memberName } = useBoards();
  const items = useBoardItems(workspace.id, b.id);
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState(false);
  const [activity, setActivity] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const history = useUndoState(b.id);

  // Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes: but never while typing (the field has
  // its own undo) and never with a dialog open.
  useEffect(() => {
    if (role === 'viewer' || b.archived) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const redo = (k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey);
      const undo = k === 'z' && !e.shiftKey;
      if (!redo && !undo) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.closest('input, textarea, select, [contenteditable="true"]') ||
          t.closest('dialog[open]'))
      )
        return;
      e.preventDefault();
      void (redo ? redoLast(b.id) : undoLast(b.id));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [b.id, b.archived, role]);
  const user = useCurrentUser();
  const automations = useAutomations(workspace.id, b.id);
  useBoardAutomationsRegistration({
    wid: workspace.id,
    board: b,
    automations: automations.automations,
    items: items.status === 'ready' ? items.data : null,
    members,
    memberName,
    tz: workspace.settings?.timezone ?? DEFAULT_TIMEZONE,
  });
  const canEdit = role !== 'viewer' && !b.archived;
  useEffect(() => {
    if (canEdit) void trimRunHistory(workspace.id, b.id).catch(() => undefined);
  }, [canEdit, workspace.id, b.id]);
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
    onOpenItem: (id: string) =>
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.set('item', id);
          return n;
        },
        { replace: false },
      ),
  };
  const itemId = params.get('item');
  const closeItem = () =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('item');
        return n;
      },
      { replace: true },
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-3 border-b border-border bg-surface px-4 pt-4 pb-3 sm:px-6">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
            <h1 className="flex items-center gap-2 truncate text-xl font-extrabold sm:text-2xl">
              {b.name}
              {b.visibility === 'private' && (
                <Lock size={18} aria-label="Private list" className="text-muted" />
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
          {/* On a phone the actions are one swipeable row under the title; from sm up they sit beside it. */}
          <div className="-mx-4 flex w-[calc(100%+2rem)] flex-nowrap gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:contents [&::-webkit-scrollbar]:hidden">
            {role !== 'viewer' && !b.archived && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!history.undoLabel || history.busy}
                  onClick={() => void undoLast(b.id)}
                  aria-label="Undo"
                  title={
                    history.undoLabel ? `Undo: ${history.undoLabel} (Ctrl+Z)` : 'Nothing to undo'
                  }
                >
                  <Undo2 size={14} aria-hidden />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!history.redoLabel || history.busy}
                  onClick={() => void redoLast(b.id)}
                  aria-label="Redo"
                  title={
                    history.redoLabel
                      ? `Redo: ${history.redoLabel} (Ctrl+Shift+Z)`
                      : 'Nothing to redo'
                  }
                >
                  <Redo2 size={14} aria-hidden />
                </Button>
              </>
            )}
            {role !== 'viewer' && (
              <Button
                variant="secondary"
                size="sm"
                disabled={items.status !== 'ready'}
                onClick={() => setTrashOpen(true)}
                aria-label="Recently deleted"
                title="Recently deleted: restore items you removed"
              >
                <Trash2 size={14} aria-hidden />
              </Button>
            )}
            {canEdit && !b.archived && (
              <Button
                variant="secondary"
                size="sm"
                disabled={items.status !== 'ready' || !members}
                onClick={() => setImportOpen(true)}
                aria-label="Import CSV"
                title="Add items from a spreadsheet (CSV)"
              >
                <FileUp size={14} aria-hidden /> <span className="hidden lg:inline">Import</span>
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              disabled={items.status !== 'ready'}
              onClick={() =>
                items.status === 'ready' && downloadBoardCsv(b, items.data, memberName)
              }
              aria-label="Export CSV"
              title="Download this list as a spreadsheet (CSV)"
            >
              <Download size={14} aria-hidden /> <span className="hidden lg:inline">Export</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAutoOpen(true)}
              aria-label="Automations"
            >
              <Zap size={14} aria-hidden /> <span className="hidden sm:inline">Automations</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setActivity(true)}
              aria-label="List activity"
            >
              <Activity size={14} aria-hidden /> <span className="hidden sm:inline">Activity</span>
            </Button>
            {role !== 'viewer' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSettings(true)}
                aria-label="List settings"
              >
                <Settings size={14} aria-hidden />{' '}
                <span className="hidden sm:inline">List settings</span>
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {views !== null && (
            <ViewTabs
              wid={workspace.id}
              bid={b.id}
              views={list}
              activeId={active.id}
              canEdit={canEdit}
              onSelect={(vid) =>
                setParams(
                  (prev) => {
                    const n = new URLSearchParams(prev);
                    n.set('view', vid);
                    n.delete('item');
                    return n;
                  },
                  { replace: true },
                )
              }
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
      {items.status === 'ready' &&
        canEdit &&
        [...items.data.values()].every((i) => i.deleted || i.archived) && (
          <p
            role="status"
            className="border-b border-border bg-primary-soft px-4 py-2 text-sm text-primary sm:px-6"
          >
            {active.type === 'table' ? (
              <>
                This list is empty. Type a name in <strong>+ Add item</strong> and press Enter (or
                click away) to add your first item, then click a cell to fill it in.
              </>
            ) : (
              <>
                No items yet.{' '}
                {active.type === 'kanban' || active.type === 'calendar'
                  ? 'Add one right here, or'
                  : 'Add items'}{' '}
                in the table view; they appear in every view.
              </>
            )}
          </p>
        )}
      {items.status === 'ready' && members && views !== null ? (
        active.type === 'kanban' ? (
          <KanbanView {...viewProps} />
        ) : active.type === 'calendar' ? (
          <CalendarView {...viewProps} />
        ) : active.type === 'gantt' ? (
          <GanttView {...viewProps} />
        ) : active.type === 'workload' ? (
          <WorkloadView {...viewProps} />
        ) : active.type === 'chart' ? (
          <ChartView {...viewProps} />
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
      {itemId && items.status === 'ready' && members && (
        <ItemPanel p={viewProps} itemId={itemId} isAdmin={role === 'admin'} onClose={closeItem} />
      )}
      {importOpen && items.status === 'ready' && members && (
        <ImportDialog
          wid={workspace.id}
          uid={user.uid}
          board={b}
          items={items.data}
          members={members}
          fallbackNumber={Math.max(0, ...[...items.data.values()].map((i) => i.itemNumber)) + 1}
          onClose={() => setImportOpen(false)}
        />
      )}
      {trashOpen && items.status === 'ready' && (
        <TrashPanel
          wid={workspace.id}
          board={b}
          items={items.data}
          canEdit={canEdit}
          onClose={() => setTrashOpen(false)}
        />
      )}
      {autoOpen && members && (
        <AutomationsPanel
          wid={workspace.id}
          board={b}
          members={members}
          memberName={memberName}
          automations={automations.automations}
          me={user.uid}
          canEdit={canEdit}
          isAdmin={role === 'admin'}
          onClose={() => setAutoOpen(false)}
        />
      )}
      {activity && (
        <SidePanel open onClose={() => setActivity(false)} title={`Activity on ${b.name}`}>
          <ActivityList
            wid={workspace.id}
            bid={b.id}
            itemId={null}
            memberName={memberName}
            onOpenItem={(id) => {
              setActivity(false);
              viewProps.onOpenItem(id);
            }}
          />
        </SidePanel>
      )}
      {settings && <BoardSettingsDialog board={b} open onClose={() => setSettings(false)} />}
    </div>
  );
}

export default function BoardPage() {
  const { bid = '' } = useParams();
  const { workspace } = useWorkspace();
  const board = useBoardDoc(workspace.id, bid);

  if (board.status === 'loading') return <FullPageSpinner label="Opening list" />;
  if (board.status !== 'ready') {
    return (
      <EmptyState
        icon={<ShieldAlert size={28} />}
        title={board.status === 'missing' ? 'List not found' : 'Could not open this list'}
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
