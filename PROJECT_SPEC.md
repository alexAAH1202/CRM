# Project Brief & Technical Specification: Team Work Management App

> **How to use this file.** Save it as `PROJECT_SPEC.md` in an empty project folder, run Claude Code there, and start with:
> *"Read PROJECT_SPEC.md fully. Enter plan mode and propose a plan for Phase 0 and Phase 1. Do not write code until I approve the plan. Ask me about anything ambiguous."*
> Work one phase at a time, and commit after each phase.

---

## 1. Goal

Build a **monday.com-style work management web app** for a **small team (2-15 people)** that runs at **$0/month**. Use Firebase's free (Spark) plan plus Google Apps Script. The feature target is roughly monday.com's **Pro** tier: customizable boards, many view types, automations, dashboards, time tracking, dependencies, formulas, and private boards. The app is NOT a clone: use an original name, logo and branding, and do not copy monday.com assets or trademarks. Use `[APP_NAME]` as a placeholder until I choose a name.

### Hard constraints (non-negotiable)
1. **Everything must work on the Firebase Spark plan, with no billing card.** That means no Cloud Functions, no Cloud Storage and no paid APIs. Before adding any Firebase or Google Cloud service, check that it is available on Spark. If it isn't, stop and ask me.
2. **No servers to run.** The frontend is static files on Firebase Hosting. All server-side logic runs in Apps Script.
3. **Stay inside free quotas by design** (see section 7). Quota efficiency is a first-class requirement, not an afterthought.
4. **Security by Firestore Security Rules.** The browser is untrusted. Every permission is enforced in rules, and every rule is covered by emulator tests.
5. Small team, but build it **multi-workspace-ready** (all data is scoped under `workspaces/{workspaceId}`).

### Non-goals for v1
Native mobile apps, SSO/SAML, public API/webhooks, guest/external users, board-to-board mirror/connect columns, AI features, Google Calendar sync (listed as a stretch goal in section 12).

---

## 2. Decisions already made (do not re-ask)

| Topic | Decision |
|---|---|
| Users | Small team (2-15) in one or a few workspaces |
| Backend split | Firebase core (Auth, Firestore, Hosting) + Apps Script helper web app |
| Auth | Google sign-in only; **invite by email**; roles **Admin / Member / Viewer** |
| Files | **Google Drive links via Apps Script** (no Firebase Storage) |
| Automations | **Hybrid**: instant ones run in the browser, scheduled ones run in Apps Script |
| Look & feel | Colorful, monday-style boards: vivid status pills, colored group headers, friendly and rounded |
| v1 features | Boards + custom columns, multiple views, automations, dashboards, time tracking, files |
| Frontend stack | Claude's choice, within the guidance in section 3 |

---

## 3. Tech stack

**Frontend:** React 18 + TypeScript + Vite + Tailwind CSS, installable as a PWA. The choice is made for ecosystem depth (drag-and-drop, virtualization, charts) and small static bundles.
- State and data: Firebase modular SDK v9+ with Firestore `onSnapshot` and **persistent local cache** (`persistentLocalCache` + `persistentMultipleTabManager`). Use Zustand for UI-only state. Don't add React Query on top of Firestore listeners.
- Tables: TanStack Table plus TanStack Virtual (virtualized rows).
- Drag and drop: `@dnd-kit`.
- Dashboard grid: `react-grid-layout`.
- Charts: Recharts (or visx). **Gantt/Timeline and Workload views: build custom SVG/DOM components** so dependency arrows and drag-resize work exactly as needed; don't adopt a heavy Gantt library without asking me.
- Dates: `date-fns`. Routing: React Router. Forms: React Hook Form + Zod.
- Formula column: write a **safe expression parser/evaluator** (no `eval`, no `new Function`). Unit-test it heavily.
- Code-split by route and view; keep the initial JS bundle small (Hosting bandwidth is metered).

**Backend:** Firestore, Firebase Auth (Google provider), Firebase Hosting (SPA rewrite), Firestore Security Rules + indexes. **Apps Script** web app, developed locally with `clasp` (TypeScript allowed).

**Tooling:** npm workspaces monorepo, ESLint + Prettier, Vitest (unit), `@firebase/rules-unit-testing` (rules tests), Playwright (smoke e2e against the **Firebase Emulator Suite**). Develop entirely against the emulators so dev usage never consumes cloud quota.

