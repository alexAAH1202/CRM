import { Bell, Check, Circle, Settings } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Popover } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { useBoards } from '../boards/BoardsProvider';
import { useWorkspace } from '../workspaces/WorkspaceProvider';
import { markAllRead, saveMuted, setRead } from './api';
import { useNotifications } from './NotificationsProvider';

const MUTE_OPTIONS: Array<{ type: string; label: string; soon?: boolean }> = [
  { type: 'mention', label: 'When someone @mentions me' },
  { type: 'assignment', label: 'When I’m assigned to an item' },
  { type: 'due', label: 'When something I own is due', soon: true },
];

/** Bell + inbox. Click a notification to jump to the item; toggle read/unread; mute types. */
export function NotificationBell() {
  const user = useCurrentUser();
  const { workspace } = useWorkspace();
  const { items, unread } = useNotifications();
  const { muted } = useBoards();
  const navigate = useNavigate();
  const [settings, setSettings] = useState(false);
  const fail = (e: unknown) => toast.error(friendlyError(e));

  return (
    <Popover
      label="Notifications"
      placement="bottom-end"
      className="w-[min(24rem,calc(100vw-1rem))] p-0"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg"
        >
          <Bell size={18} aria-hidden />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-bold text-on-danger"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div className="flex max-h-[70vh] flex-col">
          <div className="flex items-center gap-1 border-b border-border px-3 py-2">
            <h2 className="flex-1 text-sm font-bold">Notifications</h2>
            <button
              type="button"
              disabled={unread === 0}
              onClick={() =>
                void markAllRead(
                  workspace.id,
                  user.uid,
                  items.filter((n) => !n.read).map((n) => n.id),
                ).catch(fail)
              }
              className="rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-surface-2 disabled:text-muted disabled:hover:bg-transparent"
            >
              Mark all read
            </button>
            <button
              type="button"
              aria-label="Notification settings"
              aria-pressed={settings}
              onClick={() => setSettings((s) => !s)}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
            >
              <Settings size={14} aria-hidden />
            </button>
          </div>
          {settings && (
            <fieldset className="space-y-1.5 border-b border-border px-3 py-2">
              <legend className="mb-1 text-xs font-bold text-muted">Tell me</legend>
              {MUTE_OPTIONS.map((o) => (
                <label key={o.type} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!muted.has(o.type)}
                    disabled={o.soon}
                    onChange={(e) => {
                      const next = new Set(muted);
                      if (e.target.checked) next.delete(o.type);
                      else next.add(o.type);
                      void saveMuted(user.uid, [...next]).catch(fail);
                    }}
                    className="h-4 w-4 accent-[var(--c-primary)]"
                  />
                  <span className={o.soon ? 'text-muted' : undefined}>
                    {o.label}
                    {o.soon && ' (coming soon: reminders)'}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              You’re all caught up. Mentions and assignments show up here.
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-auto">
              {items.map((n) => (
                <li key={n.id} className="flex items-start border-b border-border last:border-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.read) void setRead(workspace.id, user.uid, n.id, true).catch(fail);
                      close();
                      if (n.link.startsWith('/')) navigate(n.link);
                    }}
                    className="min-w-0 flex-1 px-3 py-2.5 text-left hover:bg-surface-2"
                  >
                    <span className={cx('block text-sm', !n.read && 'font-bold')}>{n.title}</span>
                    {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
                    <span className="block text-xs text-muted">
                      {formatDistanceToNow(n.createdAtMs, { addSuffix: true })}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={n.read ? 'Mark as unread' : 'Mark as read'}
                    title={n.read ? 'Mark as unread' : 'Mark as read'}
                    onClick={() => void setRead(workspace.id, user.uid, n.id, !n.read).catch(fail)}
                    className="m-2 rounded-lg p-1.5 text-muted hover:bg-surface-3 hover:text-fg"
                  >
                    {n.read ? (
                      <Circle size={14} aria-hidden />
                    ) : (
                      <Check size={14} aria-hidden className="text-primary" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Popover>
  );
}
