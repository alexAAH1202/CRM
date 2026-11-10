import { applyComputed, type ComputedEnv } from '@app/shared';
import { format } from 'date-fns';
import { useMemo, useState } from 'react';
import { SidePanel, TextField } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { renameItem, setCell } from '../boards/api';
import { ActivityList } from '../activity/ActivityList';
import { UpdatesTab } from '../updates/UpdatesTab';
import { CellEnvProvider, useBoardCellEnv } from './cellEnv';
import { AcceptanceBar } from './AcceptanceBar';
import { Cell } from './cells';
import type { ViewProps } from './viewParts';

type Tab = 'fields' | 'updates' | 'files' | 'activity';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'updates', label: 'Updates' },
  { id: 'fields', label: 'Fields' },
  { id: 'files', label: 'Files' },
  { id: 'activity', label: 'Activity' },
];

/** The item "page": opens as a side panel from any view, or from a notification link. */
export function ItemPanel({
  p,
  itemId,
  isAdmin,
  onClose,
}: {
  p: Omit<ViewProps, 'config' | 'onConfig' | 'search' | 'onOpenItem'>;
  itemId: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const user = useCurrentUser();
  const { wid, board, members, canEdit, items, memberName } = p;
  const env = useBoardCellEnv(wid, board, items, user.uid);
  const [tab, setTab] = useState<Tab>('updates');
  const computedEnv = useMemo<ComputedEnv>(
    () => ({
      today: format(new Date(), 'yyyy-MM-dd'),
      memberName,
      itemName: (id) => items.get(id)?.name,
    }),
    [memberName, items],
  );
  const item = useMemo(
    () =>
      applyComputed([...items.values()], board.columns, computedEnv).find((i) => i.id === itemId),
    [items, board.columns, computedEnv, itemId],
  );
  const [name, setName] = useState<string | null>(null);
  const fail = (e: unknown) => toast.error(friendlyError(e));

  if (!item || item.deleted) {
    return (
      <SidePanel open onClose={onClose} title="Item not found">
        <p className="text-sm text-muted">This item was deleted, or you can’t see it.</p>
      </SidePanel>
    );
  }
  const shownName = name ?? item.name;
  const fileCols = board.columns.filter((c) => c.type === 'files');
  const field = (c: (typeof board.columns)[number]) => (
    <div key={c.id} className="grid grid-cols-[8rem_1fr] items-center gap-2">
      <dt className="truncate text-sm font-semibold text-muted">{c.title}</dt>
      <dd className="relative h-10 rounded-lg border border-border">
        <Cell
          column={c}
          item={item}
          itemName={item.name}
          canEdit={canEdit}
          members={members}
          onChange={(value) =>
            setCell({ wid, board, item, uid: user.uid, column: c, value }).catch(fail)
          }
        />
      </dd>
    </div>
  );

  return (
    <SidePanel open onClose={onClose} title={`#${item.itemNumber} ${item.name || 'Untitled'}`}>
      <CellEnvProvider value={env}>
        <AcceptanceBar wid={wid} bid={board.id} item={item} memberName={memberName} />
        <div
          role="tablist"
          aria-label="Item sections"
          className="mb-4 flex gap-1 border-b border-border"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cx(
                '-mb-px border-b-2 px-3 py-2 text-sm font-semibold',
                tab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'updates' && (
            <UpdatesTab
              wid={wid}
              bid={board.id}
              iid={item.id}
              itemName={item.name}
              members={members}
              canEdit={canEdit}
              isAdmin={isAdmin}
              memberName={memberName}
            />
          )}
          {tab === 'fields' && (
            <div className="space-y-4">
              <TextField
                label="Name"
                value={shownName}
                disabled={!canEdit}
                maxLength={500}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  const n = shownName.trim();
                  if (canEdit && n && n !== item.name)
                    renameItem(wid, board.id, item.id, user.uid, n).catch(fail);
                  setName(null);
                }}
              />
              <dl className="grid gap-3">{board.columns.map(field)}</dl>
            </div>
          )}
          {tab === 'activity' && (
            <ActivityList wid={wid} bid={board.id} itemId={item.id} memberName={memberName} />
          )}
          {tab === 'files' &&
            (fileCols.length === 0 ? (
              <p className="text-sm text-muted">
                This list has no Files column yet. Add one from the table’s “Add column” menu to
                attach links to files.
              </p>
            ) : (
              <dl className="grid gap-3">{fileCols.map(field)}</dl>
            ))}
        </div>
      </CellEnvProvider>
    </SidePanel>
  );
}
