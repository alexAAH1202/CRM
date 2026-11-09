# Free-tier quota budget

> Limits were checked against the official pages on **2026-11-08** (each page
> showed "Last updated 2026-11-05", except Apps Script: "2026-09-03"). Check
> them again before each phase that adds a new kind of usage. Quotas change
> without notice.

## 1. Current limits

### Firebase Spark (no billing account)

Sources: firebase.google.com/pricing, /docs/firestore/pricing, /docs/firestore/quotas,
/docs/hosting/usage-quotas-pricing

| Service                        | Spark limit                                                  | Notes                                                                   |
| ------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Firestore stored data          | **1 GiB** total                                              | Standard edition                                                        |
| Firestore document reads       | **50,000 / day**                                             | Includes rule `get()`/`exists()` reads and the 1-read minimum per query |
| Firestore document writes      | **20,000 / day**                                             |                                                                         |
| Firestore document deletes     | **20,000 / day**                                             | TTL deletes count here                                                  |
| Firestore network egress       | **10 GiB / month**                                           |                                                                         |
| Firestore composite indexes    | 200 (without billing)                                        |                                                                         |
| Rules `get/exists` per request | 10 (single doc/query), 20 (batch/transaction)                |                                                                         |
| Auth (Google provider)         | **50,000 MAU**                                               |                                                                         |
| Hosting storage                | **10 GB**                                                    | Spec assumed 1 GB; it is now 10 GB                                      |
| Hosting data transfer          | **360 MB / day**                                             | About 10.8 GB/month                                                     |
| Cloud Functions                | **Not available on Spark**                                   | As the spec assumed                                                     |
| Cloud Storage                  | **Not available on Spark** (pricing table: "Not applicable") | We use Drive through Apps Script                                        |
| App Hosting                    | Needs billing                                                | We use classic Firebase **Hosting**                                     |

On Spark, when a quota runs out, that service stops until the daily reset
(midnight US Pacific). No bill is generated.

### Apps Script (consumer gmail.com account)

Source: developers.google.com/apps-script/guides/services/quotas

| Limit                               | Consumer account            |
| ----------------------------------- | --------------------------- |
| Script runtime                      | **6 min / execution**       |
| Triggers total runtime              | **90 min / day**            |
| URL Fetch calls                     | **20,000 / day**            |
| URL Fetch POST size / response size | 50 MB / call each           |
| Email recipients (MailApp)          | **100 / day** (our cap: 80) |
| Email recipients per message        | 50                          |
| Properties read/write               | 50,000 / day                |
| Properties value size / total       | 9 KB / 500 KB per store     |
| Triggers                            | **20 / user / script**      |
| Simultaneous executions             | 30 / user                   |

Apps Script quotas reset 24 h after the first request, not at a fixed time.

## 2. Billing behaviours the design depends on

These come from the Firestore pricing page and drive the design decisions below.

1. **Listener resume:** with offline persistence on, a listener that has been
   **disconnected for more than 30 minutes is billed as a brand-new query.**
   Every result document is billed again, even though it's already cached.
   Reattaching within 30 minutes bills only the changes.
2. **Each query costs at least 1 read**, even with no results.
3. **Aggregations** (`count/sum/avg`) cost 1 read per 1,000 index entries, with
   a minimum of 1.
4. **Rule lookups are billed.** Each `get()`/`exists()` costs 1 read per
   request, and repeat lookups of the same doc in one request are cached. For
   listeners, rules are re-evaluated (and billed) on every result update, on
   reconnect, after a rules deploy, and whenever a doc the rules depend on
   changes.
5. Deleted documents leaving a listener aren't billed. Changed documents leaving
   one are.
6. REST calls from Apps Script authenticate with IAM (OAuth token), so **rules
   aren't evaluated and add no rule reads.**

## 3. Design responses

