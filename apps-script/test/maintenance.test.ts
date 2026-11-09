import { describe, expect, it } from 'vitest';
import { backupDue, asciiJson, BACKUPS_TO_KEEP } from '../src/backup';
import { loadConfig } from '../src/config';
import { composeDigest, runDigest } from '../src/digest';
import { FirestoreClient } from '../src/firestore';
import { runHousekeeping } from '../src/housekeeping';
import { runMorning, runNightly, type maintenanceStatus } from '../src/nightly';
import { handleRequest } from '../src/router';
import { FakeDrive } from './fakeDrive';
import { FakeFirestore } from './fakeFirestore';
import { fakeJwt, fakePlatform, json } from './fakes';

const NOW = Date.parse('2026-03-17T20:00:00Z'); // 7am 18 March in Melbourne
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY);

function world() {
  const fs = new FakeFirestore();
  fs.now = () => new Date(NOW);
  const drive = new FakeDrive();
  const f = fakePlatform({
    now: NOW,
    respond: (req) => drive.respond(req) ?? fs.respond(req),
  });
  const cfg = loadConfig(f.p);
  const db = new FirestoreClient(f.p, cfg.projectId);
  return { fs, drive, f, db, cfg };
}

const board = {
  name: 'Bills',
  visibility: 'workspace',
  memberIds: [],
  archived: false,
  columns: [
    { id: 'due', type: 'date', title: 'Due date', settings: {} },
    {
      id: 'st',
      type: 'status',
      title: 'Status',
      settings: {
        labels: [
          { id: 'todo', name: 'To do', color: 'gray' },
          { id: 'done', name: 'Done', color: 'green' },
        ],
      },
    },
  ],
  groups: [{ id: 'g', name: 'G', color: 'blue' }],
};

