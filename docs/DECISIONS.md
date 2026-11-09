# Decisions log

Format: **decision**, followed by alternatives considered and the reason.
Entries marked **(spec deviation)** change something in `PROJECT_SPEC.md`.

---

### D1. Add a `/shared` workspace package (spec deviation: repo layout)

- **Alternatives:** duplicate the types and constants in each package.
- **Reason:** rules tests, the web app and Apps Script must agree on limits
  (file size, dashboard cap, array caps) and on document shapes. One source of
  truth prevents drift.

### D2. Admins can see and manage every private board

- **Decided by:** the product owner (2026-11-08).
- **Alternatives:** only `memberIds` can see private boards, Admins included.
- **Reason:** simpler rules, and a board can still be recovered when its
  creator leaves.

### D3. Workspace creation limited to an allowlist kept in Firestore

- **Allowlist:** `alexwinch@gmail.com` and `aevans.osteo@gmail.com`, stored in
  `appConfig/workspaceCreators` and edited only in the Firebase console.
- **Alternatives:**
  - Any signed-in user may create a workspace. Rejected: strangers could use
    up the shared free quota.
  - Hard-code the emails in `firestore.rules`. Rejected: puts personal emails
    in git, and every change would need a rules deploy.
- **Cost:** one extra rule read, only when a workspace is created.

### D4. Firestore location `australia-southeast2` (Melbourne), Standard edition, `(default)` database

- **Reason:** the team is in Melbourne. The location can't be changed later,
  and the Spark quotas apply to the Standard edition and the default database.

### D5. Delta sync for board items (soft deletes, mandatory `updatedAt`)

- **Alternatives:**
  - Plain `onSnapshot` on the open board.
  - Keeping listeners alive after the user leaves a board.
- **Reason:** Firestore re-bills a listener's whole result set after it's been
  disconnected for more than 30 minutes, even with persistent cache. The
  15-user estimate is 55% of daily reads with plain listeners and 31% with
  delta sync (QUOTA_BUDGET §4). Keeping listeners alive makes every edit bill
  more reads to idle users.
- **Consequences:**
  - Every item write sets `updatedAt = request.time` (enforced by rules).
  - Deletes are tombstones (`deletedAt`), hard-purged after 30 days.

### D6. Views, column widths and the item counter kept off the board doc (spec deviation: data model)

- **Alternatives:** embed them in the board doc, as the spec proposed.
- **Reason:** every user has a sidebar listener on `boards`, so any board-doc
  write is billed once per connected user. View tweaks and item creation are
  frequent, so they go in `boards/{bid}/views/*` and `boards/{bid}/meta/counter`.

### D7. No collection-group queries over `items`

- **Reason:** private-board rules need the parent board doc. A collection-group
  query can't supply that per board, so it would be rejected or would leak.
- **Consequence:** "My Work" and search run one small query per accessible
  board (about 10 reads + matches).

### D8. Workspace and invite discovery through collection-group queries on `members.uid` and `invites.email`

- **Alternatives:** a `workspaceIds[]` array on `users/{uid}`. Rejected:
  client-writable, and an admin removing someone couldn't update it, so it
  would go stale.
- **Reason:** membership docs are the source of truth, and the rules can
  require the filter to match the caller.

### D9. "At least one Admin" enforced in rules through `workspace.adminUids` + `getAfter()`

- **Alternatives:** UI-only enforcement, which the spec allows.
- **Reason:** cheap (the rules read docs already in the same batch) and closes
  the "remove the last admin" hole.

### D10. Apps Script web app access is "Anyone"; identity comes from the Firebase ID token

- **Alternatives:** "Anyone with a Google account".
- **Reason:** a cross-origin `fetch` from the Hosting domain can't carry the
  user's Google session cookies to `script.google.com`, so Google-account
  gating would break the calls. Security comes from verifying the ID token and
  then checking membership on every request.

### D11. clasp v3 + `tsc` into `apps-script/dist`

- **Reason:** clasp v3 no longer transpiles TypeScript. Phase 7 may switch to
  an esbuild bundle so Apps Script can import `/shared`.

### D12. Tooling versions