| Risk                                                                       | Response                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reopening a board after more than 30 min re-bills every item (behaviour 1) | **Delta sync.** Render from the IndexedDB cache, then listen only to `items where updatedAt > lastSyncedAt`. Deletes are soft tombstones. A full resync happens only on first visit, after cache eviction, or after 30 days. |
| Board-doc writes fan out to every user's sidebar listener                  | Views, column widths and the item counter live in separate docs (see DATA_MODEL)                                                                                                                                             |
| Rule `get()` costs                                                         | Exactly 1 membership `get` per request, plus 1 board `get` for board content. Never per document.                                                                                                                            |
| Dashboards                                                                 | Aggregation queries where possible; one-shot cached reads otherwise; never live listeners; maximum 5 boards                                                                                                                  |
| Writes                                                                     | Save text on blur or Enter; save drags on drop; bulk actions in one `writeBatch`; automations join the same batch                                                                                                            |
| Unbounded growth                                                           | Activity and automation runs are capped and pruned daily; read notifications are pruned after 30 days; tombstones are purged after 30 days                                                                                   |
| Hosting transfer                                                           | Hashed assets with `immutable` caching; `index.html` is `no-cache` (~1 KB); route-level code splitting; system fonts (0 bytes)                                                                                               |

## 4. Estimate: 15 active users, busy workday

### Assumptions

- 1 workspace, 10 active boards × **150 items each** (including subitems) = 1,500 items
- Per user per day: 4 cold app sessions, **10 board opens** (about 4 distinct
  boards), 40 item edits, 10 comments, 20 item-panel opens, 3 dashboard views,
  3 My Work views
- On average, 2 other people have the same board open when an edit happens
- Rule overhead: +1 read per item listener update; about +10% on one-shot reads

### Reads per day

| Source                                                        | Formula                                                                                                       |    With delta sync | Naive listeners (no delta) |    No cache at all |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -----------------: | -------------------------: | -----------------: |
| Session start (user, member, workspace, sidebar of 10 boards) | 15 users × 4 × ~18                                                                                            |              1,080 |                      1,080 |              1,080 |
| Board opens                                                   | delta: 15 × 10 × ~15 changed; naive: 6 of 10 opens are after 30 min × 150 items + 4 × 15; none: 15 × 10 × 150 |              2,250 |                     14,400 |             22,500 |
| Live updates to other open listeners (+ rule read)            | 600 edits × 2 listeners × 2                                                                                   |              2,400 |                      2,400 |              2,400 |
| Item panel: comments (about 5 per item + query minimum)       | 15 × 20 × 6                                                                                                   |              1,800 |                      1,800 |              1,800 |
| Item panel: activity tab (limit 20)                           | 15 × 5 × 21                                                                                                   |              1,575 |                      1,575 |              1,575 |
| Notifications inbox (limit 20 per cold start + new ones)      | 15 × 4 × 20 + 300                                                                                             |              1,500 |                      1,500 |              1,500 |
| Dashboards (aggregations + table widgets)                     | 15 × 3 × (8 + 40)                                                                                             |              2,160 |                      2,160 |              2,160 |
| My Work (1 query per board)                                   | 15 × 3 × 10 × 2                                                                                               |                900 |                        900 |                900 |
| Search                                                        | estimate                                                                                                      |                500 |                        500 |                500 |
| Rule overhead on one-shot reads                               | about 10%                                                                                                     |              1,000 |                      1,000 |              1,000 |
| Apps Script scheduler (144 runs × 1 minimum + events)         | 144 + ~150                                                                                                    |                300 |                        300 |                300 |
| **Total**                                                     |                                                                                                               | **≈ 15,500 (31%)** |         **≈ 27,600 (55%)** | **≈ 35,700 (71%)** |

**Conclusion:** without delta sync, a normal day lands at 55%. Any busy day
would go over the 60% target, and an uncached client would exceed it outright.
**With delta sync, we expect ~31% on a normal day and ~46% on a 1.5× peak
day, inside the 60% target.** Delta sync is therefore a core Phase 2 feature,
not an optimisation for later (see DECISIONS D5).

