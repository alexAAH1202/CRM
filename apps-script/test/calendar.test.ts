import { makeColumn } from '@app/shared';
import { describe, expect, it } from 'vitest';
import { syncCalendars } from '../src/calendar';
import { FirestoreClient } from '../src/firestore';
import type { HttpRequest, HttpResponse } from '../src/platform';
import { FakeFirestore } from './fakeFirestore';
import { fakePlatform } from './fakes';

const status = makeColumn('status', 'Status');
const due = makeColumn('date', 'Due date');
const doneId = (status.settings.labels ?? []).find((l) => /done/i.test(l.name))!.id;

/** A tiny Google Calendar: calendars, ACLs and events by id. */
class FakeCalendar {
  calendars = new Map<string, { summary: string; acl: string[] }>();
  events = new Map<string, Record<string, unknown>>(); // `${cal}|${id}`
  n = 0;
  respond = (req: HttpRequest): HttpResponse | undefined => {
    const u = req.url;
    if (!u.startsWith('https://www.googleapis.com/calendar/v3/')) return undefined;
    const m = req.method ?? 'GET';
    const body = JSON.parse(req.body ?? '{}') as Record<string, unknown>;
    if (u.endsWith('/calendars') && m === 'POST') {
      const id = `cal${++this.n}`;
      this.calendars.set(id, { summary: String(body['summary']), acl: [] });
      return { status: 200, body: JSON.stringify({ id }) };
    }
    let r = /\/calendars\/([^/]+)\/acl$/.exec(u);
    if (r) {
      this.calendars
        .get(decodeURIComponent(r[1]!))!
        .acl.push(String((body['scope'] as { value: string }).value));
      return { status: 200, body: '{}' };
    }
    r = /\/calendars\/([^/]+)\/events(?:\/([^/?]+))?$/.exec(u);
    if (r) {
      const key = `${decodeURIComponent(r[1]!)}|${r[2] ?? body['id']}`;
      if (m === 'PUT') {
        if (!this.events.has(key)) return { status: 404, body: '{}' };
        this.events.set(key, body);
        return { status: 200, body: '{}' };
      }
      if (m === 'POST') {
        this.events.set(key, body);
        return { status: 200, body: '{}' };
      }
      if (m === 'DELETE') {
        const had = this.events.delete(key);
        return { status: had ? 204 : 404, body: '' };
      }
    }
    return { status: 404, body: '{}' };
  };
  on(summary: string) {
    const cal = [...this.calendars].find(([, c]) => c.summary === summary)?.[0];
    return [...this.events]
      .filter(([k]) => k.startsWith(`${cal}|`))
      .map(([, e]) => `${String(e['summary'])} ${(e['start'] as { date: string }).date}`);
  }
}

function world() {
  const fs = new FakeFirestore();
  const cal = new FakeCalendar();
  const f = fakePlatform({ respond: (req) => cal.respond(req) ?? fs.respond(req) });
  fs.set('workspaces/w', { name: 'Home', settings: { timezone: 'Australia/Melbourne' } });
  fs.set('workspaces/w/members/alex', { role: 'admin', email: 'alex@x.com', displayName: 'Alex' });
  fs.set('workspaces/w/members/andrew', {
    role: 'member',
    email: 'andrew@x.com',
    displayName: 'Andrew',
  });
  fs.set('workspaces/w/boards/b', { name: 'Study', columns: [status, due] });
  let t = Date.parse('2026-03-10T00:00:00Z');
  const item = (id: string, data: Record<string, unknown>) =>
    fs.set(`workspaces/w/boards/b/items/${id}`, {
      name: id,
      values: {},
      assigneeUids: [],
      archived: false,
      deletedAt: null,
      createdBy: 'alex',
      onCalendar: true,
      ...data,
      updatedAt: new Date((t += 1000)),
    });
  const sync = () => syncCalendars(f.p, new FirestoreClient(f.p, 'life-management-de315'));
  return { fs, cal, f, item, sync };
}

describe('Google Calendar due dates', () => {
  it('goes to the assignee, else the creator; follows changes; leaves when done', () => {
    const w = world();
    w.item('Essay', { values: { [due.id]: '2026-03-20' }, assigneeUids: ['andrew'] });
    w.item('Bills', { values: { [due.id]: '2026-03-21' }, createdBy: 'andrew' });
    w.item('Mine', { values: { [due.id]: '2026-03-22' } });
    w.item('No date', {});
    w.item('Not added', { values: { [due.id]: '2026-03-23' }, onCalendar: false });
    w.sync();
    expect(w.cal.on('Sorted – Andrew').sort()).toEqual(['Bills 2026-03-21', 'Essay 2026-03-20']);
    expect(w.cal.on('Sorted – Alex')).toEqual(['Mine 2026-03-22']);
    expect([...w.cal.calendars.values()].find((c) => c.summary === 'Sorted – Andrew')!.acl).toEqual(
      ['andrew@x.com'],
    );

    // reassigned to Alex with a new date: moves calendars; marked done: removed
    w.item('Essay', { values: { [due.id]: '2026-03-25' }, assigneeUids: ['alex'] });
    w.item('Bills', {
      values: { [due.id]: '2026-03-21', [status.id]: doneId },
      createdBy: 'andrew',
    });
    w.sync();
    expect(w.cal.on('Sorted – Andrew')).toEqual([]);
    expect(w.cal.on('Sorted – Alex').sort()).toEqual(['Essay 2026-03-25', 'Mine 2026-03-22']);

    // nothing changed: nothing happens
    const before = w.f.calls.length;
    w.sync();
    expect(w.f.calls.length - before).toBe(1); // just the "anything changed?" query
  });

  it('a calendar problem is retried next time, not lost', () => {
    const w = world();
    w.item('Essay', { values: { [due.id]: '2026-03-20' }, assigneeUids: ['andrew'] });
    const real = w.cal.respond;
    w.cal.respond = (req) =>
      req.url.includes('/events') ? { status: 503, body: '{}' } : real(req);
    expect(w.sync().failed).toBe(1);
    w.cal.respond = real;
    w.sync();
    expect(w.cal.on('Sorted – Andrew')).toEqual(['Essay 2026-03-20']);
  });
});
