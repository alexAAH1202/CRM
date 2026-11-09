import { lazy, Suspense } from 'react';
import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { Toaster } from '../components/ui';
import { AuthProvider } from '../features/auth/AuthProvider';
import { RequireAuth } from '../features/auth/RequireAuth';
import { ErrorBoundary } from './ErrorBoundary';
import { UsageMeterGate } from './UsageMeterGate';

// Route-level code splitting keeps the initial bundle small (Hosting bandwidth is metered).
const SignInPage = lazy(() => import('../pages/SignInPage'));
const StartPage = lazy(() => import('../pages/StartPage'));
const InvitesPage = lazy(() => import('../pages/InvitesPage'));
const NewWorkspacePage = lazy(() => import('../pages/NewWorkspacePage'));
const WorkspaceLayout = lazy(() => import('../features/shell/WorkspaceLayout'));
const WorkspaceHomePage = lazy(() => import('../pages/WorkspaceHomePage'));
const MembersPage = lazy(() => import('../pages/MembersPage'));
const MyWorkPage = lazy(() => import('../features/mywork/MyWorkPage'));
const TimesheetPage = lazy(() => import('../features/time/TimesheetPage'));
const BoardPage = lazy(() => import('../features/board/BoardPage'));
const DevComponentsPage = lazy(() => import('../pages/DevComponentsPage'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'));

function Authed() {
  return (
    <RequireAuth>
      <Outlet />
    </RequireAuth>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<FullPageSpinner />}>
            <Routes>
              <Route path="/signin" element={<SignInPage />} />
              <Route path="/dev/components" element={<DevComponentsPage />} />
              <Route element={<Authed />}>
                <Route path="/" element={<StartPage />} />
                <Route path="/invites" element={<InvitesPage />} />
                <Route path="/new" element={<NewWorkspacePage />} />
                <Route path="/w/:wid" element={<WorkspaceLayout />}>
                  <Route index element={<WorkspaceHomePage />} />
                  <Route path="members" element={<MembersPage />} />
                  <Route path="my-work" element={<MyWorkPage />} />
                  <Route path="timesheet" element={<TimesheetPage />} />
                  <Route path="b/:bid" element={<BoardPage />} />
                </Route>
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
        <UsageMeterGate />
      </AuthProvider>
    </ErrorBoundary>
  );
}
