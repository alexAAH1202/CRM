import {
  isComputedType,
  isScheduledTrigger,
  localDateIn,
  MAX_ACTIONS,
  MAX_OFFSET_DAYS,
  MAX_CONDITIONS,
  newFilter,
  NAME_COLUMN_ID,
  OP_LABELS,
  opsFor,
  shortId,
  TOKEN_ME,
  TOKEN_TODAY,
  type Action,
  type ActionType,
  type Automation,
  type Column,
  type Group,
  type Recurrence,
  scheduledActionProblem,
  type Trigger,
  type TriggerType,
} from '@app/shared';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Button, SelectField, TextField } from '../../components/ui';
import { FilterValue } from '../board/BoardToolbar';
import type { WorkspaceMember } from '../boards/types';
import type { AutomationDraft } from './api';

interface Board {
  columns: Column[];
  groups: Group[];
}

const SETTABLE = [
  'status',
  'dropdown',
  'tags',
  'people',
  'date',
  'numbers',
  'rating',
  'checkbox',
  'text',
  'longText',
  'email',
  'phone',
];
const TRIGGER_LABELS: Record<TriggerType, string> = {
  itemCreated: 'an item is created',
  columnChanged: 'a column changes',
  statusChangedTo: 'a status changes to…',
  personAssigned: 'a person is assigned',
  movedToGroup: 'an item is moved to a group',
  subitemsAllDone: 'all subitems are done',
  dateArrives: 'a date arrives (a reminder)…',
  overdue: 'something is overdue…',
  recurring: 'on a repeating schedule…',
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Our weekday numbers are 0 = Sunday … 6 = Saturday; the picker shows Monday first. */
const WEEKDAY_NUM = [1, 2, 3, 4, 5, 6, 0];
const ACTION_LABELS: Record<ActionType, string> = {
  setValue: 'set a column to…',
  moveToGroup: 'move the item to a group',
  createItem: 'create an item or subitem',
  duplicate: 'duplicate the item',
  archive: 'archive the item',
  notify: 'send a notification',
};

function defaultTrigger(type: TriggerType, b: Board): Trigger {
  const status = b.columns.find((c) => c.type === 'status');
  const label = status?.settings.labels?.[0]?.id ?? '';
  switch (type) {
    case 'itemCreated':
      return { type };
    case 'columnChanged':
      return { type, columnId: null };
    case 'statusChangedTo':
      return { type, columnId: status?.id ?? '', labelId: label };
    case 'personAssigned':
      return { type, columnId: null, uid: null };
    case 'movedToGroup':
      return { type, groupId: b.groups[0]?.id ?? '' };
    case 'subitemsAllDone':
      return { type, columnId: status?.id ?? '', labelId: label };
    case 'dateArrives': {
      const dateCol =
        b.columns.find((c) => c.type === 'date') ?? b.columns.find((c) => c.type === 'timeline');
      return { type, columnId: dateCol?.id ?? '', which: 'end', offsetDays: -3, atTime: '09:00' };
    }
    case 'overdue':
      return {
        type,
        columnId:
          (b.columns.find((c) => c.type === 'date') ?? b.columns.find((c) => c.type === 'timeline'))
            ?.id ?? '',
        atTime: '09:00',
      };
    case 'recurring':
      return {
        type,
        scope: 'board',
        schedule: {
          recurrence: { kind: 'weekly', every: 1, weekdays: [1] },
          atTime: '09:00',
          startDate: localDateIn(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone),
        },
      };
  }
}

function defaultAction(type: ActionType, b: Board, me: string): Action {
  switch (type) {
    case 'setValue': {
      const c = b.columns.find((x) => SETTABLE.includes(x.type) && !isComputedType(x.type));
      return { type, columnId: c?.id ?? '', value: null };
    }
    case 'moveToGroup':
      return { type, groupId: b.groups[0]?.id ?? '' };
    case 'createItem':
      return { type, name: '', groupId: null, subitem: false };
    case 'duplicate':
    case 'archive':
      return { type } as Action;
    case 'notify':
      return { type, to: 'owner', uid: null, message: '{item} was updated' };
  }
  void me;
}

/** Why this automation can't be saved yet (null = fine). */
export function draftError(d: AutomationDraft): string | null {
  if (!d.name.trim()) return 'Give it a name.';
  const t = d.trigger;
  if ((t.type === 'statusChangedTo' || t.type === 'subitemsAllDone') && (!t.columnId || !t.labelId))
    return 'Choose the status column and label for the trigger.';
  if (t.type === 'movedToGroup' && !t.groupId) return 'Choose the group for the trigger.';
  if ((t.type === 'dateArrives' || t.type === 'overdue') && !t.columnId)
    return 'Choose the date column the trigger watches.';
  if (
    t.type === 'recurring' &&
    t.schedule.recurrence.kind === 'weekly' &&
    t.schedule.recurrence.weekdays.length === 0
  )
    return 'Choose at least one day of the week.';
  const sched = scheduledActionProblem(d);
  if (sched) return sched;
  if (d.actions.length === 0) return 'Add at least one action.';
  for (const a of d.actions) {
    if (a.type === 'setValue' && !a.columnId) return 'Choose the column to set.';
    if (a.type === 'moveToGroup' && !a.groupId) return 'Choose the group to move to.';
    if (a.type === 'createItem' && !a.name.trim()) return 'Name the item to create.';
    if (a.type === 'notify' && !a.message.trim()) return 'Write the notification message.';
    if (a.type === 'notify' && a.to === 'person' && !a.uid) return 'Choose who to notify.';
  }
  return null;
}

function ValueEditor({
  column,
  value,
  members,
  onChange,
}: {
  column: Column;
  value: unknown;
  members: WorkspaceMember[];
  onChange: (v: unknown) => void;
}) {
  const label = 'Value';
  switch (column.type) {
    case 'status':
    case 'dropdown':
    case 'tags': {
      const opts =
        column.type === 'status' ? (column.settings.labels ?? []) : (column.settings.options ?? []);
      const cur =
        column.type === 'status'
          ? typeof value === 'string'
            ? value
            : ''
          : Array.isArray(value)
            ? ((value[0] as string) ?? '')
            : '';
      return (
        <SelectField
          label={label}
          value={cur}
          onChange={(e) =>
            onChange(
              e.target.value === ''
                ? null
                : column.type === 'status'
                  ? e.target.value
                  : [e.target.value],
            )
          }
        >
          <option value="">(empty)</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </SelectField>
      );
    }
    case 'people': {
      const cur =
        value === TOKEN_ME ? TOKEN_ME : Array.isArray(value) ? ((value[0] as string) ?? '') : '';
      return (
        <SelectField
          label={label}
          value={cur}
          onChange={(e) =>
            onChange(
              e.target.value === ''
                ? null
                : e.target.value === TOKEN_ME
                  ? TOKEN_ME
                  : [e.target.value],
            )
          }
        >
          <option value="">(nobody)</option>
          <option value={TOKEN_ME}>The person who made the change</option>
          {members.map((m) => (
            <option key={m.uid} value={m.uid}>
              {m.name}
            </option>
          ))}
        </SelectField>
      );
    }
    case 'date': {
      const off = typeof value === 'string' ? /^@today([+-]\d{1,4})$/.exec(value) : null;
      const mode =
        value === TOKEN_TODAY
          ? 'today'
          : off
            ? 'offset'
            : typeof value === 'string' && value
              ? 'date'
              : value === null || value === undefined
                ? 'empty'
                : 'date';
      return (
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            label={label}
            value={mode}
            onChange={(e) =>
              onChange(
                e.target.value === 'today'
                  ? TOKEN_TODAY
                  : e.target.value === 'offset'
                    ? '@today+7'
                    : e.target.value === 'empty'
                      ? null
                      : '',
              )
            }
          >
            <option value="today">Today (when it runs)</option>
            <option value="offset">Today plus or minus some days</option>
            <option value="date">A specific date</option>
            <option value="empty">(empty)</option>
          </SelectField>
          {mode === 'offset' && (
            <TextField
              label="Days from today (negative = earlier)"
              type="number"
              min={-9999}
              max={9999}
              value={String(Number(off?.[1] ?? 0))}
              onChange={(e) => {
                const n = Math.max(-9999, Math.min(9999, Math.trunc(Number(e.target.value) || 0)));
                onChange(`@today${n < 0 ? '-' : '+'}${Math.abs(n)}`);
              }}
            />
          )}
          {mode === 'date' && (
            <TextField
              label="Date"
              type="date"
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </div>
      );
    }
    case 'checkbox':
      return (
        <SelectField
          label={label}
          value={value === true ? 'yes' : 'no'}
          onChange={(e) => onChange(e.target.value === 'yes' ? true : null)}
        >
          <option value="yes">Checked</option>
          <option value="no">Unchecked</option>
        </SelectField>
      );
    case 'numbers':
    case 'rating':
      return (
        <TextField
          label={label}
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    default:
      return (
        <TextField
          label={label}
          value={typeof value === 'string' ? value : ''}
          maxLength={500}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );
  }
}

const row = 'grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2';

export function AutomationBuilder({
  board,
  members,
  me,
  initial,
  editing,
  onSave,
  onCancel,
}: {
  board: Board;
  members: WorkspaceMember[];
  me: string;
  initial: AutomationDraft;
  editing: boolean;
  onSave: (d: AutomationDraft) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<AutomationDraft>(initial);
  const [busy, setBusy] = useState(false);
  const err = draftError(d);
  const statusCols = board.columns.filter((c) => c.type === 'status');
  const dateColumns = board.columns.filter((c) => c.type === 'date' || c.type === 'timeline');
  const settable = board.columns.filter(
    (c) => SETTABLE.includes(c.type) && !isComputedType(c.type),
  );
  const peopleCols = board.columns.filter((c) => c.type === 'people');
  const t = d.trigger;
  const setTrigger = (x: Trigger) => setD({ ...d, trigger: x });
  const setAction = (i: number, a: Action) =>
    setD({ ...d, actions: d.actions.map((x, j) => (j === i ? a : x)) });

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (err || busy) return;
        setBusy(true);
        try {
          await onSave({ ...d, name: d.name.trim() });
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextField
        label="Name"
        value={d.name}
        maxLength={120}
        onChange={(e) => setD({ ...d, name: e.target.value })}
      />

      <section aria-label="When" className="space-y-2">
        <h3 className="text-sm font-bold">When</h3>
        <div className={row}>
          <SelectField
            label="Trigger"
            value={t.type}
            onChange={(e) => setTrigger(defaultTrigger(e.target.value as TriggerType, board))}
          >
            {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((k) => (
              <option key={k} value={k}>
                {TRIGGER_LABELS[k]}
              </option>
            ))}
          </SelectField>
          {t.type === 'columnChanged' && (
            <SelectField
              label="Column"
              value={t.columnId ?? ''}
              onChange={(e) => setTrigger({ ...t, columnId: e.target.value || null })}
            >
              <option value="">Any column</option>
              {board.columns
                .filter((c) => !isComputedType(c.type))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
            </SelectField>
          )}
          {(t.type === 'statusChangedTo' || t.type === 'subitemsAllDone') && (
            <>
              <SelectField
                label="Status column"
                value={t.columnId}
                onChange={(e) => {
                  const c = statusCols.find((x) => x.id === e.target.value);
                  setTrigger({
                    ...t,
                    columnId: e.target.value,
                    labelId: c?.settings.labels?.[0]?.id ?? '',
                  });
                }}
              >
                {statusCols.length === 0 && <option value="">(no status column)</option>}
                {statusCols.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={t.type === 'statusChangedTo' ? 'Changes to' : 'All are'}
                value={t.labelId}
                onChange={(e) => setTrigger({ ...t, labelId: e.target.value })}
              >
                {(statusCols.find((c) => c.id === t.columnId)?.settings.labels ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </SelectField>
            </>
          )}
          {t.type === 'personAssigned' && (
            <>
              <SelectField
                label="In column"
                value={t.columnId ?? ''}
                onChange={(e) => setTrigger({ ...t, columnId: e.target.value || null })}
              >
                <option value="">Any People column</option>
                {peopleCols.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Who"
                value={t.uid ?? ''}
                onChange={(e) => setTrigger({ ...t, uid: e.target.value || null })}
              >
                <option value="">Anyone</option>
                {members.map((m) => (
                  <option key={m.uid} value={m.uid}>
                    {m.name}
                  </option>
                ))}
              </SelectField>
            </>
          )}
          {t.type === 'movedToGroup' && (
            <SelectField
              label="Group"
              value={t.groupId}
              onChange={(e) => setTrigger({ ...t, groupId: e.target.value })}
            >
              {board.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </SelectField>
          )}
          {(t.type === 'dateArrives' || t.type === 'overdue') && (
            <>
              <SelectField
                label="Date column"
                value={t.columnId}
                onChange={(e) => setTrigger({ ...t, columnId: e.target.value })}
              >
                {dateColumns.length === 0 && <option value="">(no date column)</option>}
                {dateColumns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </SelectField>
              {t.type === 'dateArrives' &&
                dateColumns.find((c) => c.id === t.columnId)?.type === 'timeline' && (
                  <SelectField
                    label="Which end"
                    value={t.which}
                    onChange={(e) =>
                      setTrigger({ ...t, which: e.target.value === 'start' ? 'start' : 'end' })
                    }
                  >
                    <option value="start">Start</option>
                    <option value="end">End</option>
                  </SelectField>
                )}
              {t.type === 'dateArrives' && (
                <>
                  <TextField
                    label="Days"
                    type="number"
                    min={0}
                    max={MAX_OFFSET_DAYS}
                    value={String(Math.abs(t.offsetDays))}
                    onChange={(e) => {
                      const n = Math.min(
                        MAX_OFFSET_DAYS,
                        Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                      );
                      setTrigger({ ...t, offsetDays: t.offsetDays < 0 ? -n : n });
                    }}
                  />
                  <SelectField
                    label="Before or after"
                    value={t.offsetDays < 0 ? 'before' : 'after'}
                    onChange={(e) => {
                      const n = Math.abs(t.offsetDays);
                      setTrigger({ ...t, offsetDays: e.target.value === 'before' ? -n : n });
                    }}
                  >
                    <option value="before">before the date</option>
                    <option value="after">after the date</option>
                  </SelectField>
                </>
              )}
              <TextField
                label="At (time of day)"
                type="time"
                value={t.atTime}
                onChange={(e) => e.target.value && setTrigger({ ...t, atTime: e.target.value })}
              />
            </>
          )}
          {t.type === 'recurring' && (
            <>
              <SelectField
                label="Runs"
                value={t.scope}
                onChange={(e) =>
                  setTrigger({ ...t, scope: e.target.value === 'items' ? 'items' : 'board' })
                }
              >
                <option value="board">once for the list (add items, send a notification)</option>
                <option value="items">for each item that matches the conditions</option>
              </SelectField>
              <SelectField
                label="Repeats"
                value={t.schedule.recurrence.kind}
                onChange={(e) => {
                  const every = t.schedule.recurrence.every;
                  const kind = e.target.value;
                  const recurrence: Recurrence =
                    kind === 'daily'
                      ? { kind: 'daily', every }
                      : kind === 'monthly'
                        ? { kind: 'monthly', every, dayOfMonth: 1 }
                        : { kind: 'weekly', every, weekdays: [1] };
                  setTrigger({ ...t, schedule: { ...t.schedule, recurrence } });
                }}
              >
                <option value="daily">Every N days</option>
                <option value="weekly">Every N weeks, on chosen days</option>
                <option value="monthly">Every N months, on a day of the month</option>
              </SelectField>
              <TextField
                label="Every"
                type="number"
                min={1}
                max={52}
                value={String(t.schedule.recurrence.every)}
                onChange={(e) => {
                  const every = Math.min(52, Math.max(1, Math.trunc(Number(e.target.value) || 1)));
                  setTrigger({
                    ...t,
                    schedule: { ...t.schedule, recurrence: { ...t.schedule.recurrence, every } },
                  });
                }}
              />
              {t.schedule.recurrence.kind === 'weekly' && (
                <fieldset className="sm:col-span-2">
                  <legend className="mb-1 text-sm font-semibold">On</legend>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((label, i) => {
                      const rec = t.schedule.recurrence as Extract<Recurrence, { kind: 'weekly' }>;
                      const num = WEEKDAY_NUM[i] as number;
                      const on = rec.weekdays.includes(num);
                      return (
                        <label
                          key={label}
                          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setTrigger({
                                ...t,
                                schedule: {
                                  ...t.schedule,
                                  recurrence: {
                                    ...rec,
                                    weekdays: on
                                      ? rec.weekdays.filter((x) => x !== num)
                                      : [...rec.weekdays, num].sort((a, b) => a - b),
                                  },
                                },
                              })
                            }
                            className="h-4 w-4 accent-[var(--c-primary)]"
                          />
                          {label}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              {t.schedule.recurrence.kind === 'monthly' && (
                <TextField
                  label="Day of the month"
                  type="number"
                  min={1}
                  max={31}
                  hint="The 29th to 31st run on the last day of shorter months."
                  value={String(t.schedule.recurrence.dayOfMonth)}
                  onChange={(e) => {
                    const dayOfMonth = Math.min(
                      31,
                      Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                    );
                    setTrigger({
                      ...t,
                      schedule: {
                        ...t.schedule,
                        recurrence: {
                          kind: 'monthly',
                          every: t.schedule.recurrence.every,
                          dayOfMonth,
                        },
                      },
                    });
                  }}
                />
              )}
              <TextField
                label="At (time of day)"
                type="time"
                value={t.schedule.atTime}
                onChange={(e) =>
                  e.target.value &&
                  setTrigger({ ...t, schedule: { ...t.schedule, atTime: e.target.value } })
                }
              />
              <TextField
                label="Starting"
                type="date"
                value={t.schedule.startDate}
                onChange={(e) =>
                  e.target.value &&
                  setTrigger({ ...t, schedule: { ...t.schedule, startDate: e.target.value } })
                }
              />
            </>
          )}
        </div>
      </section>

      {!(t.type === 'recurring' && t.scope === 'board') && (
        <section aria-label="Only if" className="space-y-2">
          <h3 className="text-sm font-bold">
            Only if <span className="font-normal text-muted">(optional)</span>
          </h3>
          {d.conditions.map((f, i) => {
            const col = board.columns.find((c) => c.id === f.columnId);
            const type = col?.type ?? 'text';
            return (
              <div
                key={f.id}
                className="flex flex-wrap items-end gap-2 rounded-xl border border-border p-3"
              >
                <SelectField
                  label="Column"
                  value={f.columnId}
                  onChange={(e) => {
                    const c = board.columns.find((x) => x.id === e.target.value);
                    const next = {
                      ...f,
                      columnId: e.target.value,
                      op: opsFor(c?.type ?? 'name')[0] ?? 'isEmpty',
                      value: undefined,
                    };
                    setD({ ...d, conditions: d.conditions.map((x, j) => (j === i ? next : x)) });
                  }}
                >
                  <option value={NAME_COLUMN_ID}>Name</option>
                  {board.columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="Is"
                  value={f.op}
                  onChange={(e) =>
                    setD({
                      ...d,
                      conditions: d.conditions.map((x, j) =>
                        j === i ? { ...f, op: e.target.value as typeof f.op } : x,
                      ),
                    })
                  }
                >
                  {opsFor(f.columnId === NAME_COLUMN_ID ? 'name' : type).map((op) => (
                    <option key={op} value={op}>
                      {OP_LABELS[op]}
                    </option>
                  ))}
                </SelectField>
                <FilterValue
                  filter={f}
                  column={col}
                  members={members}
                  onChange={(value) =>
                    setD({
                      ...d,
                      conditions: d.conditions.map((x, j) => (j === i ? { ...f, value } : x)),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove condition ${i + 1}`}
                  onClick={() => setD({ ...d, conditions: d.conditions.filter((_, j) => j !== i) })}
                  className="rounded-lg p-2 text-muted hover:bg-surface-2"
                >
                  <X size={16} aria-hidden />
                </button>
              </div>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={d.conditions.length >= MAX_CONDITIONS}
            onClick={() =>
              setD({
                ...d,
                conditions: [...d.conditions, { ...newFilter(board.columns), id: shortId() }],
              })
            }
          >
            <Plus size={14} aria-hidden /> Add condition
          </Button>
        </section>
      )}

      {isScheduledTrigger(t) && (
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">
          This one runs on a clock, not when you click: the Sorted helper checks every 10 minutes
          (see Members → Sorted helper). Times use your workspace’s time zone.
        </p>
      )}

      <section aria-label="Then" className="space-y-2">
        <h3 className="text-sm font-bold">Then</h3>
        {d.actions.map((a, i) => {
          const col =
            a.type === 'setValue' ? board.columns.find((c) => c.id === a.columnId) : undefined;
          return (
            <div key={i} className={row}>
              <SelectField
                label={`Action ${i + 1}`}
                value={a.type}
                onChange={(e) =>
                  setAction(i, defaultAction(e.target.value as ActionType, board, me))
                }
              >
                {(Object.keys(ACTION_LABELS) as ActionType[]).map((k) => (
                  <option key={k} value={k}>
                    {ACTION_LABELS[k]}
                  </option>
                ))}
              </SelectField>
              {a.type === 'setValue' && (
                <>
                  <SelectField
                    label="Column"
                    value={a.columnId}
                    onChange={(e) => setAction(i, { ...a, columnId: e.target.value, value: null })}
                  >
                    {settable.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </SelectField>
                  {col && (
                    <ValueEditor
                      column={col}
                      value={a.value}
                      members={members}
                      onChange={(value) => setAction(i, { ...a, value })}
                    />
                  )}
                </>
              )}
              {a.type === 'moveToGroup' && (
                <SelectField
                  label="Group"
                  value={a.groupId}
                  onChange={(e) => setAction(i, { ...a, groupId: e.target.value })}
                >
                  {board.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </SelectField>
              )}
              {a.type === 'createItem' && (
                <>
                  <TextField
                    label="Name (use {item} for the item’s name)"
                    value={a.name}
                    maxLength={200}
                    onChange={(e) => setAction(i, { ...a, name: e.target.value })}
                  />
                  <SelectField
                    label="Create it as"
                    value={a.subitem ? 'sub' : 'item'}
                    onChange={(e) => setAction(i, { ...a, subitem: e.target.value === 'sub' })}
                  >
                    <option value="item">A new item</option>
                    <option value="sub">A subitem of this item</option>
                  </SelectField>
                  {!a.subitem && (
                    <SelectField
                      label="In group"
                      value={a.groupId ?? ''}
                      onChange={(e) => setAction(i, { ...a, groupId: e.target.value || null })}
                    >
                      <option value="">Same group</option>
                      {board.groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </SelectField>
                  )}
                </>
              )}
              {a.type === 'notify' && (
                <>
                  <SelectField
                    label="Tell"
                    value={a.to}
                    onChange={(e) =>
                      setAction(i, { ...a, to: e.target.value as typeof a.to, uid: null })
                    }
                  >
                    <option value="owner">Me (the automation’s owner)</option>
                    <option value="assignees">The people on the item</option>
                    <option value="actor">Whoever made the change</option>
                    <option value="person">A particular person</option>
                  </SelectField>
                  {a.to === 'person' && (
                    <SelectField
                      label="Person"
                      value={a.uid ?? ''}
                      onChange={(e) => setAction(i, { ...a, uid: e.target.value || null })}
                    >
                      <option value="">(choose)</option>
                      {members.map((m) => (
                        <option key={m.uid} value={m.uid}>
                          {m.name}
                        </option>
                      ))}
                    </SelectField>
                  )}
                  <TextField
                    label="Message (use {item} for the item’s name)"
                    className="sm:col-span-2"
                    value={a.message}
                    maxLength={200}
                    onChange={(e) => setAction(i, { ...a, message: e.target.value })}
                  />
                </>
              )}
              {d.actions.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove action ${i + 1}`}
                  onClick={() => setD({ ...d, actions: d.actions.filter((_, j) => j !== i) })}
                  className="justify-self-end rounded-lg p-2 text-muted hover:bg-surface-2 sm:col-span-2"
                >
                  <X size={16} aria-hidden />
                </button>
              )}
            </div>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={d.actions.length >= MAX_ACTIONS}
          onClick={() =>
            setD({ ...d, actions: [...d.actions, defaultAction('notify', board, me)] })
          }
        >
          <Plus size={14} aria-hidden /> Add action
        </Button>
      </section>

      {err && (
        <p role="status" className="text-sm text-muted">
          {err}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={err !== null || busy}>
          {editing ? 'Save changes' : 'Add automation'}
        </Button>
      </div>
    </form>
  );
}

export type { Automation };
