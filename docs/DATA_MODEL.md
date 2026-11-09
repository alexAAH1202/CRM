# Data model (Firestore)

> **Status: draft for review (Phase 0).** Changes from the starting proposal in
> `PROJECT_SPEC.md` §5 are marked **[changed]** and explained in `DECISIONS.md`.

All application data lives under `workspaces/{wid}` (multi-workspace ready). Two
small top-level collections exist outside it: `users` and `appConfig`.

Conventions:

- IDs are Firestore auto-IDs unless stated otherwise.
- `*At` fields are **server timestamps** (`serverTimestamp()`); rules check
  `== request.time` where trust matters.
- String length caps and array caps are enforced in rules; the numbers live in
  `shared/src/constants.ts` and are mirrored in `firestore.rules`.
- Ordering uses **fractional index strings** (`order`), so a drag-reorder writes
  exactly one document.

---

## Top level

### `appConfig/workspaceCreators` **[new]**

```ts
{ emails: string[] }   // lowercased Google emails allowed to create workspaces
```

Written only from the Firebase console (no client write rule). A signed-in user
may `get` it only if their verified email is in the list. This keeps the
allowlist out of git and editable without a rules deploy.

### `users/{uid}`

```ts
{ displayName, email, photoURL, lastWorkspaceId: string | null,
  settings: { theme?: 'light'|'dark'|'system', favoriteBoardIds?: string[] /* <= 200, the whole list is written */ } }
```

Owner read/write only. Holds per-user preferences only. **It is never used for
authorization.**

---

## Workspace

### `workspaces/{wid}`

```ts
{ name, createdBy, createdAt,
  adminUids: string[],                       // [new] mirror of admin members
  driveFolderId: string | null,              // set by Apps Script (Phase 7)
  settings: { capacityHoursPerWeek, weekStart: 0|1, timezone } }
```

- `adminUids` must always equal the set of members whose role is `admin`, and
  must never be empty. Rules enforce this with `getAfter()`. Any batch that
  changes an admin's role or removes an admin also updates `adminUids`. This is
  how "at least one Admin remains" is enforced **in rules**, not just the UI.

### `workspaces/{wid}/members/{uid}`

```ts
{ uid, role: 'admin'|'member'|'viewer', email, displayName, photoURL, joinedAt }
```

- `uid` is duplicated in a field **[changed]** so the app can find "my
  workspaces" with one collection-group query (`members` where `uid == me`). The
  rules allow that query only when the filter is the caller's own uid.
- This is the single document every rule `get()`s to check membership and role.

### `workspaces/{wid}/invites/{emailLower}`

```ts
{
  (email /* == doc id */, role, workspaceName, invitedBy, createdAt);
}
```

- `email` and `workspaceName` are stored **[changed]**. The invitee isn't a
  member yet and can't read the workspace, so the app finds their invites with a
  collection-group query (`invites` where `email == token.email`) and needs the
  name to display.
- Accepting an invite is one batch: create `members/{uid}` with the invite's
  role, then delete the invite. Rules require `email_verified`, an email that
  matches the invite ID, the same role, and that the invite exists.

### `workspaces/{wid}/folders/{fid}`

```ts
{
  (name, order, createdBy, createdAt);
}
```

---

## Boards

### `workspaces/{wid}/boards/{bid}`

```ts
{ name, description, folderId: string | null, order,
  visibility: 'main'|'private',
  memberIds: string[],                       // private boards only (cap 50)
  columns: Column[],                         // [{ id, type, title, settings, defaultValue? }]
  groups: Group[],                           // [{ id, name, color }]; array order = display order
  schemaVersion: number,
  archived: boolean, createdBy, createdAt, updatedAt }
```

- **Access:** Admins see every board, including private ones (decision D2).
  Members and Viewers see `main` boards plus private boards where they are in
  `memberIds`. The sidebar uses two listeners (`visibility == 'main'` and
  `memberIds array-contains me`). Admins use one listener over all boards.
- **[changed] Views and the item counter are not on the board doc.** Every user
  has a sidebar listener on the boards collection, so each write to a board doc
  is re-billed to every connected user. Things that change often (view filters,
  column widths, the autonumber) live in separate docs (below).
- Column `width` moved into the view config, since widths are per view.

### `boards/{bid}/views/{vid}` **[changed: was embedded]**

`config` (Phase 2b) holds the view's saved state:

