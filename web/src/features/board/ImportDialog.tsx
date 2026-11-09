import {
  buildImport,
  IMPORT_MAX_ROWS,
  IMPORTABLE_TYPES,
  parseCsv,
  suggestMapping,
  type ImportMember,
  type Target,
} from '@app/shared';
import { Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button, Modal, SelectField } from '../../components/ui';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { importItems } from '../boards/api';
import type { Board, BoardItem, WorkspaceMember } from '../boards/types';

const keyOf = (t: Target): string => (t === null ? '' : t.kind === 'column' ? `c:${t.id}` : t.kind);
const targetOf = (k: string): Target =>
  k === ''
    ? null
    : k === 'name'
      ? { kind: 'name' }
      : k === 'group'
        ? { kind: 'group' }
        : { kind: 'column', id: k.slice(2) };

/**
 * Import items from a CSV (for example one exported from here, or from another app). The file is
 * read on this device; you choose what each column means, see what would happen, and then it's
 * created in batches. Cells that can't be understood are left empty and listed, never guessed.
 */
export function ImportDialog({
  wid,
  uid,
  board,
  items,
  members,
  fallbackNumber,
  onClose,
}: {
  wid: string;
  uid: string;
  board: Board;
  items: ReadonlyMap<string, BoardItem>;
  members: readonly WorkspaceMember[];
  fallbackNumber: number;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Target[]>([]);
  const [groupId, setGroupId] = useState(board.groups[0]?.id ?? '');
  const [progress, setProgress] = useState<number | null>(null);

  const headers = rows?.[0] ?? [];
  const importMembers: ImportMember[] = useMemo(
    () => members.map((m) => ({ uid: m.uid, name: m.name, email: m.email })),
    [members],
  );
  const plan = useMemo(
    () =>
      rows
        ? buildImport({
            rows: rows.slice(1),
            headers,
            mapping,
            columns: board.columns,
            groups: board.groups,
            defaultGroupId: groupId,
            members: importMembers,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- headers derives from rows
    [rows, mapping, board.columns, board.groups, groupId, importMembers],
  );
  const hasName = mapping.some((t) => t?.kind === 'name');
  const importing = progress !== null;

  const choose = async (file: File) => {
    setError('');
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.error) {
      setError(parsed.error);
      setRows(null);
      return;
    }
    setFileName(file.name);
    setRows(parsed.rows);
    setMapping(suggestMapping(parsed.rows[0] ?? [], board.columns));
  };

  const run = () => {
    if (!plan || plan.items.length === 0) return;
    setProgress(0);
    const lastOrderByGroup = new Map<string, string | null>();
    for (const it of items.values()) {
      if (it.deleted || it.parentId) continue;
      const cur = lastOrderByGroup.get(it.groupId);
      if (cur == null || it.order > cur) lastOrderByGroup.set(it.groupId, it.order);
    }
    importItems({
      wid,
      board,
      uid,
      items: plan.items,
      lastOrderByGroup,
      fallbackNumber,
      onProgress: setProgress,
    })
      .then(() => {
        toast.success(`Imported ${plan.items.length} item${plan.items.length === 1 ? '' : 's'}.`);
        onClose();
      })
      .catch((e: unknown) => {
        setError(friendlyError(e));
        setProgress(null);
      });
  };

  const options = board.columns.filter((c) => IMPORTABLE_TYPES.has(c.type));
  const usedColumns = new Set(mapping.map(keyOf).filter((k) => k.startsWith('c:')));

  return (
    <Modal
      open
      onClose={() => !importing && onClose()}
      title="Import from CSV"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button
            onClick={run}
            disabled={!plan || plan.items.length === 0 || !hasName || importing}
          >
            {importing
              ? `Importing… ${progress} of ${plan?.items.length ?? 0}`
              : plan
                ? `Import ${plan.items.length} item${plan.items.length === 1 ? '' : 's'}`
                : 'Import'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv,text/plain"
            aria-label="Choose a CSV file"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void choose(f);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => input.current?.click()}
            disabled={importing}
          >
            <Upload size={14} aria-hidden />{' '}
            {rows ? 'Choose a different file' : 'Choose a CSV file'}
          </Button>
          {fileName && <p className="text-sm text-muted">{fileName}</p>}
          <p className="text-xs text-muted">
            The first row should be column headings. Up to {IMPORT_MAX_ROWS} rows. Dates are read
            day-first (17/3/2026). Imported items don’t trigger automations, but reminders for their
            dates are set up.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {rows && plan && (
          <>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">What is each column?</legend>
              <ul className="space-y-2">
                {headers.map((h, i) => (
                  <li key={i} className="grid grid-cols-2 items-center gap-2">
                    <span className="truncate text-sm" title={h}>
                      {h || `(column ${i + 1})`}
                      <span className="block truncate text-xs text-muted">
                        {rows[1]?.[i] ?? ''}
                      </span>
                    </span>
                    <SelectField
                      label={`Column ${h || i + 1} is`}
                      hideLabel
                      value={keyOf(mapping[i] ?? null)}
                      disabled={importing}
                      onChange={(e) =>
                        setMapping((prev) => {
                          const n = [...prev];
                          const t = targetOf(e.target.value);
                          // one CSV column per board column / name / group
                          for (let j = 0; j < n.length; j++)
                            if (j !== i && t && keyOf(n[j] ?? null) === keyOf(t)) n[j] = null;
                          n[i] = t;
                          return n;
                        })
                      }
                    >
                      <option value="">Don’t import</option>
                      <option value="name">Item name</option>
                      <option value="group">Group</option>
                      {options.map((c) => (
                        <option
                          key={c.id}
                          value={`c:${c.id}`}
                          disabled={
                            usedColumns.has(`c:${c.id}`) &&
                            keyOf(mapping[i] ?? null) !== `c:${c.id}`
                          }
                        >
                          {c.title}
                        </option>
                      ))}
                    </SelectField>
                  </li>
                ))}
              </ul>
            </fieldset>
            {!hasName && (
              <p role="alert" className="text-sm text-danger">
                Choose which column is the item name.
              </p>
            )}
            <SelectField
              label="Group for items without one"
              value={groupId}
              disabled={importing}
              onChange={(e) => setGroupId(e.target.value)}
            >
              {board.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </SelectField>
            <div role="status" className="space-y-1 text-sm">
              <p className="font-semibold">
                {plan.items.length} item{plan.items.length === 1 ? '' : 's'} will be added
                {plan.skipped > 0 &&
                  ` (${plan.skipped} row${plan.skipped === 1 ? '' : 's'} with no name skipped)`}
                .
              </p>
              {plan.problems.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-danger">
                    {plan.problems.length} cell{plan.problems.length === 1 ? '' : 's'} can’t be used
                    and will be left empty
                  </summary>
                  <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted">
                    {plan.problems.slice(0, 50).map((p, k) => (
                      <li key={k}>
                        Row {p.row}, {p.column}: “{p.text}” is {p.reason}
                      </li>
                    ))}
                    {plan.problems.length > 50 && <li>…and {plan.problems.length - 50} more</li>}
                  </ul>
                </details>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
