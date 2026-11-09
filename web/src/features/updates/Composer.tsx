import { MAX_UPDATE_LENGTH, type Person } from '@app/shared';
import { Bold, Italic, Link2, List } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '../../components/ui';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { cx } from '../../lib/cx';

type Format = 'bold' | 'italic' | 'list' | 'link';

/** Wraps the selection (or inserts a placeholder) and returns the new text and selection. */
export function applyFormat(
  text: string,
  start: number,
  end: number,
  kind: Format,
): { text: string; start: number; end: number } {
  const sel = text.slice(start, end);
  const wrap = (mark: string, placeholder: string) => {
    const inner = sel || placeholder;
    return {
      text: `${text.slice(0, start)}${mark}${inner}${mark}${text.slice(end)}`,
      start: start + mark.length,
      end: start + mark.length + inner.length,
    };
  };
  if (kind === 'bold') return wrap('**', 'bold text');
  if (kind === 'italic') return wrap('*', 'italic text');
  if (kind === 'list') {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const block = text.slice(lineStart, end || start);
    const listed = block
      .split('\n')
      .map((l) => (l.startsWith('- ') ? l : `- ${l}`))
      .join('\n');
    const next = text.slice(0, lineStart) + listed + text.slice(end || start);
    return { text: next, start: lineStart + listed.length, end: lineStart + listed.length };
  }
  const label = sel || 'link text';
  const url = 'https://';
  const out = `${text.slice(0, start)}[${label}](${url})${text.slice(end)}`;
  const urlStart = start + label.length + 3;
  return { text: out, start: urlStart, end: urlStart + url.length };
}

interface Props {
  label: string;
  people: readonly Person[];
  submitLabel: string;
  initial?: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<void> | void;
  onCancel?: () => void;
}

export function Composer({
  label,
  people,
  submitLabel,
  initial = '',
  autoFocus,
  onSubmit,
  onCancel,
}: Props) {
  const [text, setText] = useState(initial);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  // "@par" right before the caret opens the people list.
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
  const q = m ? (m[2] as string).toLowerCase() : null;
  const options =
    q === null || dismissed
      ? []
      : people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  const open = options.length > 0;

  const setSel = (start: number, end: number) =>
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(start, end);
      setCaret(end);
    });

  const pick = (p: Person) => {
    if (!m) return;
    const at = caret - (m[2] as string).length - 1;
    const next = `${text.slice(0, at)}@${p.name} ${text.slice(caret)}`;
    setText(next);
    setActive(0);
    setSel(at + p.name.length + 2, at + p.name.length + 2);
  };

  const fmt = (kind: Format) => {
    const el = ref.current;
    if (!el) return;
    const r = applyFormat(text, el.selectionStart, el.selectionEnd, kind);
    setText(r.text);
    setSel(r.start, r.end);
  };

  // Writes are queued locally by Firestore (and survive being offline), so don't wait for the
  // server: clear the box at once, and put the text back only if the save really fails.
  const submit = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    Promise.resolve(onSubmit(body)).catch((e: unknown) => {
      setText((t) => (t === '' ? body : t));
      toast.error(friendlyError(e));
    });
  };

  const tool = 'rounded p-1.5 text-muted hover:bg-surface-3 hover:text-fg';
  return (
    <div className="rounded-xl border border-border bg-surface focus-within:border-primary">
      <div
        className="flex items-center gap-0.5 border-b border-border px-1.5 py-1"
        role="toolbar"
        aria-label="Formatting"
      >
        <button
          type="button"
          className={tool}
          aria-label="Bold"
          title="Bold"
          onClick={() => fmt('bold')}
        >
          <Bold size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={tool}
          aria-label="Italic"
          title="Italic"
          onClick={() => fmt('italic')}
        >
          <Italic size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={tool}
          aria-label="Bulleted list"
          title="Bulleted list"
          onClick={() => fmt('list')}
        >
          <List size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={tool}
          aria-label="Link"
          title="Link"
          onClick={() => fmt('link')}
        >
          <Link2 size={14} aria-hidden />
        </button>
        <span className="ml-auto pr-1 text-xs text-muted">Type @ to mention</span>
      </div>
      <div className="relative">
        <textarea
          ref={ref}
          aria-label={label}
          value={text}
          rows={3}
          autoFocus={autoFocus}
          maxLength={MAX_UPDATE_LENGTH}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setDismissed(false);
            setActive(0);
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={(e) => {
            if (open) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => (a + 1) % options.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => (a - 1 + options.length) % options.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pick(options[active] as Person);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setDismissed(true);
                return;
              }
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          className="block w-full resize-y rounded-b-xl bg-transparent p-3 text-sm outline-none"
          placeholder="Write an update…"
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="People"
            className="absolute bottom-full left-2 z-10 mb-1 w-56 rounded-xl border border-border bg-surface p-1 shadow-pop"
          >
            {options.map((p, i) => (
              <li
                key={p.uid}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                className={cx(
                  'cursor-pointer truncate rounded-lg px-3 py-1.5 text-sm',
                  i === active ? 'bg-primary-soft text-primary' : 'hover:bg-surface-2',
                )}
              >
                {p.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 px-2 pb-2">
        {text.length > MAX_UPDATE_LENGTH - 500 && (
          <span className="mr-auto text-xs text-muted">
            {text.length}/{MAX_UPDATE_LENGTH}
          </span>
        )}
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" onClick={() => submit()} disabled={text.trim() === ''}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
