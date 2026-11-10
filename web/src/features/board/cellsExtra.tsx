import {
  formatBytes,
  formatComputedNumber,
  formulaErrorOf,
  isIsoDate,
  isPreviewable,
  drivePreviewUrl,
  LABEL_COLOR_NAMES,
  LABEL_COLORS,
  MAX_FILES,
  MAX_LAG_DAYS,
  normalizeValue,
  predecessorsOf,
  RATING_MAX,
  shortId,
  wouldCreateCycle,
  type DependencyValue,
  type FileValue,
  type Label,
} from '@app/shared';
import {
  Check,
  Eye,
  FileText,
  Link2,
  Mail,
  Phone,
  Star,
  Trash2,
  TriangleAlert,
  Upload,
  FilePlus,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Button, Modal, Popover } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { callHelper, helperConfigured } from '../../lib/helper';
import { toast } from '../../stores/toast';
import { fileValueFor, uploadToDrive } from '../files/upload';
import { useCellEnv } from './cellEnv';
import { Empty, LabelOption, cellBase, cellButton, fmtDate, type CellProps } from './cellParts';

const field =
  'h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm focus:border-primary focus:outline-none';

// ------------------------------------------------------------------- rating

export function RatingCell({ column, item, itemName, canEdit, onChange }: CellProps) {
  const v = (normalizeValue(column, item.values[column.id]) as number | null) ?? 0;
  const [hover, setHover] = useState(0);
  const shown = hover || v;
  return (
    <div
      role="group"
      aria-label={`${column.title} for ${itemName}: ${v} of ${RATING_MAX}`}
      className={cx(cellBase, 'justify-center gap-0.5')}
      onMouseLeave={() => setHover(0)}
    >
      {Array.from({ length: RATING_MAX }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          disabled={!canEdit}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          aria-pressed={v === n}
          onMouseEnter={() => canEdit && setHover(n)}
          onClick={() => onChange(n === v ? null : n)}
          className="rounded p-0.5 enabled:hover:scale-110"
        >
          <Star
            size={16}
            aria-hidden
            className={n <= shown ? 'text-[#f59f2a]' : 'text-muted/50'}
            fill={n <= shown ? 'currentColor' : 'none'}
          />
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ email / phone

export function ContactCell({ column, item, itemName, canEdit, onChange }: CellProps) {
  const isEmail = column.type === 'email';
  const v = normalizeValue(column, item.values[column.id]) as string | null;
  const [draft, setDraft] = useState(v ?? '');
  const [error, setError] = useState('');
  useEffect(() => setDraft(v ?? ''), [v]);
  const Icon = isEmail ? Mail : Phone;
  const link = v ? (
    <a
      href={isEmail ? `mailto:${v}` : `tel:${v.replace(/[^\d+]/g, '')}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex min-w-0 items-center gap-1 text-primary underline-offset-2 hover:underline"
    >
      <Icon size={12} aria-hidden className="shrink-0" />
      <span className="truncate">{v}</span>
    </a>
  ) : null;
  if (!canEdit) return <div className={cellBase}>{link}</div>;
  const save = (close: () => void) => {
    const text = draft.trim();
    if (text === '') {
      onChange(null);
      close();
    } else if (normalizeValue(column, text) === null) {
      setError(isEmail ? 'Enter a valid email address' : 'Enter a valid phone number');
    } else {
      onChange(text);
      close();
    }
  };
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
            aria-label={`Edit ${column.title} for ${itemName}`}
            className={cx(
              'h-full px-2 text-xs text-muted hover:bg-surface-2 hover:text-fg',
              !v && 'flex-1 text-left',
            )}
          >
            {v ? 'Edit' : <Empty />}
          </button>
        )}
      >
        {(close) => (
          <form
            noValidate
            className="space-y-2 p-1"
            onSubmit={(e) => {
              e.preventDefault();
              save(close);
            }}
          >
            <input
              autoComplete="off"
              autoFocus
              type={isEmail ? 'email' : 'tel'}
              aria-label={column.title}
              aria-invalid={error ? true : undefined}
              placeholder={isEmail ? 'name@example.com' : '+61 400 000 000'}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError('');
              }}
              className={field}
            />
            {error && <p className="text-sm text-danger">{error}</p>}
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

// --------------------------------------------------------------------- tags

/** Tags and Dropdown share this: pick from the options, or type a new one right here. */
export function TagsCell({
  column,
  item,
  itemName,
  canEdit,
  onChange,
  noun = 'tag',
}: CellProps & { noun?: 'tag' | 'option' }) {
  const env = useCellEnv();
  const options = column.settings.options ?? [];
  const v = (normalizeValue(column, item.values[column.id]) as string[] | null) ?? [];
  const [name, setName] = useState('');
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

  const create = (close: () => void) => {
    const text = name.trim().slice(0, 40);
    if (!text) return;
    const existing = options.find((o) => o.name.toLowerCase() === text.toLowerCase());
    if (existing) {
      if (!v.includes(existing.id)) onChange([...v, existing.id]);
    } else {
      const opt: Label = {
        id: shortId(),
        name: text,
        color: LABEL_COLOR_NAMES[options.length % LABEL_COLOR_NAMES.length] ?? 'blue',
      };
      env.saveColumnAndSet(
        { ...column, settings: { ...column.settings, options: [...options, opt] } },
        item,
        [...v, opt.id],
      );
    }
    setName('');
    close();
  };

  return (
    <Popover
      label={`${column.title} for ${itemName}`}
      className="w-60"
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
      {(close) => (
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
          <form
            className="mt-1 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              create(close);
            }}
          >
            <input
              autoComplete="off"
              aria-label={`New ${noun}`}
              placeholder={`New ${noun}…`}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={field}
            />
            <Button size="sm" type="submit" disabled={!name.trim()}>
              Add
            </Button>
          </form>
        </div>
      )}
    </Popover>
  );
}

// -------------------------------------------------------------------- files

export function FilesCell({ column, item, itemName, canEdit, onChange }: CellProps) {
  const files = (normalizeValue(column, item.values[column.id]) as FileValue[] | null) ?? [];
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const env = useCellEnv();
  const [upload, setUpload] = useState<{ name: string; fraction: number } | null>(null);
  const [preview, setPreview] = useState<FileValue | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Uploads can outlive the popover, so finish against the latest values, not the ones at the start.
  const latest = useRef({ files, onChange });
  latest.current = { files, onChange };

  const startUpload = (file: File) => {
    if (upload) return;
    if (latest.current.files.length >= MAX_FILES) {
      setError(`You can attach up to ${MAX_FILES} files`);
      return;
    }
    setError('');
    setUpload({ name: file.name, fraction: 0 });
    uploadToDrive(env.wid, file, {
      onProgress: (fraction) => setUpload({ name: file.name, fraction }),
    })
      .then((done) => {
        const cur = latest.current;
        const next = normalizeValue(column, [...cur.files, fileValueFor(done, env.uid)]) as
          FileValue[] | null;
        if (next) cur.onChange(next);
        toast.success(`Uploaded ${done.name}`);
      })
      .catch((e: unknown) => setError(friendlyError(e)))
      .finally(() => setUpload(null));
  };
  const [creating, setCreating] = useState(false);
  const newDoc = () => {
    if (creating) return;
    if (latest.current.files.length >= MAX_FILES) {
      setError(`You can attach up to ${MAX_FILES} files`);
      return;
    }
    setError('');
    setCreating(true);
    // Open the tab now (browsers block pop-ups that aren't a direct result of a click).
    const tab = window.open('', '_blank');
    callHelper(
      'createDoc',
      { workspaceId: env.wid, name: itemName || 'Untitled document' },
      { retries: 0, timeoutMs: 60_000 },
    )
      .then((done) => {
        const cur = latest.current;
        const next = normalizeValue(column, [...cur.files, fileValueFor(done, env.uid)]) as
          FileValue[] | null;
        if (next) cur.onChange(next);
        if (tab) tab.location.href = done.url;
        toast.success(`Created ${done.name}`);
      })
      .catch((e: unknown) => {
        tab?.close();
        setError(friendlyError(e));
      })
      .finally(() => setCreating(false));
  };
  const chips = (
    <span className="flex min-w-0 gap-1 overflow-hidden">
      {files.map((f) => (
        <a
          key={f.url}
          href={f.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={f.name}
          className="inline-flex min-w-0 items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-xs font-semibold hover:bg-primary-soft hover:text-primary"
        >
          <FileText size={11} aria-hidden className="shrink-0" />
          <span className="truncate">{f.name}</span>
        </a>
      ))}
    </span>
  );
  if (!canEdit) return <div className={cellBase}>{chips}</div>;

  const add = () => {
    const candidate = [...files, { name, url }];
    const next = normalizeValue(column, candidate) as FileValue[] | null;
    if (!url.trim() || !next || next.length === files.length) {
      setError(
        files.length >= MAX_FILES
          ? `You can attach up to ${MAX_FILES} files`
          : 'Enter a web address (for example, a Google Drive link)',
      );
      return;
    }
    onChange(next);
    setName('');
    setUrl('');
    setError('');
  };

  return (
    <div className={cx(cellBase, 'gap-1 px-0')}>
      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview?.name ?? 'Preview'}
      >
        {preview?.driveFileId && (
          <div className="space-y-2">
            <iframe
              title={`Preview of ${preview.name}`}
              src={drivePreviewUrl(preview.driveFileId)}
              className="h-[70vh] w-full rounded-lg border border-border"
            />
            <p className="text-xs text-muted">
              Not loading? Make sure you’re signed in to Google with the same email you use here, or{' '}
              <a
                href={preview.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                open it in Drive
              </a>
              .
            </p>
          </div>
        )}
      </Modal>
      <div className="min-w-0 flex-1 px-2">{chips}</div>
      <Popover
        label={`${column.title} for ${itemName}`}
        className="w-80"
        trigger={(p) => (
          <button
            type="button"
            {...p}
            aria-label={`Edit ${column.title} for ${itemName}`}
            className={cx(
              'h-full px-2 text-xs text-muted hover:bg-surface-2 hover:text-fg',
              files.length === 0 && 'flex-1 text-left',
            )}
          >
            {files.length ? 'Edit' : <Empty />}
          </button>
        )}
      >
        <div className="space-y-3 p-1">
          {files.length > 0 && (
            <ul className="space-y-1">
              {files.map((f) => (
                <li key={f.url} className="flex items-center gap-2 text-sm">
                  <FileText size={14} aria-hidden className="shrink-0 text-muted" />
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-primary hover:underline"
                  >
                    {f.name}
                  </a>
                  {f.size !== undefined && (
                    <span className="shrink-0 text-xs text-muted">{formatBytes(f.size)}</span>
                  )}
                  {f.driveFileId && isPreviewable(f.mimeType) && (
                    <button
                      type="button"
                      aria-label={`Preview ${f.name}`}
                      onClick={() => setPreview(f)}
                      className="rounded p-1 text-muted hover:bg-surface-2"
                    >
                      <Eye size={14} aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => onChange(files.filter((x) => x.url !== f.url))}
                    className="rounded p-1 text-muted hover:bg-surface-2"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {helperConfigured() && (
            <div className="space-y-1">
              <input
                ref={input}
                type="file"
                aria-label="Choose a file to upload"
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) startUpload(f);
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                type="button"
                disabled={upload !== null}
                onClick={() => input.current?.click()}
              >
                <Upload size={14} aria-hidden /> Upload a file
              </Button>
              {canEdit && (
                <Button
                  size="sm"
                  variant="secondary"
                  type="button"
                  disabled={creating}
                  onClick={newDoc}
                  className="ml-2"
                >
                  <FilePlus size={14} aria-hidden /> {creating ? 'Creating…' : 'New document'}
                </Button>
              )}
              {upload && (
                <div className="space-y-1" role="status">
                  <p className="truncate text-xs text-muted">
                    Uploading {upload.name}… {Math.round(upload.fraction * 100)}%
                  </p>
                  <div
                    role="progressbar"
                    aria-label="Upload progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(upload.fraction * 100)}
                    className="h-1.5 overflow-hidden rounded-full bg-surface-3"
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${upload.fraction * 100}%` }}
                    />
                  </div>
                </div>
              )}
              <p className="text-xs text-muted">Up to 10 MB. Saved in your shared Drive folder.</p>
            </div>
          )}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input
              autoComplete="off"
              aria-label="File address"
              placeholder="Paste a link (https://…)"
              value={url}
              onChange={(e) => (setUrl(e.target.value), setError(''))}
              className={field}
            />
            <input
              autoComplete="off"
              aria-label="File name"
              placeholder="Name (optional)"
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={field}
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted">Or attach a link to a file.</p>
              <Button size="sm" type="submit">
                Add
              </Button>
            </div>
          </form>
        </div>
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------- computed

export function ProgressCell({ column, item }: CellProps) {
  const v = normalizeValue(column, item.values[column.id]) as number | null;
  if (v === null) return <div className={cellBase} />;
  const pct = Math.round(v);
  return (
    <div className={cx(cellBase, 'gap-2')}>
      <div
        role="progressbar"
        aria-label={column.title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-3 flex-1 overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className={cx('h-full rounded-full', pct >= 100 ? 'bg-[#13865a]' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-9 text-right text-xs font-semibold tabular-nums">{pct}%</span>
    </div>
  );
}

export function ItemIdCell({ column, item }: CellProps) {
  const v = normalizeValue(column, item.values[column.id]) as number | null;
  return (
    <div className={cx(cellBase, 'justify-center text-muted tabular-nums')}>
      {v === null ? null : `${column.settings.prefix ?? ''}${v}`}
    </div>
  );
}

export function DateStampCell({ column, item }: CellProps) {
  const v = normalizeValue(column, item.values[column.id]) as string | null;
  const ms = column.type === 'createdAt' ? item.createdAtMs : item.updatedAtMs;
  return (
    <div
      className={cx(cellBase, 'justify-center')}
      title={ms ? new Date(ms).toLocaleString('en-AU') : undefined}
    >
      {v ? fmtDate(v) : null}
    </div>
  );
}

export function CreatedByCell({ column, item, members }: CellProps) {
  const uid = normalizeValue(column, item.values[column.id]) as string | null;
  if (!uid) return <div className={cellBase} />;
  const m = members.find((x) => x.uid === uid);
  return (
    <div className={cx(cellBase, 'justify-center')} title={m?.name ?? 'Former member'}>
      <Avatar name={m?.name ?? 'Former member'} photoURL={m?.photoURL ?? null} size="sm" />
    </div>
  );
}

export function FormulaCell({ column, item }: CellProps) {
  const raw = item.values[column.id];
  const error = formulaErrorOf(raw);
  if (error) {
    return (
      <div className={cx(cellBase, 'gap-1 text-danger')} title={error}>
        <TriangleAlert size={14} aria-hidden className="shrink-0" />
        <span className="truncate text-xs font-semibold">#ERROR — {error}</span>
      </div>
    );
  }
  const v = normalizeValue(column, raw);
  if (v === null) return <div className={cellBase} />;
  const isNumber = typeof v === 'number';
  const text =
    typeof v === 'number'
      ? formatComputedNumber(v, column.settings)
      : typeof v === 'boolean'
        ? v
          ? 'TRUE'
          : 'FALSE'
        : isIsoDate(v)
          ? fmtDate(v)
          : String(v);
  return (
    <div className={cx(cellBase, isNumber ? 'justify-end tabular-nums' : '')} title={text}>
      <span className="truncate">{text}</span>
    </div>
  );
}

// -------------------------------------------------------------- dependency

export function DependencyCell({ column, item, itemName, canEdit, onChange }: CellProps) {
  const env = useCellEnv();
  const deps = (normalizeValue(column, item.values[column.id]) as DependencyValue[] | null) ?? [];
  const [query, setQuery] = useState('');
  const live = deps.filter((d) => {
    const it = env.items.get(d.id);
    return it && !it.deleted;
  });
  const chips = (
    <span className="flex min-w-0 gap-1 overflow-hidden">
      {live.slice(0, 2).map((d) => (
        <span
          key={d.id}
          title={`${env.items.get(d.id)?.name}${d.lag ? ` (${d.lag > 0 ? '+' : ''}${d.lag} days)` : ''}`}
          className="inline-flex min-w-0 items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-xs font-semibold"
        >
          <Link2 size={11} aria-hidden className="shrink-0" />
          <span className="truncate">{env.items.get(d.id)?.name}</span>
          {d.lag !== 0 && (
            <span className="shrink-0 text-muted">
              {d.lag > 0 ? '+' : ''}
              {d.lag}d
            </span>
          )}
        </span>
      ))}
      {live.length > 2 && (
        <span className="self-center text-xs text-muted">+{live.length - 2}</span>
      )}
    </span>
  );

  // Items that could be chosen, and which of them would create a loop.
  const preds = (id: string) =>
    predecessorsOf(column, env.items.get(id)?.values ?? {}).map((d) => d.id);
  const candidates = useMemo(
    () =>
      [...env.items.values()]
        .filter((c) => c.id !== item.id && !c.deleted && !c.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [env.items, item.id],
  );
  if (!canEdit) return <div className={cellBase}>{chips}</div>;
  const q = query.trim().toLowerCase();
  const shown = candidates.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 100);
  const loopsWith = (id: string) => wouldCreateCycle(preds, item.id, [id]) !== null;

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
          {live.length ? chips : <Empty />}
        </button>
      )}
    >
      <div className="space-y-2 p-1">
        <p className="px-1 text-xs text-muted">
          <strong className="text-fg">{itemName}</strong> can start once these are finished:
        </p>
        <input
          autoComplete="off"
          aria-label="Search items"
          placeholder="Search items…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={field}
        />
        <ul
          className="max-h-64 space-y-0.5 overflow-auto"
          role="listbox"
          aria-label="Items"
          aria-multiselectable
        >
          {shown.length === 0 && (
            <li className="px-2 py-1 text-sm text-muted">No matching items.</li>
          )}
          {shown.map((c) => {
            const dep = deps.find((d) => d.id === c.id);
            const blocked = !dep && loopsWith(c.id);
            return (
              <li
                key={c.id}
                role="option"
                aria-selected={!!dep}
                className={cx(
                  'flex items-center gap-2 rounded-lg px-2 py-1 text-sm',
                  blocked ? 'opacity-50' : 'hover:bg-surface-2',
                )}
              >
                <button
                  type="button"
                  disabled={blocked}
                  title={
                    blocked
                      ? 'This would create a loop: that item already depends on this one'
                      : undefined
                  }
                  onClick={() =>
                    onChange(
                      dep ? deps.filter((d) => d.id !== c.id) : [...deps, { id: c.id, lag: 0 }],
                    )
                  }
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className={cx(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      dep ? 'border-primary bg-primary text-on-primary' : 'border-border',
                    )}
                  >
                    {dep && <Check size={12} aria-hidden />}
                  </span>
                  <span className="truncate">{c.name}</span>
                  {c.parentId && <span className="shrink-0 text-xs text-muted">subitem</span>}
                  {blocked && <span className="shrink-0 text-xs text-danger">loop</span>}
                </button>
                {dep && (
                  <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
                    lag
                    <input
                      autoComplete="off"
                      type="number"
                      aria-label={`Days after ${c.name} finishes`}
                      min={-MAX_LAG_DAYS}
                      max={MAX_LAG_DAYS}
                      value={dep.lag}
                      onChange={(e) =>
                        onChange(
                          deps.map((d) =>
                            d.id === c.id ? { ...d, lag: Number(e.target.value) || 0 } : d,
                          ),
                        )
                      }
                      className="h-7 w-14 rounded-md border border-border bg-surface px-1 text-right text-sm"
                    />
                    d
                  </label>
                )}
              </li>
            );
          })}
        </ul>
        <p className="px-1 text-xs text-muted">
          Lag is extra days after the other item finishes (negative = overlap).
        </p>
        {live.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Clear all
          </Button>
        )}
      </div>
    </Popover>
  );
}