describe('housekeeping', () => {
  function seed(w: ReturnType<typeof world>) {
    const { fs } = w;
    fs.set('workspaces/w1', { name: 'Home' });
    fs.set('workspaces/w1/members/u1', { role: 'admin', email: 'ada@example.com' });
    fs.set('workspaces/w1/boards/b1', board);
    const item = (deletedAt: Date | null) => ({ name: 'x', values: {}, deletedAt });
    fs.set('workspaces/w1/boards/b1/items/old', item(ago(31)));
    fs.set('workspaces/w1/boards/b1/items/old/updates/c1', { text: 'comment' });
    fs.set('workspaces/w1/boards/b1/items/old/updates/c2', { text: 'comment' });
    fs.set('workspaces/w1/boards/b1/items/recent', item(ago(5)));
    fs.set('workspaces/w1/boards/b1/items/live', item(null));
    // notifications live in a collection also called "items"
    const note = (read: boolean, days: number) => ({ read, createdAt: ago(days), text: 'n' });
    fs.set('workspaces/w1/notifications/u1/items/readOld', note(true, 40));
    fs.set('workspaces/w1/notifications/u1/items/readNew', note(true, 5));
    fs.set('workspaces/w1/notifications/u1/items/unreadOld', note(false, 40));
    fs.set('workspaces/w1/notifications/u1/items/unreadAncient', note(false, 120));
    fs.set('workspaces/w1/boards/b1/activity/a-old', { at: ago(200), type: 'create' });
    fs.set('workspaces/w1/boards/b1/activity/a-new', { at: ago(10), type: 'create' });
    fs.set('workspaces/w1/boards/b1/automationRuns/r-old', { at: ago(40) });
    fs.set('workspaces/w1/boards/b1/automationRuns/r-new', { at: ago(2) });
  }

  it('removes only what is old enough, including comment threads, and never touches live data', () => {
    const w = world();
    seed(w);
    const r = runHousekeeping(w.f.p, w.db);
    expect(r.steps.every((s) => !s.error)).toBe(true);
    const gone = (p: string) => w.fs.get(p) === undefined;
    expect(gone('workspaces/w1/boards/b1/items/old')).toBe(true);
    expect(gone('workspaces/w1/boards/b1/items/old/updates/c1')).toBe(true);
    expect(gone('workspaces/w1/boards/b1/items/old/updates/c2')).toBe(true);
    expect(gone('workspaces/w1/boards/b1/items/recent')).toBe(false);
    expect(gone('workspaces/w1/boards/b1/items/live')).toBe(false);
    expect(gone('workspaces/w1/notifications/u1/items/readOld')).toBe(true);
    expect(gone('workspaces/w1/notifications/u1/items/readNew')).toBe(false);
    expect(gone('workspaces/w1/notifications/u1/items/unreadOld')).toBe(false); // unread: kept 90 days
    expect(gone('workspaces/w1/notifications/u1/items/unreadAncient')).toBe(true);
    expect(gone('workspaces/w1/boards/b1/activity/a-old')).toBe(true);
    expect(gone('workspaces/w1/boards/b1/activity/a-new')).toBe(false);
    expect(gone('workspaces/w1/boards/b1/automationRuns/r-old')).toBe(true);
    expect(gone('workspaces/w1/boards/b1/automationRuns/r-new')).toBe(false);
    expect(gone('workspaces/w1/boards/b1')).toBe(false);
  });

  it('is idempotent, and a notification that merely looks like a deleted item is never swept up as one', () => {
    const w = world();
    seed(w);
    // a stray notification with a deletedAt must not be treated as a board item
    w.fs.set('workspaces/w1/notifications/u1/items/odd', {
      read: false,
      createdAt: ago(1),
      deletedAt: ago(99),
    });
    runHousekeeping(w.f.p, w.db);
    expect(w.fs.get('workspaces/w1/notifications/u1/items/odd')).toBeDefined();
    const before = w.fs.list('').length;
    const again = runHousekeeping(w.f.p, w.db);
    expect(again.steps.reduce((n, s) => n + s.deleted, 0)).toBe(0);
    expect(w.fs.list('').length).toBe(before);
  });

  it('a failing step (e.g. an index still building) is reported and the others still run', () => {
    const w = world();
    seed(w);
    const orig = w.fs.respond;
    w.fs.respond = (req) =>
      req.body?.includes('"activity"') && req.url.endsWith(':runQuery')
        ? {
            status: 400,
            body: JSON.stringify({ error: { message: 'The query requires an index' } }),
          }
        : orig(req);
    const r = runHousekeeping(w.f.p, w.db);
    expect(r.steps.find((s) => s.name === 'activity log')?.error).toBeTruthy();
    expect(w.fs.get('workspaces/w1/boards/b1/items/old')).toBeUndefined(); // other steps did their job
    expect(w.fs.get('workspaces/w1/notifications/u1/items/readOld')).toBeUndefined();
  });

  it('stops when out of time and says there is more to do', () => {
    const w = world();
    seed(w);
    const r = runHousekeeping(w.f.p, w.db, { budgetMs: 0 });
    expect(r.steps.every((s) => s.more || s.deleted === 0)).toBe(true);
    expect(w.fs.get('workspaces/w1/boards/b1/items/old')).toBeDefined();
  });
});

