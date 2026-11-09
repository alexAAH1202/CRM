import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="mx-auto mt-24 max-w-md rounded-3xl bg-surface p-8 text-center shadow-pop"
      >
        {/dynamically imported module|Loading chunk|Importing a module script failed/i.test(
          this.state.error.message,
        ) ? (
          <>
            <h1 className="text-xl font-bold">Sorted has been updated</h1>
            <p className="mt-2 text-sm text-muted">Reload to get the new version.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted">{this.state.error.message}</p>
          </>
        )}
        <button
          type="button"
          className="mt-6 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
