import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>, durationMs?: number) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (t, durationMs = 5000) => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { ...t, id }] });
    if (durationMs > 0) setTimeout(() => get().dismiss(id), durationMs);
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  info: (message: string) => useToastStore.getState().push({ message, tone: 'info' }),
  success: (message: string) => useToastStore.getState().push({ message, tone: 'success' }),
  error: (message: string) => useToastStore.getState().push({ message, tone: 'error' }, 8000),
};
