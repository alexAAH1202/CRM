# Setup

There are two parts:

- **A. Local development.** Nothing to sign up for. This is all you need until
  you want to deploy.
- **B. Cloud setup.** One-time steps only you can do, because they need your
  Google account. Firebase console labels change from time to time; if a button
  name differs slightly, look for the closest match.

---

## A. Local development

Prerequisites:

- **Node 22+** (`.nvmrc`)
- **Java 21+** (the Firestore emulator needs it): `java -version`
- Git

```bash
npm install
```

```bash
npm run dev
```

- App: http://localhost:5173. It shows a purple "Emulators" badge in the header.
- Emulator UI: http://localhost:4000. Browse Firestore data and Auth users here.
- "Continue with Google" opens the **emulator's** fake sign-in popup. Choose
  "Add new account" and enter any name and email. No real Google account is
  involved.
- Emulator data is saved to `firebase/emulator-data/` when you stop with Ctrl-C.
  Delete that folder to start fresh.
- The first run downloads the emulator JARs (about 60 MB) into
  `~/.cache/firebase`.

Other scripts:

| Command              | What it does                                                                      |
| -------------------- | --------------------------------------------------------------------------------- |
| `npm run check`      | Everything CI runs: format check, lint, typecheck, unit tests, rules tests, build |
| `npm test`           | Unit tests (Vitest)                                                               |
| `npm run test:rules` | Starts a throwaway Firestore emulator and runs the security-rules tests           |
| `npm run build`      | Production build into `web/dist`, plus Apps Script into `apps-script/dist`        |
| `npm run format`     | Prettier write                                                                    |

Dev usage meter: set `VITE_USAGE_METER=true` in `web/.env.local`, or run
`localStorage.setItem('usageMeter','1')` in the browser console and reload. A
small R/W/D/L counter then appears bottom-right.

---

## B. Cloud setup

I'll ask you to do each step when the phase that needs it arrives:

- B1–B3 before the first deploy
- B4 and B5 in Phase 7

Reply "done" with the values I ask for after each one.

### B1. Create the Firebase project (Spark plan, no billing)

1. Go to https://console.firebase.google.com and sign in with the Google account
   that will **own** the app.
2. **Create a project.** Use any name, for example `teamboard-prod`. Note the
   **Project ID** shown under the name; you'll need it.
3. Turn **Google Analytics** off. We don't need it, and it adds setup.
4. When it finishes, check that the plan badge (bottom-left, or under the
   project name) says **Spark** (no-cost). **Never click "Upgrade".**

### B2. Enable Google sign-in

1. Go to **Build → Authentication → Get started**.
2. Open the **Sign-in method** tab, choose **Google → Enable**, pick your
   support email, then **Save**.
3. Open the **Settings → Authorized domains** tab. `localhost`,
   `<project-id>.web.app` and `<project-id>.firebaseapp.com` should already be
   listed. If you later use a custom domain (B6), add it here.

### B3. Create Firestore (choose the region carefully: it can't be changed)

1. Go to **Build → Firestore Database → Create database**.
2. **Edition:** if asked, choose **Standard**. The free quotas in
   QUOTA_BUDGET.md are for Standard.
3. **Database ID:** keep **`(default)`**. The free tier applies to the default
   database.
4. **Location:** choose **`australia-southeast2` (Melbourne)**. This is
   permanent. It keeps latency lowest for a Melbourne team, and data stays in
   Australia. (`australia-southeast1`, Sydney, would also be fine.)
5. **Security rules:** choose **production mode** (deny all). We deploy our own
   rules next.
6. Create the workspace-creator allowlist:
   1. **Start collection** → Collection ID `appConfig`.
   2. Document ID `workspaceCreators`.
   3. Add a field `emails`, type **array**, with two string entries:
      `alexwinch@gmail.com` and `aevans.osteo@gmail.com` (lowercase).
   4. Save.

### B3b. Register the web app and give me the config

1. Go to **Project settings** (gear icon) → **General** → **Your apps** →
   the **Web** icon (`</>`).
2. Use nickname `web`. Tick **"Also set up Firebase Hosting"**, then
   **Register app**.
3. The console shows a `firebaseConfig` object. Create `web/.env.local` (never
   committed) containing:

   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=<project-id>
   VITE_FIREBASE_APP_ID=...
   ```

   This config is public by design (it identifies the project; the security
   rules protect the data). It's fine to paste it to me in chat.

### B3c. Install the Firebase CLI and deploy

The CLI is already a dev dependency, so `npx firebase` works.

```bash
cd firebase
```

```bash
npx firebase login
```

```bash
npx firebase use --add
```

When prompted, pick your project and give it the alias `default`. This writes
`firebase/.firebaserc`, which is safe to commit.

Deploy the rules and indexes:

```bash
npm run deploy:rules
```

Build and deploy Hosting:

```bash
npm run deploy:hosting
```

The app is then live at `https://<project-id>.web.app`.

### B4. Apps Script helper (Phase 7, detailed instructions then)

The outline, so there are no surprises:

1. In the Google Cloud console for the **same project**, enable the
   **Cloud Firestore API** and the **Google Drive API**, and configure the
   OAuth consent screen (External, Testing, with yourself as a test user).
2. Install clasp: `npx clasp login`, then
   `npx clasp create --type webapp --rootDir dist` inside `apps-script/`.
   Copy `.clasp.json.example` if you prefer.
3. In the Apps Script editor go to **Project Settings → Google Cloud Platform
   (GCP) Project → Change project** and enter the Firebase project's **project
   number** (Firebase console → Project settings → General).
4. `npm -w apps-script run push`, then run a setup function once in the editor
   to authorize the scopes listed in `apps-script/appsscript.json`.
5. **Deploy → New deployment → Web app** (Execute as: Me; Who has access:
   Anyone). Copy the URL into `web/.env.local` as `VITE_APPS_SCRIPT_URL`.
6. Create a Drive folder for workspace files and share its ID with me.

### B5. Time-driven triggers (Phase 7)

These are created by a `setupTriggers()` function you run once from the editor.
Instructions will come with Phase 7.

### B6. Custom domain (optional, any time)

Go to Hosting → **Add custom domain** and follow the DNS steps. Then add the
domain under Authentication → Settings → Authorized domains.

---

## CI (GitHub Actions)

`.github/workflows/ci.yml` runs `npm run check` on every push and pull request.
It needs no secrets: rules tests run against the emulator with the `demo-app`
project.
