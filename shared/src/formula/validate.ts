import { parseFormula } from './parser';
import { tokenize } from './tokenizer';
import { FormulaError } from './types';

/** The bits of a column the formula checks need. */
export interface FormulaColumnInfo {
  id: string;
  title: string;
  /** Present for formula columns. */
  formula?: string | undefined;
}

export type FormulaProblem = { message: string; pos?: number };

const norm = (t: string) => t.trim().toLowerCase();

/** Title → first column with that title (a Map, so odd titles like "constructor" are safe). */
export function titleIndex<T extends { title: string }>(columns: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const c of columns) if (!m.has(norm(c.title))) m.set(norm(c.title), c);
  return m;
}

/**
 * Everything that can be checked without any item data: syntax, unknown functions and
 * argument counts, unknown column names, and loops between formula columns.
 */
export function validateFormula(
  source: string,
  columns: readonly FormulaColumnInfo[],
  selfId: string | null,
): FormulaProblem | null {
  const parsed = parseFormula(source);
  if (!parsed.ok) return { message: parsed.message, pos: parsed.pos };
  const byTitle = titleIndex(columns);

  for (const ref of parsed.refs) {
    if (!byTitle.has(ref)) {
      const original =
        source.match(
          new RegExp(`\\{\\s*${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}`, 'i'),
        )?.[0] ?? `{${ref}}`;
      return { message: `There's no column called ${original}`, pos: source.indexOf(original) };
    }
  }

  // Would this formula (transitively) refer back to the column it lives in?
  if (selfId) {
    const formulas = new Map(columns.map((c) => [c.id, c.formula]));
    formulas.set(selfId, source);
    const seen = new Set<string>();
    const walk = (id: string, path: string[]): string[] | null => {
      if (id === selfId && path.length > 0) return path;
      if (seen.has(id)) return null;
      seen.add(id);
      const f = formulas.get(id);
      if (!f) return null;
      const p = parseFormula(f);
      if (!p.ok) return null;
      for (const ref of p.refs) {
        const target = byTitle.get(ref);
        if (!target) continue;
        const hit = walk(target.id, [...path, target.title]);
        if (hit) return hit;
      }
      return null;
    };
    const loop = walk(selfId, []);
    if (loop) {
      return {
        message:
          loop.length === 1
            ? `A formula can't refer to its own column ({${loop[0]}})`
            : `This would go in a circle: ${loop.map((t) => `{${t}}`).join(' → ')}`,
      };
    }
  }
  return null;
}

/**
 * Rewrites `{Old title}` to `{New title}` in every formula column, so renaming a column
 * doesn't silently break formulas. Only real references change, never text inside quotes.
 */
export function renameFormulaRefs<
  T extends { title: string; type: string; settings: { formula?: string } },
>(columns: readonly T[], oldTitle: string, newTitle: string): T[] {
  const want = norm(oldTitle);
  return columns.map((c) => {
    const f = c.settings.formula;
    if (c.type !== 'formula' || !f) return c;
    let tokens;
    try {
      tokens = tokenize(f);
    } catch (e) {
      if (e instanceof FormulaError) return c;
      throw e;
    }
    const hits = tokens.filter((t) => t.t === 'ref' && norm(t.v) === want);
    if (hits.length === 0) return c;
    let out = f;
    for (const t of [...hits].reverse()) {
      const end = out.indexOf('}', t.pos);
      out = `${out.slice(0, t.pos)}{${newTitle}}${out.slice(end + 1)}`;
    }
    return { ...c, settings: { ...c.settings, formula: out } };
  });
}

/** Column titles can't contain the brackets formulas use to refer to them. */
export function cleanColumnTitle(title: string): string {
  return title.replace(/[{}]/g, '').trim().slice(0, 60);
}
