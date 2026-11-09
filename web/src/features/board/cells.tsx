import {
  formatNumber,
  LABEL_COLORS,
  normalizeUrl,
  normalizeValue,
  type Column,
  type Label,
  type LinkValue,
  type TimelineValue,
} from '@app/shared';
import { format, parseISO } from 'date-fns';
import { Check, ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Avatar, Button, Popover } from '../../components/ui';
import { cx } from '../../lib/cx';
import type { BoardItem, WorkspaceMember } from '../boards/types';

export interface CellProps {
  column: Column;
  item: BoardItem;
  itemName: string;
  canEdit: boolean;
  members: WorkspaceMember[];
  onChange: (value: unknown) => void;
}

const cellBase = 'flex h-full w-full items-center px-2 text-sm';
const cellButton = cx(cellBase, 'text-left hover:bg-surface-2 focus-visible:outline-offset-[-2px]');

export function fmtDate(iso: string): string {
  const d = parseISO(iso);
  return format(d, d.getFullYear() === new Date().getFullYear() ? 'd MMM' : 'd MMM yyyy');
}

/** Inline text-ish editor: Enter/blur saves, Escape cancels. Never writes per keystroke. */
function InlineInput({
  initial,
  type = 'text',
  label,
  onCommit,
  onCancel,
  align = 'left',
}: {
  initial: string;
  type?: 'text' | 'number' | 'date';
  label: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
  align?: 'left' | 'right';
}) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && v !== initial) onCommit(v);
    else onCancel();
  };
  return (
    <input
      autoFocus
      type={type}
      aria-label={label}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      className={cx(
        'h-full w-full border-2 border-primary bg-surface px-2 text-sm outline-none',
        align === 'right' && 'text-right',
      )}
    />
  );
}

function useEditing() {
  const [editing, setEditing] = useState(false);
  return { editing, start: () => setEditing(true), stop: () => setEditing(false) };
}

function Empty() {
  return <span className="text-muted/0 group-hover/row:text-muted">–</span>;
}

// ------------------------------------------------------------------ text-ish

function TextCell({ column, item, itemName, canEdit, onChange }: CellProps) {
  const { editing, start, stop } = useEditing();
  const v = normalizeValue(column, item.values[column.id]) as string | null;
  if (editing) {
    return (
      <InlineInput
        initial={v ?? ''}
        label={`${column.title} for ${itemName}`}
        onCommit={(nv) => {
          stop();
          onChange(nv);
        }}
        onCancel={stop}
      />
    );
  }
  if (!canEdit)
    return (
      <div className={cellBase}>
        <span className="truncate">{v}</span>
      </div>
    );
  return (
    <button
      type="button"
      className={cellButton}
      onClick={start}
      aria-label={`Edit ${column.title} for ${itemName}`}
    >
      <span className="truncate">{v ?? <Empty />}</span>
    </button>
  );
}

