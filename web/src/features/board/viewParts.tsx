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
import { useCallback, useMemo } from 'react';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { createItem } from '../boards/api';
import type { Board, BoardItem, WorkspaceMember } from '../boards/types';

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
  /** Opens the item side panel. */
  onOpenItem: (id: string) => void;
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
  const layout = useMemo(
    () =>
      buildLayout<BoardItem>({
        items: computed,
        columns: board.columns,
        groups: board.groups,
        config,
        search,
        ctx,
      }),
    [computed, board.columns, board.groups, config, search, ctx],
  );
  const visible = useMemo(
    () => layout.flatMap((g) => g.rows.flatMap((r) => [r.item, ...r.subitems])),
    [layout],
  );
  return { visible, layout, byId, today, ctx };
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
