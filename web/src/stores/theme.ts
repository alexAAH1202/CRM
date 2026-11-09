import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const darkQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && 'matchMedia' in window
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return darkQuery()?.matches ? 'dark' : 'light';
}

function apply(pref: ThemePreference) {
  document.documentElement.dataset.theme = resolveTheme(pref);
}

/** Persisted under localStorage "theme" — index.html reads the same key before first paint. */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => {
        apply(preference);
        set({ preference });
      },
    }),
    { name: 'theme', partialize: (s) => ({ preference: s.preference }) },
  ),
);

/** Follow OS changes while preference is "system". Call once at startup. */
export function watchSystemTheme(): () => void {
  const mq = darkQuery();
  if (!mq) return () => undefined;
  const handler = () => {
    if (useThemeStore.getState().preference === 'system') apply('system');
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
