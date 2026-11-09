import { describe, expect, it } from 'vitest';
import {
  computeAssignees,
  isIsoDate,
  makeColumn,
  normalizeUrl,
  normalizeValue,
  valueToText,
} from './columns';

describe('column values', () => {
  const status = makeColumn('status');
  const people = makeColumn('people');
  const people2 = makeColumn('people', 'Reviewer');
  const numbers = makeColumn('numbers', 'Cost', { unit: '$', decimals: 2 });
  const dropdown = makeColumn('dropdown', 'Tags', {
    options: [
      { id: 'a', name: 'Urgent', color: 'red' },
      { id: 'b', name: 'Later', color: 'gray' },
    ],
  });

  it('validates dates strictly', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('28/02/2026')).toBe(false);
  });

  it('normalizes per type', () => {
    expect(normalizeValue(status, 'done')).toBe('done');
    expect(normalizeValue(status, 'nope')).toBeNull();
    expect(normalizeValue(people, ['u1', 'u1', '', 'u2'])).toEqual(['u1', 'u2']);
    expect(normalizeValue(dropdown, ['a', 'zzz'])).toEqual(['a']);
    expect(normalizeValue(numbers, Number.NaN)).toBeNull();
    expect(normalizeValue(makeColumn('checkbox'), false)).toBeNull();
    expect(normalizeValue(makeColumn('text'), '   ')).toBeNull();
    expect(
      normalizeValue(makeColumn('timeline'), { start: '2026-05-10', end: '2026-05-01' }),
    ).toEqual({
      start: '2026-05-01',
      end: '2026-05-10',
    });
  });

  it('refuses dangerous link schemes and adds https', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBe('');
    expect(normalizeUrl('example.com/x')).toBe('https://example.com/x');
    expect(normalizeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(normalizeValue(makeColumn('link'), { url: 'javascript:x', text: '' })).toBeNull();
  });

  it('computes assignees across all People columns', () => {
    const cols = [status, people, people2];
    expect(
      computeAssignees(cols, {
        [people.id]: ['b', 'a'],
        [people2.id]: ['a', 'c'],
        [status.id]: 'done',
      }),
    ).toEqual(['a', 'b', 'c']);
  });

  it('renders text for search', () => {
    expect(valueToText(status, 'stuck')).toBe('Stuck');
    expect(valueToText(numbers, 12.5)).toBe('$12.50');
    expect(valueToText(dropdown, ['b', 'a'])).toBe('Later, Urgent');
    expect(valueToText(people, ['u1'], () => 'Ada')).toBe('Ada');
  });
});
