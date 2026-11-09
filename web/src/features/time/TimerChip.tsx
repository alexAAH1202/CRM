import { Square, Timer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useWorkspace } from '../workspaces/WorkspaceProvider';
import { clock, useNow, useTimer } from './TimerProvider';

/** Shown anywhere in the household while you have a timer running: elapsed time, jump, stop. */
export function TimerChip({ onNavigate }: { onNavigate?: () => void }) {
  const { running, stop, busy } = useTimer();
  if (!running) return null;
  return <Running onNavigate={onNavigate} stop={stop} busy={busy} />;
}

function Running({
  onNavigate,
  stop,
  busy,
}: {
  onNavigate: (() => void) | undefined;
  stop: () => void;
  busy: boolean;
}) {
  const { running } = useTimer();
  const { workspace } = useWorkspace();
  const now = useNow();
  if (!running) return null;
  return (
    <div
      role="status"
      aria-label="Timer running"
      className="flex items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-sm font-semibold text-primary"
    >
      <Timer size={16} aria-hidden className="shrink-0" />
      <Link
        to={`/w/${workspace.id}/b/${running.boardId}?item=${running.itemId}`}
        onClick={onNavigate}
        className="min-w-0 flex-1 truncate tabular-nums underline-offset-2 hover:underline"
        title="Open the item you're timing"
      >
        {clock(now - running.startedAtMs)}
      </Link>
      <button
        type="button"
        onClick={stop}
        disabled={busy}
        aria-label="Stop timer"
        className="rounded-lg p-1.5 hover:bg-surface/60 disabled:opacity-50"
      >
        <Square size={14} aria-hidden fill="currentColor" />
      </button>
    </div>
  );
}
