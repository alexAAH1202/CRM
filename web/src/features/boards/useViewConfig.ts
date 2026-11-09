import {
  boardPaths,
  EMPTY_VIEW_CONFIG,
  parseViewConfig,
  pruneViewConfig,
  type Column,
  type ViewConfig,
} from '@app/shared';
import { doc } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../lib/firebase';
import { listenDoc } from '../../lib/firestore';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { saveViewConfig } from './api';

const VIEW_ID = 'main';
const SAVE_DELAY_MS = 600;

export interface ViewConfigState {
  config: ViewConfig;
  /** Merge a patch. Editors' changes are saved to the view (debounced); viewers' stay on this device. */
  update: (patch: Partial<ViewConfig>) => void;
  /** True when changes are saved for everyone (false = only on this device). */
  shared: boolean;
}

/**
 * Per-view settings. One small listener on views/main; changes apply instantly
 * and are written once after a short pause, so dragging a column edge or typing
 * a filter value is never one write per event.
 */
export function useViewConfig(
  wid: string,
  bid: string,
  canEdit: boolean,
  columns: readonly Column[],
): ViewConfigState {
  const user = useCurrentUser();
  const [saved, setSaved] = useState<ViewConfig>(EMPTY_VIEW_CONFIG);
  const [exists, setExists] = useState(true);
  const [local, setLocal] = useState<ViewConfig | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<ViewConfig | null>(null);
  const existsRef = useRef(true);
  existsRef.current = exists;

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    saveViewConfig(wid, bid, VIEW_ID, user.uid, next, existsRef.current).catch((err: unknown) =>
      toast.error(`Couldn't save view settings: ${friendlyError(err)}`),
    );
  }, [wid, bid, user.uid]);

  useEffect(() => {
    setLocal(null);
    pending.current = null;
    return listenDoc(
      'view',
      doc(db, boardPaths.view(wid, bid, VIEW_ID)),
      (snap) => {
        setExists(snap.exists());
        setSaved(parseViewConfig(snap.data()?.['config']));
        // Drop the optimistic copy once the server has caught up (and nothing is pending).
        if (!snap.metadata.hasPendingWrites && !pending.current) setLocal(null);
      },
      () => undefined,
    );
  }, [wid, bid]);

  // Save anything pending when leaving the board.
  useEffect(() => () => flush(), [flush]);

  const config = useMemo(() => pruneViewConfig(local ?? saved, columns), [local, saved, columns]);

  const update = useCallback(
    (patch: Partial<ViewConfig>) => {
      const next = { ...config, ...patch };
      setLocal(next);
      if (!canEdit) return;
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [config, canEdit, flush],
  );

  return { config, update, shared: canEdit };
}