```ts
{ filters: [{ id, columnId /* or 'name' */, op, value? }],   // max 12; incomplete filters are ignored
  sort: [{ columnId, dir: 'asc'|'desc' }],                    // max 3
  groupBy: columnId | null,                                   // status | dropdown | people
  hiddenCols: columnId[], colWidths: { [columnId]: px },      // 80–600
  showArchived: boolean,
  options: { laneColumnId: columnId|null,                    // Kanban lanes (status|dropdown|people)
             dateColumnId: columnId|null,                     // Calendar (date|timeline)
             calendarMode: 'month'|'week',
             ganttColumnId: columnId|null, zoom: 'day'|'week'|'month',     // Gantt (timeline column)
             effortColumnId, peopleColumnId: columnId|null,                // Workload
             capacity: number, capacityByUid: { [uid]: hours },            // hours/week, 1–168
             chartType: 'bar'|'stacked'|'pie'|'line', groupColumnId, stackColumnId,
             measure: 'count'|'sum'|'avg', valueColumnId } }                // Chart
```

A board has up to 12 views (tabs). Each keeps its own filters/sort/options. The table
view created with the board has id `main`; others get random ids. Viewers can change a
view for themselves, but nothing is saved. One listener on the `views` collection
(a handful of tiny docs) feeds the tabs.

```ts
{ type: 'table'|'kanban'|'calendar'|'gantt'|'workload'|'chart'|'form',
  name, order, config: { filters, sort, groupBy, hiddenCols, colWidths, ... },
  createdBy, updatedAt }
```

### `boards/{bid}/meta/counter` **[new]**

```ts
{
  next: number;
}
```

The item autonumber is assigned in a transaction against this doc, which no one
listens to, so creating an item doesn't fan out a board-doc update.

Rules only require `1 <= next <= old + 500`: not strictly increasing, because rules
run before Firestore's stale-read check and a strict rule turns a retryable conflict
between two simultaneous creates into `permission-denied` (see D43).

### `boards/{bid}/items/{iid}`

```ts
{ name, groupId, order, parentId: string | null,   // subitems point at their parent
  itemNumber: number,
  values: { [columnId]: TypedValue },
  assigneeUids: string[],        // [new] union of all People columns; enables "My Work"
  reminderKeys: string[],        // denormalized for scheduling (Phase 7)
  archived: boolean,
  deletedAt: Timestamp | null,   // [new] soft delete (tombstone) for delta sync
  createdBy, createdAt, updatedBy, updatedAt }
```

- **Every write must set `updatedAt = request.time`** (enforced in rules). This
  makes **delta sync** possible: opening a board reads items from the local
  cache, then listens only to `updatedAt > lastSyncedAt`. See
  `ARCHITECTURE.md § Read path`.
- Deleting from the UI sets `deletedAt` (a tombstone) so other clients' caches
  learn about it. Apps Script hard-deletes tombstones older than 30 days. A
  client whose last sync is older than that does a full resync.
- Lean doc: updates, activity, files beyond metadata, and time sessions over the
  inline cap are kept elsewhere.
- `values` shapes per column type are defined in `shared/src/columns.ts` and
  versioned by `board.schemaVersion`. Phase 2a types:

  | Column type    | Stored value                                                 |
  | -------------- | ------------------------------------------------------------ |
  | text, longText | `string`                                                     |
  | status         | label id (`string`)                                          |
  | dropdown       | option ids (`string[]`)                                      |
  | people         | uids (`string[]`)                                            |
  | date           | `"YYYY-MM-DD"`                                               |
  | timeline       | `{ start, end }` (dates)                                     |
  | numbers        | `number`                                                     |
  | checkbox       | `true` (cleared = field removed)                             |
  | link           | `{ url, text }` (http(s)/mailto only; `javascript:` refused) |

  An empty cell removes its key from `values`.

  Phase 3 additions:

  | Column type                                                | Stored value / setting                                                         |
  | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
  | rating                                                     | `number` 1–5 (cleared = field removed)                                         |
  | email, phone                                               | `string`                                                                       |
  | tags                                                       | tag ids (`string[]`), tags live in column `settings`                           |
  | files                                                      | `[{ name, url, driveFileId?, mimeType?, size?, addedBy?, addedAt? }]` (max 20) |
  | dependency                                                 | `[{ id, lag }]` predecessor item ids, `lag` in days (±365, max 30 preds)       |
  | formula, progress, itemId, createdAt, updatedAt, createdBy | **never stored**: computed on render from the column's `settings`              |

  Column `settings` also carry (2b): `summary` (footer: none/count/sum/avg/min/max/
  distribution) and `defaultValue` (what new items start with; status uses
  `defaultLabelId`).