### Repo layout
```
/web                 React app
/firebase            firestore.rules, firestore.indexes.json, firebase.json, rules tests
/apps-script         clasp project (Code.ts, scheduler, drive, digest, auth helpers, appsscript.json)
/docs                ARCHITECTURE.md, DATA_MODEL.md, QUOTA_BUDGET.md, SETUP.md, DECISIONS.md
```

---

## 4. Feature specification

Monday.com Pro feature to our implementation. **P0 = must ship in v1, P1 = ship if time allows.**

### 4.1 Workspace, boards, structure (P0)
- Workspace > Folders (optional) > **Boards** > **Groups** > **Items** > **Subitems**.
- Left sidebar with workspace switcher, favorites, folders, boards. Board header with name, description, view tabs, filter/sort/group/hide-columns toolbar, and a search box.
- Board visibility: **Main** (all workspace members) or **Private** (explicit member list; hidden from everyone else, including in dashboards and search).
- Board templates: Project tracker, Sprint/Kanban, Content calendar, Simple CRM, Blank. Duplicate board, archive/restore board and item.
- Item "page": opens as a side panel with fields, an **Updates** tab (comments), **Files** tab, **Activity** tab.

### 4.2 Columns (P0 unless marked)
Text · Long text · **Status** (custom labels + colors, default label) · Dropdown · **People** · **Date** · **Timeline** (start-end range) · Numbers (with unit/format) · Checkbox · Rating · Link · Email · Phone · Tags · **Progress** (derived from subitems or checkbox groups) · **Files** (Drive links) · Item ID (auto-number) · Created at / Last updated / Created by (system) · **Formula** · **Dependency** · **Time tracking** · Priority (preset status) (P1: Vote, Color picker, Button).
- Column settings: rename, change type (with safe conversion), width, required (P1), default value, per-column summary footer (sum/avg/min/max/count/status distribution).
- Column definitions live on the board doc. Cell values live on the item doc as `values: { [columnId]: typedValue }`.

### 4.3 Views (all saved per board; each has its own filter/sort/group/visible-columns state)
1. **Table** (main): inline editing, drag to reorder rows and groups, collapse groups, multi-select bulk actions (move, set value, duplicate, archive, delete), column drag-reorder, frozen first column, keyboard navigation.
2. **Kanban**: group by any Status/Dropdown/People column; drag cards between lanes (writes the column value).
3. **Calendar**: month/week; places items by a Date or Timeline column; drag to reschedule.
4. **Gantt / Timeline**: bars from a Timeline column; drag to move/resize; **dependency arrows** (finish-to-start, with lag); highlight the critical path (P1); zoom day/week/month; today marker; group lanes.
5. **Workload**: people x time buckets. Effort comes from a Numbers (hours) column or Timeline duration, against a configurable per-person capacity. Over-capacity cells are flagged.
6. **Chart** (board-level): bar/pie/line/stacked from any column aggregation (count, sum, avg).
7. **(P1)** Form view that creates items (authenticated members only).

### 4.4 Dependencies & formulas (P0)
- Dependency column links to other items on the same board. Rescheduling a predecessor **offers** to shift successors (confirm dialog, with undo). Detect and prevent cycles.
- Formula column supports `+ - * / ( )`, comparisons, `IF`, `AND/OR/NOT`, `SUM/AVG/MIN/MAX/ROUND`, `CONCATENATE`, `TODAY()`, `DAYS(a,b)`, `WORKDAYS`, text functions, and column references like `{Budget}`. Show errors inline. The formula never writes to the DB: compute on render, and cache nothing.

### 4.5 Automations
**Builder UI:** sentence-style recipe ("When `<trigger>` and `<condition>`, then `<action>`"), plus a gallery of ~12 prebuilt recipes. Per-board list with on/off toggle, run history (last 50 runs, with failures) and an "owner" (whose permissions apply).

| Trigger | Where it runs |
|---|---|
| Item created · Column changes · Status changes to X · Person assigned · Item moved to group · Subitems all done | **Instant (browser)** |
| Date arrives (N days/hours before/after a date column) · Recurring (daily/weekly/monthly/custom) · Item overdue | **Scheduled (Apps Script)** |

| Action | Notes |
|---|---|
| Set/change column value · Move item to group · Create item / subitem · Duplicate item · Archive item | Instant or scheduled |
| **Notify** (in-app inbox) | Instant or scheduled |
| **Send email** | Scheduled path only, always **batched into digests** (section 6.4) |

