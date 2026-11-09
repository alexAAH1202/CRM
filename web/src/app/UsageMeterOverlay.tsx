import { useState, useSyncExternalStore } from 'react';
import { meter } from '../lib/firestore/meter';

/** Dev overlay: estimated Firestore reads/writes this session, by label. */
export default function UsageMeterOverlay() {
  const s = useSyncExternalStore(meter.subscribe, meter.getSnapshot);
  const [expanded, setExpanded] = useState(false);
  const minutes = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
  return (
    <aside
      aria-label="Firestore usage meter"
      className="fixed right-3 bottom-3 z-[70] rounded-2xl border border-border bg-surface/95 p-3 font-mono text-xs shadow-pop backdrop-blur"
    >
      <button
        type="button"
        className="flex gap-3"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span>R {s.reads}</span>
        <span>W {s.writes}</span>
        <span>D {s.deletes}</span>
        <span>L {s.activeListeners}</span>
        <span className="text-muted">{minutes}m</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1">
          <table className="w-full">
            <thead className="text-muted">
              <tr>
                <th className="pr-3 text-left font-normal">label</th>
                <th className="pr-2 text-right font-normal">R</th>
                <th className="pr-2 text-right font-normal">W</th>
                <th className="text-right font-normal">D</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(s.byLabel).map(([label, c]) => (
                <tr key={label}>
                  <td className="pr-3">{label}</td>
                  <td className="pr-2 text-right">{c.reads}</td>
                  <td className="pr-2 text-right">{c.writes}</td>
                  <td className="text-right">{c.deletes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="text-primary underline" onClick={() => meter.reset()}>
            reset
          </button>
        </div>
      )}
    </aside>
  );
}
