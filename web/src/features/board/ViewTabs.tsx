import {
  AVAILABLE_VIEW_TYPES,
  EMPTY_VIEW_CONFIG,
  MAX_VIEWS,
  VIEW_TYPE_META,
  type ViewType,
} from '@app/shared';
import {
  Columns3,
  CalendarDays,
  MoreHorizontal,
  Plus,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button, Modal, Popover, TextField } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { createView, deleteView, renameView, saveViewConfig } from '../boards/api';
import type { BoardView } from '../boards/useViews';

export const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  table: Table2,
  kanban: Columns3,
  calendar: CalendarDays,
  gantt: Table2,
  workload: Table2,
  chart: Table2,
};

interface Props {
  wid: string;
  bid: string;
  views: BoardView[];
  activeId: string;
  canEdit: boolean;
  onSelect: (vid: string) => void;
}

/** Tabs for the board's saved views, with add / rename / delete for editors. */
export function ViewTabs({ wid, bid, views, activeId, canEdit, onSelect }: Props) {
  const user = useCurrentUser();
  const [renaming, setRenaming] = useState<BoardView | null>(null);
  const [deleting, setDeleting] = useState<BoardView | null>(null);
  const [name, setName] = useState('');
  const virtual = views.length === 1 && views[0]?.id === 'main' && views[0].order === '';
  const canAdd = canEdit && views.length < MAX_VIEWS;

  const add = async (type: ViewType) => {
    // A board whose first view was never saved gets it now, so it doesn't vanish.
    if (virtual) await saveViewConfig(wid, bid, 'main', user.uid, views[0]!.config, false);
    return createView({
      wid,
      bid,
      uid: user.uid,
      type,
      name: VIEW_TYPE_META[type].defaultName,
      lastOrder: virtual ? 'a0' : (views.at(-1)?.order ?? null),
      config: EMPTY_VIEW_CONFIG,
    })
      .then(onSelect)
      .catch((e: unknown) => toast.error(friendlyError(e)));
  };

  return (
    <div role="tablist" aria-label="Views" className="flex min-w-0 flex-wrap items-center gap-1">
      {views.map((v) => {
        const Icon = VIEW_ICONS[v.type];
        const on = v.id === activeId;
        return (
          <div
            key={v.id}
            className={cx(
              'flex items-center rounded-full',
              on ? 'bg-primary-soft text-primary' : 'text-fg hover:bg-surface-2',
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onSelect(v.id)}
              className={cx(
                'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold',
                on && 'font-bold',
              )}
            >
              <Icon size={14} aria-hidden /> {v.name}
            </button>
            {on && canEdit && !virtual && (
              <Popover
                label={`${v.name} options`}
                className="w-44"
                trigger={(p) => (
                  <button
                    {...p}
                    type="button"
                    aria-label={`Options for ${v.name}`}
                    className="mr-1 rounded-full p-1 hover:bg-surface-3"
                  >
                    <MoreHorizontal size={14} aria-hidden />
                  </button>
                )}
              >
                {(close) => (
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
                      onClick={() => {
                        close();
                        setName(v.name);
                        setRenaming(v);
                      }}
                    >
                      Rename view
                    </button>
                    <button
                      type="button"
                      disabled={views.length < 2}
                      title={views.length < 2 ? 'A board needs at least one view' : undefined}
                      className="rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-surface-2 disabled:opacity-50"
                      onClick={() => {
                        close();
                        setDeleting(v);
                      }}
                    >
                      Delete view
                    </button>
                  </div>
                )}
              </Popover>
            )}
          </div>
        );
      })}
      {canAdd && (
        <Popover
          label="Add view"
          className="w-48"
          trigger={(p) => (
            <button
              {...p}
              type="button"
              aria-label="Add view"
              className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-sm font-semibold text-muted hover:bg-surface-2"
            >
              <Plus size={14} aria-hidden /> <span className="hidden sm:inline">View</span>
            </button>
          )}
        >
          {(close) => (
            <div className="flex flex-col">
              {AVAILABLE_VIEW_TYPES.map((t) => {
                const Icon = VIEW_ICONS[t];
                return (
                  <button
                    key={t}
                    type="button"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
                    onClick={() => {
                      close();
                      void add(t);
                    }}
                  >
                    <Icon size={14} aria-hidden /> {VIEW_TYPE_META[t].label}
                  </button>
                );
              })}
            </div>
          )}
        </Popover>
      )}

      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename view"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              disabled={name.trim() === ''}
              onClick={() => {
                if (renaming)
                  renameView(wid, bid, renaming.id, name).catch((e: unknown) =>
                    toast.error(friendlyError(e)),
                  );
                setRenaming(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <TextField
          label="View name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </Modal>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this view?"
        body={`“${deleting?.name ?? ''}” will be removed for everyone. Your items are not affected.`}
        confirmLabel="Delete view"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          if (deleting.id === activeId) {
            const other = views.find((x) => x.id !== deleting.id);
            if (other) onSelect(other.id);
          }
          await deleteView(wid, bid, deleting.id).catch((e: unknown) =>
            toast.error(friendlyError(e)),
          );
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
