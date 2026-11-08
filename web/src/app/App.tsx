import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Spinner, Toaster } from '../components/ui';
import { ErrorBoundary } from './ErrorBoundary';
import { UsageMeterGate } from './UsageMeterGate';

// Route-level code splitting keeps the initial bundle small (Hosting bandwidth is metered).
const HomePage = lazy(() => import('../pages/HomePage'));
const DevComponentsPage = lazy(() => import('../pages/DevComponentsPage'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'));

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/dev/components" element={<DevComponentsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster />
      <UsageMeterGate />
    </ErrorBoundary>
  );
}
