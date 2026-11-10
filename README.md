# Sorted

A colourful, shared life-admin organiser (bills, chores, renewals, plans) for a household or small group, built on a monday.com-style board engine. It runs entirely
on free tiers: the Firebase Spark plan plus a Google Apps Script helper.

- Product brief: [`PROJECT_SPEC.md`](PROJECT_SPEC.md)
- Getting started: [`docs/SETUP.md`](docs/SETUP.md). The short version:

  ```bash
  npm install
  ```

  ```bash
  npm run dev
  ```

  This uses local emulators and needs no cloud account.

- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Data model: [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)
- Quota budget: [`docs/QUOTA_BUDGET.md`](docs/QUOTA_BUDGET.md)
- Decisions log: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Backlog: [`docs/BACKLOG.md`](docs/BACKLOG.md)

- For the people using it: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)

## What it does

Households hold **lists** (bills, chores, renewals, maintenance, trips, purchases, goals or your
own), each with custom columns (status, people, dates, timelines, numbers, files, formulas,
dependencies, time tracking and more) and six views (table, Kanban, calendar, timeline, workload,
chart). Items have comments with @mentions, files in Google Drive, and an activity log. Automations
run instantly in the browser or on a clock through the Apps Script helper (reminders, recurring
chores), which also sends an optional daily email, backs everything up weekly to Drive and tidies up
nightly. Plus My work, search, a timesheet, dashboards, CSV import/export, undo/redo, dark mode,
phone layout and offline use.

## Status

All phases (0–9) are done. The quota audit (`e2e/quota-audit.spec.ts`, see
[`docs/QUOTA_BUDGET.md`](docs/QUOTA_BUDGET.md)) puts a busy 15-person household at about 30% of the
free daily reads (48% on a peak day) and 8% of writes.

## Checks

```bash
npm run check
```

```bash
npx playwright test
```