### Writes and deletes per day

| Source                                            |                  Writes |
| ------------------------------------------------- | ----------------------: |
| Item edits and creates                            |                     600 |
| Comments                                          |                     150 |
| Notifications (about 2 per comment or assignment) |                     300 |
| Activity log (meaningful events only)             |                     300 |
| Automation side effects and run history           |                     200 |
| Timers and time sessions                          |                     100 |
| Board, view and member changes                    |                      50 |
| Scheduled events (create + mark done)             |                     150 |
| **Total**                                         | **≈ 1,850 (9% of 20K)** |

Deletes: daily pruning of activity, runs, old notifications and tombstones runs
to about 1,000 or less (5% of 20K).

### Storage, egress, hosting, auth

- **Firestore storage:** 1,500 items × ~2 KB, plus comments, activity and
  indexes, comes to roughly 20 MB in year one. That's under 2% of 1 GiB.
- **Firestore egress:** about 15K reads × ~2 KB ≈ 30 MB/day ≈ 0.9 GB/month,
  9% of 10 GiB.
- **Hosting transfer:** a cold first load is ~270 KB gzip (measured in Phase 0:
  firebase 183 KB, react 59 KB, app 15 KB, CSS 5 KB). Normal days are ~1 KB HTML
  per session, plus lazy route chunks the first time. Deploy day (everyone
  re-downloads): 15 users × 2 devices × 300 KB ≈ 9 MB, 2.5% of 360 MB/day.
- **Auth:** 15 MAU out of 50,000.

### Apps Script

| Item                                                                    | Estimate    | Limit        |   % |
| ----------------------------------------------------------------------- | ----------- | ------------ | --: |
| Scheduler runtime: 144 runs × ~3 s, plus housekeeping and digest ~3 min | ~10 min/day | 90 min       | 11% |
| URL Fetch: scheduler ~2/run, plus uploads, ID-token checks, digests     | ~1,000/day  | 20,000       |  5% |
| Emails: 1 digest per user + optional morning digest                     | ≤ 30/day    | 100 (cap 80) | 30% |
| Triggers: scheduler, housekeeping, digest                               | 3           | 20           | 15% |

## 5. Measured costs

These are filled in as phases land. The dev usage meter (`VITE_USAGE_METER=true`
or `localStorage.usageMeter = '1'`) shows per-session estimates by label. It
can't see rule reads or the over-30-minute re-billing, so Phase 9 compares it
against the Firebase console's usage tab.

| Measurement                                                | Phase | Result                                                                                                                                                                    |
| ---------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule `get()` cost per membership-gated request             | 1     | _to measure_                                                                                                                                                              |
| Board open: cold / warm / delta (see the table below)      | 2     | measured                                                                                                                                                                  |
| Dashboard load (1 list of 7 items, 9 widgets, warm reload) | 9     | 14 reads: 2 aggregation counts, the list document, plus the usual start-up reads; the items came from the device cache (a cold load adds one read per item in each list). |
| Full 15-user scenario vs this budget                       | 9     | _to measure_                                                                                                                                                              |

### Measured app-side costs (Phases 1–6)

