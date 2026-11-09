import { boardPaths, rankMatches } from '@app/shared';
import { collection, query } from 'firebase/firestore';
import { LayoutGrid, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../../components/ui';
import { cx } from '../../lib/cx';
import { db } from '../../lib/firebase';
import { readQueryFromCache } from '../../lib/firestore';
import { useBoards } from '../boards/BoardsProvider';
import { useWorkspace } from '../workspaces/WorkspaceProvider';

interface Hit {
  key: string;
  kind: 'board' | 'item';
  title: string;
  sub: string;
  to: string;
}

/**
 * Find boards (always) and items (from boards opened on this device). Items come from the
 * local cache, which costs no reads — so boards you haven't opened yet aren't searched.
 */
export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const { boards, archived } = useBoards();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [items, setItems] = useState<Hit[]>([]);
  const [searched, setSearched] = useState<number | null>(null);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  // The dialog takes focus when it opens; put it in the search box instead.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Load cached items once each time the palette opens (free), then filter in memory.
  useEffect(() => {
    if (!open || !boards) return;
    setQ('');
    setActive(0);
    let live = true;
    void (async () => {
      const out: Hit[] = [];
      let covered = 0;
      for (const b of [...boards, ...archived]) {
        try {
          const snap = await readQueryFromCache(
            query(collection(db, boardPaths.items(workspace.id, b.id))),
          );
          if (snap.empty) continue;
          covered++;
          for (const d of snap.docs) {
            const x = d.data();
            if (x['deletedAt'] != null || x['archived'] === true) continue;
            out.push({
              key: `${b.id}:${d.id}`,
              kind: 'item',
              title: String(x['name'] ?? ''),
              sub: b.name,
              to: `/w/${workspace.id}/b/${b.id}?item=${d.id}`,
            });
          }
        } catch {
          /* nothing cached for this board */
        }
      }
      if (live) {
        setItems(out);
        setSearched(covered);
      }
    })();
    return () => {
      live = false;
    };
  }, [open, boards, archived, workspace.id]);

  const hits = useMemo<Hit[]>(() => {
    if (!q.trim()) return [];
    const boardHits: Hit[] = [...(boards ?? []), ...archived].map((b) => ({
      key: `b:${b.id}`,
      kind: 'board',
      title: b.name,
      sub: b.archived ? 'Archived list' : 'List',
      to: `/w/${workspace.id}/b/${b.id}`,
    }));
    return [
      ...rankMatches(boardHits, q, (h) => h.title, 5),
      ...rankMatches(items, q, (h) => h.title, 15),
    ];
  }, [q, boards, archived, items, workspace.id]);

  const go = (h: Hit) => {
    onClose();
    navigate(h.to);
  };

  return (
    <Modal open={open} onClose={onClose} title="Search">
      <div className="flex items-center gap-2 rounded-xl border border-border px-3 focus-within:border-primary">
        <Search size={16} aria-hidden className="text-muted" />
        <input
          ref={input}
          autoFocus
          role="combobox"
          aria-label="Search lists and items"
          aria-expanded={hits.length > 0}
          aria-controls={listId}
          aria-activedescendant={hits.length ? `${listId}-${active}` : undefined}
          placeholder="Search lists and items…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && hits.length) {
              e.preventDefault();
              setActive((a) => (a + 1) % hits.length);
            } else if (e.key === 'ArrowUp' && hits.length) {
              e.preventDefault();
              setActive((a) => (a - 1 + hits.length) % hits.length);
            } else if (e.key === 'Enter' && hits[active]) {
              e.preventDefault();
              go(hits[active] as Hit);
            }
          }}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <ul id={listId} role="listbox" aria-label="Results" className="mt-2 max-h-80 overflow-auto">
        {hits.map((h, i) => (
          <li
            key={h.key}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => go(h)}
            className={cx(
              'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm',
              i === active && 'bg-primary-soft text-primary',
            )}
          >
            {h.kind === 'board' && <LayoutGrid size={14} aria-hidden />}
            <span className="min-w-0 flex-1 truncate font-semibold">{h.title || 'Untitled'}</span>
            <span className="shrink-0 text-xs text-muted">{h.sub}</span>
          </li>
        ))}
      </ul>
      {q.trim() !== '' && hits.length === 0 && (
        <p className="py-4 text-center text-sm text-muted">No matches.</p>
      )}
      <p className="mt-3 text-xs text-muted">
        {searched === null
          ? 'Looking through this device’s lists…'
          : `Items are searched in the ${searched} list${searched === 1 ? '' : 's'} you’ve opened on this device.`}
      </p>
    </Modal>
  );
}
