import { describe, expect, it } from 'vitest';
import { makeColumn } from './columns';
import {
  focusOrder,
  isQuick,
  parsePlan,
  relativeDue,
  toCandidate,
  type FocusCandidate,
} from './focus';
import { recipesFor } from './automationRecipes';
import { buildTemplate } from './templates';

describe('countdowns', () => {
  const t = '2026-03-10';
  it('reads like a person would say it, warming as it nears', () => {
    expect(relativeDue('2026-03-08', t)).toMatchObject({ text: '2 days late', tone: 'late' });
    expect(relativeDue('2026-03-09', t)).toMatchObject({ text: '1 day late', tone: 'late' });
    expect(relativeDue('2026-03-10', t)).toMatchObject({ text: 'today', tone: 'today' });
    expect(relativeDue('2026-03-11', t)).toMatchObject({ text: 'tomorrow', tone: 'soon' });
    expect(relativeDue('2026-03-13', t)).toMatchObject({ text: 'in 3 days', tone: 'soon' });
    expect(relativeDue('2026-03-16', t)).toMatchObject({ text: 'in 6 days', tone: 'week' });
    expect(relativeDue('2026-03-31', t)).toMatchObject({ text: 'in 3 weeks', tone: 'later' });
    expect(relativeDue('2026-09-10', t)).toMatchObject({ text: 'in 6 months', tone: 'later' });
    expect(relativeDue('nope', t)).toBeNull();
  });
});

describe('quick wins', () => {
  const tags = makeColumn('tags', 'Tags', {
    options: [
      { id: 'q', name: 'Quick', color: 'green' },
      { id: 'h', name: 'Home', color: 'blue' },
      { id: 'm', name: '2 min', color: 'blue' },
    ],
  });
  it('an item tagged Quick / 2 min counts; others do not', () => {
    expect(isQuick([tags], { [tags.id]: ['q'] })).toBe(true);
    expect(isQuick([tags], { [tags.id]: ['m', 'h'] })).toBe(true);
    expect(isQuick([tags], { [tags.id]: ['h'] })).toBe(false);
    expect(isQuick([tags], {})).toBe(false);
  });
});

describe('what to do next', () => {
  const c = (
    key: string,
    due: string | null,
    extra: Partial<FocusCandidate> = {},
  ): FocusCandidate => ({
    key,
    boardId: 'b',
    itemId: key.split(':')[1]!,
    name: key,
    due,
    quick: false,
    done: false,
    ...extra,
  });
  const all = [
    c('b:later', '2026-04-01'),
    c('b:none', null),
    c('b:late', '2026-03-01'),
    c('b:done', '2026-02-01', { done: true }),
    c('b:soon', '2026-03-12', { quick: true }),
  ];
  it('today’s plan first, then by date, no-date last, done never', () => {
    expect(focusOrder(all, []).map((x) => x.key)).toEqual([
      'b:late',
      'b:soon',
      'b:later',
      'b:none',
    ]);
    expect(focusOrder(all, ['b:none', 'b:done', 'b:gone']).map((x) => x.key)).toEqual([
      'b:none',
      'b:late',
      'b:soon',
      'b:later',
    ]);
  });
  it('“not now” skips; quick-only filters', () => {
    expect(focusOrder(all, [], new Set(['b:late']))[0]!.key).toBe('b:soon');
    expect(focusOrder(all, [], new Set(), true).map((x) => x.key)).toEqual(['b:soon']);
  });
  it('candidates know their due date and whether they are done', () => {
    const t = buildTemplate('bills');
    const due = t.columns.find((x) => x.title === 'Due date')!;
    const st = t.columns.find((x) => x.type === 'status')!;
    const paid = (st.settings.labels ?? []).find((l) => /paid/i.test(l.name))!;
    const x = toCandidate(
      'b',
      { id: 'i', name: 'Rates', values: { [due.id]: '2026-03-20', [st.id]: paid.id } },
      t.columns,
    );
    expect(x).toMatchObject({ key: 'b:i', due: '2026-03-20', done: true });
  });
});

describe('today’s plan', () => {
  it('only today’s, at most three, well-formed', () => {
    expect(
      parsePlan(
        { date: '2026-03-10', picks: ['b:1', 'b:2', 'b:2', 'b:3', 'b:4', 'x'] },
        '2026-03-10',
      ),
    ).toEqual(['b:1', 'b:2', 'b:3']);
    expect(parsePlan({ date: '2026-03-09', picks: ['b:1'] }, '2026-03-10')).toEqual([]);
    expect(parsePlan(null, '2026-03-10')).toEqual([]);
  });
});

describe('escalating reminders', () => {
  it('one recipe, four steps, each quiet once the item is done', () => {
    const r = recipesFor(buildTemplate('bills'), 'me', '2026-03-10').find(
      (x) => x.id === 'escalate',
    )!;
    const all = [r.draft, ...(r.bundle ?? [])];
    expect(all).toHaveLength(4);
    expect(all.map((d) => (d.trigger as { offsetDays: number }).offsetDays)).toEqual([-3, 0, 1, 3]);
    expect(all.every((d) => d.conditions.length === 1)).toBe(true); // the done guard
    expect(
      all.slice(1).every((d) => d.actions.some((a) => a.type === 'notify' && a.to === 'assignees')),
    ).toBe(true);
  });
});
