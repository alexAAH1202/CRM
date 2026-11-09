# Backlog

Ideas agreed with the product owner that aren't scheduled yet. Raise them
again at the end of each phase.

## Board templates (Phase 2 ships 6; these are next)

The app is for **household life admin** (bills, chores, renewals, plans), not a
workplace.

Phase 2 ships these templates: Household chores · Bills & subscriptions ·
Renewals & documents · Home maintenance · Trip planner · Blank.

To offer again after Phase 2 (decided 2026-11-09):

| Template                    | Groups                            | Key columns                             |
| --------------------------- | --------------------------------- | --------------------------------------- |
| 🗓️ Appointments             | Health · Car · Pets · Other       | Date, Who, Where, Status, Notes         |
| 🛒 Big purchases & wishlist | Researching · Saving for · Bought | Budget, Priority, Link, Status          |
| 🍽️ Meal planning            | This week · Next week · Recipes   | Day, Who's cooking, Ingredients, Status |
| 🎯 Goals & projects         | Now · Next · Someday              | Owner, Timeline, Progress/Status, Notes |

## Reminder ideas for Phase 7 (scheduled automations)

- "Passport / licence / insurance expires in N days" (Renewals board)
- "Bill due in N days" and "not yet marked paid" (Bills board)
- Recurring chores and maintenance that recreate themselves when marked done

## Folded into Phase 7 (agreed after the Phase 6 review, 2026-11-09)

The Apps Script helper is the right home for these, so Phase 7 includes them alongside
scheduled automations, Drive uploads and email digests:

1. **Weekly backup.** The free Firebase plan has no automatic backups or point-in-time
   recovery. A scheduled job exports every board (items, comments, activity, automations) as
   JSON to the Drive folder, keeping the last N copies, with a restore note in SETUP.
2. **Housekeeping / pruning.** Cap and prune `activity` (per board) and `automationRuns`;
   purge soft-deleted item tombstones after 30 days; prune read notifications after 30 days.
   (Run history is already trimmed to 50 by editors when a board opens; see D63.)
3. **Search index.** Today's search only covers boards opened on this device (zero reads).
   The helper can keep a small per-workspace index doc of item names so search works across
   every board without reading every item.
4. **CSV import** (export shipped in the hardening round): map headers to columns, preview,
   then create items through the board counter.
5. **Rules tightening** left over from the review: format-limit notification text, bound
   the size of stored `conditions`/`actions`, and check that mentioned uids are members.
6. **Reminders** (see above) and the **template ideas** (re-offer these when Phase 7 starts).

Done after Phase 7 (D85–D87): bulk edits run automations (up to 25 items), Kanban cards can be
reordered within a lane, and there is general undo/redo.
