import {
  COLUMN_META,
  COLUMN_TYPES,
  LABEL_COLOR_NAMES,
  LABEL_COLORS,
  makeColumn,
  shortId,
  type Column,
  type ColumnType,
  type Label,
} from '@app/shared';
import { ChevronDown, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button, Modal, Popover, SelectField, TextField } from '../../components/ui';

const menuItem =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2';

export function AddColumnButton({ onAdd }: { onAdd: (c: Column) => void }) {
  return (
    <Popover
      label="Add column"
      className="w-64"
      placement="bottom-end"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          aria-label="Add column"
          className="flex h-full w-full items-center justify-center text-muted hover:bg-surface-2 hover:text-fg"
        >
          <Plus size={16} aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col">
          {COLUMN_TYPES.map((t: ColumnType) => (
            <button
              key={t}
              type="button"
              className={menuItem}
              onClick={() => {
                onAdd(makeColumn(t));
                close();
              }}
            >
              <span className="flex-1">
                <span className="block font-semibold">{COLUMN_META[t].label}</span>
                <span className="block text-xs text-muted">{COLUMN_META[t].description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

function LabelsEditor({
  title,
  labels,
  onSave,
  onClose,
}: {
  title: string;
  labels: Label[];
  onSave: (labels: Label[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Label[]>(labels);
  const update = (i: number, patch: Partial<Label>) =>
    setDraft((d) => d.map((l, j) => (j === i ? { ...l, ...patch } : l)));
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
          <Button
            onClick={() => {
              onSave(
                draft
                  .filter((l) => l.name.trim() !== '')
                  .map((l) => ({ ...l, name: l.name.trim() })),
              );
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <ul className="space-y-2">
        {draft.map((l, i) => (
          <li key={l.id} className="flex items-center gap-2">
            <span
              className="h-8 w-3 shrink-0 rounded-full"
              style={{ background: LABEL_COLORS[l.color].bg }}
              aria-hidden
            />
            <TextField
              label={`Label ${i + 1} name`}
              hideLabel
              value={l.name}
              maxLength={40}
              className="flex-1"
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <SelectField
              label={`Label ${i + 1} colour`}
              hideLabel
              className="w-32"
              value={l.color}
              onChange={(e) => update(i, { color: e.target.value as Label['color'] })}
            >
              {LABEL_COLOR_NAMES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <button
              type="button"
              aria-label={`Remove ${l.name || 'label'}`}
              onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
              className="rounded-lg p-2 text-muted hover:bg-surface-2"
            >
              <Trash2 size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="mt-3"
        onClick={() =>
          setDraft((d) => [
            ...d,
            {
              id: shortId(),
              name: '',
              color: LABEL_COLOR_NAMES[d.length % LABEL_COLOR_NAMES.length] ?? 'blue',
            },
          ])
        }
      >
        <Plus size={14} aria-hidden /> Add label
      </Button>
      <p className="mt-3 text-xs text-muted">
        Removing a label clears it from any items that use it.
      </p>
    </Modal>
  );
}

function NumberSettings({
  column,
  onSave,
  onClose,
}: {
  column: Column;
  onSave: (c: Column) => void;
  onClose: () => void;
}) {
  const [unit, setUnit] = useState(column.settings.unit ?? '');
  const [pos, setPos] = useState(column.settings.unitPosition ?? 'prefix');
  const [decimals, setDecimals] = useState(column.settings.decimals ?? 0);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${column.title} format`}
      footer={
        <Button
          onClick={() => {
            onSave({
              ...column,
              settings: { ...column.settings, unit: unit.slice(0, 8), unitPosition: pos, decimals },
            });
            onClose();
          }}
        >
          Save
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label="Unit"
          placeholder="$, h, kg"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
        <SelectField
          label="Position"
          value={pos}
          onChange={(e) => setPos(e.target.value as 'prefix' | 'suffix')}
        >
          <option value="prefix">Before ($5)</option>
          <option value="suffix">After (5 h)</option>
        </SelectField>
        <SelectField
          label="Decimals"
          value={decimals}
          onChange={(e) => setDecimals(Number(e.target.value))}
        >
          {[0, 1, 2, 3].map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
      </div>
    </Modal>
  );
}

export function ColumnHeader({
  column,
  canEdit,
  onSave,
  onDelete,
}: {
  column: Column;
  canEdit: boolean;
  onSave: (c: Column) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [dialog, setDialog] = useState<'labels' | 'numbers' | 'delete' | null>(null);
  const title = <span className="truncate">{column.title}</span>;

  if (renaming) {
    return (
      <input
        autoFocus
        defaultValue={column.title}
        aria-label="Column name"
        maxLength={60}
        className="h-full w-full border-2 border-primary bg-surface px-2 text-center text-xs font-semibold outline-none"
        onBlur={(e) => {
          const t = e.target.value.trim();
          if (t && t !== column.title) onSave({ ...column, title: t });
          setRenaming(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setRenaming(false);
        }}
      />
    );
  }
  if (!canEdit)
    return (
      <div className="flex h-full items-center justify-center px-2 text-xs font-semibold text-muted">
        {title}
      </div>
    );

  const labelsKey =
    column.type === 'status' ? 'labels' : column.type === 'dropdown' ? 'options' : null;

  return (
    <>
      <Popover
        label={`${column.title} column options`}
        className="w-56"
        trigger={(p) => (
          <button
            type="button"
            {...p}
            className="group/col flex h-full w-full items-center justify-center gap-1 px-2 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-fg"
          >
            {title}
            <ChevronDown size={12} aria-hidden className="opacity-0 group-hover/col:opacity-100" />
          </button>
        )}
      >
        {(close) => (
          <div className="flex flex-col">
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                setRenaming(true);
              }}
            >
              <Pencil size={14} aria-hidden /> Rename
            </button>
            {labelsKey && (
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  close();
                  setDialog('labels');
                }}
              >
                <Tags size={14} aria-hidden /> Edit {labelsKey === 'labels' ? 'labels' : 'options'}
              </button>
            )}
            {column.type === 'numbers' && (
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  close();
                  setDialog('numbers');
                }}
              >
                <Tags size={14} aria-hidden /> Unit & format
              </button>
            )}
            <button
              type="button"
              className={`${menuItem} text-danger`}
              onClick={() => {
                close();
                setDialog('delete');
              }}
            >
              <Trash2 size={14} aria-hidden /> Delete column
            </button>
          </div>
        )}
      </Popover>
      {dialog === 'labels' && labelsKey && (
        <LabelsEditor
          title={`${column.title} ${labelsKey === 'labels' ? 'labels' : 'options'}`}
          labels={column.settings[labelsKey] ?? []}
          onClose={() => setDialog(null)}
          onSave={(labels) =>
            onSave({ ...column, settings: { ...column.settings, [labelsKey]: labels } })
          }
        />
      )}
      {dialog === 'numbers' && (
        <NumberSettings column={column} onClose={() => setDialog(null)} onSave={onSave} />
      )}
      <ConfirmDialog
        open={dialog === 'delete'}
        danger
        title={`Delete “${column.title}”?`}
        body="The column is removed from the board. Values already stored on items are ignored."
        confirmLabel="Delete column"
        onClose={() => setDialog(null)}
        onConfirm={onDelete}
      />
    </>
  );
}
