import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { watchSystemTheme } from './stores/theme';
import './styles/index.css';

watchSystemTheme();

// After a new version is deployed, an open tab may ask for a code chunk that no longer exists.
// Reload once to pick up the new version (guarded so a real failure can't loop).
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('reloadedForUpdate') ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('reloadedForUpdate', String(Date.now()));
  } catch {
    /* storage blocked: reload anyway */
  }
  e.preventDefault();
  window.location.reload();
});

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
