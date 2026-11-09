/** Case- and accent-insensitive "every word appears" matching, best matches first. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();

export function matchScore(text: string, query: string): number {
  const t = fold(text);
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  let score = 0;
  for (const w of words) {
    const i = t.indexOf(w);
    if (i < 0) return 0;
    // earlier and at a word start is better
    score += 10 - Math.min(i, 9) + (i === 0 || t[i - 1] === ' ' ? 5 : 0);
  }
  return score + (t === fold(query).trim() ? 20 : 0);
}

export function rankMatches<T>(
  rows: readonly T[],
  query: string,
  textOf: (row: T) => string,
  limit: number,
): T[] {
  return rows
    .map((r) => ({ r, s: matchScore(textOf(r), query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || textOf(a.r).localeCompare(textOf(b.r)))
    .slice(0, limit)
    .map((x) => x.r);
}
