import { lazy, Suspense } from 'react';

function meterEnabled(): boolean {
  if (import.meta.env.VITE_USAGE_METER === 'true') return true;
  try {
    return localStorage.getItem('usageMeter') === '1';
  } catch {
    return false;
  }
}

// Lazy so the overlay's code is only downloaded when the flag is on.
const UsageMeterOverlay = lazy(() => import('./UsageMeterOverlay'));

export function UsageMeterGate() {
  if (!meterEnabled()) return null;
  return (
    <Suspense fallback={null}>
      <UsageMeterOverlay />
    </Suspense>
  );
}
