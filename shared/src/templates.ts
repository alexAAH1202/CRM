import {
  makeColumn,
  type Column,
  type ColumnSettings,
  type ColumnType,
  type Label,
} from './columns';
import { shortId } from './ids';
import type { Group } from './board';
import type { LabelColor } from './palette';

/**
 * Built-in board templates for household life admin. Phase 2 ships six; more
 * ideas are listed in docs/BACKLOG.md.
 */
export type TemplateId =
  'chores' | 'bills' | 'renewals' | 'maintenance' | 'trip' | 'purchases' | 'goals' | 'blank';

interface ColumnSpec {
  key: string;
  type: ColumnType;
  title: string;
  settings?: ColumnSettings;
}
interface ItemSpec {
  name: string;
  group: string;
  values?: Record<string, unknown>;
}
interface TemplateSpec {
  id: TemplateId;
  name: string;
  emoji: string;
  description: string;
  groups: Array<{ key: string; name: string; color: LabelColor }>;
  columns: ColumnSpec[];
  items: ItemSpec[];
}

const L = (id: string, name: string, color: LabelColor): Label => ({ id, name, color });

const FREQUENCY = [
  L('daily', 'Daily', 'sky'),
  L('weekly', 'Weekly', 'blue'),
  L('fortnightly', 'Fortnightly', 'teal'),
  L('monthly', 'Monthly', 'purple'),
  L('quarterly', 'Quarterly', 'pink'),
  L('yearly', 'Yearly', 'brown'),
];

