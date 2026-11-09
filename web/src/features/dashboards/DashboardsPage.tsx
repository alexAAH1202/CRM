import { LayoutDashboard, Lock, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MAX_DASHBOARD_LISTS, type DashboardVisibility } from '@app/shared';
import { Button, EmptyState, Modal, Skeleton, TextField } from '../../components/ui';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { useBoards } from '../boards/BoardsProvider';
import { useWorkspace } from '../workspaces/WorkspaceProvider';
import { createDashboard, listDashboards, type Dashboard } from './api';

export function ListPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const { boards } = useBoards();
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-semibold">
        Lists to draw on (up to {MAX_DASHBOARD_LISTS})
      </legend>
      {(boards ?? []).length === 0 && <p className="text-sm text-muted">No lists yet.</p>}
      {(boards ?? []).map((b) => {
        const on = value.includes(b.id);
        return (
          <label key={b.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={on}
              disabled={!on && value.length >= MAX_DASHBOARD_LISTS}
              onChange={() => onChange(on ? value.filter((x) => x !== b.id) : [...value, b.id])}
              className="h-4 w-4 accent-[var(--c-primary)]"
            />
            {b.name}
          </label>
        );
      })}
      {value.length >= MAX_DASHBOARD_LISTS && (
        <p className="text-xs text-muted">
          That’s the limit: it keeps dashboards quick and inside the free database allowance.
        </p>
      )}
    </fieldset>
  );
}

/** All dashboards you can see, and a way to make one. */
export default function DashboardsPage() {
  const { workspace, role } = useWorkspace();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [list, setList] = useState<Dashboard[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [boardIds, setBoardIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<DashboardVisibility>('main');
  const [busy, setBusy] = useState(false);
  const wid = workspace.id;

  const load = useCallback(() => {
    listDashboards(wid)
      .then(setList)
      .catch((e: unknown) => setError(friendlyError(e)));
  }, [wid]);
  useEffect(load, [load]);

  const create = () => {
    setBusy(true);
    createDashboard({ wid, uid: user.uid, name, boardIds, visibility })
      .then((did) => navigate(`/w/${wid}/dashboards/${did}`))
      .catch((e: unknown) => toast.error(friendlyError(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-extrabold">Dashboards</h1>
        {role !== 'viewer' && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden /> New dashboard
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {list === null && !error ? (
        <Skeleton className="h-24 w-full" />
      ) : list && list.length === 0 ? (
        <EmptyState
          icon={<LayoutDashboard size={28} />}
          title="No dashboards yet"
          body="A dashboard puts numbers, charts and lists from up to five of your lists on one page."
          {...(role !== 'viewer'
            ? { action: <Button onClick={() => setCreating(true)}>New dashboard</Button> }
            : {})}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Dashboards">
          {(list ?? []).map((d) => (
            <li key={d.id}>
              <Link
                to={`/w/${wid}/dashboards/${d.id}`}
                className="flex h-24 flex-col justify-between rounded-3xl bg-surface p-4 shadow-sm transition-shadow hover:shadow-pop"
              >
                <span className="flex items-center gap-2 font-bold">
                  <LayoutDashboard size={16} aria-hidden className="shrink-0 text-primary" />
                  <span className="truncate">{d.name}</span>
                  {d.visibility === 'private' && (
                    <Lock size={12} aria-label="Private" className="shrink-0 text-muted" />
                  )}
                </span>
                <span className="text-sm text-muted">
                  {d.widgets.length} widget{d.widgets.length === 1 ? '' : 's'} · {d.boardIds.length}{' '}
                  list{d.boardIds.length === 1 ? '' : 's'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New dashboard"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={busy || !name.trim()}>
              Create dashboard
            </Button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create();
          }}
        >
          <TextField
            label="Dashboard name"
            autoFocus
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <ListPicker value={boardIds} onChange={setBoardIds} />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={visibility === 'private'}
              onChange={(e) => setVisibility(e.target.checked ? 'private' : 'main')}
              className="mt-0.5 h-4 w-4 accent-[var(--c-primary)]"
            />
            <span>
              Just for me
              <span className="block text-xs text-muted">
                Otherwise everyone in the household can see it. (Admins can see every dashboard.)
              </span>
            </span>
          </label>
        </form>
      </Modal>
    </div>
  );
}
