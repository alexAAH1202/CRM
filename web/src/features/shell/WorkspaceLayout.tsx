import { ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useParams } from 'react-router-dom';
import { FullPageSpinner } from '../../components/FullPageSpinner';
import { EmptyState } from '../../components/ui';
import { BoardsProvider } from '../boards/BoardsProvider';
import { NotificationsProvider } from '../notifications/NotificationsProvider';
import { WorkspaceProvider, useWorkspaceState } from '../workspaces/WorkspaceProvider';
import { SearchPalette } from '../search/SearchPalette';
import { MobileTopBar, Sidebar } from './Sidebar';
import { SearchContext } from './searchContext';

function Body() {
  const state = useWorkspaceState();
  const [drawer, setDrawer] = useState(false);
  const [searching, setSearching] = useState(false);

  // Ctrl/Cmd+K opens search from anywhere in the workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (state.status === 'loading') return <FullPageSpinner label="Opening workspace" />;
  if (state.status === 'noAccess' || state.status === 'error') {
    return (
      <EmptyState
        icon={<ShieldAlert size={28} />}
        title={
          state.status === 'noAccess'
            ? "You don't have access to this workspace"
            : 'Something went wrong'
        }
        body={
          state.status === 'error'
            ? state.message
            : 'You may have been removed, or the link is wrong.'
        }
        action={
          <Link to="/" className="font-semibold text-primary underline underline-offset-2">
            Go to my workspaces
          </Link>
        }
      />
    );
  }

  return (
    <BoardsProvider>
      <NotificationsProvider>
        <SearchContext.Provider value={() => setSearching(true)}>
          <div className="flex h-full">
            {/* Persistent sidebar on md+; slide-in drawer on small screens. */}
            <div className="hidden w-64 shrink-0 md:block">
              <Sidebar />
            </div>
            {drawer && (
              <div
                className="fixed inset-0 z-40 md:hidden"
                role="dialog"
                aria-modal="true"
                aria-label="Navigation"
              >
                <button
                  type="button"
                  aria-label="Close navigation"
                  className="absolute inset-0 bg-overlay"
                  onClick={() => setDrawer(false)}
                />
                <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">
                  <Sidebar onNavigate={() => setDrawer(false)} />
                </div>
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <MobileTopBar onMenu={() => setDrawer(true)} />
              <main className="min-h-0 flex-1 overflow-auto">
                <Outlet />
              </main>
            </div>
          </div>
          <SearchPalette open={searching} onClose={() => setSearching(false)} />
        </SearchContext.Provider>
      </NotificationsProvider>
    </BoardsProvider>
  );
}

export default function WorkspaceLayout() {
  const { wid } = useParams();
  if (!wid) return null;
  return (
    <WorkspaceProvider key={wid} wid={wid}>
      <Body />
    </WorkspaceProvider>
  );
}
