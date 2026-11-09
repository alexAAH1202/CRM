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
- On start, the emulator is seeded so **`ada@example.com`** and
  **`grace@example.com`** may create workspaces. Sign in as either to create
  one. Any other email lands on "ask for an invite".
- "Continue with Google" opens the **emulator's** fake sign-in popup. Choose
  "Add new account" and enter any name and email. No real Google account is
  involved.
- Emulator data is saved to `firebase/emulator-data/` when you stop with Ctrl-C.
  Delete that folder to start fresh.
- The first run downloads the emulator JARs (about 60 MB) into
  `~/.cache/firebase`.

Other scripts:

| Command              | What it does                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run check`      | Everything CI runs: format check, lint, typecheck, unit tests, rules tests, build                       |
| `npm run test:e2e`   | Playwright browser test of the invite flow (starts `npm run dev` if it isn't running)                   |
| `npm test`           | Unit tests (Vitest)                                                                                     |
| `npm run test:rules` | Starts a throwaway Firestore emulator and runs the security-rules tests                                 |
| `npm run build`      | Production build into `firebase/public` (what Hosting serves), plus Apps Script into `apps-script/dist` |
| `npm run format`     | Prettier write                                                                                          |

**"Port taken" / emulators won't start:** a previous run left an emulator behind (this
happens after a test run is killed). Stop it, then try again:

```bash
pkill -f "firebase emulators"; pkill java
```

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

### B3b. Register the web app and get its config

1. In the Firebase console, open the project. Click the **gear icon** next to
   "Project Overview" (top-left), then **Project settings**.
2. Stay on the **General** tab and scroll to **Your apps** ("There are no apps
   in your project").
3. Click the **`</>`** (Web) icon.
4. **App nickname:** `web`. **Tick "Also set up Firebase Hosting for this
   app"**. A site dropdown appears; keep the default (your project ID).
   Click **Register app**.
5. **Add Firebase SDK:** the console shows `npm install firebase` and a code
   block containing `const firebaseConfig = { apiKey: "...", authDomain: "...",
projectId: "...", storageBucket: "...", messagingSenderId: "...", appId: "...",
measurementId?: "..." }`. **Copy the values of `apiKey`, `authDomain`,
   `projectId` and `appId`.** We don't use the others. Click **Next**.
6. **Install Firebase CLI / Deploy to Firebase Hosting:** click **Next**, then
   **Continue to console**. **Don't run `firebase init`.** The repo already has
   `firebase/firebase.json`, and init would overwrite it.
7. You can find the config again any time under Project settings → General →
   Your apps → `web` → **SDK setup and configuration → Config**.

Create `web/.env.local` in your local copy of the repo. It's gitignored. Copy
`web/.env.example` and fill it in:

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<project-id>
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

- Use no quotes and no spaces around `=`.
- This config is public by design: it identifies the project, and the security
  rules protect the data. Pasting it in chat is fine.
- `npm run build` refuses to run if these values are missing.
- `npm run dev` ignores them and keeps using the emulators.

### B3c. Automatic deploys from GitHub (no local computer needed)

Deploys run in GitHub Actions (`.github/workflows/deploy.yml`):

- **Automatically** on every push to `main`. Merging a phase's pull request
  deploys it.
- **Manually** from GitHub → **Actions** → **Deploy** → **Run workflow**.

Each run first runs the full `npm run check` (lint, types, unit tests and
security-rules tests). Only if that passes does it deploy the Firestore rules,
indexes and website.

For this, GitHub needs a Google Cloud **service account**: a robot account
limited to deploying. You set it up once, in a browser.

#### 1. Create the deploy account (Google Cloud console)

1. Open
   https://console.cloud.google.com/iam-admin/serviceaccounts?project=life-management-de315
   and sign in with the account that owns the Firebase project. Check that the
   project picker in the top bar shows **life-management-de315**.
2. Click **+ Create service account**.
   - **Service account name:** `github-deployer`. The ID fills itself in.
   - Click **Create and continue**.
3. **Permissions:** click **Select a role**, type each name below into the
   filter, and pick it. Click **+ Add another role** between them.
   - **Firebase Hosting Admin**
   - **Firebase Rules Admin**
   - **Cloud Datastore Index Admin**
   - **API Keys Viewer**
   - **Service Usage Consumer**

   Click **Continue**, then **Done**. Skip the "principals with access" step.

4. In the list, click the new **github-deployer@life-management-de315.iam.gserviceaccount.com**.
5. Open the **Keys** tab and choose **Add key → Create new key → JSON → Create**.
   A `.json` file downloads.

⚠️ That file is a password for deploying your project. **Don't paste it into
chat, email it, or commit it.** It only goes into GitHub's encrypted secrets
(next step). If it ever leaks, delete the key on the same Keys tab and create a
new one.

#### 2. Store it as a GitHub secret

1. Open https://github.com/alexAAH1202/CRM/settings/secrets/actions. You can
   also get there from the repo's **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**.
   - **Name:** `FIREBASE_SERVICE_ACCOUNT` (exactly this).
   - **Secret:** open the downloaded `.json` file in a text editor (Notepad,
     TextEdit), select all, copy, and paste it here. It starts with `{` and
     ends with `}`.
   - Click **Add secret**.
3. Delete the downloaded `.json` file from your computer, and empty the trash.

#### 3. Run the first deploy

Open https://github.com/alexAAH1202/CRM/actions/workflows/deploy.yml, click
**Run workflow** (keep the branch shown), then **Run workflow** again.

- The run takes about 3–4 minutes. A green tick means it worked.
- The site is at https://life-management-de315.web.app.
- If it fails, tell me. I can read the logs and fix it.

#### Alternative: deploy from your own computer

If you ever want a local copy:

1. Install Node 22 and Git.
2. Run `git clone https://github.com/alexAAH1202/CRM.git`, then `npm install`.
3. Create `web/.env.local` (values in `.github/workflows/deploy.yml`).
4. Run `npm run firebase -- login`.
5. Deploy with `npm run deploy:rules` and `npm run deploy:hosting`.

