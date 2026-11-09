import type { Role } from '@app/shared';
import { Pill } from './ui';

const ROLE_UI: Record<Role, { label: string; color: 'purple' | 'blue' | 'gray' }> = {
  admin: { label: 'Admin', color: 'purple' },
  member: { label: 'Member', color: 'blue' },
  viewer: { label: 'Viewer', color: 'gray' },
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Manages members, boards and workspace settings',
  member: 'Creates and edits boards and items',
  viewer: 'Read-only access',
};

export function roleLabel(role: Role): string {
  return ROLE_UI[role].label;
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Pill color={ROLE_UI[role].color} className="h-6 px-2.5 text-xs">
      {ROLE_UI[role].label}
    </Pill>
  );
}
