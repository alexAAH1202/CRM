/**
 * Google Calendar due dates (D103). Each household member gets a calendar in the script owner's
 * account, "Sorted – <name>", shared with them (edit access) so it shows in their own Google
 * Calendar. Every item with a due date becomes an all-day event on the calendar of each person
 * assigned to it, or of whoever created it when nobody is. Done, archived, deleted or undated
 * items have no event.
 *
 * Runs with the 10-minute scheduler and only looks at items changed since the last run (one
 * collection-group query), so it costs nothing when nothing changed. Event ids are derived from
 * the item, so nothing needs to be stored per event.
 */
import { addDays, dueDateOf, isDone, type Column } from '@app/shared';
import type { Doc, FirestoreClient } from './firestore';
import type { HttpResponse, Platform } from './platform';

const API = 'https://www.googleapis.com/calendar/v3';
const APP_URL = 'https://life-management-de315.web.app';
const LAST_PROP = 'CAL_LAST_SYNC';
const STATUS_PROP = 'CAL_STATUS';
const MAX_ITEMS_PER_RUN = 200;
const ITEM_PATH = /^workspaces\/([^/]+)\/boards\/([^/]+)\/items\/([^/]+)$/;

export interface CalendarSummary {
  at: string;
  items: number;
  written: number;
  removed: number;
  failed: number;
  error?: string;
}

interface Member {
  uid: string;
  email: string;
  name: string;
  role: string;
}

/** Calendar event ids must be 5–1024 characters of a–v and 0–9: a hex hash qualifies. */
export function eventIdFor(p: Platform, wid: string, bid: string, iid: string): string {
  return `s${p.sha256Hex(`${wid}/${bid}/${iid}`).slice(0, 40)}`;
}

/** Who an item's event belongs to: everyone assigned, else its creator. */
export function ownersOf(item: Record<string, unknown>): string[] {
  const assigned = Array.isArray(item['assigneeUids'])
    ? (item['assigneeUids'] as unknown[]).filter((u): u is string => typeof u === 'string')
    : [];
  if (assigned.length) return [...new Set(assigned)];
  return typeof item['createdBy'] === 'string' && item['createdBy'] ? [item['createdBy']] : [];
}

/** The event an item should have (all-day on its due date), or null for none. */
export function wantedEvent(
  columns: readonly Column[],
  item: Record<string, unknown>,
): { date: string; title: string } | null {
  if (item['deletedAt'] != null || item['archived'] === true) return null;
  const values = (item['values'] ?? {}) as Record<string, unknown>;
  if (isDone(columns, values)) return null;
  const date = dueDateOf(columns, values);
  if (!date) return null;
  return { date, title: String(item['name'] ?? '').trim() || 'Untitled item' };
}

