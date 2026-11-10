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
  can fire. Edits made through other boards' pages and undo/redo do not trigger automations; a
  single drag or cell edit does, and (since D85) so do bulk set-value and move for up to 25 items.

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

### D65. "Recently deleted" for items, from data already loaded

- Deleting an item is a tombstone (`deletedAt`), and tombstones are already in the board's
  delta-synced data, so the panel lists them with **no extra reads**. Restore brings back the
  item with the subitems deleted alongside it. Items deleted over 30 days ago are hidden here
  (and purged for good by the Phase 7 helper). Before this, the only way back was the 10-second
  Undo toast. Viewers can't see the button.

### D66. Status labels can be created from the cell, like dropdown options and tags

- The same "type a name, press Add" form; the label is saved on the column and applied in one
  step. Existing names are reused rather than duplicated.

### D67. Honest empty states and switches

- An empty board shows how to add the first item (type, press Enter or click away). The
  "something I own is due" notification switch is disabled and labelled "coming soon:
  reminders", because nothing sends those until the Phase 7 helper exists.

### D68. The app is called **Sorted**, and installs to a phone home screen

- Name chosen by the product owner (2026-11-09). A web app manifest plus icons (192, 512,
  maskable, Apple touch) make it installable ("Add to Home Screen") and open full screen.
- Deliberately **no service worker**: it would cache old app code and can serve a stale
  version after a deploy. Offline use is already handled by Firestore's own cache for data;
  the app shell needs a connection to load the first time each session.

### D69. The helper checks who is calling on every request

- The browser sends its Firebase **ID token** in the JSON body (text/plain, so no CORS
  preflight). The helper asks Google's Identity Toolkit (`accounts:lookup`) whether the token is
  genuine, unexpired and from this project; it never trusts a uid or role in the request. A
  successful check is cached for up to 5 minutes (never longer than the token lives, keyed by a
  hash of the token) to protect the URL Fetch quota. Then it reads the caller's
  `workspaces/{wid}/members/{uid}` document to get their role; actions say which role they need
  (any member, admin, or write access that viewers don't have).
- Only `ping` (and opening the URL in a browser) works without a token. Unknown action names,
  including `__proto__`/`constructor`, are refused. Unexpected exceptions are logged in the
  script's own log and the caller only sees a generic message.
- Because the helper uses the script owner's credentials, **Firestore rules are not applied to
  it**. That's why every action must re-check the caller's role itself, and why the router is
  the only entry point (tests attack it directly).

### D70. One pasted file, built and checked by CI

- Apps Script has no module system, so `npm run build -w apps-script` bundles the helper and
  the parts of `shared` it uses (the automation engine and planners in 7b) into one file,
  `apps-script/release/Code.js` (~20 KB). It is committed, and `npm run check` fails if it is
  out of date, so what you paste is always what the tests ran. `shared` is marked
  `sideEffects: false` so unused code (e.g. the validation library) is left out.
- The built file is also loaded in a sandbox with stand-ins for Apps Script's services, to
  prove the entry points exist as top-level functions and `doPost`/`setup` work.
- Updates are a manual paste + "new version" (documented), not clasp from CI, because a clasp
  login can't be done from a browser-only setup.

### D71. Platform adapter and REST writes shared with the app

- All Apps Script services sit behind one small interface (`platform.ts`), so auth, Firestore
  access and routing run in plain Node tests with fakes (32 tests).
- The helper turns the same `WriteOp`s the web app and rules tests execute into Firestore REST
  writes (field masks, server timestamps and array unions as transforms), so scheduled
  automations (7b) reuse the shared planners and engine instead of a second implementation.

### D72. Scheduled automations: the browser registers, the helper executes

- Triggers: a date arrives (N days before/after a date or timeline column, at a time of day),
  overdue (the day after, if not done) and recurring (every N days, weeks on chosen days, or
  months on a day; the 29th to 31st fall on a short month's last day). Recurring runs either
  **once for the board** (create items, notify) or **for each item matching the conditions**
  (e.g. reset everything Done every Sunday evening).
- The browser keeps `scheduledEvents` in step in the **same batch** as each edit (D-spec 6.2.3), so
  the helper only ever does one indexed query. "Rebuild schedule" repairs drift (after imports,
  duplicates, or an old client).
- The helper runs the **same automation engine** as the browser, so a scheduled change can trigger
  instant automations under the same loop guard, and numbering, notifications, activity and run
  history behave identically. It acts as the automation's **owner** (their name on activity and
  runs); notifications go only to current members.

### D73. Exactly-once, retries and time limits

- Each event is processed in one atomic commit with a precondition on the event's `updateTime` (and
  the board counter's), so overlapping runs or a re-run can never fire it twice; a lost race
  changes nothing. A moved counter is retried with the fresh value.
- Failure handling: a database blip is retried 10 and 20 minutes later and given up after 3 attempts
  (`status: 'failed'`, shown in the Helper card); a run that can never work (a column was deleted)
  is recorded as **failed** in run history and doesn't retry, but a recurring series carries on.
- A run starts no new event after 4 minutes (Apps Script stops at 6) and takes at most 100 events; the
  rest are simply due next time. An idle tick costs one query.

### D74. Time zones: the workspace's, not the browser's or the script's

- "9am" means 9am on the clock in the workspace's `timezone` (set when it was created; defaults to
  Melbourne), including across daylight-saving changes (tests cover the October and April changes). A
  time that doesn't exist (2:30am on the spring-forward day) lands just after the gap.

