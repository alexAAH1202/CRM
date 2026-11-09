/**
 * The morning email: what's overdue, due today and due this week for each person who switched it
 * on (Notifications → "Email me a daily summary"), plus how many notifications they haven't seen.
 *
 * Guard rails: at most one email per person per day (remembered in a Script Property, so a
 * re-run or a second trigger can't double-send), never an email with nothing in it, and a hard
 * daily cap below Google's own limit so the script can't be throttled or suspended.
 */
import {
  bucketOf,
  DEFAULT_TIMEZONE,
  dueDateOf,
  isDone,
  LIMITS,
  localDateIn,
  type Column,
  type DueBucket,
} from '@app/shared';
import type { FirestoreClient } from './firestore';
import type { Platform } from './platform';

export const APP_URL = 'https://life-management-de315.web.app';
const SENT_PROP = 'DIGEST_SENT';
const COUNT_PROP = 'DIGEST_COUNT';
/** Leave Google's remaining quota alone below this, whatever our own cap says. */
const QUOTA_MARGIN = 5;
const MAX_ROWS_PER_SECTION = 25;

export interface DigestRow {
  name: string;
  board: string;
  due: string;
  url: string;
}
export interface DigestWorkspace {
  name: string;
  overdue: DigestRow[];
  today: DigestRow[];
  week: DigestRow[];
}
export interface DigestInput {
  person: string;
  workspaces: DigestWorkspace[];
  unread: number;
}
export interface DigestMail {
  subject: string;
  text: string;
  html: string;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const SECTIONS: ReadonlyArray<{ key: 'overdue' | 'today' | 'week'; label: string }> = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'Due in the next 7 days' },
];

const count = (w: DigestWorkspace) => w.overdue.length + w.today.length + w.week.length;

/** Pure: builds the email. Returns null when there is nothing worth sending. */
export function composeDigest(input: DigestInput): DigestMail | null {
  const total = input.workspaces.reduce((n, w) => n + count(w), 0);
  if (total === 0 && input.unread === 0) return null;
  const overdue = input.workspaces.reduce((n, w) => n + w.overdue.length, 0);
  const today = input.workspaces.reduce((n, w) => n + w.today.length, 0);
  const bits = [
    overdue ? `${overdue} overdue` : '',
    today ? `${today} due today` : '',
    !overdue && !today && total ? `${total} coming up` : '',
    input.unread ? `${input.unread} unread` : '',
  ].filter(Boolean);
  const subject = `Sorted: ${bits.join(', ')}`;

  const text: string[] = [`Good morning ${input.person},`, ''];
  const html: string[] = [
    `<div style="font-family:system-ui,Arial,sans-serif;color:#1b1f2a;max-width:560px">`,
    `<p>Good morning ${escapeHtml(input.person)},</p>`,
  ];
  for (const w of input.workspaces) {
    if (count(w) === 0) continue;
    text.push(w.name.toUpperCase());
    html.push(`<h2 style="font-size:18px;margin:20px 0 4px">${escapeHtml(w.name)}</h2>`);
    for (const s of SECTIONS) {
      const rows = w[s.key];
      if (rows.length === 0) continue;
      text.push(`${s.label}:`);
      html.push(
        `<h3 style="font-size:14px;margin:12px 0 4px;color:#555">${s.label}</h3><ul style="margin:0;padding-left:20px">`,
      );
      for (const r of rows.slice(0, MAX_ROWS_PER_SECTION)) {
        text.push(`  - ${r.name} (${r.board}, ${r.due}) ${r.url}`);
        html.push(
          `<li><a href="${escapeHtml(r.url)}" style="color:#4a3fc7">${escapeHtml(r.name)}</a> <span style="color:#666">· ${escapeHtml(r.board)} · ${escapeHtml(r.due)}</span></li>`,
        );
      }
      if (rows.length > MAX_ROWS_PER_SECTION) {
        text.push(`  …and ${rows.length - MAX_ROWS_PER_SECTION} more`);
        html.push(`<li>…and ${rows.length - MAX_ROWS_PER_SECTION} more</li>`);
      }
      html.push('</ul>');
      text.push('');
    }
  }
  if (input.unread > 0) {
    const n = `${input.unread} unread notification${input.unread === 1 ? '' : 's'}`;
    text.push(`You have ${n}: ${APP_URL}`);
    html.push(`<p>You have <a href="${APP_URL}" style="color:#4a3fc7">${n}</a>.</p>`);
  }
  text.push(
    '',
    'You get this because you turned on the daily summary in Sorted. Turn it off any time in the notifications menu.',
  );
  html.push(
    `<p style="color:#777;font-size:12px;margin-top:24px">You get this because you turned on the daily summary in Sorted. Turn it off any time in the notifications menu.</p></div>`,
  );
  return { subject, text: text.join('\n'), html: html.join('') };
}

interface Person {
  uid: string;
  email: string;
  name: string;
  /** workspace ids they belong to, with their role */
  workspaces: Array<{ id: string; role: string }>;
}

function readJson<T>(p: Platform, name: string, fallback: T): T {
  try {
    return JSON.parse(p.prop(name) ?? '') as T;
  } catch {
    return fallback;
  }
}

export interface DigestSummary {
  sent: number;
  skipped: { alreadySent: number; empty: number; optedOut: number; capped: number };
  failed: number;
}

