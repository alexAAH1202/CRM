import { describe, expect, it } from 'vitest';
import { keyBetween, keysBetween } from './ordering';

describe('fractional ordering keys', () => {
  it('produces the first key and keys at both ends', () => {
    const k = keyBetween(null, null);
    expect(k).toBe('a0');
    expect(keyBetween(k, null) > k).toBe(true);
    expect(keyBetween(null, k) < k).toBe(true);
  });

  it('inserts between neighbours', () => {
    const a = keyBetween(null, null);
    const c = keyBetween(a, null);
    const b = keyBetween(a, c);
    expect(a < b && b < c).toBe(true);
  });

  it('rejects inverted bounds', () => {
    expect(() => keyBetween('a1', 'a0')).toThrow();
    expect(() => keyBetween('a0', 'a0')).toThrow();
  });

  it('n keys are ascending and within bounds', () => {
    const ks = keysBetween('a0', 'a1', 50);
    expect(ks).toHaveLength(50);
    for (let i = 1; i < ks.length; i++) expect(ks[i - 1]! < ks[i]!).toBe(true);
    expect(ks[0]! > 'a0' && ks[49]! < 'a1').toBe(true);
    expect(keysBetween(null, null, 5)).toEqual([...keysBetween(null, null, 5)].sort());
  });

  it('stays sorted under 2,000 random inserts (simulated drags)', () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const list: string[] = [keyBetween(null, null)];
    for (let i = 0; i < 2000; i++) {
      const pos = Math.floor(rand() * (list.length + 1));
      const k = keyBetween(list[pos - 1] ?? null, list[pos] ?? null);
      list.splice(pos, 0, k);
    }
    const sorted = [...list].sort();
    expect(list).toEqual(sorted);
    expect(new Set(list).size).toBe(list.length);
  });

  it('repeated insertion at the same spot keeps keys within the 64-char rule cap for realistic use', () => {
    let lo = keyBetween(null, null);
    const hi = keyBetween(lo, null);
    for (let i = 0; i < 200; i++) lo = keyBetween(lo, hi); // 200 drags into the same gap
    expect(lo.length).toBeLessThanOrEqual(64);
  });
});
