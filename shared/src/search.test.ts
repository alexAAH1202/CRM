import { describe, expect, it } from 'vitest';
import { matchScore, rankMatches } from './search';

describe('search', () => {
  it('every word must appear, in any order, ignoring case and accents', () => {
    expect(matchScore('Electricity bill', 'bill elec')).toBeGreaterThan(0);
    expect(matchScore('Café plans', 'CAFE')).toBeGreaterThan(0);
    expect(matchScore('Electricity bill', 'water')).toBe(0);
    expect(matchScore('anything', '   ')).toBe(0);
  });
  it('word starts and exact matches rank higher', () => {
    const rows = ['Pay water bill', 'Waterproof tent', 'Water', 'Backwater'];
    expect(rankMatches(rows, 'water', (r) => r, 10)).toEqual([
      'Water',
      'Waterproof tent',
      'Pay water bill',
      'Backwater',
    ]);
  });
  it('limits and tolerates regex characters', () => {
    expect(rankMatches(['a(b', 'a(c'], 'a(', (r) => r, 1)).toHaveLength(1);
    expect(rankMatches(['x'], '.*', (r) => r, 5)).toEqual([]);
  });
});
