import { pruneViewConfig, type Column, type ViewConfig } from '@app/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { saveViewConfig } from './api';
import type { BoardView } from './useViews';

const SAVE_DELAY_MS = 600;

export interface ViewConfigState {
  config: ViewConfig;
  /** Merge a patch. Editors' changes are saved to the view (debounced); viewers' stay on this device. */
  update: (patch: Partial<ViewConfig>) => void;
  /** True when changes are saved for everyone (false = only on this device). */
  shared: boolean;
}

interface Pending {
  vid: string;
  config: ViewConfig;
  exists: boolean;
}

/**
 * Per-view settings. Changes apply instantly and are written once after a short pause,
 * so dragging a column edge or typing a filter value is never one write per event.
 * `exists` is false only for the implicit "main" table of a board that has no view doc yet.
 */
export function useViewConfig(
  wid: string,
  bid: string,
  view: BoardView,
  exists: boolean,
  canEdit: boolean,
  columns: readonly Column[],
): ViewConfigState {
  const user = useCurrentUser();
  const [local, setLocal] = useState<{ vid: string; config: ViewConfig } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Pending | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    saveViewConfig(wid, bid, p.vid, user.uid, p.config, p.exists).catch((err: unknown) =>
      toast.error(`Couldn't save view settings: ${friendlyError(err)}`),
    );
  }, [wid, bid, user.uid]);

  // Switching views saves the old one's pending change first.
  useEffect(() => () => flush(), [view.id, flush]);

  // Once the server copy changes and nothing is waiting to be saved, drop the optimistic copy.
  useEffect(() => {
    if (!pending.current) setLocal(null);
  }, [view.config]);

  const base = local && local.vid === view.id ? local.config : view.config;
  const config = useMemo(() => pruneViewConfig(base, columns), [base, columns]);

  const update = useCallback(
    (patch: Partial<ViewConfig>) => {
      const next = { ...config, ...patch };
      setLocal({ vid: view.id, config: next });
      if (!canEdit) return;
      pending.current = { vid: view.id, config: next, exists };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [config, canEdit, flush, view.id, exists],
  );

  return { config, update, shared: canEdit };
}