**Instant execution rules:** run inside the same client that made the triggering change, in the **same `writeBatch`** as the original write. Add a **loop guard** (depth limit 3 and a per-run "caused-by" marker) so automations can't trigger each other forever. Because only a connected client can run them, document the limitation clearly: *instant automations only fire when someone has the app open.*

**Scheduled execution rules:** see section 6.2 (`scheduledEvents` queue).

### 4.6 Collaboration (P0)
- **Updates** (comments) on items: rich text (bold/italic/lists/links), **@mentions**, replies, edit/delete own, emoji reactions (P1).
- **Notifications inbox** (bell icon): mentions, assignments, automation notifications, due-soon. Mark read/unread; per-user notification settings.
- **Activity log** per item and per board. Log only meaningful events (create, delete, status, person, date, move, automation run) to conserve writes.
- Real-time presence is **out of scope** (quota-heavy). Real-time data updates via Firestore listeners are in scope.

### 4.7 Time tracking (P0)
- Time tracking column: start/stop timer (one running timer per user across the workspace), manual entry, edit/delete sessions, per-item total. Sessions are stored in a compact array on the item (cap with archival into a subcollection when it exceeds ~200 sessions).
- **Timesheet report** page: filter by person/board/date range, group by person or item, export CSV.

### 4.8 Files (P0)
- Files column and item "Files" tab. Upload goes browser -> **Apps Script** -> shared **Google Drive folder** (see 6.3). Store `{driveFileId, name, mimeType, size, webViewLink, addedBy, addedAt}` on the item. Max 10 MB per file (configurable constant). Image/PDF preview via Drive's preview URL. Also allow "attach by link".

### 4.9 Dashboards (P0)
- Workspace-level dashboards combining **up to 5 boards each** (cap protects read quota; make the cap a config constant).
- Widgets (drag/resize grid): Numbers (count/sum/avg), Chart (bar/pie/line/stacked), **Battery** (overall progress), Table (items filtered), Workload, Timeline, "Tasks by person", "Overdue items", Time-tracked summary.
- Widget data should prefer **Firestore aggregation queries** (`count()`, `sum()`, `average()` via `getAggregateFromServer`), which cost far fewer reads than fetching documents. Fall back to cached client-side computation where aggregation can't express it. Document which widgets use which strategy.

### 4.10 Cross-cutting (P0 unless noted)
Global search (items/boards the user can access) · "My Work" page (items assigned to me across boards, grouped by due date) · CSV import/export per board · Undo/redo for the last N edits in the current session · Keyboard shortcuts · Light/dark mode · Responsive down to tablet; usable on phone · Accessibility (keyboard, focus, ARIA, contrast) · Empty states and onboarding for a first board · Error boundaries and offline banner (Firestore offline cache) · PWA install (P1).

---

## 5. Data model (Firestore)

Claude: finalize in `docs/DATA_MODEL.md` during Phase 0 and ask me to review it. Starting proposal:

```
users/{uid}                         { displayName, email, photoURL, lastWorkspaceId, settings{} }
workspaces/{wid}                    { name, createdBy, createdAt, driveFolderId, settings{ capacityHoursPerWeek, weekStart, timezone } }
workspaces/{wid}/members/{uid}      { role: 'admin'|'member'|'viewer', email, displayName, photoURL, joinedAt }
workspaces/{wid}/invites/{emailLower} { role, invitedBy, createdAt }
workspaces/{wid}/folders/{fid}      { name, order }
workspaces/{wid}/boards/{bid}       { name, description, folderId, visibility:'main'|'private', memberIds[] (private only),
                                      columns[{id,type,title,width,settings{}}], groups[{id,name,color,order,collapsed}],
                                      views[{id,type,name,config{filters,sort,groupBy,hiddenCols,...}}],
                                      itemCounter, archived, createdBy, updatedAt }
workspaces/{wid}/boards/{bid}/items/{iid}   { name, groupId, order (fractional string), parentId|null (subitems),
                                      values{ [colId]: ... }, createdBy, createdAt, updatedAt, archived,
                                      reminderKeys[] (denormalized, for scheduling) }
workspaces/{wid}/boards/{bid}/items/{iid}/updates/{uid}   { author, body, mentions[], parentId, createdAt, editedAt }
workspaces/{wid}/boards/{bid}/automations/{aid}           { enabled, trigger{}, conditions[], actions[], ownerUid, createdAt }
workspaces/{wid}/boards/{bid}/automationRuns/{rid}        { automationId, status, error?, at }   // capped, pruned
workspaces/{wid}/boards/{bid}/activity/{id}               { type, itemId, actor, data{}, at }    // capped, pruned
workspaces/{wid}/scheduledEvents/{eid}  { fireAt, boardId, itemId, automationId, kind, status:'pending'|'done'|'failed', attempts }
workspaces/{wid}/dashboards/{did}       { name, boardIds[<=5], widgets[{id,type,config,layout}], visibility, createdBy }
workspaces/{wid}/notifications/{uid}/items/{nid}  { type, title, body, link, read, createdAt }
workspaces/{wid}/timeEntries/{eid}      { userId, boardId, itemId, start, end|null, note }   // if split out of items
```
Design rules:
- **Lean item documents.** Don't embed updates or activity in the item doc.
- Ordering via **fractional indexing** (string keys) so a drag-reorder writes one doc.
- Item ID autonumber via transaction on `itemCounter`.
- Keep `values` shapes typed and versioned (`schemaVersion` on board doc) so column-type changes can migrate safely.
- All timestamps are server timestamps where trust matters.
- Provide the composite indexes in `firestore.indexes.json`.

---

## 6. Security, auth & the Apps Script helper

### 6.1 Auth, invites and rules
- Firebase Auth, Google provider. First user to create a workspace becomes **Admin**.
- **Invite flow (no Cloud Functions):** an Admin creates `invites/{emailLower}` with a role. When the invited person signs in with a **verified Google email** matching the invite id, the client writes `members/{uid}` and deletes the invite in a single batch. Rules allow this create only if the invite exists, `request.auth.token.email_verified == true`, the email matches, and the requested role equals the invite's role. Admins can change roles and remove members. At least one Admin must always remain (enforce in UI; in rules where feasible).
- **Rules must enforce:** workspace membership for every read/write; Viewer = read-only; Member = write to boards/items they can access; Admin = manage members, boards, workspace settings; private boards visible only to `memberIds` (+ Admins if you decide so; **ask me**); users can only write their own `notifications` read-state and their own timers; field-level validation (types, string lengths, array caps, allowed enum values); no client may set `role` to anything via other paths; deny by default.
- Note that `get()`/`exists()` calls inside rules bill document reads. Structure rules so each request does the minimum lookups (one membership `get()`), and record the measured cost in `QUOTA_BUDGET.md`.
- **Rules unit tests are mandatory** for every collection and role. Phase 1 isn't done until they pass.

### 6.2 Apps Script helper: responsibilities
One Apps Script project, deployed as a **Web App** (execute as: me; access: anyone with a Google account, or anyone), associated with the same Google Cloud project as Firebase so it can call the Firestore REST API with `ScriptApp.getOAuthToken()` (scopes: `datastore`, `drive`, `script.send_mail`, `script.external_request`, `script.scriptapp`; declare them in `appsscript.json`).

1. **Request authentication.** The browser sends its Firebase **ID token** in the JSON body (not a header). The script verifies it by calling the Identity Toolkit `accounts:lookup` endpoint (or by validating the JWT signature against Google's public certs, caching the certs), then checks workspace membership/role via the Firestore REST API. Reject everything else. Never trust a client-supplied uid or role.
2. **Scheduler (time-driven trigger, every 10 minutes).** Query `scheduledEvents` where `status == 'pending' && fireAt <= now` (collection-group query, limit ~100). For each: execute the automation actions server-side (write to Firestore via REST, create notifications, queue email digests), then mark done and schedule the next occurrence for recurring events. Make every run **idempotent** (safe if it executes twice) and **time-boxed** (exit cleanly at ~4 minutes and resume next run).
3. **Event registration.** When the browser saves an item or automation that implies future firing (date-relative reminders, recurring rules), it also writes/updates the matching `scheduledEvents` docs in the **same batch**. The scheduler never scans all items. Include a reconciliation routine that Admins can run manually ("rebuild schedule") for self-healing.
4. **Drive uploads.** Endpoint `upload`: receives `{idToken, workspaceId, fileName, mimeType, base64Chunk, chunkIndex, totalChunks}`, assembles in `CacheService`/temp state, writes to the workspace Drive folder, returns the Drive file metadata. Folder sharing: when a member joins/leaves, the helper adds/removes them as viewer of the workspace folder (needs a `syncMembers` endpoint or scheduler step).
5. **Email digests.** At most one digest per user per day (plus an optional morning digest) via `MailApp`, containing mentions, assignments and due/overdue items. Free consumer Apps Script accounts have a very small daily email recipient cap (about 100/day at the time of writing), so **never send per-event emails**; track a daily counter and stop at 80.
6. **Housekeeping.** Daily job to prune `activity`, `automationRuns` and old read `notifications` beyond their caps, keeping within quotas.

### 6.3 Calling Apps Script from the browser
- Use `fetch` with `Content-Type: text/plain;charset=utf-8` and a JSON body, so the browser doesn't send a CORS preflight (Apps Script web apps don't answer `OPTIONS`). Return JSON via `ContentService`. Wrap the call in one client module with retries, timeouts and typed errors.
- The web app URL is configuration (`VITE_APPS_SCRIPT_URL`), not a secret. Real secrets (if any) live in Script Properties, never in the repo.