| Package         | Version | Note                                                 |
| --------------- | ------- | ---------------------------------------------------- |
| React           | 18.3    | Per the spec, although 19 is current                 |
| Vite            | 8       |                                                      |
| Tailwind        | 4       | CSS-first config, tokens via `@theme inline`         |
| TypeScript      | 5.9     | 7.0 exists, but typescript-eslint supports < 6.1     |
| ESLint          | 10      | Flat config                                          |
| Vitest          | 5       |                                                      |
| firebase JS SDK | 13      |                                                      |
| firebase-tools  | 15      | Local dev dependency, so no global install is needed |

### D13. System font stack

- **Stack:** `ui-rounded`, SF Pro Rounded, Segoe UI and so on.
- **Alternatives:** a self-hosted web font.
- **Reason:** zero font bytes over metered Hosting bandwidth, and rounded
  faces on Apple devices fit the "friendly" brief.

### D14. Native `<dialog>` for Modal/SidePanel; `@floating-ui/react-dom` for popovers

- **Reason:** `<dialog>` gives focus trapping, Escape handling and an inert
  background for free. floating-ui is about 3 KB and handles collision-aware
  positioning. Both are accessible without a heavy component library.

### D15. All Firestore access goes through `web/src/lib/firestore` (metered), enforced by ESLint

- **Reason:** keeps the dev usage meter accurate, and gives a single choke
  point for delta sync and automations.

### D16. Emulator-only test sign-in hook (`window.__emulatorSignIn`)

- **Reason:** e2e tests need to sign in as specific verified emails (invite
  flow) without driving the emulator's OAuth popup. It's only defined when
  emulators are in use, and it doesn't exist in production builds that point
  at a real project.

### D17. Hosting emulator on port 5050

- **Reason:** port 5000 is taken by AirPlay Receiver on macOS.

### D18. Proposed for later: TTL policies for pruning

- **Proposal:** use TTL policies on `activity.at`, `automationRuns.at` and read
  notifications.
- **Reason:** Firestore TTL deletes count as normal deletes. The quotas page
  lists TTL configuration limits for projects without billing, which suggests
  TTL works on Spark. That will be confirmed in the console before Phase 7. If
  it works, it replaces part of the Apps Script housekeeping job. Count-based
  caps (last 50 runs) still need housekeeping.

### D19. Accepted dev-only `npm audit` findings

- **What:** moderate and high advisories in transitive dependencies of
  firebase-tools, @google/clasp and eslint.
- **Reason:** these are local CLIs that never ship to the browser, and
  `npm audit fix --force` would downgrade them to old major versions.
  Re-check in Phase 9.

### D20. Deploy from GitHub Actions with a narrowly-scoped service account

- **Decided by:** the product owner (2026-11-08), who has no local copy of the
  repo.
- **Alternatives:**
  - Deploy from a laptop with `firebase login`.
  - Run `firebase login --no-localhost` inside the Claude cloud session. That
    would leave a Google login token in the container and need a re-login
    every session.
- **How it works:** pushes to `main` (or a manual run) run `npm run check` and
  then `firebase deploy`. The service-account key lives only in the GitHub
  secret `FIREBASE_SERVICE_ACCOUNT`.
- **Roles (least privilege):**
  - Hosting Admin
  - Rules Admin
  - Datastore Index Admin
  - API Keys Viewer
  - Service Usage Consumer

  No Cloud Functions, Auth or data access roles.

- **Firebase web config:** stored as plain env values in the deploy workflow.
  It's public by design, and this avoids four extra repository variables. This
  is a small deviation from "keep it in env files".

### D21. Later-phase collections stay deny-by-default (deviation from the Phase 1 plan)

- **What:** Phase 1 ships full rules and tests for `users`, `appConfig`,
  `workspaces`, `members`, `invites`, `folders`, `boards`, `items`, `views`,
  `meta/counter`, `notifications` and `timers`. The remaining collections are
  explicitly denied, and a test checks each one:
  - `updates`
  - `automations`
  - `automationRuns`
  - `activity`
  - `scheduledEvents`
  - `dashboards`
  - `timeEntries`
