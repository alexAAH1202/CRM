import {
  applyComputed,
  defaultProgressSettings,
  FUNCTION_LIST,
  formulaErrorOf,
  validateFormula,
  type Column,
  type ComputedEnv,
  type FnGroup,
  type ProgressSettings,
} from '@app/shared';
import { useMemo, useRef, useState } from 'react';
import { Button, Modal, SelectField, TextField } from '../../components/ui';
import { cx } from '../../lib/cx';
import type { BoardItem } from '../boards/types';
import { FormulaCell } from './cellsExtra';

const GROUPS: FnGroup[] = ['Math', 'Text', 'Logic', 'Date'];

export function FormulaDialog({
  column,
  columns,
  items,
  env,
  onSave,
  onClose,
}: {
  column: Column;
  columns: Column[];
  items: BoardItem[];
  env: ComputedEnv;
  onSave: (c: Column) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(column.settings.formula ?? '');
  const [unit, setUnit] = useState(column.settings.unit ?? '');
  const [decimals, setDecimals] = useState<string>(
    typeof column.settings.decimals === 'number' && column.settings.decimals >= 0
      ? String(column.settings.decimals)
      : '',
  );
  const ref = useRef<HTMLTextAreaElement>(null);

  const problem = useMemo(
    () =>
      draft.trim() === ''
        ? { message: 'Type a formula, for example {Budget} - {Spent}' }
        : validateFormula(
            draft,
            columns.map((c) => ({
              id: c.id,
              title: c.title,
              formula: c.type === 'formula' ? c.settings.formula : undefined,
            })),
            column.id,
          ),
    [draft, columns, column.id],
  );

  const insert = (text: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  // Preview on a few real items, using the formula as typed (without saving it).
  const preview = useMemo(() => {
    const trial: Column = {
      ...column,
      settings: {
        ...column.settings,
        formula: draft,
        unit,
        decimals: decimals === '' ? undefined : Number(decimals),
      },
    };
    const trialCols = columns.map((c) => (c.id === column.id ? trial : c));
    const sample = items.filter((i) => !i.deleted && !i.archived && !i.parentId).slice(0, 4);
    const out = applyComputed(items, trialCols, env);
    const byId = new Map(out.map((i) => [i.id, i]));
    return { trial, rows: sample.map((s) => byId.get(s.id) ?? s) };
  }, [column, columns, items, env, draft, unit, decimals]);

  const others = columns.filter((c) => c.id !== column.id);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Formula for “${column.title}”`}
      className="sm:w-[min(44rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={problem !== null}
            onClick={() => {
              const settings = { ...column.settings, formula: draft.trim() };
              if (unit) settings.unit = unit.slice(0, 8);
              else delete settings.unit;
              if (decimals === '') delete settings.decimals;
              else settings.decimals = Number(decimals);
              onSave({ ...column, settings });
              onClose();
            }}
          >
            Save formula
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="formula-input" className="text-sm font-semibold">
            Formula
          </label>
          <textarea
            id="formula-input"
            ref={ref}
            autoFocus
            rows={3}
            maxLength={1000}
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby="formula-status"
            placeholder="{Budget} - {Spent}"
            className="rounded-xl border border-border bg-surface p-3 font-mono text-sm focus:border-primary focus:outline-none aria-[invalid=true]:border-danger"
          />
          <p
            id="formula-status"
            role="status"
            className={cx('min-h-5 text-sm', problem ? 'text-danger' : 'text-[#13865a]')}
          >
            {problem
              ? `${problem.message}${problem.pos ? ` (at character ${problem.pos + 1})` : ''}`
              : 'Looks good'}
          </p>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">Insert a column</legend>
          <div className="flex flex-wrap gap-1.5">
            {others.length === 0 && (
              <span className="text-sm text-muted">No other columns yet.</span>
            )}
            {others.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => insert(`{${c.title}}`)}
                className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold hover:bg-surface-2"
              >
                {c.title}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Unit (optional)"
            placeholder="$, h, kg"
            maxLength={8}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
          <SelectField
            label="Decimals"
            value={decimals}
            onChange={(e) => setDecimals(e.target.value)}
          >
            <option value="">Automatic</option>
            {[0, 1, 2, 3, 4].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </SelectField>
        </div>

        <section aria-label="Preview">
          <h3 className="mb-1.5 text-sm font-semibold">Preview</h3>
          {preview.rows.length === 0 ? (
            <p className="text-sm text-muted">Add some items to see results here.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {preview.rows.map((r) => (
                <li
                  key={r.id}
                  className="grid grid-cols-[1fr_1fr] items-center gap-3 px-3 py-1 text-sm"
                >
                  <span className="truncate text-muted">{r.name}</span>
                  <span className="h-8 min-w-0">
                    <FormulaCell
                      column={preview.trial}
                      item={r}
                      itemName={r.name}
                      canEdit={false}
                      members={[]}
                      onChange={() => undefined}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {preview.rows.some((r) => formulaErrorOf(r.values[column.id])) && !problem && (
            <p className="mt-1.5 text-xs text-muted">
              An error on one item (like dividing by an empty cell) only affects that item.
            </p>
          )}
        </section>

        <details className="rounded-xl border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
            Functions you can use
          </summary>
          <div className="space-y-3 px-3 pt-1 pb-3">
            <p className="text-xs text-muted">
              Put column names in braces, like <code>{'{Due date}'}</code>. Join text with{' '}
              <code>&amp;</code>. Blank cells count as 0 in sums, and as empty text in joins.
            </p>
            {GROUPS.map((g) => (
              <div key={g}>
                <h4 className="mb-1 text-xs font-bold tracking-wide text-muted uppercase">{g}</h4>
                <ul className="space-y-0.5">
                  {FUNCTION_LIST.filter((f) => f.group === g).map((f) => (
                    <li key={f.name}>
                      <button
                        type="button"
                        onClick={() => insert(f.name === 'TODAY' ? 'TODAY()' : `${f.name}(`)}
                        className="w-full rounded-lg px-2 py-1 text-left text-sm hover:bg-surface-2"
                      >
                        <code className="font-semibold">{f.signature}</code>
                        <span className="block text-xs text-muted">{f.doc}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </div>
    </Modal>
  );
}

export function ProgressDialog({
  column,
  columns,
  onSave,
  onClose,
}: {
  column: Column;
  columns: Column[];
  onSave: (c: Column) => void;
  onClose: () => void;
}) {
  const initial: ProgressSettings = column.settings.progress ?? defaultProgressSettings(columns);
  const [source, setSource] = useState(initial.source);
  const statuses = columns.filter((c) => c.type === 'status');
  const [statusId, setStatusId] = useState(initial.statusColumnId ?? statuses[0]?.id ?? '');
  const [done, setDone] = useState<string[]>(initial.doneLabelIds);
  const boxes = columns.filter((c) => c.type === 'checkbox');
  const [boxIds, setBoxIds] = useState<string[]>(initial.checkboxColumnIds);
  const status = statuses.find((c) => c.id === statusId);
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Progress settings for “${column.title}”`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave({
                ...column,
                settings: {
                  ...column.settings,
                  progress: {
                    source,
                    statusColumnId: statusId || null,
                    doneLabelIds: done.filter((id) =>
                      status?.settings.labels?.some((l) => l.id === id),
                    ),
                    checkboxColumnIds: boxIds.filter((id) => boxes.some((b) => b.id === id)),
                  },
                },
              });
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Work out progress from</legend>
          <div role="radiogroup" className="space-y-2">
            {(
              [
                ['subitems', 'Subitems', 'The share of an item’s subitems that are done.'],
                ['checkboxes', 'Checkboxes', 'The share of the checkbox columns that are ticked.'],
              ] as const
            ).map(([v, title, desc]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={source === v}
                onClick={() => setSource(v)}
                className={cx(
                  'flex w-full items-start gap-3 rounded-2xl border p-3 text-left',
                  source === v
                    ? 'border-primary bg-primary-soft'
                    : 'border-border hover:bg-surface-2',
                )}
              >
                <span>
                  <span className="block text-sm font-bold">{title}</span>
                  <span className="block text-xs text-muted">{desc}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {source === 'subitems' &&
          (statuses.length === 0 ? (
            <p className="text-sm text-muted">
              Add a Status column first, so progress knows which subitems are done.
            </p>
          ) : (
            <div className="space-y-3">
              <SelectField
                label="Status column"
                value={statusId}
                onChange={(e) => (setStatusId(e.target.value), setDone([]))}
              >
                {statuses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </SelectField>
              <fieldset>
                <legend className="mb-1.5 text-sm font-semibold">These labels count as done</legend>
                <div className="flex flex-wrap gap-2">
                  {(status?.settings.labels ?? []).map((l) => (
                    <label
                      key={l.id}
                      className="flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={done.includes(l.id)}
                        onChange={() => setDone(toggle(done, l.id))}
                      />
                      {l.name}
                    </label>
                  ))}
                </div>
                {done.length === 0 && (
                  <p className="mt-1.5 text-xs text-muted">
                    Nothing ticked: the “Done” label (or the last one) is used.
                  </p>
                )}
              </fieldset>
            </div>
          ))}

        {source === 'checkboxes' &&
          (boxes.length === 0 ? (
            <p className="text-sm text-muted">Add one or more Checkbox columns first.</p>
          ) : (
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold">Count these checkbox columns</legend>
              <div className="flex flex-wrap gap-2">
                {boxes.map((b) => (
                  <label
                    key={b.id}
                    className="flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={boxIds.includes(b.id)}
                      onChange={() => setBoxIds(toggle(boxIds, b.id))}
                    />
                    {b.title}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
      </div>
    </Modal>
  );
}
