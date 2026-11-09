import {
  Archive,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  LayoutGrid,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button, Modal, Popover, TextField } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { createFolder, deleteFolder, renameFolder, setFavorite } from '../boards/api';
import { useBoards } from '../boards/BoardsProvider';
import { boardColor, byBoardName } from '../boards/boardStyle';
import { CreateBoardDialog } from '../boards/CreateBoardDialog';
import type { BoardSummary, Folder } from '../boards/types';
import { useWorkspace } from '../workspaces/WorkspaceProvider';

const navItem = ({ isActive }: { isActive: boolean }) =>
  cx(
    'flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold',
    isActive ? 'bg-primary-soft text-primary' : 'text-fg hover:bg-surface-2',
  );

const COLLAPSED_KEY = 'collapsedFolders';
function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function BoardRow({
  board,
  base,
  onNavigate,
}: {
  board: BoardSummary;
  base: string;
  onNavigate: (() => void) | undefined;
}) {
  const user = useCurrentUser();
  const { favorites } = useBoards();
  const fav = favorites.has(board.id);
  const color = boardColor(board.id);
  return (
    <div className="group/board flex items-center">
      <NavLink to={`${base}/${board.id}`} className={navItem} onClick={onNavigate}>
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: color.bg, color: color.text }}
        >
          <LayoutGrid size={14} />
        </span>
        <span className="truncate">{board.name}</span>
        {board.visibility === 'private' && (
          <Lock size={12} aria-label="Private" className="ml-auto shrink-0 text-muted" />
        )}
      </NavLink>
      <button
        type="button"
        aria-pressed={fav}
        aria-label={
          fav ? `Remove ${board.name} from favourites` : `Add ${board.name} to favourites`
        }
        title={fav ? 'Remove from favourites' : 'Add to favourites'}
        onClick={() => {
          const next = fav
            ? [...favorites].filter((id) => id !== board.id)
            : [...favorites, board.id];
          setFavorite(user.uid, next).catch((err: unknown) => toast.error(friendlyError(err)));
        }}
        className={cx(
          '-ml-8 mr-1 shrink-0 rounded-md p-1.5 hover:bg-surface-3',
          fav
            ? 'text-[#f59f2a]'
            : 'text-muted opacity-0 group-hover/board:opacity-100 focus-visible:opacity-100',
        )}
      >
        <Star size={14} aria-hidden fill={fav ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}

function FolderDialog({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  initial: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const save = () => {
    if (name.trim()) {
      onSave(name.trim());
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField
          label="Folder name"
          autoFocus
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </form>
    </Modal>
  );
}

function FolderMenu({
  folder,
  onRename,
  onDelete,
}: {
  folder: Folder;
  onRename: () => void;
  onDelete: () => void;
}) {
  const item =
    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2';
  return (
    <Popover
      label={`Folder ${folder.name} options`}
      className="w-48"
      placement="bottom-end"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          aria-label={`Options for folder ${folder.name}`}
          className="rounded-md p-1 text-muted opacity-0 hover:bg-surface-3 focus-visible:opacity-100 group-hover/folder:opacity-100 aria-expanded:opacity-100"
        >
          <MoreHorizontal size={14} aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col">
          <button
            type="button"
            className={item}
            onClick={() => {
              close();
              onRename();
            }}
          >
            <Pencil size={14} aria-hidden /> Rename
          </button>
          <button
            type="button"
            className={cx(item, 'text-danger')}
            onClick={() => {
              close();
              onDelete();
            }}
          >
            <Trash2 size={14} aria-hidden /> Delete folder
          </button>
        </div>
      )}
    </Popover>
  );
}

