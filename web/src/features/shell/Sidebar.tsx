import { TimerChip } from '../time/TimerChip';
import {
  Check,
  ChevronsUpDown,
  Home,
  ListChecks,
  LogOut,
  Mail,
  Menu,
  Plus,
  Search,
  Users,
  Clock,
  LayoutDashboard,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { RoleBadge } from '../../components/RoleBadge';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Avatar, Popover } from '../../components/ui';
import { cx } from '../../lib/cx';
import { signOutUser, useCurrentUser } from '../auth/AuthProvider';
import { BoardList } from './BoardList';
import { useOpenSearch } from './searchContext';
import { NotificationBell } from '../notifications/NotificationBell';
import { useSessionStore } from '../workspaces/sessionStore';
import { useWorkspace } from '../workspaces/WorkspaceProvider';

function WorkspaceSwitcher() {
  const user = useCurrentUser();
  const { workspace, role } = useWorkspace();
  const { status, workspaces, invites, canCreate, refresh } = useSessionStore();

  useEffect(() => {
    if (status === 'idle') void refresh(user);
  }, [status, user, refresh]);

  return (
    <Popover
      label="Switch household"
      className="w-64"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className="flex w-full items-center gap-2 rounded-2xl px-2 py-2 text-left hover:bg-surface-2"
        >
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-extrabold text-on-primary"
          >
            {workspace.name.slice(0, 1).toUpperCase() || 'W'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{workspace.name}</span>
            <span className="block text-xs text-muted capitalize">{role}</span>
          </span>
          <ChevronsUpDown size={16} aria-hidden className="text-muted" />
        </button>
      )}
    >
      {(close) => (
        <nav aria-label="Households" className="flex flex-col">
          {workspaces.map((w) => (
            <Link
              key={w.id}
              to={`/w/${w.id}`}
              onClick={close}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-2"
              aria-current={w.id === workspace.id ? 'page' : undefined}
            >
              <span className="flex-1 truncate">{w.name}</span>
              {w.id === workspace.id && <Check size={16} aria-label="Current" />}
            </Link>
          ))}
          {invites.length > 0 && (
            <Link
              to="/invites"
              onClick={close}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-2"
            >
              <Mail size={16} aria-hidden /> {invites.length} pending invitation
              {invites.length > 1 ? 's' : ''}
            </Link>
          )}
          {canCreate && (
            <Link
              to="/new"
              onClick={close}
              className="mt-1 flex items-center gap-2 rounded-lg border-t border-border px-3 py-2 text-sm font-semibold text-primary hover:bg-surface-2"
            >
              <Plus size={16} aria-hidden /> New household
            </Link>
          )}
        </nav>
      )}
    </Popover>
  );
}

const navItem = ({ isActive }: { isActive: boolean }) =>
  cx(
    'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold',
    isActive ? 'bg-primary-soft text-primary' : 'text-fg hover:bg-surface-2',
  );

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const user = useCurrentUser();
  const { workspace, role } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const name = user.displayName ?? user.email ?? 'You';
  const openSearch = useOpenSearch();

  return (
    <aside className="flex h-full flex-col gap-4 border-r border-border bg-surface p-3">
      <div className="flex items-center px-2 pt-1">
        <div className="flex-1">
          <Logo />
        </div>
        <NotificationBell />
      </div>
      <WorkspaceSwitcher />
      <nav aria-label="Household" className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => {
            openSearch();
            onNavigate?.();
          }}
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-fg hover:bg-surface-2"
        >
          <Search size={18} aria-hidden /> Search
          <kbd className="ml-auto rounded border border-border px-1.5 text-xs font-normal text-muted">
            Ctrl K
          </kbd>
        </button>
        <NavLink to={base} end className={navItem} onClick={onNavigate}>
          <Home size={18} aria-hidden /> Home
        </NavLink>
        <NavLink to={`${base}/my-work`} className={navItem} onClick={onNavigate}>
          <ListChecks size={18} aria-hidden /> My work
        </NavLink>
        <NavLink to={`${base}/dashboards`} className={navItem} onClick={onNavigate}>
          <LayoutDashboard size={18} aria-hidden /> Dashboards
        </NavLink>
        <NavLink to={`${base}/timesheet`} className={navItem} onClick={onNavigate}>
          <Clock size={18} aria-hidden /> Timesheet
        </NavLink>
        <NavLink to={`${base}/members`} className={navItem} onClick={onNavigate}>
          <Users size={18} aria-hidden /> Members
        </NavLink>
      </nav>
      <TimerChip {...(onNavigate ? { onNavigate } : {})} />
      <BoardList {...(onNavigate ? { onNavigate } : {})} />
      <div className="space-y-3 border-t border-border pt-3">
        <div className="flex items-center gap-2 px-1">
          <Avatar name={name} photoURL={user.photoURL} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{name}</p>
            <RoleBadge role={role} />
          </div>
          <button
            type="button"
            onClick={() => void signOutUser()}
            aria-label="Sign out"
            title="Sign out"
            className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg"
          >
            <LogOut size={18} aria-hidden />
          </button>
        </div>
        <div className="px-1">
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

export function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  const { workspace } = useWorkspace();
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2 md:hidden">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open navigation"
        className="rounded-lg p-2 hover:bg-surface-2"
      >
        <Menu size={20} aria-hidden />
      </button>
      <span className="flex-1 truncate font-bold">{workspace.name}</span>
      <NotificationBell />
    </div>
  );
}