- **Alternatives:** permissive placeholder rules for those collections now.
- **Reason:** their shapes aren't designed yet. Loose placeholder rules are a
  security risk if forgotten, while deny-by-default is safe. Each collection
  gets real rules and tests in the phase that builds it.

### D22. Write "planners" in `/shared`, executed by both the app and the rules tests

- **What:** functions such as `planAcceptInvite()` return SDK-free `WriteOp[]`
  lists. The web app commits them through the metered batch. The rules tests
  commit the exact same ops against the emulator, plus tampered variants.
- **Reason:** the tests prove the app's real batches pass the rules, not
  hand-written copies of them.

### D23. Forms that write reset immediately (optimistic)

- **What:** Firestore shows local writes instantly, but `commit()` resolves
  only when the server acknowledges. Waiting for that before resetting a form
  wiped input typed in the meantime. Forms now reset on submit, and a failure
  shows a toast naming the item that failed.

### D24. Rules mutation testing during development

- **What:** each security property was checked by deliberately weakening the
  rule and confirming a test fails:
  - consumed invite
  - last admin
  - private-board visibility
  - invite role equality
  - `updatedAt` stamping
  - viewer write
  - `email_verified`

  The invite role-equality check initially went uncaught, and a test was
  added for it.

### D25. Custom table renderer with TanStack Virtual, without TanStack Table (spec deviation)

- **What:** the board table is a CSS-grid renderer with vertical
  virtualisation (`@tanstack/react-virtual`). Each row is a flattened entry:
  group header, column header, item, add-item row, or gap.
- **Alternatives:** TanStack Table, as the spec suggests.
- **Reason:** we would have overridden almost everything TanStack Table does:
  - grouping is by our own groups
  - filtering, sorting and summaries come from per-view config logic that
    lives in `/shared`, so it can be tested and reused by the Kanban and
    Calendar views
  - there are per-group header rows

  Skipping it saves ~15 KB gzip and a layer of indirection.

### D26. Group collapse state stays on the device, not on the board doc

- **Reason:** collapsing is a personal view preference. Writing it to the board
  doc would bill a read to every connected user's sidebar listener (see D6).

### D27. Board-content writes check the board's state _after_ the request (`getAfter`)

- **Reason:** a board and its first items, view and counter are created in one
  atomic batch when built from a template. The board doesn't exist before the
  batch, so `get()` would deny. Reads still use `get()`.
- **Cost:** none extra; the same one document is read.

### D28. Date values are stored as `YYYY-MM-DD` strings

- **Reason:** dates in household admin are all-day ("bill due 15 March"). Using
  plain strings avoids timezone shifts between devices. Timeline values are
  `{ start, end }` in the same format.

### D29. Favourites and folders moved from 2a to 2b

- **Reason:** keeps 2a focused on a working board. Both need per-user settings
  sync, which fits better with the other 2b view-state work.

### D30. Column reordering uses Move left / Move right, not drag-and-drop (spec deviation)

- **Spec:** "column drag-reorder".
- **Reason:** the table header repeats in every group, so a drag handle would need
  one sortable context per header row and horizontal auto-scroll over a virtualized
  grid. Move left/right is reliable, keyboard-accessible and one write. Row and
  group reordering _is_ drag-and-drop (dnd-kit, with keyboard support).
- **Revisit:** if it bothers you in daily use, a header drag can be added on the
  first group's header only.

### D31. Virtual rows are positioned with `top`, not `transform`

- **Reason:** dnd-kit measures elements ignoring CSS transforms. With
  `translateY` positioning every drop target was measured at the wrong place
  (items landed at the end of the group). Found by driving the real UI.

### D32. Per-view settings: one `views/main` doc, debounced writes, viewers stay local

- **What:** filters, sort, group-by, hidden columns, column widths and "show
  archived" are saved on the view doc and apply for everyone (the spec's "saved
  per board"). Changes apply instantly and are written once ~600 ms after the
  last change, so dragging a column edge or typing a filter value is one write.
  Viewers can't write, so their changes stay on their device.
- **Alternative:** per-user personal views (listed as a stretch goal in the spec).
- **Cost:** one small listener on `views/main` per open board.

### D33. Incomplete filters are ignored

- **Reason:** a filter row with no value yet (e.g. "Amount =" with nothing typed) would
  otherwise hide every item while the person is mid-edit.