export function BoardList({ onNavigate }: { onNavigate?: () => void }) {
  const user = useCurrentUser();
  const { workspace, role } = useWorkspace();
  const { boards, archived, folders, favorites } = useBoards();
  const [creating, setCreating] = useState(false);
  const [folderDialog, setFolderDialog] = useState<
    { mode: 'new' } | { mode: 'rename'; folder: Folder } | null
  >(null);
  const [deleting, setDeleting] = useState<Folder | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const base = `/w/${workspace.id}/b`;
  const canCreate = role !== 'viewer';
  const fail = (err: unknown) => toast.error(friendlyError(err));

  const toggleFolder = (id: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...n]));
      } catch {
        /* ignore */
      }
      return n;
    });

  const folderIds = new Set(folders.map((f) => f.id));
  const sorted = [...(boards ?? [])].sort(byBoardName);
  const favoriteBoards = sorted.filter((b) => favorites.has(b.id));
  const loose = sorted.filter((b) => !b.folderId || !folderIds.has(b.folderId));
  const label = 'px-3 text-xs font-bold tracking-wide text-muted uppercase';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1">
        <h2 className={cx(label, 'px-0')}>Lists</h2>
        {canCreate && (
          <Popover
            label="Create"
            className="w-48"
            placement="bottom-end"
            trigger={(p) => (
              <button
                type="button"
                {...p}
                aria-label="New list or folder"
                title="New list or folder"
                className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-fg"
              >
                <Plus size={16} aria-hidden />
              </button>
            )}
          >
            {(close) => (
              <div className="flex flex-col">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
                  onClick={() => {
                    close();
                    setCreating(true);
                  }}
                >
                  <LayoutGrid size={14} aria-hidden /> New list
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
                  onClick={() => {
                    close();
                    setFolderDialog({ mode: 'new' });
                  }}
                >
                  <FolderPlus size={14} aria-hidden /> New folder
                </button>
              </div>
            )}
          </Popover>
        )}
      </div>

      <nav aria-label="Lists" className="flex min-h-0 flex-col gap-0.5 overflow-y-auto pb-2">
        {boards === null ? (
          <p className="px-3 py-2 text-sm text-muted">Loading…</p>
        ) : boards.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted">No lists yet.</p>
        ) : (
          <>
            {favoriteBoards.length > 0 && (
              <section aria-label="Favourites" className="mb-2 space-y-0.5">
                <h3 className={cx(label, 'flex items-center gap-1 py-1')}>
                  <Star size={11} aria-hidden /> Favourites
                </h3>
                {favoriteBoards.map((b) => (
                  <BoardRow key={`fav-${b.id}`} board={b} base={base} onNavigate={onNavigate} />
                ))}
              </section>
            )}

            {folders.map((f) => {
              const inside = sorted.filter((b) => b.folderId === f.id);
              const open = !collapsed.has(f.id);
              return (
                <section key={f.id} aria-label={`Folder ${f.name}`} className="space-y-0.5">
                  <div className="group/folder flex items-center pr-1">
                    <button
                      type="button"
                      onClick={() => toggleFolder(f.id)}
                      aria-expanded={open}
                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-xs font-bold text-muted hover:bg-surface-2 hover:text-fg"
                    >
                      {open ? (
                        <ChevronDown size={14} aria-hidden />
                      ) : (
                        <ChevronRight size={14} aria-hidden />
                      )}
                      <span className="truncate">{f.name}</span>
                      <span className="font-normal">({inside.length})</span>
                    </button>
                    {canCreate && (
                      <FolderMenu
                        folder={f}
                        onRename={() => setFolderDialog({ mode: 'rename', folder: f })}
                        onDelete={() => setDeleting(f)}
                      />
                    )}
                  </div>
                  {open && (
                    <div className="space-y-0.5 pl-3">
                      {inside.length === 0 ? (
                        <p className="px-3 py-1 text-xs text-muted">
                          Empty — move lists here from List settings.
                        </p>
                      ) : (
                        inside.map((b) => (
                          <BoardRow key={b.id} board={b} base={base} onNavigate={onNavigate} />
                        ))
                      )}
                    </div>
                  )}
                </section>
              );
            })}

            {loose.length > 0 && folders.length > 0 && (
              <h3 className={cx(label, 'pt-2 pb-1')}>Other lists</h3>
            )}
            {loose.map((b) => (
              <BoardRow key={b.id} board={b} base={base} onNavigate={onNavigate} />
            ))}
          </>
        )}

        {archived.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
              className="mt-2 flex items-center gap-2 px-3 py-1 text-xs font-semibold text-muted hover:text-fg"
            >
              {showArchived ? (
                <ChevronDown size={14} aria-hidden />
              ) : (
                <ChevronRight size={14} aria-hidden />
              )}
              <Archive size={12} aria-hidden /> Archived ({archived.length})
            </button>
            {showArchived &&
              [...archived].sort(byBoardName).map((b) => (
                <NavLink
                  key={b.id}
                  to={`${base}/${b.id}`}
                  className={(s) => cx(navItem(s), 'opacity-70')}
                  onClick={onNavigate}
                >
                  <span className="truncate">{b.name}</span>
                </NavLink>
              ))}
          </>
        )}
      </nav>

      <CreateBoardDialog open={creating} onClose={() => setCreating(false)} />
      {folderDialog && (
        <FolderDialog
          title={folderDialog.mode === 'new' ? 'New folder' : 'Rename folder'}
          initial={folderDialog.mode === 'rename' ? folderDialog.folder.name : ''}
          onClose={() => setFolderDialog(null)}
          onSave={(name) => {
            const p =
              folderDialog.mode === 'new'
                ? createFolder(workspace.id, user.uid, name, folders.at(-1)?.order ?? null)
                : renameFolder(workspace.id, folderDialog.folder.id, name);
            p.catch(fail);
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        danger
        title={`Delete folder “${deleting?.name}”?`}
        body="Lists inside move out of the folder into the main sidebar. Nothing else is deleted."
        confirmLabel="Delete folder"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const ids = (boards ?? [])
            .concat(archived)
            .filter((b) => b.folderId === deleting.id)
            .map((b) => b.id);
          await deleteFolder(workspace.id, deleting.id, ids).catch(fail);
        }}
      />
    </div>
  );
}
