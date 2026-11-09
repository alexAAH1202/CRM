import { describe, expect, it } from 'vitest';
import { bestTextColor, contrastRatio, parseHex } from './contrast';

describe('contrast', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
  it('identical colours are 1:1', () => {
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });
  it('picks dark text on light backgrounds and vice versa', () => {
    expect(bestTextColor('#ffff00')).toBe('#1b1f2a');
    expect(bestTextColor('#000080')).toBe('#ffffff');
  });
  it('rejects malformed colours', () => {
    expect(() => parseHex('red')).toThrow();
  });
});
