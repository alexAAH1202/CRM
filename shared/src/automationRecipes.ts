import type { Group } from './board';
import type { Column } from './columns';
import { TOKEN_ME, TOKEN_TODAY, type Action, type Automation, type Trigger } from './automations';

export type AutomationDraft = Omit<Automation, 'id'>;

export interface Recipe {
  id: string;
  title: string;
  description: string;
  draft: AutomationDraft;
}

interface Board {
  columns: readonly Column[];
  groups: readonly Group[];
}

const DONE = /^(done|complete|completed|finished|paid|closed|resolved)$/i;
const BAD = /stuck|overdue|blocked|late|problem|urgent/i;
const WORKING = /work|progress|doing|started|active/i;

const labelsOf = (c: Column) => c.settings.labels ?? [];

/**
 * Ready-made automations that fit this board's columns (a recipe is offered only if the board
 * has what it needs). Picking one opens it in the builder, pre-filled, to adjust and save.
 */
export function recipesFor(board: Board, me: string): Recipe[] {
  const status = board.columns.find((c) => c.type === 'status');
  const people = board.columns.find((c) => c.type === 'people');
  const date = board.columns.find((c) => c.type === 'date');
  const doneLabel = status ? labelsOf(status).find((l) => DONE.test(l.name.trim())) : undefined;
  const badLabel = status ? labelsOf(status).find((l) => BAD.test(l.name)) : undefined;
  const workingLabel = status ? labelsOf(status).find((l) => WORKING.test(l.name)) : undefined;
  const lastGroup = board.groups.at(-1);
  const doneGroup =
    board.groups.find((g) => DONE.test(g.name.trim()) || /done|complete|archive/i.test(g.name)) ??
    lastGroup;
  const mk = (
    id: string,
    title: string,
    description: string,
    trigger: Trigger,
    actions: Action[],
    conditions: Automation['conditions'] = [],
  ): Recipe => ({
    id,
    title,
    description,
    draft: { name: title, enabled: true, ownerUid: me, trigger, conditions, actions },
  });
  const out: Recipe[] = [];
  const toDone: Trigger | null =
    status && doneLabel
      ? { type: 'statusChangedTo', columnId: status.id, labelId: doneLabel.id }
      : null;

  out.push(
    mk(
      'created-notify',
      'Tell me when an item is added',
      'A notification for you whenever someone adds an item.',
      { type: 'itemCreated' },
      [{ type: 'notify', to: 'owner', uid: null, message: 'New item: {item}' }],
    ),
  );
  if (toDone && status) {
    out.push(
      mk(
        'done-notify-assignees',
        'Tell the people on it when it’s done',
        'When status becomes Done, notify everyone assigned.',
        toDone,
        [{ type: 'notify', to: 'assignees', uid: null, message: '{item} is done' }],
      ),
    );
    if (doneGroup)
      out.push(
        mk(
          'done-move',
          `Move finished items to “${doneGroup.name}”`,
          'When status becomes Done, move the item to the finished group.',
          toDone,
          [{ type: 'moveToGroup', groupId: doneGroup.id }],
        ),
      );
    if (date)
      out.push(
        mk(
          'done-date',
          `Stamp “${date.title}” when it’s done`,
          'When status becomes Done, set the date column to today.',
          toDone,
          [{ type: 'setValue', columnId: date.id, value: TOKEN_TODAY }],
        ),
      );
    out.push(
      mk(
        'done-archive',
        'Archive items when they’re done',
        'When status becomes Done, archive the item.',
        toDone,
        [{ type: 'archive' }],
      ),
    );
    out.push(
      mk(
        'subitems-done',
        'Finish the item when all its subitems are done',
        'When the last subitem is Done, mark the parent Done.',
        { type: 'subitemsAllDone', columnId: status.id, labelId: (doneLabel as { id: string }).id },
        [{ type: 'setValue', columnId: status.id, value: (doneLabel as { id: string }).id }],
      ),
    );
  }
  if (status && badLabel)
    out.push(
      mk(
        'bad-notify',
        `Warn me when something is “${badLabel.name}”`,
        'A notification for you when status changes to a problem state.',
        { type: 'statusChangedTo', columnId: status.id, labelId: badLabel.id },
        [{ type: 'notify', to: 'owner', uid: null, message: '{item} needs attention' }],
      ),
    );
  if (people) {
    out.push(
      mk(
        'created-assign-me',
        'Assign new items to whoever adds them',
        'When an item is added, put the person who added it on it.',
        { type: 'itemCreated' },
        [{ type: 'setValue', columnId: people.id, value: TOKEN_ME }],
      ),
    );
    if (status && workingLabel)
      out.push(
        mk(
          'assigned-working',
          `Set status to “${workingLabel.name}” when someone is assigned`,
          'When a person is put on an item, mark it as underway.',
          { type: 'personAssigned', columnId: people.id, uid: null },
          [{ type: 'setValue', columnId: status.id, value: workingLabel.id }],
        ),
      );
  }
  if (status && doneLabel && lastGroup)
    out.push(
      mk(
        'moved-done',
        `Mark items Done when moved to “${lastGroup.name}”`,
        'Moving an item to the last group sets its status to Done.',
        { type: 'movedToGroup', groupId: lastGroup.id },
        [{ type: 'setValue', columnId: status.id, value: doneLabel.id }],
      ),
    );
  out.push(
    mk(
      'created-subitem',
      'Add a “Review” subitem to every new item',
      'A starter checklist item under each new item.',
      { type: 'itemCreated' },
      [{ type: 'createItem', name: 'Review', groupId: null, subitem: true }],
    ),
  );
  if (date)
    out.push(
      mk(
        'date-notify',
        `Tell me when “${date.title}” changes`,
        'A notification for you when the date is moved or set.',
        { type: 'columnChanged', columnId: date.id },
        [{ type: 'notify', to: 'owner', uid: null, message: 'Date changed on {item}' }],
      ),
    );
  return out;
}