- **Subitems** are items with `parentId` set. They share the parent's columns and
  `groupId`, and use the same board counter. Archiving, deleting or moving a parent
  applies to its subitems in the same batches.

### `items/{iid}/updates/{updId}` (comments)

```ts
{ author, body, mentions: string[], parentId: string | null,
  createdAt, editedAt: Timestamp | null }
```

`body` is a small safe markup, not HTML: `**bold**`, `*italic*`, `[text](https://…)`, bare
`https://` links, `- ` / `1. ` lists, blank line = paragraph, `@Name` mentions. It is
turned into React elements by `parseRich` (no HTML is ever stored or injected). Max 5,000
characters; `mentions` (max 20) lists the uids whose `@Name` is in the text.
Anyone who can edit the board comments as themselves; only the author edits (text only);
the author or an admin deletes. Replies are updates with `parentId` set (one level).
Emoji reactions are P1 and not built yet.

### `boards/{bid}/automations/{aid}`

```ts
{ name, enabled, ownerUid,
  trigger: { type: 'itemCreated' }
         | { type: 'columnChanged', columnId: string | null }          // null = any column
         | { type: 'statusChangedTo', columnId, labelId }
         | { type: 'personAssigned', columnId: string | null, uid: string | null }
         | { type: 'movedToGroup', groupId }
         | { type: 'subitemsAllDone', columnId, labelId }
         // scheduled (run by the Apps Script helper, on the workspace's time zone)
         | { type: 'dateArrives', columnId, which: 'start'|'end', offsetDays, atTime: 'HH:MM' }
         | { type: 'overdue', columnId, atTime }       // the day after the date, if not done
         | { type: 'recurring', scope: 'board'|'items',
             schedule: { recurrence: {kind:'daily'|'weekly'|'monthly', every, weekdays?, dayOfMonth?}, atTime, startDate } },
  conditions: Filter[],                 // same shape as view filters; all must match (max 5)
  actions: Array<                       // 1–5, run in order
      { type: 'setValue', columnId, value }          // value may be '@me' (people) or '@today' (date)
    | { type: 'moveToGroup', groupId }
    | { type: 'createItem', name, groupId: string | null, subitem: boolean }   // {item} = the item's name
    | { type: 'duplicate' }                           // copy of the item (subitems are not copied)
    | { type: 'archive' }
    | { type: 'notify', to: 'assignees'|'owner'|'actor'|'person', uid, message }>,
  createdAt, updatedAt }
```

Max 20 per board. The owner is whoever created it and never changes. Any editor may edit or
switch one off; the owner or an admin deletes it. Scheduled triggers run in the helper as the
owner; a board-wide recurring schedule (`scope: 'board'`) has no item, so it can only create items
and send notifications.

### `boards/{bid}/automationRuns/{rid}` (capped at 50/board, pruned)

```ts
{ automationId, name, status: 'ok'|'failed'|'skipped', error?, itemId, depth, actor, at }
```

One entry per execution ("ran"), per refusal ("failed": e.g. a column it sets was deleted) and
per loop-guard stop ("skipped"). Written in the same batch as the change that caused it.
The panel shows the newest 50 and deletes older ones (editors may; Apps Script will too).

```ts

```

### `boards/{bid}/activity/{id}` (capped, pruned)

```ts
{ type: 'create'|'delete'|'status'|'people'|'date'|'move'|'bulk'|'automation',
  itemId: string | null, itemName, actor, data: { column?, from?, to?, group?, count?, text? }, at }
```

One entry per meaningful event, written in the same batch as the change (a cell edit on a
status / people / date / timeline column, a new item, a delete, a change of group, or a
bulk action as a single summary entry). `from`/`to` are readable text, so entries need no
joins. Append-only: no edits; only admins (or the Apps Script pruner, which uses a service
account) delete. Index: `(itemId asc, at desc)` for the item's Activity tab.

---

## Workspace-level collections

### `boards/{bid}/scheduledEvents/{eid}` **[moved under the board in 7b]**

