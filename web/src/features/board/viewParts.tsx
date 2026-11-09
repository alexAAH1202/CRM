import {
  applyComputed,
  buildLayout,
  valueToText,
  type ComputedEnv,
  type Column,
  type ViewConfig,
  type ViewContext,
} from '@app/shared';
import { format } from 'date-fns';
import { useCallback, useMemo, useState } from 'react';
import { Modal, TextField } from '../../components/ui';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { createItem, renameItem, setCell } from '../boards/api';
import type { Board, BoardItem, WorkspaceMember } from '../boards/types';
import { CellEnvProvider, useBoardCellEnv } from './cellEnv';
import { Cell } from './cells';

/** What every non-table view receives from the board page. */
export interface ViewProps {
  wid: string;
  board: Board;
  items: Map<string, BoardItem>;
  members: WorkspaceMember[];
  canEdit: boolean;
  search: string;
  config: ViewConfig;
  onConfig: (patch: Partial<ViewConfig>) => void;
  memberName: (uid: string) => string;
}

/**
 * The items a Kanban / Calendar view shows: computed columns worked out, then the view's own
 * filters, search and sort — the same pure code the table uses. Subitems are shown as cards too.
 */
export function useVisibleItems(p: ViewProps) {
  const user = useCurrentUser();
  const today = format(new Date(), 'yyyy-MM-dd');
  const { board, items, config, search, memberName } = p;
  const ctx = useMemo<ViewContext>(
    () => ({ today, me: user.uid, memberName }),
    [today, user.uid, memberName],
  );
  const env = useMemo<ComputedEnv>(
    () => ({ today, memberName, itemName: (id) => items.get(id)?.name }),
    [today, memberName, items],
  );
  const computed = useMemo(
    () => applyComputed([...items.values()], board.columns, env),
    [items, board.columns, env],
  );
  const byId = useMemo(() => new Map(computed.map((i) => [i.id, i])), [computed]);
  const visible = useMemo(() => {
    const layout = buildLayout<BoardItem>({
      items: computed,
      columns: board.columns,
      groups: board.groups,
      config,
      search,
      ctx,
    });
    return layout.flatMap((g) => g.rows.flatMap((r) => [r.item, ...r.subitems]));
  }, [computed, board.columns, board.groups, config, search, ctx]);
  return { visible, byId, today, ctx };
}

/** Adds an item to the board's first group (optionally with starting values). */
export function useAddItem(p: ViewProps) {
  const user = useCurrentUser();
  const { board, items, wid } = p;
  return useCallback(
    (name: string, values?: Record<string, unknown>) => {
      const gid = board.groups[0]?.id;
      if (!gid) return;
      let maxOrder: string | null = null;
      let maxNumber = 0;
      for (const i of items.values()) {
        if (i.groupId === gid && !i.parentId && (maxOrder === null || i.order > maxOrder))
          maxOrder = i.order;
        maxNumber = Math.max(maxNumber, i.itemNumber);
      }
      createItem({
        board,
        wid,
        uid: user.uid,
        name,
        groupId: gid,
        afterOrder: maxOrder,
        fallbackNumber: maxNumber + 1,
        ...(values ? { values } : {}),
      }).catch((err: unknown) => toast.error(friendlyError(err)));
    },
    [board, items, wid, user.uid],
  );
}

/** A few "Title: value" lines for a card — non-empty, non-lane, non-computed-noise columns. */
export function cardFacts(
  columns: readonly Column[],
  item: BoardItem,
  skip: string | null,
  memberName: (uid: string) => string,
  limit = 3,
): Array<{ id: string; title: string; text: string }> {
  const out: Array<{ id: string; title: string; text: string }> = [];
  for (const c of columns) {
    if (c.id === skip || out.length >= limit) continue;
    if (c.type === 'longText' || c.type === 'files' || c.type === 'dependency') continue;
    const text = valueToText(c, item.values[c.id], { peopleName: memberName });
    if (text) out.push({ id: c.id, title: c.title, text });
  }
  return out;
}

/** Opens from a card: rename and edit every column with the same editors the table uses. */
export function ItemDialog({
  p,
  item,
  onClose,
}: {
  p: ViewProps;
  item: BoardItem;
  onClose: () => void;
}) {
  const user = useCurrentUser();
  const { wid, board, members, canEdit, items } = p;
  const env = useBoardCellEnv(wid, board, items, user.uid);
  const [name, setName] = useState(item.name);
  const fail = (e: unknown) => toast.error(friendlyError(e));
  return (
    <Modal open onClose={onClose} title={`Item #${item.itemNumber}`}>
      <CellEnvProvider value={env}>
        <TextField
          label="Name"
          value={name}
          disabled={!canEdit}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const n = name.trim();
            if (canEdit && n && n !== item.name)
              renameItem(wid, board.id, item.id, user.uid, n).catch(fail);
          }}
        />
        <dl className="mt-4 grid gap-3">
          {board.columns.map((c) => (
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
          ))}
        </dl>
      </CellEnvProvider>
    </Modal>
  );
}
