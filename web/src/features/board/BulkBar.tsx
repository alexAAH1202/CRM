import { COLUMN_META, LABEL_COLORS, type Column, type Group } from '@app/shared';
import { Archive, ArchiveRestore, Copy, FolderInput, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Button, Modal, Popover, SelectField } from '../../components/ui';
import type { BoardItem, WorkspaceMember } from '../boards/types';
import { Cell } from './cells';

export interface BulkBarProps {
  count: number;
  columns: Column[];
  groups: Group[];
  members: WorkspaceMember[];
  allArchived: boolean;
  canMove: boolean;
  onSetValue: (column: Column, value: unknown) => void;
  onMove: (groupId: string) => void;
  onDuplicate: () => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
  onClear: () => void;
}

const btn =
  'inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold hover:bg-surface-3 disabled:opacity-50';

function SetValueDialog({
  columns,
  members,
  onApply,
  onClose,
}: {
  columns: Column[];
  members: WorkspaceMember[];
  onApply: (c: Column, v: unknown) => void;
  onClose: () => void;
}) {
  const [colId, setColId] = useState(columns[0]?.id ?? '');
  const [draft, setDraft] = useState<unknown>(null);
  const column = columns.find((c) => c.id === colId);
  const dummy: BoardItem = {
    id: 'bulk',
    name: 'selected items',
    groupId: '',
    order: 'a0',
    parentId: null,
    itemNumber: 0,
    values: column ? { [column.id]: draft } : {},
    assigneeUids: [],
    archived: false,
    deleted: false,
    createdBy: '',
    updatedAtMs: null,
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Set a value"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!column}
            onClick={() => {
              if (column) onApply(column, draft);
              onClose();
            }}
          >
            Apply to selected
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SelectField
          label="Column"
          value={colId}
          onChange={(e) => {
            setColId(e.target.value);
            setDraft(null);
          }}
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} ({COLUMN_META[c.type].label})
            </option>
          ))}
        </SelectField>
        {column && (
          <div>
            <p className="mb-1 text-sm font-semibold">Value</p>
            <div className="h-11 overflow-hidden rounded-xl border border-border bg-surface">
              <Cell
                column={column}
                item={dummy}
                itemName="selected items"
                canEdit
                members={members}
                onChange={setDraft}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              Leave it empty to clear this column on every selected item.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function BulkBar(p: BulkBarProps) {
  const [setting, setSetting] = useState(false);
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="sticky bottom-3 z-30 mx-auto mt-2 flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1 rounded-2xl border border-border bg-surface p-1.5 shadow-pop"
    >
      <span className="px-3 text-sm font-bold" aria-live="polite">
        {p.count} selected
      </span>
      <button type="button" className={btn} onClick={() => setSetting(true)}>
        <Pencil size={14} aria-hidden /> Set value
      </button>
      {p.canMove && (
        <Popover
          label="Move selected to group"
          className="w-56"
          placement="top"
          trigger={(t) => (
            <button type="button" {...t} className={btn}>
              <FolderInput size={14} aria-hidden /> Move
            </button>
          )}
        >
          {(close) => (
            <div className="flex flex-col">
              {p.groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
                  onClick={() => {
                    close();
                    p.onMove(g.id);
                  }}
                >
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: LABEL_COLORS[g.color].bg }}
                    aria-hidden
                  />
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </Popover>
      )}
      <button type="button" className={btn} onClick={p.onDuplicate}>
        <Copy size={14} aria-hidden /> Duplicate
      </button>
      <button type="button" className={btn} onClick={() => p.onArchive(!p.allArchived)}>
        {p.allArchived ? (
          <ArchiveRestore size={14} aria-hidden />
        ) : (
          <Archive size={14} aria-hidden />
        )}
        {p.allArchived ? 'Restore' : 'Archive'}
      </button>
      <button type="button" className={`${btn} text-danger`} onClick={p.onDelete}>
        <Trash2 size={14} aria-hidden /> Delete
      </button>
      <button
        type="button"
        className="rounded-xl p-2 text-muted hover:bg-surface-3"
        aria-label="Clear selection"
        onClick={p.onClear}
      >
        <X size={16} aria-hidden />
      </button>
      {setting && (
        <SetValueDialog
          columns={p.columns}
          members={p.members}
          onApply={p.onSetValue}
          onClose={() => setSetting(false)}
        />
      )}
    </div>
  );
}
