import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

/** Shown while the browser has no connection. Firestore keeps working from its local cache. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-border bg-surface-3 px-4 py-2 text-sm font-semibold"
    >
      <WifiOff size={16} aria-hidden />
      You’re offline. Keep working: changes are saved on this device and sent when you’re back. Some
      things (like creating items from automations) need a connection.
    </div>
  );
}