const SPECS: TemplateSpec[] = [
  {
    id: 'chores',
    name: 'Household chores',
    emoji: '🧹',
    description: 'Who does what, and how often.',
    groups: [
      { key: 'daily', name: 'Daily', color: 'sky' },
      { key: 'weekly', name: 'Weekly', color: 'blue' },
      { key: 'monthly', name: 'Monthly', color: 'purple' },
    ],
    columns: [
      { key: 'who', type: 'people', title: 'Who' },
      {
        key: 'status',
        type: 'status',
        title: 'Status',
        settings: {
          labels: [
            L('todo', 'To do', 'gray'),
            L('done', 'Done', 'green'),
            L('skipped', 'Skipped', 'orange'),
          ],
          defaultLabelId: 'todo',
        },
      },
      { key: 'freq', type: 'dropdown', title: 'How often', settings: { options: FREQUENCY } },
      { key: 'last', type: 'date', title: 'Last done' },
      { key: 'next', type: 'date', title: 'Next due' },
    ],
    items: [
      { name: 'Dishes', group: 'daily', values: { freq: ['daily'] } },
      { name: 'Feed the pets', group: 'daily', values: { freq: ['daily'] } },
      { name: 'Take out the bins', group: 'weekly', values: { freq: ['weekly'] } },
      { name: 'Vacuum and mop', group: 'weekly', values: { freq: ['weekly'] } },
      { name: 'Clean the bathroom', group: 'weekly', values: { freq: ['weekly'] } },
      { name: 'Change bed sheets', group: 'weekly', values: { freq: ['fortnightly'] } },
      { name: 'Clean out the fridge', group: 'monthly', values: { freq: ['monthly'] } },
    ],
  },
  {
    id: 'bills',
    name: 'Bills & subscriptions',
    emoji: '💳',
    description: 'What’s due, how much, and whether it’s paid.',
    groups: [
      { key: 'utilities', name: 'Utilities', color: 'blue' },
      { key: 'subs', name: 'Subscriptions', color: 'purple' },
      { key: 'insurance', name: 'Insurance', color: 'teal' },
      { key: 'loans', name: 'Loans & cards', color: 'brown' },
    ],
    columns: [
      {
        key: 'amount',
        type: 'numbers',
        title: 'Amount',
        settings: { unit: '$', unitPosition: 'prefix', decimals: 2 },
      },
      { key: 'due', type: 'date', title: 'Due date' },
      {
        key: 'daysToDue',
        type: 'formula',
        title: 'Due in (days)',
        settings: { formula: 'IF({Due date} = "", "", DAYS({Due date}, TODAY()))' },
      },
      {
        key: 'repeats',
        type: 'dropdown',
        title: 'Repeats',
        settings: { options: FREQUENCY.slice(1) },
      },
      {
        key: 'status',
        type: 'status',
        title: 'Status',
        settings: {
          labels: [
            L('upcoming', 'Upcoming', 'gray'),
            L('paid', 'Paid', 'green'),
            L('overdue', 'Overdue', 'red'),
            L('autopay', 'Auto-pay', 'blue'),
          ],
          defaultLabelId: 'upcoming',
        },
      },
      { key: 'autopay', type: 'checkbox', title: 'Auto-pay' },
      { key: 'who', type: 'people', title: 'Who pays' },
      { key: 'account', type: 'link', title: 'Account' },
    ],
    items: [
      { name: 'Electricity', group: 'utilities', values: { repeats: ['quarterly'] } },
      { name: 'Water', group: 'utilities', values: { repeats: ['quarterly'] } },
      { name: 'Internet', group: 'utilities', values: { repeats: ['monthly'] } },
      { name: 'Mobile phones', group: 'utilities', values: { repeats: ['monthly'] } },
      { name: 'Streaming services', group: 'subs', values: { repeats: ['monthly'] } },
      { name: 'Gym membership', group: 'subs', values: { repeats: ['monthly'] } },
      { name: 'Car insurance', group: 'insurance', values: { repeats: ['yearly'] } },
      { name: 'Home & contents insurance', group: 'insurance', values: { repeats: ['yearly'] } },
    ],
  },
  {
    id: 'renewals',
    name: 'Renewals & documents',
    emoji: '📄',
    description: 'Passports, licences, rego and anything that expires.',
    groups: [
      { key: 'ids', name: 'IDs & licences', color: 'blue' },
      { key: 'vehicles', name: 'Vehicles', color: 'orange' },
      { key: 'insurance', name: 'Insurance', color: 'teal' },
      { key: 'memberships', name: 'Memberships', color: 'purple' },
    ],
    columns: [
      { key: 'who', type: 'people', title: 'Whose' },
      { key: 'expiry', type: 'date', title: 'Expires' },
      {
        key: 'daysLeft',
        type: 'formula',
        title: 'Days left',
        settings: { formula: 'IF({Expires} = "", "", DAYS({Expires}, TODAY()))' },
      },
      {
        key: 'status',
        type: 'status',
        title: 'Status',
        settings: {
          labels: [
            L('valid', 'Valid', 'green'),
            L('soon', 'Renew soon', 'orange'),
            L('expired', 'Expired', 'red'),
            L('renewing', 'Renewing', 'blue'),
          ],
          defaultLabelId: 'valid',
        },
      },
      {
        key: 'cost',
        type: 'numbers',
        title: 'Cost',
        settings: { unit: '$', unitPosition: 'prefix', decimals: 2 },
      },
      { key: 'where', type: 'link', title: 'Where it’s kept' },
      { key: 'notes', type: 'longText', title: 'Notes' },
    ],
    items: [
      { name: 'Passport', group: 'ids' },
      { name: 'Driver licence', group: 'ids' },
      { name: 'Car registration', group: 'vehicles' },
      { name: 'Roadside assistance', group: 'vehicles' },
      { name: 'Health insurance', group: 'insurance' },
      { name: 'Library card', group: 'memberships' },
    ],
  },
  {
    id: 'maintenance',
    name: 'Home maintenance',
    emoji: '🏠',
    description: 'Regular jobs around the house, and who to call.',
    groups: [
      { key: 'inside', name: 'Inside', color: 'blue' },
      { key: 'outside', name: 'Outside', color: 'green' },
      { key: 'appliances', name: 'Appliances', color: 'orange' },
    ],
    columns: [
      {
        key: 'status',
        type: 'status',
        title: 'Status',
        settings: {
          labels: [
            L('todo', 'To do', 'gray'),
            L('booked', 'Booked', 'blue'),
            L('done', 'Done', 'green'),
            L('attention', 'Needs attention', 'red'),
          ],
          defaultLabelId: 'todo',
        },
      },
      {
        key: 'freq',
        type: 'dropdown',
        title: 'How often',
        settings: { options: FREQUENCY.slice(3) },
      },
      { key: 'last', type: 'date', title: 'Last done' },
      { key: 'next', type: 'date', title: 'Next due' },
      {
        key: 'overdue',
        type: 'formula',
        title: 'Overdue?',
        settings: { formula: 'IF({Next due} = "", "", IF({Next due} < TODAY(), "Overdue", "OK"))' },
      },
      {
        key: 'cost',
        type: 'numbers',
        title: 'Cost',
        settings: { unit: '$', unitPosition: 'prefix', decimals: 0 },
      },
      { key: 'who', type: 'people', title: 'Who' },
      { key: 'contact', type: 'link', title: 'Tradie / contact' },
    ],
    items: [
      { name: 'Test smoke alarms', group: 'inside', values: { freq: ['monthly'] } },
      { name: 'Clean range hood filter', group: 'inside', values: { freq: ['quarterly'] } },
      { name: 'Clean gutters', group: 'outside', values: { freq: ['yearly'] } },
      { name: 'Pest inspection', group: 'outside', values: { freq: ['yearly'] } },
      { name: 'Service air conditioner', group: 'appliances', values: { freq: ['yearly'] } },
      { name: 'Check hot water system', group: 'appliances', values: { freq: ['yearly'] } },
    ],
  },
  {
    id: 'trip',
    name: 'Trip planner',
    emoji: '✈️',
    description: 'Bookings, packing and to-dos for a trip.',
    groups: [
      { key: 'before', name: 'Before we go', color: 'purple' },
      { key: 'bookings', name: 'Bookings', color: 'blue' },
      { key: 'packing', name: 'Packing', color: 'teal' },
      { key: 'during', name: 'During the trip', color: 'orange' },
    ],
    columns: [
      { key: 'who', type: 'people', title: 'Who' },
      {
        key: 'status',
        type: 'status',
        title: 'Status',
        settings: {
          labels: [
            L('todo', 'To do', 'gray'),
            L('waiting', 'Waiting', 'orange'),
            L('done', 'Done', 'green'),
          ],
          defaultLabelId: 'todo',
        },
      },
      { key: 'dates', type: 'timeline', title: 'Dates' },
      {
        key: 'cost',
        type: 'numbers',
        title: 'Cost',
        settings: { unit: '$', unitPosition: 'prefix', decimals: 0 },
      },
      { key: 'link', type: 'link', title: 'Confirmation' },
      { key: 'notes', type: 'longText', title: 'Notes' },
    ],
    items: [
      { name: 'Check passports are valid', group: 'before' },
      { name: 'Travel insurance', group: 'before' },
      { name: 'Arrange pet sitter', group: 'before' },
      { name: 'Flights', group: 'bookings' },
      { name: 'Accommodation', group: 'bookings' },
      { name: 'Chargers and adapters', group: 'packing' },
      { name: 'Medications', group: 'packing' },
    ],
  },
  {
    id: 'purchases',
    name: 'Big purchases & wishlist',
    emoji: '🛍️',
    description: 'Things you want to buy, what they cost, and when.',
    groups: [
      { key: 'soon', name: 'Buying soon', color: 'green' },
      { key: 'saving', name: 'Saving up', color: 'orange' },
      { key: 'someday', name: 'Someday', color: 'sky' },
      { key: 'bought', name: 'Bought', color: 'gray' },
    ],
    columns: [
      {
        key: 'status',
        type: 'status',
        title: 'Status',
        settings: {
          labels: [
            L('idea', 'Idea', 'gray'),
            L('researching', 'Researching', 'blue'),
            L('saving', 'Saving', 'orange'),
            L('ready', 'Ready to buy', 'purple'),
            L('bought', 'Bought', 'green'),
          ],
          defaultLabelId: 'idea',
        },
      },
      {
        key: 'price',
        type: 'numbers',
        title: 'Price',
        settings: { unit: '$', unitPosition: 'prefix', decimals: 0 },
      },
      {
        key: 'saved',
        type: 'numbers',
        title: 'Saved so far',
        settings: { unit: '$', unitPosition: 'prefix', decimals: 0 },
      },
      {
        key: 'togo',
        type: 'formula',
        title: 'Still to save',
        settings: { formula: 'MAX(0, {Price} - {Saved so far})' },
      },
      { key: 'priority', type: 'rating', title: 'Want it' },
      { key: 'by', type: 'date', title: 'Buy by' },
      { key: 'who', type: 'people', title: 'For' },
      { key: 'link', type: 'link', title: 'Link' },
    ],
    items: [
      { name: 'New washing machine', group: 'soon', values: { status: 'ready', priority: 5 } },
      { name: 'Laptop for study', group: 'saving', values: { status: 'saving', priority: 4 } },
      { name: 'Patio furniture', group: 'someday', values: { priority: 3 } },
      { name: 'Noise-cancelling headphones', group: 'someday', values: { priority: 2 } },
    ],
  },
  {
    id: 'goals',
    name: 'Goals & projects',
    emoji: '🎯',
    description: 'Bigger things you’re working towards, in steps.',
    groups: [
      { key: 'now', name: 'This quarter', color: 'blue' },
      { key: 'next', name: 'Next up', color: 'purple' },
      { key: 'done', name: 'Achieved', color: 'green' },
    ],
    columns: [
      {
        key: 'status',
        type: 'status',
        title: 'Status',
        settings: {
          labels: [
            L('notstarted', 'Not started', 'gray'),
            L('working', 'On track', 'green'),
            L('atrisk', 'At risk', 'orange'),
            L('stuck', 'Stuck', 'red'),
            L('done', 'Achieved', 'blue'),
          ],
          defaultLabelId: 'notstarted',
        },
      },
      { key: 'who', type: 'people', title: 'Owner' },
      { key: 'dates', type: 'timeline', title: 'Timeline' },
      { key: 'progress', type: 'progress', title: 'Progress' },
      { key: 'why', type: 'longText', title: 'Why it matters' },
    ],
    items: [
      { name: 'Build an emergency fund', group: 'now' },
      { name: 'Renovate the bathroom', group: 'now' },
      { name: 'Learn to cook five new meals', group: 'next' },
      { name: 'Plan a family reunion', group: 'next' },
    ],
  },
  {
    id: 'blank',
    name: 'Blank list',
    emoji: '⬜',
    description: 'Start from scratch.',
    groups: [{ key: 'todo', name: 'To do', color: 'blue' }],
    columns: [
      { key: 'status', type: 'status', title: 'Status' },
      { key: 'who', type: 'people', title: 'Person' },
      { key: 'date', type: 'date', title: 'Date' },
    ],
    items: [],
  },
];

