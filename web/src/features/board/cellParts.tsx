import { LABEL_COLORS, type Column, type Label } from '@app/shared';
import { format, parseISO } from 'date-fns';
import { Check } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
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

export const cellBase = 'flex h-full w-full items-center px-2 text-sm';
export const cellButton = cx(
  cellBase,
  'text-left hover:bg-surface-2 focus-visible:outline-offset-[-2px]',
);

export function fmtDate(iso: string): string {
  const d = parseISO(iso);
  return format(d, d.getFullYear() === new Date().getFullYear() ? 'd MMM' : 'd MMM yyyy');
}

/** Inline text-ish editor: Enter/blur saves, Escape cancels. Never writes per keystroke. */
export function InlineInput({
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

export function useEditing() {
  const [editing, setEditing] = useState(false);
  return { editing, start: () => setEditing(true), stop: () => setEditing(false) };
}

export function Empty() {
  return <span className="text-muted/0 group-hover/row:text-muted">–</span>;
}

// ------------------------------------------------------------------ text-ish

export function LabelOption({
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
