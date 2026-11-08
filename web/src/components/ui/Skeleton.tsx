import { cx } from '../../lib/cx';

/** Placeholder block with fixed dimensions so loading never shifts layout. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded-lg bg-surface-3', className)} />;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
