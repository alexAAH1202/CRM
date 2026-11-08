/**
 * Label palette for status pills, group headers and tags. Original colours chosen
 * for this product; each entry pairs a background with a text colour that meets
 * WCAG AA (>= 4.5:1) — enforced by palette.test.ts.
 */
export const LABEL_COLORS = {
  green: { bg: '#13865a', text: '#ffffff' },
  orange: { bg: '#f59f2a', text: '#1b1f2a' },
  red: { bg: '#cf3448', text: '#ffffff' },
  gray: { bg: '#c4c8d4', text: '#1b1f2a' },
  blue: { bg: '#2f6fed', text: '#ffffff' },
  purple: { bg: '#7c4ddb', text: '#ffffff' },
  pink: { bg: '#c4337f', text: '#ffffff' },
  teal: { bg: '#0b7a7a', text: '#ffffff' },
  yellow: { bg: '#f7c948', text: '#1b1f2a' },
  lime: { bg: '#8bc34a', text: '#1b1f2a' },
  navy: { bg: '#2b3a67', text: '#ffffff' },
  brown: { bg: '#9a6a44', text: '#ffffff' },
  sky: { bg: '#4fb3e8', text: '#1b1f2a' },
  grape: { bg: '#8e4fd0', text: '#ffffff' },
} as const;

export type LabelColor = keyof typeof LABEL_COLORS;

export const LABEL_COLOR_NAMES = Object.keys(LABEL_COLORS) as LabelColor[];

/** Default Status column labels (spec section 8). */
export const DEFAULT_STATUS_LABELS: ReadonlyArray<{ id: string; name: string; color: LabelColor }> =
  [
    { id: 'not_started', name: 'Not started', color: 'gray' },
    { id: 'working', name: 'Working on it', color: 'orange' },
    { id: 'stuck', name: 'Stuck', color: 'red' },
    { id: 'done', name: 'Done', color: 'green' },
  ];
