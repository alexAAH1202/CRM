import { zodResolver } from '@hookform/resolvers/zod';
import { createWorkspaceFormSchema, type CreateWorkspaceForm } from '@app/shared';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { Logo } from '../components/Logo';
import { Button, EmptyState, TextField } from '../components/ui';
import { useCurrentUser } from '../features/auth/AuthProvider';
import { createWorkspace } from '../features/workspaces/api';
import { useSessionStore } from '../features/workspaces/sessionStore';
import { friendlyError } from '../lib/firestore/errors';
import { toast } from '../stores/toast';

export default function NewWorkspacePage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const { status, canCreate, workspaces, refresh } = useSessionStore();
  const form = useForm<CreateWorkspaceForm>({
    resolver: zodResolver(createWorkspaceFormSchema),
    defaultValues: { name: '' },
  });

  useEffect(() => {
    if (status === 'idle') void refresh(user);
  }, [status, user, refresh]);

  if (status !== 'ready') return <FullPageSpinner />;
  if (!canCreate) {
    return (
      <EmptyState
        title="Creating households is restricted"
        body="Only approved accounts can create households. Ask an admin to invite you instead."
        action={
          <Link to="/" className="font-semibold text-primary underline">
            Go back
          </Link>
        }
      />
    );
  }

  const onSubmit = form.handleSubmit(async ({ name }) => {
    try {
      const wid = await createWorkspace(user, name);
      await refresh(user);
      toast.success('Household created');
      navigate(`/w/${wid}`, { replace: true });
    } catch (err) {
      toast.error(friendlyError(err));
    }
  });

  return (
    <div className="flex min-h-full flex-col">
      <header className="px-6 py-4">
        <Logo />
      </header>
      <main className="flex flex-1 items-start justify-center p-6 sm:items-center">
        <form
          onSubmit={onSubmit}
          noValidate
          className="w-full max-w-md space-y-6 rounded-3xl bg-surface p-8 shadow-pop"
        >
          <div className="space-y-1">
            <h1 className="text-2xl font-extrabold">
              {workspaces.length === 0 ? 'Create your household' : 'New household'}
            </h1>
            <p className="text-sm text-muted">
              A household holds your shared lists — bills, chores, renewals and more. You'll be its
              admin.
            </p>
          </div>
          <TextField
            label="Household name"
            placeholder="e.g. Our household"
            autoFocus
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <div className="flex justify-end gap-2">
            {workspaces.length > 0 && (
              <Button variant="ghost" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Create household
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
