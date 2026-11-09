import { describe, expect, it } from 'vitest';
import { boardColor, byBoardName } from './boardStyle';

describe('board list helpers', () => {
  it('sorts alphabetically, ignoring case, with numbers in order', () => {
    const names = ['bills', 'Trip 10', 'Alpha', 'trip 2', 'Zed', 'Ångström'].map((name, i) => ({
      name,
      id: `i${i}`,
    }));
    expect(names.sort(byBoardName).map((b) => b.name)).toEqual([
      'Alpha',
      'Ångström',
      'bills',
      'trip 2',
      'Trip 10',
      'Zed',
    ]);
  });
  it('equal names fall back to id so the order never flickers', () => {
    const a = { name: 'Home', id: 'b' };
    const b = { name: 'home', id: 'a' };
    expect([a, b].sort(byBoardName).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('a board always gets the same colour, never grey, and the palette is well used', () => {
    expect(boardColor('abc')).toEqual(boardColor('abc'));
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = boardColor(`board-${i}`);
      expect(c.name).not.toBe('gray');
      seen.add(c.name);
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });
});
