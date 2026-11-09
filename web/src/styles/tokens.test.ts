import { readFileSync } from 'node:fs';
import { contrastRatio } from '@app/shared';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`selector ${selector} not found`);
  const body = css.slice(start, css.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--(c-[\w-]+):\s*(#[0-9a-f]{6})/gi))
    vars[m[1] as string] = m[2] as string;
  return vars;
}

// [foreground, background, minimum ratio]
const PAIRS: Array<[string, string, number]> = [
  ['c-text', 'c-bg', 4.5],
  ['c-text', 'c-surface', 4.5],
  ['c-text', 'c-surface-2', 4.5],
  ['c-text-muted', 'c-surface', 4.5],
  ['c-text-muted', 'c-bg', 4.5],
  ['c-primary-text', 'c-primary', 4.5],
  ['c-primary-text', 'c-primary-hover', 4.5],
  ['c-danger-text', 'c-danger', 4.5],
  ['c-primary', 'c-surface', 4.5], // primary-coloured link text
  ['c-primary', 'c-primary-soft', 4.5], // badge text on soft primary
  ['c-focus', 'c-surface', 3],
];

describe.each([
  ['light', ':root'],
  ['dark', "[data-theme='dark']"],
])('%s theme tokens meet WCAG AA', (_name, selector) => {
  const vars = block(selector);
  it.each(PAIRS)('%s on %s', (fg, bg, min) => {
    const a = vars[fg];
    const b = vars[bg];
    expect(a, `missing --${fg}`).toBeDefined();
    expect(b, `missing --${bg}`).toBeDefined();
    expect(contrastRatio(a as string, b as string)).toBeGreaterThanOrEqual(min);
  });
});
