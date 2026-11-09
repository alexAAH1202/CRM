import {
  GROUPABLE_TYPES,
  LABEL_COLORS,
  ME,
  MAX_FILTERS,
  NAME_COLUMN_ID,
  newFilter,
  OP_LABELS,
  opNeedsValue,
  opsFor,
  type Column,
  type Filter,
  type FilterOp,
  type Label,
  type SortRule,
  type ViewConfig,
} from '@app/shared';
import {
  ArrowDownUp,
  Archive,
  Columns3,
  Filter as FilterIcon,
  Layers,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import { Button, Popover, SelectField } from '../../components/ui';
import { cx } from '../../lib/cx';
import type { WorkspaceMember } from '../boards/types';

interface Props {
  columns: Column[];
  members: WorkspaceMember[];
  config: ViewConfig;
  onChange: (patch: Partial<ViewConfig>) => void;
  search: string;
  onSearch: (v: string) => void;
  /** False for viewers: changes apply only on this device. */
  shared: boolean;
}

const wide = 'w-[min(34rem,calc(100vw-2rem))]';

const ToolButton = forwardRef<
  HTMLButtonElement,
  {
    icon: ReactNode;
    label: string;
    count?: number;
    active?: boolean;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function ToolButton({ icon, label, count, active, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cx(
        'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-colors',
        active
          ? 'border-primary bg-primary-soft text-primary'
          : 'border-border bg-surface text-fg hover:bg-surface-2',
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      {count ? (
        <span
          className="rounded-full bg-primary px-1.5 text-xs font-bold text-on-primary"
          aria-label={`${count} active`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
});

function LabelChips({
  labels,
  selected,
  onToggle,
}: {
  labels: Label[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((l) => {
        const on = selected.includes(l.id);
        const c = LABEL_COLORS[l.color];
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(l.id)}
            className={cx(
              'rounded-full px-2.5 py-1 text-xs font-semibold ring-offset-1 ring-offset-surface',
              on ? 'ring-2 ring-fg' : 'opacity-60 hover:opacity-100',
            )}
            style={{ background: c.bg, color: c.text }}
          >
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

function FilterValue({
  filter,
  column,
  members,
  onChange,
}: {
  filter: Filter;
  column: Column | undefined;
  members: WorkspaceMember[];
  onChange: (value: Filter['value']) => void;
}) {
  if (!opNeedsValue(filter.op)) return null;
  const type = column?.type ?? 'text';
  const list = Array.isArray(filter.value) ? filter.value : [];
  const toggle = (id: string) =>
    onChange(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const input =
    'h-9 rounded-lg border border-border bg-surface px-2 text-sm focus:border-primary focus:outline-none';

  if (type === 'status')
    return <LabelChips labels={column?.settings.labels ?? []} selected={list} onToggle={toggle} />;
  if (type === 'dropdown' || type === 'tags')
    return <LabelChips labels={column?.settings.options ?? []} selected={list} onToggle={toggle} />;
  if (type === 'people' || type === 'createdBy') {
    const options = [
      { uid: ME, name: 'Me' },
      ...members.map((m) => ({ uid: m.uid, name: m.name })),
    ];
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.uid}
            type="button"
            aria-pressed={list.includes(o.uid)}
            onClick={() => toggle(o.uid)}
            className={cx(
              'rounded-full border px-2.5 py-1 text-xs font-semibold',
              list.includes(o.uid)
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border hover:bg-surface-2',
            )}
          >
            {o.name}
          </button>
        ))}
      </div>
    );
  }
  if (type === 'date' || type === 'timeline' || type === 'createdAt' || type === 'updatedAt') {
    return (
      <input
        type="date"
        aria-label="Date"
        className={input}
        value={typeof filter.value === 'string' ? filter.value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  const numeric =
    type === 'numbers' ||
    type === 'rating' ||
    type === 'progress' ||
    type === 'itemId' ||
    (type === 'formula' && ['eq', 'gt', 'lt'].includes(filter.op));
  if (numeric) {
    return (
      <input
        type="number"
        aria-label="Number"
        className={cx(input, 'w-28')}
        value={typeof filter.value === 'number' ? filter.value : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    );
  }
  return (
    <input
      aria-label="Text"
      className={cx(input, 'min-w-0 flex-1')}
      placeholder="Value"
      value={typeof filter.value === 'string' ? filter.value : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function FilterPanel({
  columns,
  members,
  config,
  onChange,
}: Pick<Props, 'columns' | 'members' | 'config' | 'onChange'>) {
  const update = (id: string, patch: Partial<Filter>) =>
    onChange({ filters: config.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const typeOf = (columnId: string) => columns.find((c) => c.id === columnId)?.type ?? 'name';

  return (
    <div className="space-y-3 p-1">
      {config.filters.length === 0 && (
        <p className="px-1 text-sm text-muted">
          No filters. Add one to narrow what the table shows.
        </p>
      )}
      <ul className="space-y-3">
        {config.filters.map((f, i) => {
          const col = columns.find((c) => c.id === f.columnId);
          return (
            <li key={f.id} className="space-y-2 rounded-xl border border-border p-2">
              <div className="flex items-center gap-2">
                <span className="w-9 shrink-0 text-xs font-semibold text-muted">
                  {i === 0 ? 'Where' : 'And'}
                </span>
                <SelectField
                  label={`Filter ${i + 1} column`}
                  hideLabel
                  className="min-w-0 flex-1"
                  value={f.columnId}
                  onChange={(e) => {
                    const t = typeOf(e.target.value);
                    update(f.id, {
                      columnId: e.target.value,
                      op: opsFor(t)[0] ?? 'isEmpty',
                      value: undefined,
                    });
                  }}
                >
                  <option value={NAME_COLUMN_ID}>Item name</option>
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label={`Filter ${i + 1} condition`}
                  hideLabel
                  className="min-w-0 flex-1"
                  value={f.op}
                  onChange={(e) => update(f.id, { op: e.target.value as FilterOp })}
                >
                  {opsFor(typeOf(f.columnId)).map((op) => (
                    <option key={op} value={op}>
                      {OP_LABELS[op]}
                    </option>
                  ))}
                </SelectField>
                <button
                  type="button"
                  aria-label={`Remove filter ${i + 1}`}
                  onClick={() => onChange({ filters: config.filters.filter((x) => x.id !== f.id) })}
                  className="rounded-lg p-2 text-muted hover:bg-surface-2"
                >
                  <X size={16} aria-hidden />
                </button>
              </div>
              <div className="pl-11">
                <FilterValue
                  filter={f}
                  column={col}
                  members={members}
                  onChange={(value) => update(f.id, { value })}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant="ghost"
          disabled={config.filters.length >= MAX_FILTERS}
          onClick={() => onChange({ filters: [...config.filters, newFilter(columns)] })}
        >
          <Plus size={14} aria-hidden /> Add filter
        </Button>
        {config.filters.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange({ filters: [] })}>
            Clear all
          </Button>
        )}
      </div>
    </div>
  );
}

function SortPanel({ columns, config, onChange }: Pick<Props, 'columns' | 'config' | 'onChange'>) {
  const rules = config.sort;
  const set = (i: number, patch: Partial<SortRule>) =>
    onChange({ sort: rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-3 p-1">
      {rules.length === 0 && (
        <p className="px-1 text-sm text-muted">
          Items follow the order you set by dragging. Add a sort to order by a column instead.
        </p>
      )}
      {rules.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-xs font-semibold text-muted">
            {i === 0 ? 'Sort by' : 'Then by'}
          </span>
          <SelectField
            label={`Sort ${i + 1} column`}
            hideLabel
            className="min-w-0 flex-1"
            value={r.columnId}
            onChange={(e) => set(i, { columnId: e.target.value })}
          >
            <option value={NAME_COLUMN_ID}>Item name</option>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={`Sort ${i + 1} direction`}
            hideLabel
            className="w-28"
            value={r.dir}
            onChange={(e) => set(i, { dir: e.target.value as 'asc' | 'desc' })}
          >
            <option value="asc">A → Z / low → high</option>
            <option value="desc">Z → A / high → low</option>
          </SelectField>
          <button
            type="button"
            aria-label={`Remove sort ${i + 1}`}
            onClick={() => onChange({ sort: rules.filter((_, j) => j !== i) })}
            className="rounded-lg p-2 text-muted hover:bg-surface-2"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        disabled={rules.length >= 3}
        onClick={() => {
          const used = new Set(rules.map((r) => r.columnId));
          const next =
            [NAME_COLUMN_ID, ...columns.map((c) => c.id)].find((id) => !used.has(id)) ??
            NAME_COLUMN_ID;
          onChange({ sort: [...rules, { columnId: next, dir: 'asc' }] });
        }}
      >
        <Plus size={14} aria-hidden /> Add sort
      </Button>
    </div>
  );
}

export function BoardToolbar({
  columns,
  members,
  config,
  onChange,
  search,
  onSearch,
  shared,
}: Props) {
  const groupable = columns.filter((c) => GROUPABLE_TYPES.includes(c.type));
  const groupCol = columns.find((c) => c.id === config.groupBy);
  const hidden = config.hiddenCols.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover
        label="Filter"
        className={wide}
        trigger={(p) => (
          <ToolButton
            {...p}
            icon={<FilterIcon size={14} aria-hidden />}
            label="Filter"
            count={config.filters.length}
            active={config.filters.length > 0}
          />
        )}
      >
        <FilterPanel columns={columns} members={members} config={config} onChange={onChange} />
      </Popover>

      <Popover
        label="Sort"
        className={wide}
        trigger={(p) => (
          <ToolButton
            {...p}
            icon={<ArrowDownUp size={14} aria-hidden />}
            label="Sort"
            count={config.sort.length}
            active={config.sort.length > 0}
          />
        )}
      >
        <SortPanel columns={columns} config={config} onChange={onChange} />
      </Popover>

      <Popover
        label="Group by"
        className="w-64"
        trigger={(p) => (
          <ToolButton
            {...p}
            icon={<Layers size={14} aria-hidden />}
            label={groupCol ? `Grouped: ${groupCol.title}` : 'Group by'}
            active={!!groupCol}
          />
        )}
      >
        {(close) => (
          <div role="radiogroup" aria-label="Group by" className="flex flex-col">
            {[
              { id: null as string | null, title: 'Board groups (default)' },
              ...groupable.map((c) => ({ id: c.id as string | null, title: c.title })),
            ].map((o) => (
              <button
                key={o.id ?? 'default'}
                type="button"
                role="radio"
                aria-checked={config.groupBy === o.id}
                onClick={() => {
                  onChange({ groupBy: o.id });
                  close();
                }}
                className={cx(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2',
                  config.groupBy === o.id && 'font-bold text-primary',
                )}
              >
                {o.title}
              </button>
            ))}
            {groupable.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted">
                Add a Status, Dropdown or People column to group by it.
              </p>
            )}
          </div>
        )}
      </Popover>

      <Popover
        label="Columns"
        className="w-64"
        trigger={(p) => (
          <ToolButton
            {...p}
            icon={<Columns3 size={14} aria-hidden />}
            label="Columns"
            count={hidden}
            active={hidden > 0}
          />
        )}
      >
        <div className="flex flex-col">
          {columns.length === 0 && <p className="px-3 py-2 text-sm text-muted">No columns yet.</p>}
          {columns.map((c) => {
            const shown = !config.hiddenCols.includes(c.id);
            return (
              <label
                key={c.id}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={shown}
                  onChange={() =>
                    onChange({
                      hiddenCols: shown
                        ? [...config.hiddenCols, c.id]
                        : config.hiddenCols.filter((id) => id !== c.id),
                    })
                  }
                />
                {c.title}
              </label>
            );
          })}
        </div>
      </Popover>

      <ToolButton
        icon={<Archive size={14} aria-hidden />}
        label="Archived"
        active={config.showArchived}
        aria-pressed={config.showArchived}
        onClick={() => onChange({ showArchived: !config.showArchived })}
      />

      {!shared && (
        <span className="text-xs text-muted">View-only: your changes stay on this device.</span>
      )}

      <label className="ml-auto flex h-9 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm focus-within:border-primary">
        <Search size={14} aria-hidden className="text-muted" />
        <span className="sr-only">Search items</span>
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search"
          className="w-32 bg-transparent outline-none sm:w-48"
        />
      </label>
    </div>
  );
}