describe('weekly backup', () => {
  function seed(w: ReturnType<typeof world>) {
    const { fs } = w;
    fs.set('workspaces/w1', { name: 'Home', driveFolderId: null });
    fs.set('workspaces/w1/members/u1', { role: 'admin', email: 'ada@example.com' });
    fs.set('workspaces/w1/boards/b1', board);
    fs.set('workspaces/w1/boards/b1/views/v1', { type: 'table' });
    fs.set('workspaces/w1/boards/b1/meta/counter', { next: 3 });
    fs.set('workspaces/w1/boards/b1/items/i1', {
      name: 'Café ☕ rates',
      values: { due: '2026-04-01' },
    });
    fs.set('workspaces/w1/boards/b1/items/i2', { name: 'Water', values: {} });
  }
  const latest = (w: ReturnType<typeof world>) =>
    [...w.drive.files.values()].filter((f) => f.name.startsWith('backup-')).at(-1)!;

  it('writes a complete, valid JSON file into Backups, with non-ASCII intact', () => {
    const w = world();
    seed(w);
    const r = backupDue(w.f.p, w.cfg, w.db);
    expect(r).toHaveLength(1);
    expect(r[0], JSON.stringify(r[0])).toMatchObject({ ok: true });
    const file = latest(w);
    expect(file.name).toBe('backup-2026-03-17.json');
    const data = JSON.parse(file.bytes.toString('utf8'));
    expect(data.format).toBe('sorted-backup');
    expect(data.boards).toHaveLength(1);
    expect(data.boards[0].items.map((i: { name: string }) => i.name).sort()).toEqual([
      'Café ☕ rates',
      'Water',
    ]);
    expect(data.boards[0].views).toHaveLength(1);
    expect(data.boards[0].counter).toEqual({ next: 3 });
    expect(data.members[0].email).toBe('ada@example.com');
    // it sits in <workspace folder>/Backups
    const backups = [...w.drive.folders].find(([, f]) => f.name === 'Backups')!;
    expect(file.parents).toEqual([backups[0]]);
    expect(file.bytes.length).toBe(r[0]!.bytes);
  });

  it('weekly: skips a recently backed-up workspace, runs again after a week, and keeps only the newest few', () => {
    const w = world();
    seed(w);
    backupDue(w.f.p, w.cfg, w.db);
    expect(backupDue(w.f.p, w.cfg, w.db)).toHaveLength(0);
    for (let i = 0; i < BACKUPS_TO_KEEP + 2; i++) {
      w.f.advance(7 * DAY);
      expect(backupDue(w.f.p, w.cfg, w.db)[0]?.ok).toBe(true);
    }
    const live = [...w.drive.files.values()].filter(
      (f) => f.name.startsWith('backup-') && !f.trashed,
    );
    expect(live).toHaveLength(BACKUPS_TO_KEEP);
    const newest = Math.max(...[...w.drive.files.values()].map((f) => f.seq));
    expect(live.some((f) => f.seq === newest)).toBe(true); // the newest is always kept
  });

  it('a failed backup is reported, retried next time, and does not stop other workspaces', () => {
    const w = world();
    seed(w);
    w.fs.set('workspaces/w2', { name: 'Other', driveFolderId: null });
    w.drive.failNext = { match: /uploadType=resumable/, status: 503 };
    const r = backupDue(w.f.p, w.cfg, w.db);
    expect(r.filter((x) => !x.ok)).toHaveLength(1);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    const again = backupDue(w.f.p, w.cfg, w.db);
    expect(again).toHaveLength(1); // only the one that failed
    expect(again[0]!.ok).toBe(true);
  });

  it('ascii json escapes every non-ASCII character so byte length equals string length', () => {
    const s = asciiJson({ a: 'é☕😀' });
    expect([...s].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect(JSON.parse(s).a).toBe('é☕😀');
  });
});

describe('daily digest', () => {
  function seed(w: ReturnType<typeof world>, opts: { optIn?: boolean } = {}) {
    const { fs } = w;
    fs.set('workspaces/w1', { name: 'Home' });
    fs.set('workspaces/w1/members/u1', {
      role: 'admin',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
    });
    fs.set('workspaces/w1/members/u2', {
      role: 'member',
      email: 'bob@example.com',
      displayName: 'Bob',
    });
    fs.set('users/u1', { settings: { emailDigest: opts.optIn ?? true } });
    fs.set('users/u2', { settings: {} });
    fs.set('workspaces/w1/boards/b1', board);
    fs.set('workspaces/w1/boards/priv', {
      ...board,
      name: 'Secret',
      visibility: 'private',
      memberIds: ['u2'],
    });
    const item = (name: string, due: string | null, extra: object = {}) => ({
      name,
      assigneeUids: ['u1'],
      values: due ? { due, st: 'todo' } : { st: 'todo' },
      archived: false,
      deletedAt: null,
      ...extra,
    });
    // today in Melbourne is 2026-03-18
    fs.set('workspaces/w1/boards/b1/items/overdue', item('Rates <b>bold</b>', '2026-03-10'));
    fs.set('workspaces/w1/boards/b1/items/today', item('Water', '2026-03-18'));
    fs.set('workspaces/w1/boards/b1/items/week', item('Gym', '2026-03-22'));
    fs.set('workspaces/w1/boards/b1/items/later', item('Far off', '2026-06-01'));
    fs.set('workspaces/w1/boards/b1/items/nodate', item('No date', null));
    fs.set(
      'workspaces/w1/boards/b1/items/done',
      item('Paid', '2026-03-10', { values: { due: '2026-03-10', st: 'done' } }),
    );
    fs.set(
      'workspaces/w1/boards/b1/items/deleted',
      item('Gone', '2026-03-10', { deletedAt: ago(1) }),
    );
    fs.set('workspaces/w1/boards/b1/items/archived', item('Old', '2026-03-10', { archived: true }));
    fs.set(
      'workspaces/w1/boards/b1/items/others',
      item('Not mine', '2026-03-10', { assigneeUids: ['u2'] }),
    );
    fs.set('workspaces/w1/boards/priv/items/p1', item('Private thing', '2026-03-10'));
    fs.set('workspaces/w1/notifications/u1/items/n1', {
      read: false,
      text: 'hi',
      createdAt: ago(1),
    });
    fs.set('workspaces/w1/notifications/u1/items/n2', {
      read: true,
      text: 'hi',
      createdAt: ago(1),
    });
  }

  it('emails an opted-in person what is overdue, due today and due this week, safely escaped', () => {
    const w = world();
    seed(w);
    const s = runDigest(w.f.p, w.db);
    expect(s.sent).toBe(1);
    expect(s.skipped.optedOut).toBe(1);
    const mail = w.f.mails[0]!;
    expect(mail.to).toBe('ada@example.com');
    // u1 is an admin, and admins see every private board
    expect(mail.subject).toBe('Sorted: 2 overdue, 1 due today, 1 unread');
    for (const keep of ['Water', 'Gym']) expect(mail.text).toContain(keep);
    expect(mail.text).toContain('Rates <b>bold</b>');
    expect(mail.html).not.toContain('<b>bold</b>'); // escaped
    expect(mail.html).toContain('&#60;b&#62;bold');
    for (const leave of ['Far off', 'No date', 'Paid', 'Gone', 'Old', 'Not mine'])
      expect(mail.text).not.toContain(leave);
    expect(mail.text).toContain('https://life-management-de315.web.app/w/w1/b/b1?item=today');
  });

  it('at most one a day per person, even if the trigger fires twice; tomorrow works again', () => {
    const w = world();
    seed(w);
    runDigest(w.f.p, w.db);
    const second = runDigest(w.f.p, w.db);
    expect(second.sent).toBe(0);
    expect(second.skipped.alreadySent).toBe(1);
    expect(w.f.mails).toHaveLength(1);
    w.f.advance(DAY);
    expect(runDigest(w.f.p, w.db).sent).toBe(1);
  });

  it('never sends an empty email, and respects the daily cap and Google’s own quota', () => {
    const w = world();
    seed(w);
    w.fs.docs.delete('workspaces/w1/notifications/u1/items/n1');
    w.fs.docs.delete('workspaces/w1/boards/priv/items/p1');
    for (const id of ['overdue', 'today', 'week'])
      w.fs.docs.delete(`workspaces/w1/boards/b1/items/${id}`);
    expect(runDigest(w.f.p, w.db)).toMatchObject({ sent: 0, skipped: { empty: 1 } });
    expect(w.f.mails).toHaveLength(0);

    const c = world();
    seed(c);
    c.f.setMailQuota(3);
    expect(runDigest(c.f.p, c.db)).toMatchObject({ sent: 0, skipped: { capped: 1 } });
    const d = world();
    seed(d);
    d.f.props.set('DIGEST_COUNT', JSON.stringify({ date: '2026-03-18', n: 80 }));
    expect(runDigest(d.f.p, d.db).skipped.capped).toBe(1);
  });

  it('private boards: a plain member only gets them if they are on the board', () => {
    const w = world();
    seed(w);
    w.fs.set('workspaces/w1/members/u1', {
      role: 'member',
      email: 'ada@example.com',
      displayName: 'Ada',
    });
    runDigest(w.f.p, w.db);
    expect(w.f.mails[0]!.text).not.toContain('Private thing'); // u1 is not on "Secret"
    const x = world();
    seed(x);
    x.fs.set('workspaces/w1/members/u1', {
      role: 'member',
      email: 'ada@example.com',
      displayName: 'Ada',
    });
    x.fs.set('workspaces/w1/boards/priv', {
      ...board,
      name: 'Secret',
      visibility: 'private',
      memberIds: ['u1'],
    });
    runDigest(x.f.p, x.db);
    expect(x.f.mails[0]!.text).toContain('Private thing');
  });

  it('does not email people who have not opted in', () => {
    const w = world();
    seed(w, { optIn: false });
    expect(runDigest(w.f.p, w.db).sent).toBe(0);
    expect(w.f.mails).toHaveLength(0);
  });

  it('a mail failure is counted, does not stop others, and is not retried into a double send', () => {
    const w = world();
    seed(w);
    w.fs.set('users/u2', { settings: { emailDigest: true } });
    w.fs.set('workspaces/w1/boards/b1/items/b', {
      name: 'B',
      assigneeUids: ['u2'],
      values: { due: '2026-03-18', st: 'todo' },
      archived: false,
      deletedAt: null,
    });
    const send = w.f.p.sendMail;
    let n = 0;
    w.f.p.sendMail = (m) => {
      if (n++ === 0) throw new Error('quota');
      send(m);
    };
    const s = runDigest(w.f.p, w.db);
    expect(s.failed).toBe(1);
    expect(s.sent).toBe(1);
  });

  it('composeDigest is empty-safe and singular/plural correct', () => {
    expect(composeDigest({ person: 'A', workspaces: [], unread: 0 })).toBeNull();
    const m = composeDigest({ person: 'A', workspaces: [], unread: 1 })!;
    expect(m.text).toContain('1 unread notification:');
  });
});

describe('nightly + status + router', () => {
  it('runs everything, records a report, and exposes it to admins only', () => {
    const w = world();
    w.fs.set('workspaces/w1', { name: 'Home', driveFolderId: null });
    w.fs.set('workspaces/w1/members/u1', { role: 'admin', email: 'ada@example.com' });
    w.fs.set('workspaces/w1/members/u2', { role: 'member', email: 'bob@example.com' });
    w.fs.set('workspaces/w1/boards/b1', board);
    w.fs.set('workspaces/w1/boards/b1/items/old', { name: 'x', values: {}, deletedAt: ago(40) });
    const rep = runNightly(w.f.p);
    expect(rep.housekeeping.steps[0]!.deleted).toBe(1);
    expect(rep.backups[0]).toMatchObject({ ok: true });
    runMorning(w.f.p);

    let who = 'u1';
    const p2 = fakePlatform({
      now: NOW,
      props: {},
      respond: (req) =>
        req.url.includes('accounts:lookup')
          ? json(200, { users: [{ localId: who, email: `${who}@x.com` }] })
          : (w.drive.respond(req) ?? w.fs.respond(req)),
    });
    // share the same stored properties as the first platform
    for (const [k, v] of w.f.props) p2.props.set(k, v);
    const call = (u: string) => {
      who = u;
      return handleRequest(
        p2.p,
        JSON.stringify({
          action: 'maintenanceStatus',
          workspaceId: 'w1',
          idToken: fakeJwt({ exp: NOW / 1000 + 3600, sub: u }),
        }),
      ) as { ok: boolean; data?: ReturnType<typeof maintenanceStatus>; error?: { code: string } };
    };
    const admin = call('u1');
    expect(admin.ok).toBe(true);
    expect(admin.data!.nightly).toMatchObject({
      deleted: 1,
      problems: [],
      backups: { ok: 1, failed: 0 },
    });
    expect(admin.data!.digest).toMatchObject({ sent: 0 });
    expect(admin.data!.lastBackupAt).toBe('2026-03-17T20:00:00.000Z');
    expect(call('u2').error?.code).toBe('forbidden');
  });
});