### B4. Apps Script helper (browser only)

Use the **same Google account that owns the Firebase project** for every step.
The helper runs as that account and uses its access to Firestore and Drive.

Steps B4.1–B4.3 can be done any time. B4.4–B4.6 need the Phase 7 code.

#### B4.1. Enable APIs (Google Cloud console)

1. Open https://console.cloud.google.com/apis/library?project=life-management-de315.
   The top bar should show **life-management-de315**.
2. Search **Cloud Firestore API** and open it. If it says **API Enabled**,
   that's fine; otherwise click **Enable**.
3. Go back, search **Google Drive API**, and click **Enable**.
4. Also check that **Identity Toolkit API** is enabled. Firebase Auth turns it
   on, and the helper uses it to verify sign-ins.

#### B4.2. OAuth consent screen ("Google Auth Platform")

1. Open https://console.cloud.google.com/auth/overview?project=life-management-de315
   and click **Get started**. If the menu still says "OAuth consent screen",
   it's the same thing.
2. **App information:** name `Sorted helper`; user support email: your
   email. Click **Next**.
3. **Audience:** choose **External**. Click **Next**.
4. **Contact information:** your email. Click **Next**, tick the agreement,
   then **Continue → Create**.
5. Open the **Audience** page and click **Publish app → Confirm**, so the
   status reads **In production**.
   - Don't leave it in **Testing**. In Testing, Google expires the
     authorization after 7 days and the scheduled jobs stop.
   - You do **not** need to submit for verification. Only your own account
     authorizes the script. You'll see a "Google hasn't verified this app"
     warning once, which is expected.

#### B4.3. Drive folder for workspace files

1. In https://drive.google.com click **New → New folder** and name it, for
   example, `Sorted files`.
2. Open the folder. The address bar shows
   `https://drive.google.com/drive/folders/<FOLDER_ID>`. Copy the long
   `<FOLDER_ID>` and send it to me. It isn't a secret.
3. Don't share the folder with anyone manually. The helper adds and removes
   workspace members as viewers automatically.

> ✅ **Done (2026-11-09).** Root folder ID:
> `1RinTNsHtgeK0yjycf339SL0TQ3S7gRcV`. Phase 7 stores it in the script's
> Script Properties as `DRIVE_ROOT_FOLDER_ID`. The helper creates one
> subfolder per workspace inside it.

#### B4.4. Create the script project (Phase 7)

1. Open https://script.google.com and click **New project**. Click "Untitled
   project" (top-left) and rename it `Sorted helper`.
2. **⚙ Project Settings** (left sidebar):
   - Tick **Show "appsscript.json" manifest file in editor**.
   - Under **Google Cloud Platform (GCP) Project**, click **Change project**.
     Enter the project number **290995869060** (Firebase console → Project
     settings → General → "Project number"), then **Set project**. This
     requires B4.2 to be done first.
3. **Editor** (`< >` icon):
   - Open `appsscript.json`, select all, and paste the manifest I give you.
   - Open `Code.gs`, select all, and paste the code file I give you.
   - Press **Ctrl+S** (or **Cmd+S**).
4. **Authorize:** pick `setup` from the function dropdown in the toolbar, then
   click **Run**.
   - Choose your account. At "Google hasn't verified this app" click
     **Advanced → Go to Sorted helper (unsafe)**, then **Allow**.
   - The scopes are Firestore, Drive, sending email, external requests and
     triggers. `setup` also creates the scheduled triggers.

#### B4.5. Deploy as a web app (Phase 7)

1. **Deploy → New deployment**. Click the ⚙ next to "Select type" and choose
   **Web app**.
2. Fill in the form:
   - **Description:** `v1`
   - **Execute as:** **Me (your email)**
   - **Who has access:** **Anyone**. This is required so the website can call
     it. Every request is still checked against a Firebase sign-in token (see
     DECISIONS D10).
3. Click **Deploy**, then copy the **Web app URL**, which ends in `/exec`, and
   send it to me. I'll add it to the deploy workflow as `VITE_APPS_SCRIPT_URL`.
   It isn't a secret.

#### B4.6. Updating the helper later

Paste the new code, save, then go to **Deploy → Manage deployments → ✏️
(edit) → Version: New version → Deploy**.

- **Don't** use "New deployment" for updates. That creates a new URL, and the
  website would still call the old one.
- Code changes take effect only after this step.

(Optional, later: this can be automated from GitHub Actions with clasp. It
needs a one-time `clasp login` token stored as a GitHub secret.)

### B5. Scheduled triggers

These are created automatically by the `setup` function in B4.4. To check
them, open the clock icon (**Triggers**) in the Apps Script editor. You should
see the scheduler (every 10 minutes), housekeeping (daily) and the digest
(daily).

### B6. Custom domain (optional, any time)

Go to Hosting → **Add custom domain** and follow the DNS steps. Then add the
domain under Authentication → Settings → Authorized domains.

---

## CI (GitHub Actions)

`.github/workflows/ci.yml` runs `npm run check` on every push and pull request.
It needs no secrets: rules tests run against the emulator with the `demo-app`
project.
