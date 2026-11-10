import { Gauge } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Popover } from '../../components/ui';
import { meter } from '../../lib/firestore/meter';
import { FREE_LIMITS, pacificDay, readLog, type DayUsage } from './dailyUsage';

const CONSOLE_URL =
  'https://console.firebase.google.com/project/life-management-de315/firestore/usage';

function Bar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, (used / limit) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-muted">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} today`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="h-2.5 overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className={pct >= 60 ? 'h-full bg-danger' : 'h-full bg-primary'}
          style={{ width: `${Math.max(pct, used > 0 ? 1 : 0)}%` }}
        />
      </div>
    </div>
  );
}

/** Sidebar button + pop-up: database use from this device today, against the free daily limits. */
export function UsagePopup() {
  // re-read the stored log whenever the session meter moves
  useSyncExternalStore(meter.subscribe, meter.getSnapshot);
  const [log, setLog] = useState(readLog);
  const snap = meter.getSnapshot();
  useEffect(() => {
    const t = setTimeout(() => setLog(readLog()), 1100);
    return () => clearTimeout(t);
  }, [snap]);
  const today = log[pacificDay(Date.now())] ?? ({ reads: 0, writes: 0, deletes: 0 } as DayUsage);
  const week = Object.entries(log).sort(([a], [b]) => b.localeCompare(a));

  return (
    <Popover
      label="Database usage"
      className="w-80"
      placement="top-start"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-fg hover:bg-surface-2"
        >
          <Gauge size={18} aria-hidden /> Database usage
          <span className="ml-auto text-xs font-normal text-muted tabular-nums">
            {((today.reads / FREE_LIMITS.reads) * 100).toFixed(1)}%
          </span>
        </button>
      )}
    >
      <div className="space-y-3 p-1">
        <p className="text-sm font-bold">Today, from this device</p>
        <Bar label="Reads" used={today.reads} limit={FREE_LIMITS.reads} />
        <Bar label="Writes" used={today.writes} limit={FREE_LIMITS.writes} />
        <Bar label="Deletes" used={today.deletes} limit={FREE_LIMITS.deletes} />
        <p className="text-xs text-muted">
          Free daily limits, reset at midnight US Pacific time. This counts only what this device
          has done (an estimate); everyone else and the Sorted helper add to the real total.
        </p>
        {week.length > 1 && (
          <table className="w-full text-xs" aria-label="Last 7 days">
            <thead className="text-muted">
              <tr>
                <th className="text-left font-normal">Day</th>
                <th className="text-right font-normal">Reads</th>
                <th className="text-right font-normal">Writes</th>
              </tr>
            </thead>
            <tbody>
              {week.map(([d, u]) => (
                <tr key={d}>
                  <td>{d}</td>
                  <td className="text-right tabular-nums">{u.reads.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{u.writes.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <a
          href={CONSOLE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-sm font-semibold text-primary underline underline-offset-2"
        >
          See the whole household in the Firebase console
        </a>
      </div>
    </Popover>
  );
}