export const TEMPLATES: ReadonlyArray<Pick<TemplateSpec, 'id' | 'name' | 'emoji' | 'description'>> =
  SPECS.map(({ id, name, emoji, description }) => ({ id, name, emoji, description }));

export interface BuiltTemplate {
  columns: Column[];
  groups: Group[];
  items: Array<{ name: string; groupId: string; values: Record<string, unknown> }>;
}

/** The sections a new list can start with (its groups, shown in the Group column). */
export const LIST_TYPES = [
  { id: 'template', name: 'As the template', sections: [] },
  {
    id: 'tasks',
    name: 'Tasks',
    sections: [
      { name: 'To do', color: 'blue' },
      { name: 'Doing', color: 'orange' },
      { name: 'Done', color: 'green' },
    ],
  },
  {
    id: 'bills',
    name: 'Bills',
    sections: [
      { name: 'Upcoming', color: 'blue' },
      { name: 'Paid', color: 'green' },
      { name: 'Overdue', color: 'red' },
    ],
  },
  {
    id: 'study',
    name: 'Study',
    sections: [
      { name: 'Not started', color: 'gray' },
      { name: 'In progress', color: 'orange' },
      { name: 'Submitted', color: 'green' },
    ],
  },
  {
    id: 'project',
    name: 'Project',
    sections: [
      { name: 'Planning', color: 'purple' },
      { name: 'In progress', color: 'orange' },
      { name: 'Waiting', color: 'yellow' },
      { name: 'Done', color: 'green' },
    ],
  },
  { id: 'custom', name: 'Custom', sections: [] },
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  sections: ReadonlyArray<{ name: string; color: LabelColor }>;
}>;
export type ListTypeId = (typeof LIST_TYPES)[number]['id'];
const CUSTOM_COLORS: LabelColor[] = ['blue', 'orange', 'green', 'purple', 'red', 'yellow', 'gray'];