### D34. Favourites are stored as a whole list; array-union is not used in nested maps

- **Found by a rules test:** `arrayUnion` inside `settings.favoriteBoardIds` was rejected
  by the rules (they can't see through the transform in a nested map), while the UI
  looked fine because Firestore applies writes locally first.
- **Fix:** write the whole list (cap 200, shape validated in rules).
- **Safeguard:** the browser tests now fail if the page logs a permission error, and
  the favourites test reloads to prove the write reached the server.

### D35. Group-by shows an item under its _first_ value

- **Applies to:** Dropdown and People columns with several values.
- **Reason:** showing one item in several groups would duplicate row keys and make
  drag/edit ambiguous. Drag-reorder is off while grouped by a column (the order is
  meaningless across virtual groups); adding an item in a virtual group sets that value.

### D36. Changing a column's type rewrites the affected cells (a bounded fan-out)

- **Reason:** converting "text → status" must create labels and map every cell. A
  preview shows how many values carry over and how many are cleared before applying.
- **Bound:** boards are budgeted at ~150 items; writes go in batches of 100.

### D37. Batches are capped at 100 writes

- **Measured:** the rules accept 450-write batches in the emulator (repeat lookups of
  the member/board docs are cached per request). A regression test guards 200.
- **Chosen cap:** 100, to limit the damage if a batch ever fails part-way.

### D38. Toasts moved to the bottom-right

- **Reason:** centred toasts covered the left half of the bulk-actions bar.

### D39. Group names use the normal text colour; the label colour is a dot

- **Reason:** light label colours (grey, yellow, sky) as text on the page background
  failed WCAG AA contrast (found by looking at a "grey" group).

### D40. Formula engine: own tokenizer, parser and tree-walking evaluator

- **Reason:** no `eval`/`new Function` (safe for user-typed formulas; runs in the browser
  and Apps Script alike). Max 1000 characters, nesting depth 60.
- Columns are referenced by title in `{braces}`; renames rewrite formulas.
  Precedence: comparison < `&` < `+ -` < `* /` < unary `-` < `^` (right-assoc, `-2^2 = -4`).
- Blank counts as 0 in arithmetic and "" in text joins. Errors are values that
  propagate and show as `#ERROR — reason`; `IFERROR` catches them.

### D41. Computed columns are never stored

- Formula, progress, item ID, created/updated time and created-by are derived on render
  (`applyComputed`): no writes, can't go stale. Filters/sort/summaries use the computed
  values. Cycles between formulas are detected and reported.

### D42. Dependencies are `[{id, lag}]` with cycle prevention

- The picker disables items that would create a loop (`wouldCreateCycle`); duplicating
  a board remaps ids. The time-tracking column is deferred to Phase 8.

### D43. Counter rule relaxed; item creation is serialised on the client

- **Found by:** rapid subitem entry giving 403s; reproduced with two concurrent
  transactions (same user and two users).
- **Cause:** a "counter strictly increases" rule is evaluated before Firestore's retry
  logic, so the slower commit became permission-denied instead of retrying.
- **Fix:** rule only checks `1 <= next <= old + 500`; regression test in
  `firebase/tests/concurrent.test.ts`. The client also queues creations as defence.

### D44. Tags and files are not offered in bulk-set or column defaults

- **Reason:** list values with per-column ids/metadata; bulk overwrite would surprise.

### D45. Several saved views per board; type-specific settings live in `config.options`

- Rules already allowed any `config` map, so no rules change was needed. Kanban lanes
  and Calendar date column are saved per view, so two Kanban views can use different
  columns.
- Views are tabs; the selected one is in the URL (`?view=`) so links and reloads keep it.
- Only the table, Kanban and Calendar exist so far; Gantt, Workload and Chart follow.

### D46. Kanban / Calendar write the same cell values the table does

- Dragging a card to a lane calls the normal `setCell`. For people/dropdown columns only
  the lane it came from is swapped, so other values on the card stay.
- Dragging on the calendar keeps a timeline's length, and keeps the grabbed day under the
  pointer. Items with no date sit in a "No date yet" list that can be dragged in.
- Cards open the same editors the table uses (one dialog), so there is no second set of
  editors to keep in step. A full item page with comments arrives in Phase 5.

### D47. Gantt, Workload and Chart are our own components (Chart uses Recharts)

- Gantt is DOM + one SVG overlay for arrows, written by us as the spec asks (no Gantt
  library). Bars drag with pointer events (move, resize either end, whole-day snapping) and
  with the keyboard (arrows move, Shift+arrows resize the end). Group headers are the lanes.
- Dependency arrows are finish-to-start with lag. An arrow turns red when the dependent
  starts too early. After a bar moves, dependents that now start too early are offered a
  **Shift** (not moved automatically); it cascades through dependents of dependents, keeps
  each item's length, and only ever pushes later (`shiftPlan`).
- Recharts is ~100 KB gzipped, so the chart is a lazy-loaded chunk: boards that don't use
  the Chart view never download it. A plain data table sits under every chart so the data is
  readable without sight or pointer.

### D48. Workload maths

- An item's hours are spread evenly over its working days (Mon–Fri; all days if it has
  none) and split equally between its assignees. Hours come from a Numbers column, or from
  the dates at 8h per working day. Unassigned work is its own row and is never "over".