/** Sends today's digests. Safe to run twice: nobody gets two. */
export function runDigest(p: Platform, db: FirestoreClient): DigestSummary {
  const today = localDateIn(p.nowMs(), DEFAULT_TIMEZONE);
  const sentMap = readJson<Record<string, string>>(p, SENT_PROP, {});
  const counter = readJson<{ date: string; n: number }>(p, COUNT_PROP, { date: today, n: 0 });
  if (counter.date !== today) {
    counter.date = today;
    counter.n = 0;
  }
  const summary: DigestSummary = {
    sent: 0,
    skipped: { alreadySent: 0, empty: 0, optedOut: 0, capped: 0 },
    failed: 0,
  };

  // Who is in which workspace.
  const people = new Map<string, Person>();
  const workspaceNames = new Map<string, string>();
  for (const w of db.query({ collection: 'workspaces', limit: 100 })) {
    workspaceNames.set(w.id, String(w.data['name'] ?? 'Household'));
    for (const m of db.query({ parent: `workspaces/${w.id}`, collection: 'members', limit: 200 })) {
      const email = m.data['email'];
      if (typeof email !== 'string' || !email.includes('@')) continue;
      const person = people.get(m.id) ?? {
        uid: m.id,
        email,
        name: String(m.data['displayName'] ?? email),
        workspaces: [],
      };
      person.workspaces.push({ id: w.id, role: String(m.data['role'] ?? 'member') });
      people.set(m.id, person);
    }
  }
  if (people.size === 0) return summary;

  const users = new Map(
    db.batchGet([...people.keys()].map((u) => `users/${u}`)).map((d) => [d.id, d.data]),
  );

  for (const person of people.values()) {
    const settings = (users.get(person.uid)?.['settings'] ?? {}) as { emailDigest?: unknown };
    if (settings.emailDigest !== true) {
      summary.skipped.optedOut++;
      continue;
    }
    if (sentMap[person.uid] === today) {
      summary.skipped.alreadySent++;
      continue;
    }
    if (counter.n >= LIMITS.MAX_DIGEST_EMAILS_PER_DAY || p.mailQuota() <= QUOTA_MARGIN) {
      summary.skipped.capped++;
      continue;
    }
    try {
      const mail = composeDigest(gather(p, db, person, workspaceNames, today));
      if (!mail) {
        summary.skipped.empty++;
        continue;
      }
      // Record first: if sending then throws half-way we'd rather skip a day than send two.
      sentMap[person.uid] = today;
      p.setProp(SENT_PROP, JSON.stringify(prune(sentMap, today)));
      p.sendMail({ to: person.email, ...mail });
      counter.n++;
      p.setProp(COUNT_PROP, JSON.stringify(counter));
      summary.sent++;
    } catch (e) {
      summary.failed++;
      p.log(`Digest for ${person.uid} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return summary;
}

/** Keeps the remembered-dates map from growing forever (only today's entries matter). */
function prune(map: Record<string, string>, today: string): Record<string, string> {
  return Object.fromEntries(Object.entries(map).filter(([, d]) => d === today));
}

function gather(
  p: Platform,
  db: FirestoreClient,
  person: Person,
  names: ReadonlyMap<string, string>,
  today: string,
): DigestInput {
  const workspaces: DigestWorkspace[] = [];
  let unread = 0;
  for (const ws of person.workspaces) {
    const out: DigestWorkspace = {
      name: names.get(ws.id) ?? 'Household',
      overdue: [],
      today: [],
      week: [],
    };
    const boards = db.query({ parent: `workspaces/${ws.id}`, collection: 'boards', limit: 100 });
    for (const b of boards) {
      if (b.data['archived'] === true) continue;
      // Private boards: only their members (and admins, who can see every board).
      const memberIds = Array.isArray(b.data['memberIds']) ? (b.data['memberIds'] as string[]) : [];
      if (
        b.data['visibility'] === 'private' &&
        ws.role !== 'admin' &&
        !memberIds.includes(person.uid)
      )
        continue;
      const columns = (b.data['columns'] ?? []) as Column[];
      const items = db.query({
        parent: b.path,
        collection: 'items',
        where: [{ field: 'assigneeUids', op: 'ARRAY_CONTAINS', value: person.uid }],
        limit: 300,
      });
      for (const it of items) {
        if (it.data['deletedAt'] != null || it.data['archived'] === true) continue;
        const values = (it.data['values'] ?? {}) as Record<string, unknown>;
        if (isDone(columns, values)) continue;
        const due = dueDateOf(columns, values);
        const bucket: DueBucket = bucketOf(due, today);
        if (bucket !== 'overdue' && bucket !== 'today' && bucket !== 'week') continue;
        out[bucket].push({
          name: String(it.data['name'] ?? 'Untitled'),
          board: String(b.data['name'] ?? 'List'),
          due: due ?? '',
          url: `${APP_URL}/w/${ws.id}/b/${b.id}?item=${it.id}`,
        });
      }
    }
    for (const k of ['overdue', 'today', 'week'] as const)
      out[k].sort((a, c) => a.due.localeCompare(c.due));
    workspaces.push(out);
    const note = db.query({
      parent: `workspaces/${ws.id}/notifications/${person.uid}`,
      collection: 'items',
      where: [{ field: 'read', op: 'EQUAL', value: false }],
      limit: 50,
    });
    unread += note.length;
  }
  void p;
  return { person: person.name.split(' ')[0] ?? person.name, workspaces, unread };
}
