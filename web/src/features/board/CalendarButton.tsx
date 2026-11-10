import { dueDateOf } from '@app/shared';
import type { Column } from '@app/shared';
import { CalendarCheck, CalendarPlus } from 'lucide-react';
import { helperConfigured } from '../../lib/helper';
import type { BoardItem } from '../boards/types';

/**
 * "Add to calendar": puts the item's due date on Google Calendar (the calendar of whoever is
 * assigned, or of its creator). The helper picks it up within about 10 minutes (D103).
 */
export function CalendarButton(p: {
  item: BoardItem;
  columns: readonly Column[];
  onToggle: (on: boolean) => void;
}) {
  if (!helperConfigured()) return null;
  const due = dueDateOf(p.columns, p.item.values);
  const on = p.item.onCalendar === true;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        aria-pressed={on}
        disabled={!on && !due}
        onClick={() => p.onToggle(!on)}
        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-semibold hover:bg-surface-2 disabled:opacity-50"
      >
        {on ? (
          <CalendarCheck size={14} aria-hidden className="text-primary" />
        ) : (
          <CalendarPlus size={14} aria-hidden />
        )}
        {on ? 'On calendar · remove' : 'Add to calendar'}
      </button>
      <span className="text-xs text-muted">
        {!due
          ? 'Give it a due date to add it to Google Calendar.'
          : on
            ? `All-day on ${due}, on the calendar of whoever it’s assigned to. Updates within about 10 minutes.`
            : 'Puts the due date on the Google Calendar of whoever it’s assigned to (or you).'}
      </span>
    </div>
  );
}