function LongTextCell({ column, item, itemName, canEdit, onChange }: CellProps) {
  const v = (normalizeValue(column, item.values[column.id]) as string | null) ?? '';
  const [draft, setDraft] = useState(v);
  useEffect(() => setDraft(v), [v]);
  const preview = (
    <span className="truncate">{v.split('\n')[0] || (canEdit ? <Empty /> : '')}</span>
  );
  if (!canEdit)
    return (
      <div className={cellBase} title={v}>
        {preview}
      </div>
    );
  return (
    <Popover
      label={`${column.title} for ${itemName}`}
      className="w-80"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className={cellButton}
          aria-label={`Edit ${column.title} for ${itemName}`}
        >
          {preview}
        </button>
      )}
    >
      {(close) => (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            maxLength={5000}
            aria-label={column.title}
            className="w-full rounded-xl border border-border bg-surface p-2 text-sm focus:border-primary focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (draft !== v) onChange(draft);
                close();
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}

function NumbersCell({ column, item, itemName, canEdit, onChange }: CellProps) {
  const { editing, start, stop } = useEditing();
  const v = normalizeValue(column, item.values[column.id]) as number | null;
  if (editing) {
    return (
      <InlineInput
        type="number"
        align="right"
        initial={v === null ? '' : String(v)}
        label={`${column.title} for ${itemName}`}
        onCommit={(nv) => {
          stop();
          onChange(nv.trim() === '' ? null : Number(nv));
        }}
        onCancel={stop}
      />
    );
  }
  const shown = v === null ? null : formatNumber(v, column.settings);
  if (!canEdit) return <div className={cx(cellBase, 'justify-end tabular-nums')}>{shown}</div>;
  return (
    <button
      type="button"
      className={cx(cellButton, 'justify-end tabular-nums')}
      onClick={start}
      aria-label={`Edit ${column.title} for ${itemName}`}
    >
      {shown ?? <Empty />}
    </button>
  );
}

function DateCell({ column, item, itemName, canEdit, onChange }: CellProps) {
  const { editing, start, stop } = useEditing();
  const v = normalizeValue(column, item.values[column.id]) as string | null;
  if (editing) {
    return (
      <InlineInput
        type="date"
        initial={v ?? ''}
        label={`${column.title} for ${itemName}`}
        onCommit={(nv) => {
          stop();
          onChange(nv || null);
        }}
        onCancel={stop}
      />
    );
  }
  const shown = v ? fmtDate(v) : null;
  if (!canEdit) return <div className={cx(cellBase, 'justify-center')}>{shown}</div>;
  return (
    <button
      type="button"
      className={cx(cellButton, 'justify-center')}
      onClick={start}
      aria-label={`Edit ${column.title} for ${itemName}`}
    >
      {shown ?? <Empty />}
    </button>
  );
}

function TimelineCell({ column, item, itemName, canEdit, onChange }: CellProps) {
  const v = normalizeValue(column, item.values[column.id]) as TimelineValue | null;
  const [start, setStart] = useState(v?.start ?? '');
  const [end, setEnd] = useState(v?.end ?? '');
  useEffect(() => {
    setStart(v?.start ?? '');
    setEnd(v?.end ?? '');
  }, [v?.start, v?.end]);
  const shown = v ? (
    <span className="truncate rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
      {fmtDate(v.start)} – {fmtDate(v.end)}
    </span>
  ) : null;
  if (!canEdit) return <div className={cx(cellBase, 'justify-center')}>{shown}</div>;
  return (
    <Popover
      label={`${column.title} for ${itemName}`}
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className={cx(cellButton, 'justify-center')}
          aria-label={`Edit ${column.title} for ${itemName}`}
        >
          {shown ?? <Empty />}
        </button>
      )}
    >
      {(close) => (
        <div className="space-y-3 p-1">
          <label className="block text-xs font-semibold">
            Start
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 block h-9 w-full rounded-lg border border-border bg-surface px-2"
            />
          </label>
          <label className="block text-xs font-semibold">
            End
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-1 block h-9 w-full rounded-lg border border-border bg-surface px-2"
            />
          </label>
          <div className="flex justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange(null);
                close();
              }}
            >
              Clear
            </Button>
            <Button
              size="sm"
              disabled={!start || !end}
              onClick={() => {
                onChange({ start, end });
                close();
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}

function LinkCell({ column, item, itemName, canEdit, onChange }: CellProps) {
  const v = normalizeValue(column, item.values[column.id]) as LinkValue | null;
  const [url, setUrl] = useState(v?.url ?? '');
  const [text, setText] = useState(v?.text ?? '');
  useEffect(() => {
    setUrl(v?.url ?? '');
    setText(v?.text ?? '');
  }, [v?.url, v?.text]);
  const link = v ? (
    <a
      href={v.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex min-w-0 items-center gap-1 text-primary underline-offset-2 hover:underline"
    >
      <span className="truncate">{v.text || v.url.replace(/^https?:\/\//, '')}</span>
      <ExternalLink size={12} aria-hidden className="shrink-0" />
    </a>
  ) : null;
  if (!canEdit) return <div className={cellBase}>{link}</div>;
  return (
    <div className={cx(cellBase, 'gap-1 px-0')}>
      <div className="min-w-0 flex-1 px-2">{link}</div>
      <Popover
        label={`${column.title} for ${itemName}`}
        className="w-72"
        trigger={(p) => (
          <button
            type="button"
            {...p}
            className={cx(
              'h-full px-2 text-xs text-muted hover:bg-surface-2 hover:text-fg',
              !v && 'flex-1 text-left',
            )}
            aria-label={`Edit ${column.title} for ${itemName}`}
          >
            {v ? 'Edit' : <Empty />}
          </button>
        )}
      >
        {(close) => (
          <form
            className="space-y-2 p-1"
            onSubmit={(e) => {
              e.preventDefault();
              onChange(normalizeUrl(url) ? { url, text } : null);
              close();
            }}
          >
            <input
              autoFocus
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-label="Web address"
              className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
            />
            <input
              placeholder="Text to show (optional)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Text to show"
              className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
            />
            <div className="flex justify-between">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onChange(null);
                  close();
                }}
              >
                Remove
              </Button>
              <Button size="sm" type="submit">
                Save
              </Button>
            </div>
          </form>
        )}
      </Popover>
    </div>
  );
}

// ----------------------------------------------------------------- choosers

function LabelOption({
  label,
  selected,
  onClick,
}: {
  label: Label;
  selected: boolean;
  onClick: () => void;
}) {
  const c = LABEL_COLORS[label.color];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="flex h-9 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold"
      style={{ background: c.bg, color: c.text }}
    >
      {selected && <Check size={14} aria-hidden />}
      {label.name}
    </button>
  );
}

function StatusCell({ column, item, itemName, canEdit, onChange }: CellProps) {
  const v = normalizeValue(column, item.values[column.id]) as string | null;
  const labels = column.settings.labels ?? [];
  const current = labels.find((l) => l.id === v);
  const style = current
    ? { background: LABEL_COLORS[current.color].bg, color: LABEL_COLORS[current.color].text }
    : undefined;
  const body = <span className="truncate">{current?.name ?? ''}</span>;
  const cls = cx(cellBase, 'justify-center font-semibold', !current && 'bg-surface-3/60');
  if (!canEdit)
    return (
      <div className={cls} style={style}>
        {body}
      </div>
    );
  return (
    <Popover
      label={`${column.title} for ${itemName}`}
      className="w-56"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className={cx(cls, 'hover:brightness-95')}
          style={style}
          aria-label={`${column.title}: ${current?.name ?? 'empty'}. Change for ${itemName}`}
        >
          {body}
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-1.5">
          {labels.map((l) => (
            <LabelOption
              key={l.id}
              label={l}
              selected={l.id === v}
              onClick={() => {
                onChange(l.id);
                close();
              }}
            />
          ))}
          {v && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                close();
              }}
              className="mt-1 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}

function DropdownCell({ column, item, itemName, canEdit, onChange }: CellProps) {
  const v = (normalizeValue(column, item.values[column.id]) as string[] | null) ?? [];
  const options = column.settings.options ?? [];
  const chips = (
    <span className="flex min-w-0 gap-1 overflow-hidden">
      {v.map((id) => {
        const o = options.find((x) => x.id === id);
        if (!o) return null;
        const c = LABEL_COLORS[o.color];
        return (
          <span
            key={id}
            className="truncate rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ background: c.bg, color: c.text }}
          >
            {o.name}
          </span>
        );
      })}
    </span>
  );
  if (!canEdit) return <div className={cellBase}>{chips}</div>;
  return (
    <Popover
      label={`${column.title} for ${itemName}`}
      className="w-56"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className={cellButton}
          aria-label={`Edit ${column.title} for ${itemName}`}
        >
          {v.length ? chips : <Empty />}
        </button>
      )}
    >
      {options.length === 0 ? (
        <p className="p-2 text-sm text-muted">No options yet. Add some from the column menu.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {options.map((o) => (
            <LabelOption
              key={o.id}
              label={o}
              selected={v.includes(o.id)}
              onClick={() =>
                onChange(v.includes(o.id) ? v.filter((x) => x !== o.id) : [...v, o.id])
              }
            />
          ))}
        </div>
      )}
    </Popover>
  );
}

function PeopleCell({ column, item, itemName, canEdit, members, onChange }: CellProps) {
  const v = (normalizeValue(column, item.values[column.id]) as string[] | null) ?? [];
  const byUid = new Map(members.map((m) => [m.uid, m]));
  const avatars = (
    <span className="flex -space-x-1.5">
      {v.slice(0, 3).map((uid) => {
        const m = byUid.get(uid);
        return (
          <Avatar
            key={uid}
            name={m?.name ?? 'Former member'}
            photoURL={m?.photoURL ?? null}
            size="sm"
          />
        );
      })}
      {v.length > 3 && <span className="ml-2 text-xs text-muted">+{v.length - 3}</span>}
    </span>
  );
  if (!canEdit) return <div className={cx(cellBase, 'justify-center')}>{avatars}</div>;
  return (
    <Popover
      label={`${column.title} for ${itemName}`}
      className="w-64"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className={cx(cellButton, 'justify-center')}
          aria-label={`Edit ${column.title} for ${itemName}`}
        >
          {v.length ? avatars : <Empty />}
        </button>
      )}
    >
      <div className="flex flex-col">
        {members.map((m) => {
          const on = v.includes(m.uid);
          return (
            <button
              key={m.uid}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? v.filter((x) => x !== m.uid) : [...v, m.uid])}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2"
            >
              <Avatar name={m.name} photoURL={m.photoURL} size="sm" />
              <span className="flex-1 truncate">{m.name}</span>
              {on && <Check size={16} aria-label="Assigned" className="text-primary" />}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

function CheckboxCell({ column, item, itemName, canEdit, onChange }: CellProps) {
  const v = normalizeValue(column, item.values[column.id]) === true;
  return (
    <div className={cx(cellBase, 'justify-center')}>
      <input
        type="checkbox"
        checked={v}
        disabled={!canEdit}
        aria-label={`${column.title} for ${itemName}`}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--c-primary)]"
      />
    </div>
  );
}

const RENDERERS: Record<Column['type'], (p: CellProps) => ReactNode> = {
  text: TextCell,
  longText: LongTextCell,
  status: StatusCell,
  dropdown: DropdownCell,
  people: PeopleCell,
  date: DateCell,
  timeline: TimelineCell,
  numbers: NumbersCell,
  checkbox: CheckboxCell,
  link: LinkCell,
};

export function Cell(props: CellProps) {
  const R = RENDERERS[props.column.type];
  return <R {...props} />;
}
