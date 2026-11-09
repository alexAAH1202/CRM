import { LABEL_COLORS, LABEL_COLOR_NAMES, type LabelColor } from '@app/shared';

/** Case-insensitive, number-aware (“Trip 2” before “Trip 10”), stable for equal names. */
export function byBoardName<T extends { name: string; id: string }>(a: T, b: T): number {
  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) ||
    a.id.localeCompare(b.id)
  );
}

// Grey is the "nothing here" colour elsewhere in the app, so boards don't use it.
const PALETTE = LABEL_COLOR_NAMES.filter((c) => c !== 'gray');

/** A colour that belongs to the board for good (derived from its id, so it never shifts). */
export function boardColor(id: string): { name: LabelColor; bg: string; text: string } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const name = PALETTE[(h >>> 0) % PALETTE.length] as LabelColor;
  return { name, ...LABEL_COLORS[name] };
}
