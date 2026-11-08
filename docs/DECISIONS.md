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
