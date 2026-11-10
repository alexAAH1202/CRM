import { HelperError } from '@app/shared';
import { backupDue, lastBackups, type BackupResult } from './backup';
import { loadConfig } from './config';
import { runDigest, type DigestSummary } from './digest';
import { syncAllFolders } from './drive';
import { calendarStatus } from './calendar';
import { FirestoreClient } from './firestore';
import { runHousekeeping, type HousekeepingReport } from './housekeeping';
import type { Platform } from './platform';

const NIGHTLY_PROP = 'LAST_NIGHTLY';
const DIGEST_PROP = 'LAST_DIGEST';

export interface NightlyReport {
  housekeeping: HousekeepingReport;
  foldersChecked: number;
  backups: BackupResult[];
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 3am: tidy up, re-check Drive sharing, and back up anything not backed up this week. */
export function runNightly(p: Platform): NightlyReport {
  const cfg = loadConfig(p);
  const db = new FirestoreClient(p, cfg.projectId);
  const started = p.nowMs();
  const housekeeping = runHousekeeping(p, db, { budgetMs: 3 * 60_000 });
  let foldersChecked = 0;
  try {
    foldersChecked = syncAllFolders(p, cfg, db);
  } catch (e) {
    p.log(`Folder sync failed: ${msg(e)}`);
  }
  let backups: BackupResult[] = [];
  try {
    backups = backupDue(p, cfg, db, { deadline: started + 5 * 60_000 });
  } catch (e) {
    p.log(`Backups failed: ${msg(e)}`);
  }
  const report = { housekeeping, foldersChecked, backups };
  p.setProp(NIGHTLY_PROP, JSON.stringify({ at: new Date(p.nowMs()).toISOString(), ...report }));
  return report;
}

/** 7am: the daily emails. */
export function runMorning(p: Platform): DigestSummary {
  const cfg = loadConfig(p);
  const summary = runDigest(p, new FirestoreClient(p, cfg.projectId));
  p.setProp(DIGEST_PROP, JSON.stringify({ at: new Date(p.nowMs()).toISOString(), ...summary }));
  return summary;
}

export interface MaintenanceStatus {
  nightly: {
    at: string;
    deleted: number;
    problems: string[];
    backups: { ok: number; failed: number };
  } | null;
  digest: { at: string; sent: number; failed: number } | null;
  lastBackupAt: string | null;
  calendar: { at: string; items: number; failed: number; error: string | null } | null;
}

const parse = <T>(s: string | null): T | null => {
  try {
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
};

/** What the admin card shows: did the tidy-up, backup and digest run, and did anything go wrong. */
export function maintenanceStatus(p: Platform, workspaceId: string): MaintenanceStatus {
  if (!workspaceId) throw new HelperError('bad_request', 'A household is required.');
  const n = parse<{ at: string } & NightlyReport>(p.prop(NIGHTLY_PROP));
  const d = parse<{ at: string } & DigestSummary>(p.prop(DIGEST_PROP));
  const last = lastBackups(p)[workspaceId];
  return {
    nightly: n && {
      at: n.at,
      deleted: n.housekeeping.steps.reduce((s, x) => s + x.deleted, 0),
      problems: n.housekeeping.steps.filter((s) => s.error).map((s) => `${s.name}: ${s.error}`),
      backups: {
        ok: n.backups.filter((b) => b.ok).length,
        failed: n.backups.filter((b) => !b.ok).length,
      },
    },
    digest: d && { at: d.at, sent: d.sent, failed: d.failed },
    lastBackupAt: last ? new Date(last).toISOString() : null,
    calendar: (() => {
      const c = calendarStatus(p);
      return c && { at: c.at, items: c.items, failed: c.failed, error: c.error ?? null };
    })(),
  };
}