### D75. Date tokens make chores come round again, with no helper

- `setValue` accepts `@today`, `@today+7`, `@today-3`. So "when Done: set Next due to a week from
  today and reset the status" (a recipe) is an ordinary instant automation. The helper is for things
  that must happen when nobody is looking.

### D76. Uploads: resumable, piece by piece, through the helper

- The browser can't write to the owner's Drive, so the helper (running as the owner) does. A file is
  sent as 1 MiB pieces (base64 in a JSON request, safely under Apps Script's request limit), each
  forwarded to Drive's _resumable upload_ with a `Content-Range`. Max 10 MB (`LIMITS.MAX_FILE_MB`), so
  at most 10 pieces; a flaky connection retries one piece, not the file.
- Drive's session address never reaches the browser: the helper keeps it in the script cache under an
  opaque upload id bound to the person and workspace that started it. A piece whose position is
  behind the helper's (a retry) is acknowledged without being re-sent; a gap or wrong-sized piece is
  refused. Sessions expire after 6 hours.
- Refused before any bytes move: empty, over 10 MB, programs (`.exe`, `.sh`, `.js`…), odd MIME types
  (become `application/octet-stream`), and names are stripped of paths and control characters. At most
  40 uploads per person per hour. Viewers can't upload.
- The item stores `{ name, url, driveFileId, mimeType, size, addedBy, addedAt }` in its Files column
  (extra fields optional, so plain links still work). Nothing in Firestore changes shape beyond that.

### D77. One Drive folder per workspace, shared with members as viewers

- First upload creates `Sorted – <workspace name>` under the root folder and records it in
  `workspace.driveFolderId` (a lost race keeps the winner's folder and trashes the spare).
- Sharing mirrors the members list: every member (any role) is a _reader_; stale readers are removed.
  Only individual-user reader grants are ever touched, so the owner, editors and link sharing are
  left alone. Runs: after someone accepts an invite or is removed (best effort, from the browser), a
  button on the Helper card, and every night for every workspace as a safety net. Repeat requests
  within a minute are ignored. An address Drive rejects (not a Google account) is skipped, not fatal.
- Anyone who can view the folder in Drive can open the files; the app doesn't proxy downloads.

### D78. Boards are listed A–Z with a colour of their own

- The sidebar sorts boards case-insensitively with numbers in order (“Trip 2” before “Trip 10”).
- Each board's icon colour comes from its id (not its position), so it never changes when boards are
  added or renamed. Grey is not used.

### D79. The nightly tidy-up (3am) deletes only what nobody can see

- Items deleted over 30 days ago (with their comment threads), activity older than 180 days,
  automation run history older than 30 days, notifications that were read over 30 days ago, and any
  notification over 90 days old. Each step deletes in batches of 200, at most 2,000 a night, and stops
  at 3 minutes (a backlog clears over several nights).
- A step that fails (for example a new index is still building after a deploy) is recorded on the
  Helper card and the other steps carry on. Everything is safe to run twice.
- Board items and notifications both live in collections called `items`; the sweep of deleted items
  checks the full path so a notification can never be treated as a tombstone (tested).

### D80. Weekly backup: one JSON file per workspace, in the workspace's Drive folder

- Written to `Backups/backup-YYYY-MM-DD.json` inside the workspace folder, the newest 8 kept (older
  ones go to Drive's bin). Holds the workspace, members, invites, folders, and every board with its
  views, automations, counter and items. Not comments, notifications or activity (large, low value).
- It reads every document once a week (see QUOTA_BUDGET). Written with all non-ASCII characters
  escaped, so the upload's byte length is known exactly. A failed backup is shown on the Helper card
  and retried the next night; it never blocks the other workspaces.
- Restoring is a manual job for now (the file is plain JSON). A restore button is a possible later
  addition.

### D81. Daily email: opt-in, one a day, never empty, capped below Google's limit

- Each person switches it on in Notifications → settings (`users/{uid}.settings.emailDigest`); it is
  off by default, and only shown when the helper is configured.
- About 7am Melbourne the helper emails each opted-in person their overdue, due-today and due-this-week
  items (assigned to them, not done, on boards they can see; admins see every private board as
  everywhere else) plus their unread count. No email on days with nothing to say.
- At most one per person per day (remembered in a Script Property, written _before_ sending, so a
  failure or a second trigger can't double-send), 80 a day (`LIMITS.MAX_DIGEST_EMAILS_PER_DAY`), and
  none at all when Google's remaining quota is under 5. Subject and body are built from escaped text.

### D82. Not built: a server-side search index

- Search already runs over the data on the device (free). An index document would add writes on every
  edit and a read per search to find items on boards that aren't loaded; not worth it for a household.
  Revisit if boards get large enough that loading them for search becomes slow.

### D83. CSV import: understand cells or say why not, never guess

- Choose a CSV, map each column (names are matched automatically), see exactly how many items will be
  created and every cell that can't be used, then import in batches of 100 (each batch numbers its
  items from the board counter in a transaction). Up to 1,000 rows, 60 columns, 1 MB.
- Dates are read day-first (17/3/2026); numbers may carry $, commas, %, or brackets for negatives;
  status, dropdown and tags match by name (case-insensitive) and don't invent options; people match by
  name or email. A cell that can't be understood is left empty and listed, and its row still imports.
- Subitem relationships, files, dependencies, timelines and computed columns are not imported.
- Instant automations don't run for imported items (500 rows would mean 500 notifications), but
  reminders for imported dates are registered.

### D84. Rules tightened in 7d

- Notification links must be in-app paths (`/w/<id>[/b/<id>[?item=<id>]]` or empty). Before, any
  string up to 500 characters was accepted, so an editor could put a web address in someone's inbox.
- Automations: the trigger and each of the (up to 5) conditions and actions must be a map of at most
  12 keys.
- `users/{uid}.settings.emailDigest` must be a boolean.

### D85. Bulk edits fire automations, for up to 25 items

- "Set value" on many items, and moving many items to a group, now run the board's instant
  automations once per changed item, in one atomic batch. Each item's event sees the board as the
  earlier items and their automations left it; items created along the way are numbered in order and
  the counter is written once.
- Over 25 items the edit still happens but automations don't run, and a message says so (a 500-item
  edit would otherwise mean hundreds of notifications and writes in one batch). Delete, archive and
  undo never trigger automations (there is no trigger for them / undo reverses only your own edit).

### D86. Kanban cards can be put in order within a lane

- Drag a card onto another card to place it next to it (below it if you dragged down within the lane,
  above it otherwise); onto empty space in a lane to put it last. Across lanes it also changes the
  value (as before) and lands where you dropped it.
- The order is saved in the view (`config.options.cardOrder`: lane key → item ids, at most 40 lanes
  and 300 cards each), not on the items, because an item's `order` only means something inside its
  table group. So Kanban ordering never disturbs the table, two Kanban views can order differently,
  and cards not in the list (new ones) sit after the listed ones in their normal order.
- A view with a sort keeps following its sort; dropping within a lane then says so instead of
  silently doing nothing. Changes to a view's settings now also save when the page is closed or
  reloaded within the half-second before they would have saved.

### D87. Undo and redo (Ctrl/Cmd+Z, Ctrl+Shift+Z or Ctrl+Y, and two buttons)

- Per board, per tab, in memory (a reload starts a fresh history; at most 50 steps). Covers: cell
  edits, bulk set-value, adding an item, renaming, moving (including Kanban/table drags), archiving
  and deleting. Not covered: view settings, columns and groups, imports, duplicates, comments.
- An entry is recorded the moment you act (so Ctrl+Z straight after an edit undoes that edit, before
  the server has even replied) and forgotten if saving fails. Steps run one at a time, in order.
- It never overwrites newer work. An undo changes a cell only if it still holds exactly what your
  edit left there; if someone else has changed it, or the item was deleted, that step is refused with
  a message (and dropped), and in a bulk edit the items that changed are left alone and counted.
  A move is refused if the item was moved again since.
- Undo reverses your edit, not what automations did because of it (they could have notified people or
  created items). Undo and redo themselves never trigger automations and are not new history.
- The keyboard shortcuts stand aside while you are typing in a field (it has its own undo) or have a
  dialog open, and viewers don't get the buttons.

### D88. Everyday words: "household" and "list", not "workspace" and "board"

- What people see: a **household** (was workspace) holds **lists** (was boards): "Create your
  household", "Join household", "Household members", "New list", "List settings", "Search lists and
  items", "Lists" in the sidebar. Items, folders, views, columns and groups keep their names.
- Only the words on screen changed (labels, messages, notifications from the helper, template and
  default names). Code, database paths (`workspaces/…/boards/…`), URLs (`/w/…/b/…`), types and
  function names are unchanged, so nothing stored or linked needs migrating. Unit-test titles and
  code comments still say board/workspace.
- The change was made with a script that only touches string literals and on-screen text (never
  paths, identifiers or comments); changing the words again is the same exercise. The end-to-end
  tests were updated to the new labels.

### D89. Phone layout

- Board header: the title has its own row; the action buttons are one swipeable row beneath it (from
  tablet width up they sit beside the title as before). View tabs are one swipeable row. The search
  box is full width.
- Table: the item-name column takes about 60% of the screen (190–260px) and is stripped of what
  needs a mouse: the drag grip, the empty expand arrow, the pencil and the open-panel button. A
  **tap on a name opens the item** (rename it there); on a mouse, a click still renames in place.
  The row's ⋯ menu (add subitem, duplicate, move, archive, delete) and the checkbox are always
  visible on touch screens.
- Calendar fits the screen (no sideways scrolling); compact day cells and event chips, and the
  month's "+" buttons are left to larger screens.

### D90. Time tracking: sessions inline on the item, one timer per person

- A **Time tracking** column holds the sessions (`{ id, uid, start, end, note? }`, times in epoch
  ms) inline in the item's cell, so showing a list costs no extra reads. Footer = sum; filter and
  sort use the total (filters compare hours); a formula sees it as hours; CSV exports decimal hours.
- A person has at most one running timer in a household (`timers/{uid}`, rules unchanged from
  Phase 1: only its owner writes it, start time is the server's). **Start** while one is running
  saves the first, then starts the new one. **Stop** is one transaction: it re-reads the item,
  appends the session and deletes the timer, so two people logging to the same item can't lose a
  session. Under a second is not recorded; a forgotten timer is recorded as exactly 24 hours and can
  be deleted and re-entered.
- Manual time: date, start, hours and minutes, with a note; a session is at most 24 hours and can't
  end in the future. To change a session, delete it and add it again. People delete their own
  sessions; admins can delete anyone's. This is enforced in the app, not in the rules (the rules
  can't look inside a cell, and anyone who can edit an item can edit its cell).
- A copy of an item or list starts with no logged time.
- Deviation from the spec: instead of archiving old sessions into a `timeEntries` sub-collection
  past ~200, the oldest 100 are **rolled up into one entry per person per month** (inline), which
  keeps every person's and every month's total exact, needs no extra reads or documents, and is
  tested. Only day-level detail for sessions older than the newest ~100 is lost (the timesheet shows
  such entries as "earlier, combined").

### D91. The timesheet reads only items that have time on them

- Timesheet (sidebar → Timesheet): period (this week, last week, this month, all time or any dates,
  in the household's time zone), person, list; grouped by person or by item; CSV export.
- For each list with a Time tracking column it runs one query ordered by that cell, which returns
  only items that have the cell set, so a visit costs about one read per tracked item plus one per
  list (to learn its columns). Results are kept for a minute (Refresh to force).

### D92. Dashboards: up to five lists, nine widgets, nothing live

- Sidebar → Dashboards. A dashboard has a name, **up to 5 lists** (`LIMITS.MAX_DASHBOARD_BOARDS`), up
  to 24 widgets on a 12-column drag-and-resize grid (react-grid-layout), and is either for the whole
  household or just for its creator (admins can see every dashboard, as with private lists). Editors
  press **Edit** to add, move, resize, configure and remove widgets; viewers can look. Phones show one
  column and don't drag.
- Widgets: **Number** (count / total / average, optionally "only items whose status is …"),
  **Progress** (share done), **Chart** (bar, stacked, pie, line: the Chart view's engine), **Items**
  (a short table), **Overdue**, **Tasks by person**, **Workload** (hours per person per week from a
  Timeline column), **Timeline**, **Time tracked** (hours per person this week/month/all time).
- Data strategy, per widget: **Number** uses a Firestore _aggregation query_ (`count()` / `sum()` /
  `average()` with equality filters on deleted/archived/subitem and optionally the status), billed
  roughly one read per thousand items instead of one per item. Every other widget needs the items, so
  they share **one read of each list's items** (and board document), kept for a minute: ten widgets
  over one list read it once. **Time tracked** reads only items that have time logged. There are **no
  live listeners** on a dashboard; Refresh drops the cache and reloads.
- Deleted items are left out by the query itself; archived items and subitems are ignored when
  counting ("the work" = top-level, not archived, not deleted).

### D93. Dashboard rules and their limit

- Read: any member for a household dashboard; the named members and admins for a private one. Create
  and edit: editors (viewers can't); the creator and creation time can't change; delete: the creator or
  an admin. At most 5 list ids, 24 widgets, and a private dashboard must name its creator.
- Firestore rules may evaluate at most 1,000 expressions per request. Checking each of 24 widgets'
  fields (type, config keys, layout keys) exceeded that, so the rules only check that every widget is
  an object with a text `type` (and the count). Everything else about a widget is sanitised when the
  dashboard is read (`parseDashboard`: unknown types and fields vanish, layouts are clamped, a widget
  can only point at a list the dashboard has), so a tampered client can't make a dashboard misbehave.

### D94. Phase 9 quota audit: measured, projected, enforced by a test

- `e2e/quota-audit.spec.ts` builds the budget's household (10 lists, one of 150 items, a dashboard),
  measures each everyday action with the usage meter, projects a day for 15 people (the assumptions
  in QUOTA_BUDGET §4), adds what the meter can't see (one rule lookup per live update, the helper's
  background reads), and **fails if a normal day reaches 60% of the free reads/writes** or a peak day
  (1.5× plus the weekly backup) reaches 100%.
- Result: about **15,100 reads/day (30%)**, peak **23,900 (48%)**, **1,500 writes (8%)**, at most
  1,000 deletes (5%). The largest single cost is dashboards (each view reads its lists' items once,
  ~165 reads for a 150-item list); still well inside the target.
- What it can't prove: billing details the emulator doesn't model (whether your own edits' echoes are
  billed, rule lookups). After a week of real use, compare with the Firebase console's Usage tab.

### D95. Robustness odds and ends

- After a deploy, an open tab asking for a code file that no longer exists reloads itself once (and
  the error screen says "Sorted has been updated" instead of a raw error).
- Hosting adds `X-Frame-Options: DENY` and a `Permissions-Policy` turning off camera, microphone,
  location and payment. A full Content-Security-Policy was not added: Google sign-in, Firestore,
  Drive previews and the Apps Script helper need a long allow-list that can't be tested from here,
  and a wrong one would lock everyone out.
- `npm audit` reports `@grpc/grpc-js` advisories through the Firebase SDK. That package is only used
  when Firestore runs under Node (our tests and tooling), never in the browser app, and the only fix
  offered is downgrading Firebase to 9.x. Left as is, to revisit when Firebase updates its dependency.
- Press **?** for a keyboard-shortcut list.

### D96. "Database usage" pop-up

- Sidebar → **Database usage**: today's reads, writes and deletes **from this device**, as bars
  against Firebase's free daily limits (50,000 / 20,000 / 20,000), reset at midnight US Pacific like
  Firebase's own counters, plus the last 7 days and a link to the console's usage page.
- It counts what the app's metered database calls do (the same meter the quota tests use), kept in
  this device's storage. A browser can't read the household's real total: that needs a Google Cloud
  sign-in to the monitoring API, which would mean a new permission and an extra service. The console
  link is one click away for the real figure.

### D97. Help for ADHD and executive dysfunction

- **Focus** (sidebar): one thing at a time. Today's plan first, then overdue, due soonest, no date
  last. "Your things" = assigned to you **or to nobody** (many households never assign). The card
  shows a countdown, the **first tiny step** (the item's first unfinished subitem) or a **Break it
  down** form (up to three steps, saved as subitems), a **timebox** (5/15/25 min; a sound, a
  notification if allowed, and a message at the end; it also runs the item's Time tracking timer if
  the list has one), **Done** (sets the list's "Done"-type status) and **Not now** (skip for this
  visit). "After that" shows the next three. Reads each of your lists once per visit (kept a minute).
- **Quick wins**: any Tags/Dropdown option named "Quick", "2 min" or "5 min" marks one; Focus can show
  only those.
- **Countdowns** beside every date in tables: "2 days late", "today", "tomorrow", "in 3 days" (warm
  colours as it gets close; far-off dates show just the date).
- **Escalating reminders** (an automation recipe): one click adds four reminders, each quiet once the
  item is done: 3 days before, on the day (you and the people on it), the day after, and 3 days late
  ("do it, move the date, or let it go?").
- **Today's plan**: pick up to three things; stored on your user profile as `settings.todayPlan
{ date, picks[≤3] }` (rules allow only that shape, only for yourself) and forgotten the next day.

### D98. The Timeline view lists items earliest first

- Within each group, items are ordered by their start date (undated items last); subitems stay under
  their parent and are ordered the same way. If the view has a sort of its own, that sort is used
  instead. Only the Timeline view does this; the table keeps your hand-made order.

### D99. Assignments wait for acceptance

- Items carry `acceptance: { [uid]: { state: 'pending' | 'accepted' | 'rejected', by } }`, kept in
  step with the People columns by `planSetCell`: someone assigned by another person is _pending_,
  assigning yourself counts as _accepted_, and people removed from the item are cleared.
- The assignee answers from the notification (Accept / Reject, or just mark it read) or from the
  item panel's banner. Answering marks the notification read and notifies whoever assigned them.
- Rules only check that `acceptance` is a small map: any editor may write it, so "only the assignee
  answers for themselves" is enforced by the app, not the database (a household is a trusted group,
  and the rules expression budget is tight). Automations that assign people don't ask for acceptance.

### D100. New documents are Google Docs made by the helper

- A Files cell's **New document** asks the helper (`createDoc`) for a blank Google Doc, named after
  the item, in the household's Drive folder. It is attached to the cell like an upload and opens
  in a new tab.
- The folder only gives members _view_ access, so the helper also makes every member who can edit
  (admins and members, not viewers) an editor of that one document. People who join later can
  view it through the folder; the creator can share it further from Docs.
- Google Docs rather than Word files: Word Online needs a Microsoft 365 setup, and Docs can still
  download as .docx.

### D101. Groups are a column

- Every list has a **Group** column (type `group`). It stores nothing: it shows the item's
  `groupId`, and picking another group moves the item (and its subitems) to the end of that group
  through the normal move path, so it is undoable and logged. Dragging between groups changes it
  too, and renaming or adding a group is reflected everywhere, because the groups are still the
  list's own `groups`.
- Existing lists are converted the first time an editor opens them: `schemaVersion` goes from 1 to
  2 and the Group column is added first. Items keep the group they were in, so nothing moves.
- New lists choose their groups ("list type") when created: the template's own, Tasks, Bills,
  Study, Project, or Custom (typed, comma-separated). A template's sample items go in the first
  group when the groups are replaced.
- Filters treat the Group column as text (the group's name); it has no summary.

### D102. Review fixes: rules and helper

- Lists are deleted by admins only (their items can only be hard-deleted by admins). Changing who
  can see a dashboard is limited to its creator or an admin, as for lists.
- Viewers may accept or decline their own assignment: an item update that touches only
  `acceptance.<their uid>` (plus updatedBy/updatedAt), and an `assignment` notification back.
- Scheduled automations stop (their events are removed) when the owner is no longer an editor who
  can see the list: the helper bypasses the rules, so it checks this itself.
- The helper splits commits to stay under Firestore's 500-writes limit (rebuild, big per-item runs)
  and looks an item up directly before treating it as deleted.
- Folder sync also removes document edit access (D100) from people who left or became viewers.
- Not changed: notifications of people who have left are not purged (no safe query for them yet).
