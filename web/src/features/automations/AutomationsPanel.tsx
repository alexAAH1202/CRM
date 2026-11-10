import {
  describeAutomation,
  recipesFor,
  type Automation,
  type Column,
  type Group,
} from '@app/shared';
import { formatDistanceToNow } from 'date-fns';
import { ChevronLeft, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button, SidePanel } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import type { WorkspaceMember } from '../boards/types';
import {
  AUTOMATION_LIMIT,
  createAutomation,
  deleteAutomation,
  pruneRuns,
  setAutomationEnabled,
  updateAutomation,
  type AutomationDraft,
} from './api';
import { AutomationBuilder } from './AutomationBuilder';
import { useRuns } from './useRuns';

type View =
  | { kind: 'list' }
  | { kind: 'gallery' }
  | { kind: 'edit'; id: string | null; draft: AutomationDraft };

const BADGE: Record<string, string> = {
  ok: 'bg-surface-3 text-fg',
  skipped: 'bg-surface-3 text-muted',
  failed: 'bg-danger-soft text-danger',
};

export function AutomationsPanel({
  wid,
  board,
  members,
  memberName,
  automations,
  me,
  canEdit,
  isAdmin,
  onClose,
}: {
  wid: string;
  board: { id: string; name: string; columns: Column[]; groups: Group[] };
  members: WorkspaceMember[];
  memberName: (uid: string) => string;
  automations: Automation[];
  me: string;
  canEdit: boolean;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [deleting, setDeleting] = useState<Automation | null>(null);
  const { runs, extraIds, ready } = useRuns(wid, board.id, view.kind === 'list');
  const fail = (e: unknown) => toast.error(friendlyError(e));
  const recipes = useMemo(() => recipesFor(board, me), [board, me]);
  const full = automations.length >= AUTOMATION_LIMIT;

  // Keep run history to the newest 50.
  useEffect(() => {
    if (canEdit && extraIds.length > 0)
      void pruneRuns(wid, board.id, extraIds).catch(() => undefined);
  }, [canEdit, extraIds, wid, board.id]);

  const blank = (): AutomationDraft => ({
    name: '',
    enabled: true,
    ownerUid: me,
    trigger: { type: 'itemCreated' },
    conditions: [],
    actions: [{ type: 'notify', to: 'owner', uid: null, message: '{item} was updated' }],
  });

  const title =
    view.kind === 'list'
      ? 'Automations'
      : view.kind === 'gallery'
        ? 'Add an automation'
        : view.id
          ? 'Edit automation'
          : 'New automation';

  return (
    <SidePanel open onClose={onClose} title={title}>
      {view.kind !== 'list' && (
        <button
          type="button"
          onClick={() =>
            setView(
              view.kind === 'edit' && view.id === null ? { kind: 'gallery' } : { kind: 'list' },
            )
          }
          className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-primary"
        >
          <ChevronLeft size={14} aria-hidden /> Back
        </button>
      )}

      {view.kind === 'list' && (
        <div className="space-y-6">
          <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">
            Automations run in the browser of whoever makes the change, so they only fire while
            someone has the app open. Rules that run on dates or a schedule come with the Apps
            Script helper.
          </p>
          {canEdit && (
            <Button onClick={() => setView({ kind: 'gallery' })} disabled={full}>
              <Plus size={14} aria-hidden /> Add automation
            </Button>
          )}
          {full && (
            <p className="text-sm text-muted">
              This board has the most automations allowed ({AUTOMATION_LIMIT}).
            </p>
          )}
          {automations.length === 0 ? (
            <p className="text-sm text-muted">
              No automations yet. Pick one from the gallery to get started.
            </p>
          ) : (
            <ul className="space-y-3" aria-label="Automations">
              {automations.map((a) => (
                <li key={a.id} className="rounded-2xl border border-border p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{a.name}</p>
                      <p className="text-sm text-muted">
                        {describeAutomation(a, board, memberName)}
                      </p>
                      <p className="mt-1 text-xs text-muted">Owner: {memberName(a.ownerUid)}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={a.enabled}
                      aria-label={`${a.name} is ${a.enabled ? 'on' : 'off'}`}
                      disabled={!canEdit}
                      onClick={() =>
                        void setAutomationEnabled(wid, board.id, a, !a.enabled).catch(fail)
                      }
                      className={cx(
                        'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
                        a.enabled ? 'bg-primary' : 'bg-surface-3',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cx(
                          'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                          a.enabled && 'translate-x-5',
                        )}
                      />
                    </button>
                  </div>
                  {canEdit && (
                    <div className="mt-2 flex gap-1 text-xs">
                      <button
                        type="button"
                        aria-label={`Edit ${a.name}`}
                        onClick={() => {
                          const { id: _id, ...draft } = a;
                          void _id;
                          setView({ kind: 'edit', id: a.id, draft });
                        }}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-muted hover:bg-surface-3 hover:text-fg"
                      >
                        <Pencil size={12} aria-hidden /> Edit
                      </button>
                      {(isAdmin || a.ownerUid === me) && (
                        <button
                          type="button"
                          aria-label={`Delete ${a.name}`}
                          onClick={() => setDeleting(a)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-muted hover:bg-surface-3 hover:text-danger"
                        >
                          <Trash2 size={12} aria-hidden /> Delete
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <section aria-label="Recent runs">
            <h3 className="mb-2 text-sm font-bold">Recent runs</h3>
            {!ready ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing has run yet. The last 50 runs, including problems, appear here.
              </p>
            ) : (
              <ol className="space-y-2">
                {runs.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span
                      className={cx(
                        'rounded-full px-2 py-0.5 text-xs font-semibold',
                        BADGE[r.status],
                      )}
                    >
                      {r.status === 'ok' ? 'Ran' : r.status === 'failed' ? 'Failed' : 'Skipped'}
                    </span>
                    <span className="font-semibold">{r.name}</span>
                    <span className="text-xs text-muted">
                      {memberName(r.actor)} · {formatDistanceToNow(r.atMs, { addSuffix: true })}
                    </span>
                    {r.error && <span className="basis-full text-xs text-muted">{r.error}</span>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}

      {view.kind === 'gallery' && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Pick a recipe, then adjust it before you save.</p>
          <ul className="grid gap-2" aria-label="Recipes">
            {recipes.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    // A set of reminders is added in one go (each can be edited afterwards).
                    if (r.bundle?.length) {
                      Promise.all(
                        [r.draft, ...r.bundle].map((d) =>
                          createAutomation(wid, board.id, { ...d, ownerUid: me }),
                        ),
                      )
                        .then(() => {
                          toast.success(`Added ${r.bundle!.length + 1} reminders`);
                          setView({ kind: 'list' });
                        })
                        .catch(fail);
                      return;
                    }
                    setView({ kind: 'edit', id: null, draft: r.draft });
                  }}
                  className="flex w-full items-start gap-3 rounded-2xl border border-border p-3 text-left hover:border-primary hover:bg-surface-2"
                >
                  <Zap size={16} aria-hidden className="mt-0.5 shrink-0 text-primary" />
                  <span>
                    <span className="block font-bold">{r.title}</span>
                    <span className="block text-sm text-muted">{r.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            onClick={() => setView({ kind: 'edit', id: null, draft: blank() })}
          >
            Start from scratch
          </Button>
        </div>
      )}

      {view.kind === 'edit' && (
        <AutomationBuilder
          board={board}
          members={members}
          me={me}
          initial={view.draft}
          editing={view.id !== null}
          onCancel={() => setView({ kind: 'list' })}
          onSave={async (draft) => {
            try {
              if (view.id) await updateAutomation(wid, board.id, view.id, draft);
              else await createAutomation(wid, board.id, { ...draft, ownerUid: me });
              setView({ kind: 'list' });
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this automation?"
        body={`“${deleting?.name ?? ''}” will stop running and be removed for everyone.`}
        confirmLabel="Delete automation"
        danger
        onConfirm={async () => {
          if (deleting) await deleteAutomation(wid, board.id, deleting.id).catch(fail);
        }}
        onClose={() => setDeleting(null)}
      />
    </SidePanel>
  );
}
