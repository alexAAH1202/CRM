/**
 * Sorted helper: Apps Script web app + time-driven triggers.
 *
 * The browser POSTs JSON (Content-Type text/plain, so no CORS preflight; Apps Script can't
 * answer OPTIONS). Every request except `ping` carries a Firebase ID token that is verified
 * here before anything happens (see router.ts / auth.ts).
 */
import { DEFAULT_DRIVE_ROOT, TIME_ZONE, VERSION, loadConfig } from './config';
import { syncAllFolders } from './drive';
import { FirestoreClient } from './firestore';
import { gasPlatform } from './gas';
import { handleRequest } from './router';
import { runDueEvents } from './scheduler';

function json(body: unknown): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/** Opening the web app URL in a browser shows this: a quick "is it deployed?" check. */
export function doGet(): GoogleAppsScript.Content.TextOutput {
  return json({
    ok: true,
    data: { name: 'Sorted helper', version: VERSION, at: new Date().toISOString() },
  });
}

export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  return json(handleRequest(gasPlatform(), e?.postData?.contents));
}

// ---------------------------------------------------------------------------------------------
// Triggers (scheduler: 7b; housekeeping and digest fill in with 7d).
// ---------------------------------------------------------------------------------------------

/** Every 10 minutes: run whatever scheduled automations have come due. Cheap when there's nothing to do. */
export function runScheduler(): void {
  try {
    const sum = runDueEvents(gasPlatform());
    if (sum.due > 0) console.log(`Scheduler: ${JSON.stringify(sum)}`);
  } catch (e) {
    // Never throw out of a trigger: Apps Script would email a failure notice for every run.
    console.error(`Scheduler failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  }
}
export function runHousekeeping(): void {
  try {
    const p = gasPlatform();
    const cfg = loadConfig(p);
    const n = syncAllFolders(p, cfg, new FirestoreClient(p, cfg.projectId));
    console.log(`Housekeeping: Drive sharing checked for ${n} workspace(s).`);
  } catch (e) {
    console.error(
      `Housekeeping failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
    );
  }
}
export function runDigest(): void {
  console.log('Digest tick (nothing to send yet).');
}

const HANDLERS = ['runScheduler', 'runHousekeeping', 'runDigest'] as const;

/**
 * Run once from the editor (after pasting the code): stores settings, then (re)creates the
 * time-driven triggers. Safe to run again at any time: it replaces the triggers rather than
 * adding duplicates.
 */
export function setup(): void {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('DRIVE_ROOT_FOLDER_ID'))
    props.setProperty('DRIVE_ROOT_FOLDER_ID', DEFAULT_DRIVE_ROOT);

  for (const t of ScriptApp.getProjectTriggers())
    if ((HANDLERS as readonly string[]).includes(t.getHandlerFunction()))
      ScriptApp.deleteTrigger(t);

  ScriptApp.newTrigger('runScheduler').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('runHousekeeping')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .inTimezone(TIME_ZONE)
    .create();
  ScriptApp.newTrigger('runDigest')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .inTimezone(TIME_ZONE)
    .create();

  console.log(
    `Sorted helper ${VERSION} is set up. Triggers: scheduler every 10 min, housekeeping 3am, digest 7am (${TIME_ZONE}).`,
  );
}
