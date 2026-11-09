import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { DEFAULT_STATUS_LABELS, LABEL_COLORS, LABEL_COLOR_NAMES } from './palette';

describe('label palette', () => {
  it.each(LABEL_COLOR_NAMES)('%s meets WCAG AA (4.5:1) for pill text', (name) => {
    const { bg, text } = LABEL_COLORS[name];
    expect(contrastRatio(bg, text)).toBeGreaterThanOrEqual(4.5);
  });

  it('default status labels reference palette colours', () => {
    for (const label of DEFAULT_STATUS_LABELS) {
      expect(LABEL_COLORS[label.color]).toBeDefined();
    }
  });
});