### 6.4 Apps Script quota guardrails (free consumer account)
Design around: **6 min max per execution, ~90 min/day total trigger runtime, ~20,000 URL Fetch calls/day, ~100 email recipients/day, 20 triggers per script**. Before building, **re-verify the current numbers at developers.google.com/apps-script/guides/services/quotas** and record them in `QUOTA_BUDGET.md`. A 10-minute scheduler therefore must average well under 30 seconds per run. Use early exit when there's no work, and batch REST calls (`documents:batchGet`, `commit`).

---

## 7. Free-tier quota budget (design requirement)

Check current limits at **firebase.google.com/pricing** and record them in `docs/QUOTA_BUDGET.md` (including how you derived estimates). Approximate Spark limits at the time of writing: Firestore **1 GiB stored, ~50K reads/day, ~20K writes/day, ~20K deletes/day**; Auth ~50K MAU; Hosting **~10 GB/month transfer** (also ~360 MB/day) and 1 GB stored. When a Spark quota is exceeded, that service stops until the reset; there is no surprise bill, which is why guardrails matter.

**Mandatory engineering patterns:**
1. **Persistent local cache** enabled; listeners only on the *currently open* board (and the user's notifications), detached when leaving.
2. **No listeners on whole workspaces or all boards.** Sidebar uses the (small) `boards` collection with a single listener; dashboards use aggregation queries or one-shot cached reads, not live listeners.
3. Paginate/virtualize big boards (query `limit` with "load more" by group); archived items are excluded by default.
4. **Debounce and batch writes:** text edits save on blur/Enter; drag operations write once on drop; bulk actions use `writeBatch` (max 500). Never write on every keystroke.
5. Denormalize carefully: store what views need on the item to avoid join reads, but never fan out writes to hundreds of docs for one edit.
6. Activity log capped and pruned; automation run history capped (last 50/board).
7. **Dev-only usage meter:** a small debug overlay (enabled by a flag) that counts reads/writes per session, so regressions are visible. In `QUOTA_BUDGET.md`, estimate daily reads/writes for 15 active users (e.g. users x board opens x items per board, with and without cache) and show the design stays under ~60% of the free quota. If the estimate says it doesn't, raise it with me **before** building further.
8. Hosting: hashed assets with long-cache headers, gzip/brotli, route-level code splitting, no huge dependencies, images optimized.

---

## 8. UX & visual design

- **Direction:** colorful, friendly, rounded, "monday-style" boards: bold colored group headers with collapse chevrons, vivid full-cell **status pills**, avatar chips for people, subtle row hover and a persistent left sidebar. Original palette and typography, not a pixel copy of anyone's brand. Suggested status defaults: Done (green), Working on it (orange), Stuck (red), Not started (gray), plus blue/purple/pink/teal for custom labels. Light + dark mode via CSS variables/Tailwind tokens.
- Define a small design system early (tokens, components for Pill, Avatar, Popover, Modal, SidePanel, Toast, EmptyState) and use it everywhere.
- Performance: instant-feeling inline editing (optimistic UI), skeleton loaders, virtualized lists, no layout shift.
- Accessibility: WCAG AA contrast (status pills need accessible text colors), full keyboard operation of the table, screen-reader labels.
- Use the `frontend-design` skill (if available) when building the shell and design system.

---

## 9. Phased delivery plan

Work **one phase at a time**. For each: propose a short plan, wait for my approval, implement, run lint/tests, update docs, commit. Don't start the next phase without my go-ahead.

| Phase | Scope | Done when |
|---|---|---|
| **0. Foundations** | Monorepo, tooling, emulator suite, CI-style npm scripts, design tokens, `ARCHITECTURE.md`, `DATA_MODEL.md`, `QUOTA_BUDGET.md`, `SETUP.md` | `npm run dev` works against emulators; docs reviewed by me |
| **1. Auth, workspace, invites, rules** | Google sign-in, create workspace, invite/accept flow, roles, member management UI, **full rules + rules tests** | Rules tests pass for all roles; invite flow works end to end |
| **2. Boards & table view** | Sidebar, board CRUD, groups, items, subitems, core column types, inline editing, drag-reorder, filter/sort/group, templates | A team can run a project in the table view |
| **3. More column types + formulas + dependencies** | Remaining columns, summaries, formula engine (with tests), dependency column | Formula engine tests pass; cycles prevented |
| **4. Views** | Kanban, Calendar, Gantt/Timeline (with dependencies), Workload, Chart | All views editable and saved per board |
| **5. Collaboration** | Item side panel, updates/mentions, notifications inbox, activity log, My Work, search | Mentions create notifications |
| **6. Instant automations** | Builder UI, recipe gallery, in-browser engine with loop guard, run history | Prebuilt recipes work, no infinite loops |
| **7. Apps Script helper** | Auth verification, scheduler + `scheduledEvents`, scheduled automations, Drive upload + folder sharing, email digest, housekeeping; `clasp` deploy docs | Reminder and recurring-task automations fire without the app open |
| **8. Time tracking & dashboards** | Timer column, timesheet, dashboards with aggregation-based widgets, 5-board cap | Dashboards load within the read budget |
| **9. Polish & hardening** | CSV import/export, templates, undo/redo, dark mode, a11y pass, PWA, error handling, **quota audit** (measured vs budget), Playwright smoke tests, final docs | Quota audit shows < 60% of free limits for the 15-user scenario |

---

## 10. Setup steps that need ME (write these into `SETUP.md`; walk me through them)

You can't do these yourself. Give me exact click-by-click instructions and wait for my confirmation:
1. Create a Firebase project on the **Spark** plan; enable Google sign-in; create Firestore in production mode (choose a region carefully, since it can't be changed later); register a web app and give me the config to paste into `.env`.
2. Install and log in to the Firebase CLI; deploy rules, indexes and Hosting.
3. Create the Apps Script project with `clasp`, link it to the Firebase project's Cloud project number, enable the Firestore API and Drive API, authorize scopes, deploy as a Web App, and set the URL in `.env`. Create the workspace Drive folder.
4. Add the authorized domain for Auth (Hosting domain) and, if relevant, a custom domain.

---

## 11. Working rules for Claude

- **Start in plan mode.** Show a plan for each phase before coding. Ask me questions in batches, not one at a time, and only for decisions that would be costly to reverse.
- **Never add a paid service or one that needs a billing card.** If a requirement seems to need one, stop and give me options.
- Keep a running `docs/DECISIONS.md` (decision, alternatives, reason). If you deviate from this spec, record why and tell me.
- TypeScript strict mode; no `any` without a comment; small, tested modules; meaningful commit messages after each phase.
- Test what matters: rules (all roles), formula engine, automation engine (including loop guard), fractional ordering, scheduler idempotency, and a Playwright smoke test of the happy path.
- Don't commit secrets, `.env` files or service-account keys. Firebase web config is public by design, but keep it in env files anyway.
- Verify any limit or API behavior you rely on against the official docs at implementation time, since free-tier quotas and Apps Script limits change. Don't rely on memory.
- If something in this spec is ambiguous or conflicts with a hard constraint, **ask me**. Don't guess.

---

## 12. Stretch goals (after v1)

Google Calendar two-way sync via Apps Script · Web push notifications (FCM send via Apps Script) · Board-to-board connect/mirror columns · Form view with public submissions (needs abuse protection) · Guest/client access · Critical-path analysis · Saved personal views · Slack/webhook notifications from Apps Script.