function call(
  p: Platform,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
): HttpResponse {
  return p.http({
    url,
    method,
    oauth: true,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** The member's Sorted calendar id, creating and sharing it the first time. */
function calendarFor(p: Platform, wid: string, m: Member, tz: string): string {
  const key = `CAL_${wid}_${m.uid}`;
  const known = p.prop(key);
  if (known) return known;
  const res = call(p, 'POST', `${API}/calendars`, {
    summary: `Sorted – ${m.name}`,
    description: 'Due dates from Sorted. Kept up to date automatically; edit items in Sorted.',
    timeZone: tz,
  });
  if (res.status !== 200)
    throw new Error(`create calendar ${res.status}: ${res.body.slice(0, 200)}`);
  const id = (JSON.parse(res.body) as { id: string }).id;
  // Share it with the person (the script owner already owns it).
  const share = call(p, 'POST', `${API}/calendars/${encodeURIComponent(id)}/acl`, {
    role: 'writer',
    scope: { type: 'user', value: m.email },
  });
  if (share.status !== 200) p.log(`Calendar share with ${m.email}: ${share.status}`);
  p.setProp(key, id);
  return id;
}

function putEvent(
  p: Platform,
  cal: string,
  id: string,
  ev: { date: string; title: string },
  link: string,
  listName: string,
): boolean {
  const body = {
    id,
    summary: ev.title,
    description: `${listName}\n${link}`,
    start: { date: ev.date },
    end: { date: addDays(ev.date, 1) ?? ev.date },
    transparency: 'transparent',
    status: 'confirmed',
    source: { title: 'Sorted', url: link },
  };
  const base = `${API}/calendars/${encodeURIComponent(cal)}/events`;
  // Update in place; if it doesn't exist yet, create it with our id.
  const up = call(p, 'PUT', `${base}/${id}`, body);
  if (up.status === 200) return true;
  if (up.status === 404) {
    const ins = call(p, 'POST', base, body);
    if (ins.status === 200) return true;
    p.log(`Calendar insert ${id}: ${ins.status} ${ins.body.slice(0, 200)}`);
    return false;
  }
  p.log(`Calendar update ${id}: ${up.status} ${up.body.slice(0, 200)}`);
  return false;
}

/** Removes the event if it's there; true if it's gone (or never existed). */
function removeEvent(p: Platform, cal: string, id: string): boolean {
  const res = call(p, 'DELETE', `${API}/calendars/${encodeURIComponent(cal)}/events/${id}`);
  return res.status === 204 || res.status === 200 || res.status === 404 || res.status === 410;
}

/** Brings the calendars up to date with every item changed since the last run. Never throws. */
export function syncCalendars(
  p: Platform,
  db: FirestoreClient,
  opts: { deadline?: number } = {},
): CalendarSummary {
  const sum: CalendarSummary = {
    at: new Date(p.nowMs()).toISOString(),
    items: 0,
    written: 0,
    removed: 0,
    failed: 0,
  };
  try {
    const last = p.prop(LAST_PROP);
    const changed: Doc[] = db.query({
      collection: 'items',
      group: true,
      where: last ? [{ field: 'updatedAt', op: 'GREATER_THAN', value: new Date(last) }] : [],
      orderBy: [{ field: 'updatedAt' }],
      limit: MAX_ITEMS_PER_RUN,
    });
    const boards = new Map<string, { columns: Column[]; name: string } | null>();
    const members = new Map<string, { list: Member[]; tz: string }>();
    let newest = last ? Date.parse(last) : 0;
    for (const doc of changed) {
      const m = ITEM_PATH.exec(doc.path);
      if (!m) continue; // notifications live in collections called "items" too
      if (opts.deadline && p.nowMs() > opts.deadline) break;
      const [, wid, bid, iid] = m as unknown as [string, string, string, string];
      sum.items++;
      const bkey = `${wid}/${bid}`;
      if (!boards.has(bkey)) {
        const b = db.getDoc(`workspaces/${wid}/boards/${bid}`);
        boards.set(
          bkey,
          b
            ? {
                columns: (Array.isArray(b.data['columns']) ? b.data['columns'] : []) as Column[],
                name: String(b.data['name'] ?? 'List'),
              }
            : null,
        );
      }
      if (!members.has(wid)) {
        const ws = db.getDoc(`workspaces/${wid}`);
        const settings = (ws?.data['settings'] ?? {}) as Record<string, unknown>;
        members.set(wid, {
          tz:
            typeof settings['timezone'] === 'string' ? settings['timezone'] : 'Australia/Melbourne',
          list: db
            .query({ parent: `workspaces/${wid}`, collection: 'members', limit: 200 })
            .map((d) => ({
              uid: d.id,
              email: String(d.data['email'] ?? ''),
              name: String(d.data['displayName'] ?? d.data['email'] ?? 'Member'),
              role: String(d.data['role'] ?? ''),
            }))
            .filter((x) => x.email.includes('@')),
        });
      }
      const board = boards.get(bkey) ?? null;
      const { list, tz } = members.get(wid)!;
      const wanted = board ? wantedEvent(board.columns, doc.data) : null;
      const owners = new Set(wanted ? ownersOf(doc.data) : []);
      const id = eventIdFor(p, wid, bid, iid);
      const link = `${APP_URL}/w/${wid}/b/${bid}?item=${iid}`;
      let ok = true;
      for (const mem of list) {
        const has = p.prop(`CAL_${wid}_${mem.uid}`);
        if (wanted && owners.has(mem.uid)) {
          const cal = calendarFor(p, wid, mem, tz);
          if (putEvent(p, cal, id, wanted, link, board!.name)) sum.written++;
          else ok = false;
        } else if (has) {
          // Not (or no longer) theirs: make sure it isn't on their calendar.
          if (removeEvent(p, has, id)) sum.removed++;
          else ok = false;
        }
      }
      if (!ok) {
        sum.failed++;
        break; // try this item again next run
      }
      const t = doc.data['updatedAt'];
      if (t instanceof Date && t.getTime() > newest) newest = t.getTime();
    }
    if (newest > 0) p.setProp(LAST_PROP, new Date(newest).toISOString());
  } catch (e) {
    sum.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    p.log(`Calendar sync failed: ${sum.error}`);
  }
  p.setProp(STATUS_PROP, JSON.stringify(sum));
  return sum;
}

/** The last run, for the Helper card. */
export function calendarStatus(p: Platform): CalendarSummary | null {
  try {
    const s = p.prop(STATUS_PROP);
    return s ? (JSON.parse(s) as CalendarSummary) : null;
  } catch {
    return null;
  }
}