- Capacity is hours per person per week (default 40; per-person overrides). Over capacity
  is flagged with an icon and text, not colour alone.

### D49. Chart groups by status, dropdown, people, date (by month) or checkbox

- An item with several people/options counts once for each. Sum/average need a Numbers (or
  formula) column and fall back to counting without one.

### D50. Comments use a tiny markup, not rich-text HTML

- **Reason:** HTML from a rich-text editor has to be sanitised, and one missed case is a
  stored XSS that runs in every teammate's browser. Our own parser produces a plain tree
  that React renders, so there is nothing to inject. Only `http(s)` links are ever links.
- The toolbar (bold, italic, list, link) just inserts the markup; `@` opens a people list.
  Mentions are stored by uid (`mentions[]`) and the text carries `@Name`, so they stay
  readable if the data is ever exported.

### D51. Notifications: recipient-side muting, one small listener

- A person's inbox is one listener on their newest 30 notifications for the open workspace.
- Muting (mentions / assignments / due) is stored on the recipient's own user doc and applied
  when displaying, so the sender never needs to read anyone's settings (which would cost
  reads and need extra rules). A muted notification is still written; it's just hidden.
- Mentions and assignments create the notification in the **same batch** as the change, so a
  notification can't exist without its cause. The author is never notified about themselves.
- Composer clears immediately and doesn't wait for the server (Firestore queues writes
  offline); the text is restored only if the save really fails.

### D52. The item page is a side panel addressed by `?item=`

- Every view (table, Kanban, Calendar, Gantt) opens the same panel, and notification links
  open it directly. Tabs: Updates, Fields, Files (Activity arrives with the activity log).

### D53. The activity log is written with the change, and only for meaningful events