```ts
{ kind: 'date' | 'overdue' | 'recurring', automationId, itemId: string | null, boardId,
  fireAt: Timestamp, status: 'pending' | 'done' | 'failed', attempts, idempotencyKey,
  dateValue: string | null,           // the date it was computed from (spots a stale event)
  lastError?, doneAt?, lastRunAt?, updatedAt }
```

The queue the Apps Script helper works from (spec 6.2). It lives under the board (so the rules can
use the path's board, and a private board's events stay private); the helper finds due events with
one collection-group query `status == 'pending' && fireAt <= now`, so it never scans items.
The document id is deterministic: `{automationId}_{itemId}` for date/overdue events and
`{automationId}` for a recurring schedule, so re-registering just overwrites and removing needs no
lookup.

- **The browser registers events** in the same batch as the edit that implies them: a date column
  changes, an item is created, deleted, archived or restored, a bulk date edit, and when a scheduled
  automation is created, edited, switched on/off or deleted (`shared/scheduleOps.ts`). Clients may only
  write fresh `pending` events with `attempts: 0`; progress is written by the helper (IAM).
- Reminders for a moment more than 6 hours in the past are not registered (no surprise
  notifications for old dates).
- **The helper** handles an event in one atomic commit that also marks it done _only if the event
  document hasn't changed since it was read_ (a precondition on its `updateTime`), so two runs can't
  both fire it. A recurring schedule is moved to its next occurrence in the same commit.
- "Rebuild schedule" (admin, Members → Sorted helper) recomputes everything from the data.

### `workspaces/{wid}/dashboards/{did}`

```ts
{ name, boardIds: string[] /* <= 5 */, widgets: [{ id, type, config, layout }],
  visibility: 'main'|'private', memberIds: string[], createdBy, updatedAt }
```

### `workspaces/{wid}/notifications/{uid}/items/{nid}`

```ts
{ type, title, body, link, actor, read: boolean, createdAt }
```

Any member may **create** a notification for another member: `actor` must be
the caller and the type comes from an allowlist. Only the recipient may read it,
mark it read, or delete it.

### `workspaces/{wid}/timers/{uid}` **[new]**

```ts
{
  (boardId, itemId, columnId, startedAt);
}
```

Holds one running timer per user per workspace. The doc ID is the uid, so a
second timer is impossible. Only the owner may write it.

### `workspaces/{wid}/timeEntries/{eid}`

Archive target for time sessions once an item's inline array passes 200.

---

## Query patterns and indexes

| Query                                                                           | Index                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------- |
| collection group `members` where `uid == me`                                    | single-field, collection-group scope (override) |
| collection group `invites` where `email == myEmail`                             | single-field, collection-group scope (override) |
| `boards` where `visibility == 'main'` / `memberIds array-contains`              | automatic                                       |
| `items` where `updatedAt > t` (delta sync)                                      | automatic                                       |
| `items` where `assigneeUids array-contains me` (My Work, per board)             | automatic                                       |
| collection group `scheduledEvents` where `status == 'pending' && fireAt <= now` | composite (Apps Script, IAM)                    |
| `notifications/{me}/items` order by `createdAt desc` limit 30                   | automatic                                       |

**There are no collection-group queries over `items`.** A rule for a private
board needs that board's doc, and a collection-group query can't supply it, so
"My Work" and search run one small query per board the user can access. With
about 10 boards this costs about 10 + matches reads.

The Spark plan allows **200 composite indexes** and **200 single-field
configurations** without billing. We expect fewer than 20.

## Security model summary (detailed in Phase 1)

| Role       | Workspace settings | Members/invites | Boards (main) | Private boards         | Items      |
| ---------- | ------------------ | --------------- | ------------- | ---------------------- | ---------- |
| Admin      | read/write         | manage          | read/write    | read/write (all)       | read/write |
| Member     | read               | read            | read/write    | if in `memberIds`      | read/write |
| Viewer     | read               | read            | read          | read if in `memberIds` | read       |
| Non-member | —                  | own invite only | —             | —                      | —          |

**Rule cost per request:** one `get()` of `members/{uid}`. Item, view, comment
and automation reads and writes also `get()` the board doc to check visibility.
That's **+1–2 billed reads per request or listener update**, not per document.
Phase 1 measures this and records it in `QUOTA_BUDGET.md`.
