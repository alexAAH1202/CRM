import { COLUMN_META, COLUMN_TYPES, type Column, type ColumnType } from '@app/shared';
import { useMemo, useState } from 'react';
import { Button, Modal, SelectField } from '../../components/ui';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { applyColumnConversion, convertColumn } from '../boards/api';
import type { Board, BoardItem, WorkspaceMember } from '../boards/types';
import { Cell } from './cells';

export function ChangeTypeDialog({
  wid,
  uid,
  board,
  column,
  items,
  members,
  onClose,
}: {
  wid: string;
  uid: string;
  board: Board;
  column: Column;
  items: BoardItem[];
  members: WorkspaceMember[];
  onClose: () => void;
}) {
  const live = useMemo(() => items.filter((i) => !i.deleted), [items]);
  const [newType, setNewType] = useState<ColumnType>(
    COLUMN_TYPES.find((t) => t !== column.type) ?? 'text',
  );
  const [busy, setBusy] = useState(false);

  const result = useMemo(() => {
    const byName = new Map<string, string>();
    for (const m of members) {
      byName.set(m.name.toLowerCase(), m.uid);
      byName.set(m.email.toLowerCase(), m.uid);
    }
    const nameOf = new Map(members.map((m) => [m.uid, m.name]));
    return convertColumn(
      column,
      newType,
      live.map((i) => ({ id: i.id, value: i.values[column.id] })),
      {
        memberName: (u) => nameOf.get(u) ?? u,
        uidByName: (n) => byName.get(n.toLowerCase()) ?? null,
      },
    );
  }, [column, newType, live, members]);

  const rewrites = result.changes.length;
  const newLabels =
    result.column.settings.labels?.length ?? result.column.settings.options?.length ?? 0;
  const createdLabels =
    (newType === 'status' || newType === 'dropdown') &&
    column.type !== 'status' &&
    column.type !== 'dropdown';

  async function apply() {
    setBusy(true);
    try {
      await applyColumnConversion({ wid, board, uid, oldType: column.type, result, items: live });
      toast.success(`“${column.title}” is now ${COLUMN_META[newType].label}`);
      onClose();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Change type of “${column.title}”`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={busy}>
            Change to {COLUMN_META[newType].label}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SelectField
          label="New type"
          value={newType}
          onChange={(e) => setNewType(e.target.value as ColumnType)}
        >
          {COLUMN_TYPES.filter((t) => t !== column.type).map((t) => (
            <option key={t} value={t}>
              {COLUMN_META[t].label} — {COLUMN_META[t].description}
            </option>
          ))}
        </SelectField>
        <div className="space-y-1 rounded-2xl bg-surface-2 p-4 text-sm" aria-live="polite">
          <p>
            <strong>{result.kept}</strong> value{result.kept === 1 ? '' : 's'} will carry over.
          </p>
          {result.cleared > 0 ? (
            <p className="text-danger">
              <strong>{result.cleared}</strong> value{result.cleared === 1 ? '' : 's'} can’t be
              converted and will be cleared.
            </p>
          ) : (
            <p className="text-muted">Nothing will be lost.</p>
          )}
          {createdLabels && newLabels > 0 && (
            <p className="text-muted">
              {newLabels} label{newLabels === 1 ? '' : 's'} will be created from the existing
              values.
            </p>
          )}
          {rewrites > 25 && <p className="text-muted">This updates {rewrites} items.</p>}
        </div>
        <p className="text-xs text-muted">
          This changes the column for everyone and can’t be undone automatically.
        </p>
      </div>
    </Modal>
  );
}

export function DefaultValueDialog({
  column,
  onSave,
  onClose,
}: {
  column: Column;
  onSave: (value: unknown) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<unknown>(column.settings.defaultValue ?? null);
  const dummy: BoardItem = {
    id: 'default',
    name: 'new item',
    groupId: '',
    order: 'a0',
    parentId: null,
    itemNumber: 0,
    values: { [column.id]: draft },
    assigneeUids: [],
    archived: false,
    deleted: false,
    createdBy: '',
    createdAtMs: null,
    updatedAtMs: null,
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Default value for “${column.title}”`}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              onSave(null);
              onClose();
            }}
          >
            Clear default
          </Button>
          <Button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        New items start with this value. Click the box to set it.
      </p>
      <div className="h-11 overflow-hidden rounded-xl border border-border bg-surface">
        <Cell
          column={column}
          item={dummy}
          itemName="new item"
          canEdit
          members={[]}
          onChange={setDraft}
        />
      </div>
    </Modal>
  );
}
