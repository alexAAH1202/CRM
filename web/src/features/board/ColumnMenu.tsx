import {
  cleanColumnTitle,
  COLUMN_PICKER,
  CONVERTIBLE_TYPES,
  LABEL_COLOR_NAMES,
  LABEL_COLORS,
  shortId,
  summaryKindOf,
  summaryOptions,
  SUMMARY_LABELS,
  type Column,
  type ColumnType,
  type Label,
  type PickerGroup,
  type SummaryKind,
} from '@app/shared';
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  Check,
  ChevronDown,
  Pencil,
  Plus,
  Repeat,
  SlidersHorizontal,
  Sigma,
  Star,
  Tags,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button, Modal, Popover, SelectField, TextField } from '../../components/ui';

const menuItem =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2';

const PICKER_GROUPS: PickerGroup[] = [
  'Text & numbers',
  'Choices & people',
  'Dates',
  'Links & files',
  'Calculated',
  'Relations',
];

export function AddColumnButton({ onAdd }: { onAdd: (c: Column) => void }) {
  return (
    <Popover
      label="Add column"
      className="max-h-[70vh] w-72 overflow-auto"
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
          {PICKER_GROUPS.map((g) => (
            <section key={g} aria-label={g}>
              <h3 className="px-3 pt-2 pb-1 text-xs font-bold tracking-wide text-muted uppercase">
                {g}
              </h3>
              {COLUMN_PICKER.filter((e) => e.group === g).map((e) => (
                <button
                  key={e.key}
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    onAdd(e.make());
                    close();
                  }}
                >
                  <span className="flex-1">
                    <span className="block font-semibold">{e.label}</span>
                    <span className="block text-xs text-muted">{e.description}</span>
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
    </Popover>
  );
}

function LabelsEditor({
  title,
  labels,
  defaultId,
  showDefault,
  onSave,
  onClose,
}: {
  title: string;
  labels: Label[];
  defaultId: string | null;
  showDefault: boolean;
  onSave: (labels: Label[], defaultId: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Label[]>(labels);
  const [defId, setDefId] = useState<string | null>(defaultId);
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
              const cleaned = draft
                .filter((l) => l.name.trim() !== '')
                .map((l) => ({ ...l, name: l.name.trim() }));
              onSave(cleaned, cleaned.some((l) => l.id === defId) ? defId : null);
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
      {showDefault && (
        <SelectField
          label="New items start as"
          className="mt-4 max-w-xs"
          value={defId ?? ''}
          onChange={(e) => setDefId(e.target.value || null)}
        >
          <option value="">(empty)</option>
          {draft
            .filter((l) => l.name.trim())
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </SelectField>
      )}
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

const DEFAULTABLE: ColumnType[] = [
  'text',
  'longText',
  'numbers',
  'date',
  'checkbox',
  'dropdown',
  'rating',
  'email',
  'phone',
  'link',
];

export function ColumnHeader({
  column,
  canEdit,
  index,
  count,
  onSave,
  onDelete,
  onMove,
  onChangeType,
  onDefault,
  onConfigure,
}: {
  column: Column;
  canEdit: boolean;
  index: number;
  count: number;
  onSave: (c: Column) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onChangeType: () => void;
  onDefault: () => void;
  /** Opens the formula or progress settings dialog. */
  onConfigure: () => void;
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
          const t = cleanColumnTitle(e.target.value); // no { } — formulas use them for references
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
    column.type === 'status'
      ? 'labels'
      : column.type === 'dropdown' || column.type === 'tags'
        ? 'options'
        : null;

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
            {column.type === 'formula' && (
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  close();
                  onConfigure();
                }}
              >
                <Calculator size={14} aria-hidden /> Edit formula
              </button>
            )}
            {column.type === 'progress' && (
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  close();
                  onConfigure();
                }}
              >
                <SlidersHorizontal size={14} aria-hidden /> Progress settings
              </button>
            )}
            {CONVERTIBLE_TYPES.includes(column.type) && (
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  close();
                  onChangeType();
                }}
              >
                <Repeat size={14} aria-hidden /> Change type
              </button>
            )}
            {DEFAULTABLE.includes(column.type) && (
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  close();
                  onDefault();
                }}
              >
                <Star size={14} aria-hidden /> Default value
              </button>
            )}
            <button
              type="button"
              className={menuItem}
              disabled={index === 0}
              onClick={() => {
                close();
                onMove(-1);
              }}
            >
              <ArrowLeft size={14} aria-hidden /> Move left
            </button>
            <button
              type="button"
              className={menuItem}
              disabled={index === count - 1}
              onClick={() => {
                close();
                onMove(1);
              }}
            >
              <ArrowRight size={14} aria-hidden /> Move right
            </button>
            {summaryOptions(column.type).length > 1 && (
              <div className="mt-1 border-t border-border pt-1">
                <div className="flex items-center gap-1 px-3 py-1 text-xs font-semibold text-muted">
                  <Sigma size={12} aria-hidden /> Footer shows
                </div>
                {summaryOptions(column.type).map((k: SummaryKind) => (
                  <button
                    key={k}
                    type="button"
                    role="menuitemradio"
                    aria-checked={summaryKindOf(column) === k}
                    className={menuItem}
                    onClick={() => {
                      close();
                      onSave({ ...column, settings: { ...column.settings, summary: k } });
                    }}
                  >
                    <span className="w-4">
                      {summaryKindOf(column) === k && <Check size={14} aria-hidden />}
                    </span>
                    {SUMMARY_LABELS[k]}
                  </button>
                ))}
              </div>
            )}
            <div className="my-1 border-t border-border" />
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
          defaultId={column.type === 'status' ? (column.settings.defaultLabelId ?? null) : null}
          showDefault={column.type === 'status'}
          onClose={() => setDialog(null)}
          onSave={(labels, defaultId) =>
            onSave({
              ...column,
              settings: {
                ...column.settings,
                [labelsKey]: labels,
                ...(column.type === 'status' ? { defaultLabelId: defaultId } : {}),
              },
            })
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
        body="The column is removed from the list. Values already stored on items are ignored."
        confirmLabel="Delete column"
        onClose={() => setDialog(null)}
        onConfirm={onDelete}
      />
    </>
  );
}