Measured by `e2e/quota-5.spec.ts` against the emulator with the usage meter (which counts
what the client observes: it can't see rule `get()` reads). The test also fails if a flow
becomes much dearer. Template board = 7 items.

| Flow                                         | Reads | Writes | Notes                                                              |
| -------------------------------------------- | ----: | -----: | ------------------------------------------------------------------ |
| Create a board from a template               |     3 |     10 | board, view, counter, 7 items                                      |
| Reload a board with a warm cache             |    10 |      0 | all 10 are the app shell (user, members, invites…); **items: 0**   |
| Open a board cold (7 items)                  |    16 |      0 | shell ~9 + items 7 (+ views 1, automations 1)                      |
| A teammate edits one cell (you have it open) |     1 |      0 | delta sync: only the changed item                                  |
| 5 of your own cell edits                     |    10 |     10 | 1 item write + 1 activity write each; **+1 read each** (see below) |
| Open an item panel, post a comment + mention |     3 |      2 | comment + the mention's notification                               |
| Open My work (1 board with matches)          |     2 |      0 | 1 per board queried + matches                                      |
| Back to workspace home (warm)                |     0 |      0 | served from cache                                                  |

**Finding:** your own edits come back through your own board listener and the meter counts
them as reads (about 1 per edit). Whether Firestore bills that echo isn't something the
emulator can show, so we budget it as billed (conservative); Phase 9 checks the console.
The earlier model missed it.

**Revised daily total, 15 users:** the Section 4 table plus 600 reads for own-edit echoes
(15 × 40) plus ~300 for the new per-board listeners (views, automations: 15 × 10 × 2)
brings the with-delta-sync total from ≈ 15,500 to **≈ 16,400 reads (33% of 50K)**. Still
inside the 60% target (≈ 49% on a 1.5× peak day). Writes are unchanged at ≈ 1,850 (9%),
which already counted the activity log. The measured session start (~10 reads) is below the
18 the model assumed.

## 6. Phase 1: rule lookups and sign-in cost (from the rules)

The emulator doesn't report billing, so these counts come from the rules
themselves: the distinct documents each rule `get()`s. The Firebase console's
usage tab will confirm them in Phase 9.

| Request                                         | Extra reads billed by rules                                       |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| Read workspace, members or invites (member)     | 1: `members/{me}`                                                 |
| Read a board, or list boards for the sidebar    | 1: `members/{me}`                                                 |
| Item, view or counter query, or listener update | 2: `members/{me}` + board doc                                     |
| Create a notification                           | 2: `members/{me}` + recipient's member doc                        |
| Accept an invite (once per person)              | about 2: the invite, plus workspace/member docs in the same batch |
| Create a workspace (rare)                       | 1: `appConfig/workspaceCreators`                                  |
| Collection-group "my workspaces" / "my invites" | 0 (rules check only the doc's own fields)                         |

**Cost of one app start (cold):**

| Read                                    | Count                |
| --------------------------------------- | -------------------- |
| `users/{me}` (profile sync)             | 1                    |
| `users/{me}` again (last workspace)     | 1                    |
| Memberships query                       | 1 + N workspaces     |
| Workspace names                         | N                    |
| Invites query                           | 1                    |
| Workspace-creator check                 | 1                    |
| Workspace doc + my member doc listeners | 2, plus 2 rule reads |

For N = 1 that's about **11 reads per cold start**. The estimate in §4
assumed 18, so it holds. Writes per start: 0–1 (the profile sync writes only
when something changed, and the last-workspace write only happens when you
switch workspace). The members page adds one live listener (N members + 1
rule read), and admins get one more for pending invites.

## 7. Phase 2b additions (from the code, to be confirmed in Phase 9)

New always-on listeners while a workspace is open (each costs one read on attach plus
one per change; rules add the lookups in §6):

| Listener                  | Scope          | Typical reads                               |
| ------------------------- | -------------- | ------------------------------------------- |
| `folders`                 | workspace      | a handful (one per folder)                  |
| `users/{me}` (favourites) | per user       | 1, plus 1 per favourite toggle              |
| `views/main`              | per open board | 1, plus 1 per saved view change (debounced) |

Write costs of the new actions:

| Action                                        | Writes                                     |
| --------------------------------------------- | ------------------------------------------ |
| Filter / sort / group / column width change   | 1 (view doc), after a 600 ms pause         |
| Drag an item or group                         | 1 (plus its subitems for an item)          |
| Bulk set / archive / delete / move on N items | N (+ subitems), batches of 100             |
| Duplicate N items                             | N copies (+ subitems) + 1 counter          |
| Duplicate a board of 150 items                | about 150 + 3, read cost ~150 for the scan |
| Change a column's type                        | 1 board write + up to N item writes        |
| Add/remove favourite, folder create/rename    | 1 each                                     |

These are all user-initiated and occasional; the 15-user daily estimate in §4 (about 1,850
writes, 31% of reads) is unchanged by them. A one-off duplicate of a large board costs about
a tenth of a day's reads, so it's worth knowing but not a risk.

## Phase 5a additions

| Listener / read                   | When                             | Cost                                  |
| --------------------------------- | -------------------------------- | ------------------------------------- |
| My notifications (newest 30)      | While a workspace is open        | ≤30 reads on first open, then deltas  |
| Item updates (newest 100)         | Only while an item panel is open | ≤100 reads, then deltas; cached after |
| Mention / assignment notification | One write each, same batch       | 1 write per person notified           |

A comment that mentions 2 people is 3 writes. Muted types are still written (filtered on the
recipient's side), so muting does not save writes, only noise.

## Phase 5b additions

| Read / write                   | When                                               | Cost                                                              |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------- |
| Activity entry                 | Each status/people/date edit, create, delete, move | +1 write, same batch                                              |
| Item / board activity listener | Only while that tab/panel is open                  | ≤30 / ≤50 reads, then deltas                                      |
| My Work                        | On opening the page (1-min reuse)                  | 1 read per board + 1 per matching item + 1 per board with matches |
| Search                         | Opening the palette                                | 0 (local cache only)                                              |

For 15 users making ~40 logged edits each per day the log adds ~600 writes/day (3% of the
20K daily write quota).

## Phase 6 additions

| Read / write         | When                                           | Cost                        |
| -------------------- | ---------------------------------------------- | --------------------------- |
| Automations listener | While a board is open                          | ≤20 small docs, then deltas |
| Run history listener | Only while the Automations panel is open       | ≤100 reads, then deltas     |
| Run record           | Each automation execution (ran/failed/skipped) | +1 write, same batch        |
| Action writes        | Item updates, new items, notifications         | 1 write each, same batch    |

A busy automation (fires 100×/day) adds ~100–300 writes/day. Run history is trimmed to 50, so
it never grows. Edits on boards with item-creating automations use a transaction (1 extra read
of the counter).

## Phase 7b additions

| Read / write / fetch                       | When                          | Cost                                                                                                                  |
| ------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Scheduler tick, nothing due                | every 10 min (144/day)        | 1 query = 1 read, 1 URL Fetch (144/day of 20,000)                                                                     |
| Event registered/updated/removed (browser) | with the edit that implies it | 1 write per scheduled automation per changed item                                                                     |
| An event fires                             | when due                      | ~4 reads (workspace, board, members, automations) + the board's items (≤150) once per board per tick; 1 atomic commit |
| A recurring "every item" run               | when due                      | the items are already loaded; 1 write per changed item                                                                |

A board with 20 bills and a 3-day reminder costs 20 writes to register, then ~170 reads on the day
they fire. Typical household use stays well under 1% of the daily read quota. Idle cost is ~144 reads
and ~144 fetches a day.

## Phase 7d background work (helper)

| Job           | When         | Cost                                                                                                                                              |
| ------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tidy-up       | 3am daily    | A few queries; deletes are writes/deletes (20,000 free a day), capped at 2,000 per step per night                                                 |
| Weekly backup | one night/wk | Reads every document in each workspace once (about 1 read per document; a household with 5,000 docs = 5,000 reads of the 50,000 daily free reads) |
| Daily emails  | 7am daily    | Per opted-in person: one query per board (their items only) and one for unread notifications                                                      |
| Email quota   | daily        | Capped at 80 emails a day (Google allows about 100 for a normal account)                                                                          |
| CSV import    | on demand    | One write per item plus one counter write per 100 items; reads: one counter read per batch                                                        |
