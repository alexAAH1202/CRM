import { HELPER_VERSION, HelperError, type WhoAmI } from '@app/shared';
import { CheckCircle2, CircleAlert, CircleDashed, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui';
import { callHelper, helperConfigured } from '../../lib/helper';
import { useWorkspace } from '../workspaces/WorkspaceProvider';

type State =
  | { kind: 'unconfigured' }
  | { kind: 'checking' }
  | { kind: 'ok'; me: WhoAmI }
  | { kind: 'error'; message: string; code: string };

/**
 * Admin-only card: is the Apps Script helper deployed, reachable and up to date? It asks the
 * helper who it thinks we are, which also proves the sign-in check and the workspace lookup work.
 */
export function HelperStatus() {
  const { workspace } = useWorkspace();
  const [state, setState] = useState<State>(
    helperConfigured() ? { kind: 'checking' } : { kind: 'unconfigured' },
  );

  const check = useCallback(() => {
    if (!helperConfigured()) return;
    setState({ kind: 'checking' });
    callHelper('whoami', { workspaceId: workspace.id }, { retries: 1 })
      .then((me) => setState({ kind: 'ok', me }))
      .catch((e: unknown) =>
        setState({
          kind: 'error',
          code: e instanceof HelperError ? e.code : 'internal',
          message: e instanceof Error ? e.message : 'Unknown problem.',
        }),
      );
  }, [workspace.id]);

  useEffect(() => {
    check();
  }, [check]);

  const outdated = state.kind === 'ok' && state.me.version !== HELPER_VERSION;

  return (
    <section aria-labelledby="helper-h" className="space-y-3 rounded-3xl bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <h2 id="helper-h" className="flex-1 text-lg font-bold">
          Sorted helper
        </h2>
        {helperConfigured() && (
          <Button
            size="sm"
            variant="secondary"
            onClick={check}
            disabled={state.kind === 'checking'}
          >
            <RefreshCw size={14} aria-hidden /> Check again
          </Button>
        )}
      </div>
      <p className="text-sm text-muted">
        A small Google Apps Script that handles the things a browser can’t: reminders and scheduled
        automations, file uploads to Drive, email digests and backups.
      </p>
      {state.kind === 'unconfigured' && (
        <p role="status" className="flex items-center gap-2 text-sm">
          <CircleDashed size={16} aria-hidden className="text-muted" />
          Not set up yet. The steps are in <code>docs/SETUP.md</code> (section B4).
        </p>
      )}
      {state.kind === 'checking' && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <CircleDashed size={16} aria-hidden /> Checking…
        </p>
      )}
      {state.kind === 'ok' && (
        <div role="status" className="space-y-1 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 size={16} aria-hidden className="text-primary" />
            Connected
            {state.me.role
              ? ` · you are ${state.me.role === 'admin' ? 'an admin' : `a ${state.me.role}`} here`
              : ''}
          </p>
          <p className="text-muted">
            Helper version {state.me.version} · time zone {state.me.config.timeZone} · Drive folder{' '}
            {state.me.config.driveFolder ? 'set' : 'not set'}
          </p>
          {outdated && (
            <p className="text-danger">
              The deployed helper is version {state.me.version} but this app expects{' '}
              {HELPER_VERSION}. Paste the latest <code>Code.js</code> and deploy a new version
              (SETUP B4.6).
            </p>
          )}
        </div>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            {state.message} <span className="text-muted">({state.code})</span>
          </span>
        </p>
      )}
    </section>
  );
}
