import { Modal } from '../../components/ui';

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl / ⌘ + K', 'Search lists and items'],
  ['Ctrl / ⌘ + Z', 'Undo (on a list)'],
  ['Ctrl / ⌘ + Shift + Z  or  Ctrl + Y', 'Redo'],
  ['Arrow keys', 'Move between cells in a table'],
  ['Enter', 'Edit the cell, or open a card'],
  ['Space, then arrows, then Space', 'Drag a card or row with the keyboard'],
  ['Esc', 'Close a dialog or panel; cancel an edit'],
  ['?', 'Show this list'],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <dl className="space-y-2 text-sm">
        {SHORTCUTS.map(([k, what]) => (
          <div key={k} className="flex items-baseline gap-3">
            <dt className="w-48 shrink-0">
              <kbd className="rounded border border-border px-1.5 py-0.5 text-xs">{k}</kbd>
            </dt>
            <dd className="text-muted">{what}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
