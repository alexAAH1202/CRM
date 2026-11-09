# [APP_NAME]

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

## Status

| Phase                              | State   |
| ---------------------------------- | ------- |
| 0. Foundations                     | ✅ done |
| 1. Auth, workspace, invites, rules | ✅ done |
| 2. Boards & table view (2a + 2b)   | ✅ done |
| 3. Columns, formulas, dependencies | ✅ done |
| 4a. Saved views, Kanban, Calendar  | ✅ done |
| 4b. Gantt, Workload, Chart         | next    |