/** Section names typed by hand ("A, B, C"): trimmed, de-duplicated, at most 12. */
export function customSections(text: string): Array<{ name: string; color: LabelColor }> {
  const seen = new Set<string>();
  return text
    .split(/[,\n]/)
    .map((s) => s.trim().slice(0, 60))
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
    .slice(0, 12)
    .map((name, i) => ({ name, color: CUSTOM_COLORS[i % CUSTOM_COLORS.length]! }));
}

/**
 * Instantiates a template with fresh ids; item values are keyed by real column ids. Every list
 * gets a Group column first. `sections` replaces the template's groups (its items go in the first).
 */
export function buildTemplate(
  id: TemplateId,
  sections?: ReadonlyArray<{ name: string; color: LabelColor }>,
): BuiltTemplate {
  const spec = SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`Unknown template ${id}`);
  const colIds = new Map<string, Column>();
  const columns = [
    makeColumn('group', 'Group'),
    ...spec.columns.map((c) => {
      const col = makeColumn(c.type, c.title, c.settings ?? {});
      colIds.set(c.key, col);
      return col;
    }),
  ];
  const groupIds = new Map<string, string>();
  const custom = sections && sections.length > 0;
  const groups: Group[] = custom
    ? sections.map((g) => ({ id: shortId(), name: g.name, color: g.color }))
    : spec.groups.map((g) => {
        const gid = shortId();
        groupIds.set(g.key, gid);
        return { id: gid, name: g.name, color: g.color };
      });
  if (custom) for (const g of spec.groups) groupIds.set(g.key, groups[0]!.id);
  const items = spec.items.map((it) => {
    const values: Record<string, unknown> = {};
    for (const col of columns) {
      if (col.type === 'status' && col.settings.defaultLabelId)
        values[col.id] = col.settings.defaultLabelId;
    }
    for (const [key, v] of Object.entries(it.values ?? {})) {
      const col = colIds.get(key);
      if (col) values[col.id] = v;
    }
    return { name: it.name, groupId: groupIds.get(it.group) as string, values };
  });
  return { columns, groups, items };
}
