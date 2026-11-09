# Architecture

## Overview

```
                   ┌──────────────────────────── Browser (PWA) ────────────────────────────┐
                   │  React 18 + TS + Tailwind                                              │
                   │  ├─ UI state: Zustand            ├─ Data: Firestore SDK (onSnapshot,   │
                   │  ├─ Routes: React Router (lazy)  │   persistent IndexedDB cache)         │
                   │  ├─ Instant automations engine ──┘   all calls via lib/firestore (metered)│
                   │  └─ Apps Script client (fetch, text/plain, ID token in body)          │
                   └───────┬──────────────────────┬──────────────────────────┬─────────────┘
                           │ static files          │ reads/writes (rules)     │ HTTPS POST
                 ┌─────────▼────────┐   ┌─────────▼──────────┐   ┌───────────▼──────────────┐
                 │ Firebase Hosting │   │ Cloud Firestore    │◄──┤ Apps Script web app      │
                 │ (SPA, CDN)       │   │ + Security Rules   │   │ (execute as owner)       │
                 └──────────────────┘   └────────────────────┘   │ ├─ verify ID token       │
                 ┌──────────────────┐            ▲ REST (IAM)    │ ├─ scheduler (10 min)    │
                 │ Firebase Auth    │            └───────────────┤ ├─ Drive uploads/sharing │
                 │ (Google only)    │                            │ ├─ email digests         │
                 └──────────────────┘                            │ └─ housekeeping (daily)  │
                                                                 └──────────────────────────┘
```

Everything runs on the Firebase **Spark** plan plus a consumer Apps Script
project, so there are no servers and no billing account.

## Repository

| Path           | What                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `web/`         | React app (Vite). `src/lib/firestore` is the only place that talks to Firestore.                |
| `shared/`      | Types, constants and the colour palette, imported by web, rules tests and (Phase 7) Apps Script |
| `firebase/`    | `firebase.json`, `firestore.rules`, `firestore.indexes.json`, rules tests (Vitest + emulator)   |
| `apps-script/` | clasp project: TS compiled by `tsc` into `dist/`, which is pushed                               |
| `docs/`        | This file, DATA_MODEL, QUOTA_BUDGET, SETUP, DECISIONS                                           |

## Environments

- **Local dev (`npm run dev`)** runs the Firebase Emulator Suite (Auth 9099,
  Firestore 8080, Hosting 5050, UI 4000) under project ID `demo-app`, plus Vite
  on 5173. The `demo-` prefix means the emulators can't reach a real project, so
  development never uses cloud quota. Emulator data is saved to
  `firebase/emulator-data/` on exit (gitignored).
- **Production** is built with `npm run build` and deployed with
  `firebase deploy` from `firebase/`. The Firebase web config comes from
  `web/.env.local` (see SETUP.md).
- In dev, the app connects to the emulators unless `VITE_USE_EMULATORS=false`.
  An emulator-only `window.__emulatorSignIn(email, name)` hook lets e2e tests
  sign in as any verified Google user without the OAuth popup.

## Client layers

1. **`lib/firebase.ts`:** app init, Firestore with
   `persistentLocalCache({ tabManager: persistentMultipleTabManager() })`, Auth,
   and the emulator wiring.
2. **`lib/firestore/`:** metered wrappers: `readDoc`, `readQuery`, `listenDoc`,
   `listenQuery` and `createBatch`. An ESLint `no-restricted-imports` rule bans
   raw `getDoc/getDocs/onSnapshot/setDoc/updateDoc/deleteDoc/writeBatch/...`
   everywhere else, so the dev usage meter sees all traffic.
3. **Feature hooks** (from Phase 1): small hooks per data slice, e.g.
   `useWorkspace`, `useBoards`, `useBoardItems`. They own listener lifecycles:
   attach on mount, detach on unmount. Only the open board and the user's
   inbox are live.
4. **UI state:** Zustand stores for things that never go to Firestore (theme,
   toasts, selection, undo stack).
5. **Design system:** `components/ui` (Button, Pill, Avatar, Popover, Modal,
   SidePanel, Toaster, EmptyState, Skeleton/Spinner). Tokens are CSS variables
   in `styles/index.css`, mapped to Tailwind names. Every text/background token
   pair is checked for WCAG AA by `styles/tokens.test.ts`, and label colours by
   `shared/src/palette.test.ts`.

## Read path: delta sync (Phase 2)

Firestore re-bills a listener's whole result set if it's been detached for more
than 30 minutes (QUOTA_BUDGET §2). So boards load like this:

1. Render immediately from cache: `getDocsFromCache(items of board)`.
2. Look up `lastSyncedAt[boardId]` (stored locally, in server-time terms).
   - **Missing or older than 30 days, or the cache came back empty:** attach a
     full listener on the board's non-archived items, then record the newest
     `updatedAt` seen.
   - **Otherwise:** attach `items where updatedAt > lastSyncedAt − 2 min` (a
     safety margin for clock and commit skew). It returns only what changed
     and keeps streaming live changes.
3. Merge into the in-memory board model. Tombstoned items (`deletedAt != null`)
   are removed from view.
4. Detach when the user leaves the board.

Rules require `updatedAt == request.time` on every item write, which is what
makes this correct.

## Write path

- All writes go through `createBatch(label)`. Even a single field edit is a
  one-op batch, so that **instant automations** (Phase 6) can add their effects
  to the same atomic commit. A loop guard (depth ≤ 3, plus a `causedBy` marker)
  stops automations re-triggering each other.
- UI updates are optimistic: Firestore's latency compensation applies local
  writes to listeners immediately.
- Text saves on blur or Enter. Drags write once, on drop. Bulk actions are
  split into batches of up to 500.
- Undo/redo (Phase 9) keeps inverse batches in a session-only Zustand stack.

## Security

- The browser is untrusted. **Every permission is enforced in
  `firestore.rules`**, and every rule is covered by emulator tests in
  `firebase/tests`.
- Each rule does one membership `get()`, plus one board `get()` for board
  content. Roles: Admin / Member / Viewer. Admins can see every private board.
- Workspace creation is restricted to the emails in
  `appConfig/workspaceCreators`, a doc edited only in the console.
- Apps Script verifies the Firebase ID token sent in the JSON body. It then
  checks membership through the Firestore REST API. It never trusts a uid or
  role sent by the client.

## Apps Script helper (Phase 7)

- Deployed as a web app (execute as the owner; access: anyone). Auth comes from
  the ID token, because a cross-origin `fetch` can't carry the user's Google
  session.
- The browser calls it with `fetch(url, { method: 'POST', headers: { 'Content-Type':
'text/plain;charset=utf-8' }, body: JSON })`. This avoids a CORS preflight,
  which Apps Script can't answer.
- Time-driven triggers:
  - Scheduler, every 10 min. It exits early when there's no due work and stops
    itself at about 4 min. It's idempotent, using `idempotencyKey` plus a
    status transition.
  - Daily housekeeping (pruning).
  - Daily digest (at most 80 emails).
- Uploads arrive in base64 chunks, are assembled in `CacheService`, and are
  written to the workspace's Drive folder.

## Performance budget

- First load: about 270 KB gzip, mostly Firebase, in a separately cached chunk.
  Each route chunk should stay under 30 KB gzip.
- Large boards: TanStack Virtual rows, groups loaded per group with "load more".
- No layout shift: skeletons have fixed dimensions.