- Status / people / date / timeline edits, new items, deletes and moves are logged; text and
  number edits are not (they'd double the writes for little value). A bulk action writes one
  summary entry ("set Status on 12 items"), not one per item.
- It costs one extra write per logged event, in the same batch, so the log can't disagree
  with the data. Pruning (cap per board) belongs to the Apps Script helper in Phase 7;
  until then entries accumulate slowly (one per meaningful edit).
- The activity tab only listens while it is open (newest 30 for an item, 50 for a board).

### D54. My Work reads per board, once, and is not live

- A collection-group query across every board would need a rules check per document (a
  board lookup each) and a new index. Instead the page runs one `assigneeUids array-contains
me` query per board I can see (only matching items are billed, plus one read per board),
  then reads the board doc only for boards that have matches (for its due-date and "done"
  columns). Results are reused for a minute and refreshed with the Refresh button.
- "Due" = a Date column titled like "due" (else the first Date column, else a Timeline's end).
  "Done" = a Status whose label reads Done/Complete/Paid/Closed… (hidden unless asked for).

### D55. Search covers boards always, and items from boards opened on this device

- Searching every item in every board would mean reading every item (far over the free
  quota). Item search reads only the local cache, which is free, so it finds items in boards
  you've opened here. The palette says how many boards it looked in. Ctrl/Cmd+K opens it.
- A server-side search (Apps Script keeping a small index) is a possible later upgrade.

### D56. Dropdown cells create options in place

- Tags already did; Dropdown now shares that component, so a new Dropdown column is usable
  immediately (type a name, press Add) instead of needing a trip to "Edit options".

### D57. Instant automations run in the browser of the person who made the change

- As the spec says: the engine (`shared/automationEngine.ts`, a pure function) runs in the same
  client, and its writes join the **same batch** as the original edit, so a change and its
  consequences land together or not at all. Nothing runs when nobody has the app open; the
  UI says so. Date-based and recurring automations belong to the Apps Script helper (Phase 7).
- The person's own permissions apply: the rules see ordinary item, notification and run
  writes from that person, so an automation can never do more than they could. A viewer's
  edits don't happen, so neither do their automations. "Owner" is whose name is on it and who
  gets "notify the owner" messages.
- Only the board that is open is registered with the engine, so only that board's automations
  can fire. Edits made through other boards' pages, bulk actions (set many / delete many /
  move many) and undo do not trigger automations; a single drag or cell edit does.

### D58. Loop guard: once per chain, three levels deep

- Actions can themselves trigger automations (set status → another automation reacts). The
  engine simulates that cascade up front, before writing anything. Two rules stop loops:
  **an automation never runs twice in one chain of cause and effect** (so a ping-pong pair
  runs once each, then stops), and chains stop after **3 levels** (MAX_DEPTH). Blocked runs
  appear in the history as "Skipped" with the reason.
- A hard cap of 10 items created per change stops "create an item whenever an item is created"
  from exploding.
- Every action is validated before any is applied; if one can't work (a deleted column, a
  deleted group, an unnumberable item while offline) the whole automation is recorded as
  "failed" and applies nothing, and the person's own edit still goes through.

### D59. Creating items needs the counter, so those edits become transactions

- An automation that creates or duplicates items must number them from the board counter. If
  the board has any enabled automation like that, a triggering edit is committed as a
  transaction (needs a connection) instead of a batch. Without such automations, edits keep
  working offline exactly as before. The counter is written once per batch.

### D60. Recipes are generated from the board's own columns and open in the builder

- ~12 recipes (notify, stamp a date, move/archive when done, finish a parent when all subitems
  are done, assign the creator, add a starter subitem…). A recipe is only offered if the board has
  the columns it needs, and it opens pre-filled so the person can adjust before saving.
- Tokens `@me` and `@today` in "set a column" resolve when it runs; `{item}` in messages and
  names becomes the item's name.

### D61. A hardening round after Phase 6: measure, don't estimate

- `e2e/quota-5.spec.ts` drives typical flows with the usage meter and **fails if a flow gets
  dearer** (see QUOTA_BUDGET § Measured app-side costs). It found one cost the model missed:
  your own edits echo through your own listener (~1 read each). Budgeted as billed; the
  revised daily total is ≈ 16,400 reads (33%).
- `e2e/a11y-mobile.spec.ts` scans 14 screens with axe (WCAG A/AA; serious/critical must be
  zero), exercises a 393px-wide phone, and checks CSV export and the offline banner.
  The scan found real problems, fixed: the view tabs and the table grid had ARIA roles whose
  children weren't allowed (buttons directly inside a `tablist`, `grid`, or `row`).

### D62. CSV export is built on the device and guards against formula injection

- Built from the loaded items (zero reads), with computed columns worked out, people by
  name, and subitems under their parent. Any cell starting with `= + - @` (tab/CR) gets a
  leading apostrophe so a spreadsheet can't run it as a formula; real numbers are untouched.
  A BOM is added so Excel reads UTF-8.

### D63. Run history is trimmed when an editor opens a board

- Previously only trimmed when the Automations panel was opened. Now once per board per
  session: one count aggregation (1 read), and only if there are 10+ more than 50 runs, a read
  of just the surplus (oldest first), which is deleted. Activity pruning stays with Phase 7.

### D64. An offline banner, not a blocker

- The browser's online/offline events show a banner; Firestore keeps working from its cache and
  queues writes. The banner says the exceptions (item-creating automations need a connection).
