import { NAME_COLUMN_WIDTH } from '@app/shared';
import { useSyncExternalStore } from 'react';

/** The Item column's width, chosen with the slider in the Columns menu. Remembered per device. */
export const ITEM_WIDTH_MIN = 160;
export const ITEM_WIDTH_MAX = 700;
const KEY = 'itemColumnWidth';
const listeners = new Set<() => void>();

function read(): number | null {
  try {
    const n = Number(localStorage.getItem(KEY));
    return n >= ITEM_WIDTH_MIN && n <= ITEM_WIDTH_MAX ? n : null;
  } catch {
    return null;
  }
}

let current = read();

export function setItemWidth(w: number | null) {
  current = w;
  try {
    if (w === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(w));
  } catch {
    /* private mode: still works for this visit */
  }
  listeners.forEach((l) => l());
}

/** The chosen width, or null to use the default for the screen size. */
export function useItemWidth(): number | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export const DEFAULT_ITEM_WIDTH = NAME_COLUMN_WIDTH;
