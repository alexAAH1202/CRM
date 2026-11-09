import { LayoutGrid, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';
import { useWorkspace } from '../features/workspaces/WorkspaceProvider';

export default function WorkspaceHomePage() {
  const { workspace, role } = useWorkspace();
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-extrabold">{workspace.name}</h1>
      <EmptyState
        icon={<LayoutGrid size={28} />}
        title="No boards yet"
        body="Boards, groups and items are coming in the next phase. For now you can invite the people you share life admin with."
        action={
          role === 'admin' ? (
            <Link
              to={`/w/${workspace.id}/members`}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover"
            >
              <Users size={16} aria-hidden /> Invite people
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}
