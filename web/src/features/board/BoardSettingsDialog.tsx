import { Archive, ArchiveRestore, Copy, Globe, Lock, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Avatar, Button, Modal, SelectField, TextField } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { deleteBoardCompletely, duplicateBoard, updateBoard } from '../boards/api';
import { useBoards } from '../boards/BoardsProvider';
import type { Board } from '../boards/types';
import { useWorkspace } from '../workspaces/WorkspaceProvider';

export function BoardSettingsDialog({
  board,
  open,
  onClose,
}: {
  board: Board;
  open: boolean;
  onClose: () => void;
}) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const { workspace, role } = useWorkspace();
  const { members, folders, boards, archived } = useBoards();
  const [folderId, setFolderId] = useState<string | null>(board.folderId ?? null);
  const [duplicating, setDuplicating] = useState(false);
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description);
  const [visibility, setVisibility] = useState(board.visibility);
  const [memberIds, setMemberIds] = useState<string[]>(board.memberIds);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canManageAccess = role === 'admin' || board.createdBy === user.uid;
  const fail = (err: unknown) => toast.error(friendlyError(err));

  async function save() {
    const patch: Parameters<typeof updateBoard>[2] = {};
    if (name.trim() && name.trim() !== board.name) patch.name = name.trim();
    if (description !== board.description) patch.description = description.slice(0, 5000);
    if (folderId !== (board.folderId ?? null)) patch.folderId = folderId;
    if (canManageAccess) {
      const ids = visibility === 'private' ? [...new Set([user.uid, ...memberIds])] : [];
      if (visibility !== board.visibility || ids.join() !== board.memberIds.join()) {
        patch.visibility = visibility;
        patch.memberIds = ids;
      }
    }
    if (Object.keys(patch).length) await updateBoard(workspace.id, board.id, patch).catch(fail);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Board settings"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <div className="space-y-5">
        <TextField
          label="Name"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="board-desc" className="text-sm font-semibold">
            Description
          </label>
          <textarea
            id="board-desc"
            rows={3}
            value={description}
            maxLength={5000}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-xl border border-border bg-surface p-3 text-sm focus:border-primary focus:outline-none"
          />
        </div>
        {folders.length > 0 && (
          <SelectField
            label="Folder"
            value={folderId ?? ''}
            onChange={(e) => setFolderId(e.target.value || null)}
          >
            <option value="">(none)</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </SelectField>
        )}
        {canManageAccess && (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">Who can see it</legend>
            <div className="flex gap-2">
              {(
                [
                  ['main', Globe, 'Everyone'],
                  ['private', Lock, 'Private'],
                ] as const
              ).map(([v, Icon, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={visibility === v}
                  onClick={() => setVisibility(v)}
                  className={cx(
                    'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold',
                    visibility === v
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border',
                  )}
                >
                  <Icon size={16} aria-hidden /> {label}
                </button>
              ))}
            </div>
            {visibility === 'private' && (
              <div className="flex flex-col gap-1">
                {(members ?? [])
                  .filter((m) => m.uid !== user.uid)
                  .map((m) => (
                    <label
                      key={m.uid}
                      className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2"
                    >
                      <input
                        type="checkbox"
                        checked={memberIds.includes(m.uid)}
                        onChange={(e) =>
                          setMemberIds((ids) =>
                            e.target.checked ? [...ids, m.uid] : ids.filter((x) => x !== m.uid),
                          )
                        }
                      />
                      <Avatar name={m.name} photoURL={m.photoURL} size="sm" />
                      <span className="text-sm">{m.name}</span>
                      {m.role === 'admin' && (
                        <span className="text-xs text-muted">(admins always have access)</span>
                      )}
                    </label>
                  ))}
              </div>
            )}
          </fieldset>
        )}
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              updateBoard(workspace.id, board.id, { archived: !board.archived })
                .then(() => {
                  toast.info(
                    board.archived
                      ? 'Board restored'
                      : 'Board archived — find it under “Archived” in the sidebar',
                  );
                  onClose();
                })
                .catch(fail)
            }
          >
            {board.archived ? (
              <ArchiveRestore size={14} aria-hidden />
            ) : (
              <Archive size={14} aria-hidden />
            )}
            {board.archived ? 'Restore board' : 'Archive board'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={duplicating}
            onClick={async () => {
              setDuplicating(true);
              try {
                const all = [...(boards ?? []), ...archived];
                const bid = await duplicateBoard({
                  wid: workspace.id,
                  source: board,
                  uid: user.uid,
                  name: `${board.name} (copy)`,
                  lastOrder: all.at(-1)?.order ?? null,
                });
                toast.success('Board duplicated');
                onClose();
                navigate(`/w/${workspace.id}/b/${bid}`);
              } catch (err) {
                fail(err);
              } finally {
                setDuplicating(false);
              }
            }}
          >
            <Copy size={14} aria-hidden /> {duplicating ? 'Duplicating…' : 'Duplicate board'}
          </Button>
          {role === 'admin' && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} aria-hidden /> Delete permanently
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        danger
        title={`Delete “${board.name}” permanently?`}
        body="All of its items are deleted for everyone. This can't be undone — archiving is usually the better choice."
        confirmLabel="Delete forever"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await deleteBoardCompletely(workspace.id, board.id);
            navigate(`/w/${workspace.id}`, { replace: true });
          } catch (err) {
            fail(err);
          }
        }}
      />
    </Modal>
  );
}
