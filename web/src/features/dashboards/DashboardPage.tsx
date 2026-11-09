import {
  GRID_COLS,
  MAX_WIDGETS,
  newWidget,
  WIDGET_META,
  WIDGET_TYPES,
  DEFAULT_TIMEZONE,
  type Widget,
  type WidgetConfig,
  type WidgetType,
} from '@app/shared';
import { Pencil, Plus, RefreshCw, Settings, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button, EmptyState, Modal, Skeleton, TextField } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useBoards } from '../boards/BoardsProvider';
import { useWorkspace } from '../workspaces/WorkspaceProvider';
import { deleteDashboard, getDashboard, saveDashboard, type Dashboard } from './api';
import { forgetDashboardData } from './data';
import { ListPicker } from './DashboardsPage';
import { WidgetBody, widgetTitle, type DashList } from './Widgets';
import { WidgetSettings } from './WidgetSettings';

const Grid = WidthProvider(Responsive);
const SAVE_DELAY_MS = 800;

/** One dashboard: a drag-and-resize grid of widgets. Phones get a single column. */
export default function DashboardPage() {
  const { did } = useParams();
  const { workspace, role } = useWorkspace();
  const { boards, memberName } = useBoards();
  const navigate = useNavigate();
  const wid = workspace.id;
  const tz = workspace.settings?.timezone ?? DEFAULT_TIMEZONE;
  const canEdit = role !== 'viewer';

  const [dash, setDash] = useState<Dashboard | null | 'missing'>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Parameters<typeof saveDashboard>[2] | null>(null);
  const latest = useRef<Dashboard | null>(null);

  useEffect(() => {
    if (!did) return;
    getDashboard(wid, did)
      .then((d) => setDash(d ?? 'missing'))
      .catch((e: unknown) => setError(friendlyError(e)));
  }, [wid, did]);

  const live = dash && dash !== 'missing' ? dash : null;
  latest.current = live;

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = null;
    const d = latest.current;
    if (!patch || !d || !did) return;
    saveDashboard(wid, did, patch, patch.boardIds ?? d.boardIds).catch((e: unknown) =>
      toast.error(`Couldn’t save the dashboard: ${friendlyError(e)}`),
    );
  }, [wid, did]);
  useEffect(() => () => flush(), [flush]);
  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [flush]);

  /** Applies a change on screen at once and saves it a moment later (one write for a burst of drags). */
  const change = (patch: Partial<Dashboard>) => {
    setDash((d) => (d && d !== 'missing' ? { ...d, ...patch } : d));
    pending.current = { ...(pending.current ?? {}), ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  const lists: DashList[] = useMemo(
    () =>
      (live?.boardIds ?? []).map((id) => ({
        id,
        name: boards?.find((b) => b.id === id)?.name ?? 'List',
      })),
    [live?.boardIds, boards],
  );
  const env = useMemo(
    () => ({ wid, lists, memberName, tz, reload }),
    [wid, lists, memberName, tz, reload],
  );

  if (error)
    return (
      <p role="alert" className="p-6 text-danger">
        {error}
      </p>
    );
  if (dash === null) return <Skeleton className="m-6 h-40" />;
  if (dash === 'missing' || !live)
    return (
      <EmptyState
        title="Dashboard not found"
        body="It may have been deleted, or it's private."
        action={
          <Link to={`/w/${wid}/dashboards`} className="font-semibold text-primary underline">
            Back to dashboards
          </Link>
        }
      />
    );

  const widgets = live.widgets;
  const setWidgets = (next: Widget[]) => change({ widgets: next });
  const sorted = [...widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  const layouts = {
    lg: widgets.map((w) => ({ i: w.id, ...w.layout, minW: 2, minH: 1 })),
    sm: sorted.map((w, i) => ({ i: w.id, x: 0, y: i * w.layout.h, w: 1, h: w.layout.h })),
  };

  const onLayout = (current: Layout[], all: { [k: string]: Layout[] }) => {
    if (!editing || !all['lg']) return;
    // Only the wide layout is stored; the phone layout is derived from it.
    const lg = new Map(all['lg'].map((l) => [l.i, l]));
    const next = widgets.map((w) => {
      const l = lg.get(w.id);
      return l ? { ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : w;
    });
    if (JSON.stringify(next.map((w) => w.layout)) !== JSON.stringify(widgets.map((w) => w.layout)))
      setWidgets(next);
    void current;
  };

  const refresh = () => {
    forgetDashboardData(wid);
    setReload((n) => n + 1);
  };
  const settingsWidget = widgets.find((w) => w.id === settings) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-2 border-b border-border bg-surface px-4 pt-4 pb-3 sm:px-6">
        <p className="text-sm">
          <Link to={`/w/${wid}/dashboards`} className="text-muted hover:text-fg hover:underline">
            ← Dashboards
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-xl font-extrabold sm:text-2xl">
            {live.name}
          </h1>
          <Button variant="secondary" size="sm" onClick={refresh} aria-label="Refresh dashboard">
            <RefreshCw size={14} aria-hidden /> <span className="hidden sm:inline">Refresh</span>
          </Button>
          {canEdit && (
            <>
              {editing && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={widgets.length >= MAX_WIDGETS}
                    onClick={() => setAdding(true)}
                  >
                    <Plus size={14} aria-hidden /> Add widget
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setSetup(true)}>
                    <Settings size={14} aria-hidden />{' '}
                    <span className="hidden sm:inline">Dashboard settings</span>
                  </Button>
                </>
              )}
              <Button
                size="sm"
                onClick={() => (editing ? (flush(), setEditing(false)) : setEditing(true))}
              >
                <Pencil size={14} aria-hidden /> {editing ? 'Done' : 'Edit'}
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted">
          {lists.length === 0
            ? 'No lists chosen yet.'
            : `Drawing on ${lists.map((l) => l.name).join(', ')}.`}{' '}
          Numbers come straight from the database; the rest are read once and kept for a minute
          (Refresh to update).
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        {widgets.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            body={
              canEdit
                ? 'Press Edit, then Add widget: a number, a chart, what’s overdue and more.'
                : 'The people who edit this dashboard haven’t added anything yet.'
            }
            {...(canEdit
              ? {
                  action: (
                    <Button
                      onClick={() => {
                        setEditing(true);
                        setAdding(true);
                      }}
                    >
                      Add a widget
                    </Button>
                  ),
                }
              : {})}
          />
        ) : (
          <Grid
            className="layout"
            layouts={layouts}
            breakpoints={{ lg: 700, sm: 0 }}
            cols={{ lg: GRID_COLS, sm: 1 }}
            rowHeight={72}
            margin={[12, 12]}
            isDraggable={editing}
            isResizable={editing}
            draggableHandle=".widget-handle"
            onLayoutChange={onLayout}
            measureBeforeMount
          >
            {widgets.map((w) => (
              <div
                key={w.id}
                className={cx(
                  'flex flex-col overflow-hidden rounded-2xl bg-surface p-3 shadow-sm',
                  editing && 'ring-1 ring-border',
                )}
              >
                <div className="mb-2 flex items-center gap-2">
                  <h2
                    className={cx(
                      'min-w-0 flex-1 truncate text-sm font-bold',
                      editing && 'widget-handle cursor-grab',
                    )}
                  >
                    {widgetTitle(w)}
                  </h2>
                  {editing && (
                    <>
                      <button
                        type="button"
                        aria-label={`Settings for ${widgetTitle(w)}`}
                        onClick={() => setSettings(w.id)}
                        className="rounded p-1 text-muted hover:bg-surface-2"
                      >
                        <Settings size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${widgetTitle(w)}`}
                        onClick={() => setRemoving(w.id)}
                        className="rounded p-1 text-muted hover:bg-surface-2"
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </>
                  )}
                </div>
                <div className="min-h-0 flex-1">
                  <WidgetBody w={w} env={env} />
                </div>
              </div>
            ))}
          </Grid>
        )}
      </div>

      {adding && (
        <Modal open onClose={() => setAdding(false)} title="Add widget">
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Widget types">
            {WIDGET_TYPES.map((t: WidgetType) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => {
                    const w = newWidget(t, live.boardIds, widgets, {
                      boardId: ['numbers', 'chart', 'table', 'timeline', 'workload'].includes(t)
                        ? (live.boardIds[0] ?? null)
                        : null,
                    });
                    setWidgets([...widgets, w]);
                    setAdding(false);
                    setSettings(w.id);
                  }}
                  className="w-full rounded-xl border border-border p-3 text-left hover:border-primary hover:bg-surface-2"
                >
                  <span className="block font-semibold">{WIDGET_META[t].label}</span>
                  <span className="block text-xs text-muted">{WIDGET_META[t].description}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {settingsWidget && (
        <WidgetSettings
          widget={settingsWidget}
          wid={wid}
          lists={lists}
          onClose={() => setSettings(null)}
          onSave={(config: WidgetConfig) =>
            setWidgets(widgets.map((w) => (w.id === settingsWidget.id ? { ...w, config } : w)))
          }
        />
      )}
      {setup && (
        <SetupDialog
          dash={live}
          onClose={() => setSetup(false)}
          onSave={(name, boardIds) => {
            const keep = widgets.map((w) =>
              w.config.boardId && !boardIds.includes(w.config.boardId)
                ? { ...w, config: { ...w.config, boardId: null } }
                : w,
            );
            change({ name, boardIds, widgets: keep });
            forgetDashboardData(wid);
            setReload((n) => n + 1);
          }}
          onDelete={() => setConfirmDelete(true)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Remove this widget?"
        body="Its settings are lost; the data it shows is not touched."
        confirmLabel="Remove"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          setWidgets(widgets.filter((w) => w.id !== removing));
          setRemoving(null);
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete “${live.name}”?`}
        body="This removes the dashboard for everyone. The lists themselves are not affected."
        confirmLabel="Delete dashboard"
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (!did) return;
          pending.current = null;
          await deleteDashboard(wid, did).catch((e: unknown) => toast.error(friendlyError(e)));
          navigate(`/w/${wid}/dashboards`);
        }}
      />
    </div>
  );
}

function SetupDialog({
  dash,
  onSave,
  onDelete,
  onClose,
}: {
  dash: Dashboard;
  onSave: (name: string, boardIds: string[]) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(dash.name);
  const [boardIds, setBoardIds] = useState(dash.boardIds);
  return (
    <Modal
      open
      onClose={onClose}
      title="Dashboard settings"
      footer={
        <>
          <Button variant="ghost" onClick={onDelete}>
            <Trash2 size={14} aria-hidden /> Delete
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => {
              onSave(name.trim(), boardIds);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Dashboard name"
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <ListPicker value={boardIds} onChange={setBoardIds} />
      </div>
    </Modal>
  );
}
