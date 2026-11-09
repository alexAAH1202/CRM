import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && (
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary"
          aria-hidden
        >
          {icon}
        </div>
      )}
      <h2 className="text-lg font-bold">{title}</h2>
      {body && <div className="text-sm text-muted">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
