import { FormulaError } from './types';

export type Token =
  | { t: 'num'; v: number; pos: number }
  | { t: 'str'; v: string; pos: number }
  | { t: 'ref'; v: string; pos: number }
  | { t: 'ident'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: '('; pos: number }
  | { t: ')'; pos: number }
  | { t: ','; pos: number }
  | { t: 'eof'; pos: number };

export const MAX_FORMULA_LENGTH = 1000;

const TWO_CHAR_OPS = new Set(['<>', '<=', '>=', '!=']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '^', '&', '=', '<', '>']);

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isIdentStart = (c: string | undefined) => c !== undefined && /[A-Za-z_]/.test(c);
const isIdentPart = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_.]/.test(c);

export function tokenize(src: string): Token[] {
  if (src.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError(`Formulas can be at most ${MAX_FORMULA_LENGTH} characters`, 0);
  }
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const pos = i;

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      let j = i;
      while (isDigit(src[j])) j++;
      if (src[j] === '.') {
        j++;
        while (isDigit(src[j])) j++;
      }
      const text = src.slice(i, j);
      const v = Number(text);
      if (!Number.isFinite(v)) throw new FormulaError(`Invalid number "${text}"`, pos);
      out.push({ t: 'num', v, pos });
      i = j;
      continue;
    }

    if (c === '"' || c === "'") {
      let j = i + 1;
      let text = '';
      for (;;) {
        if (j >= src.length) throw new FormulaError('This text is missing its closing quote', pos);
        const d = src[j] as string;
        if (d === c) {
          if (src[j + 1] === c) {
            text += c; // doubled quote = literal quote
            j += 2;
            continue;
          }
          j++;
          break;
        }
        text += d;
        j++;
      }
      out.push({ t: 'str', v: text, pos });
      i = j;
      continue;
    }

    if (c === '{') {
      const end = src.indexOf('}', i + 1);
      if (end < 0) throw new FormulaError('This column name is missing its closing }', pos);
      const name = src.slice(i + 1, end).trim();
      if (!name) throw new FormulaError('Put a column name between { }', pos);
      out.push({ t: 'ref', v: name, pos });
      i = end + 1;
      continue;
    }

    if (isIdentStart(c)) {
      let j = i + 1;
      while (isIdentPart(src[j])) j++;
      out.push({ t: 'ident', v: src.slice(i, j), pos });
      i = j;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      out.push({ t: 'op', v: two === '!=' ? '<>' : two, pos });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      out.push({ t: 'op', v: c, pos });
      i++;
      continue;
    }
    if (c === '(') out.push({ t: '(', pos });
    else if (c === ')') out.push({ t: ')', pos });
    else if (c === ',') out.push({ t: ',', pos });
    else throw new FormulaError(`Unexpected character "${c}"`, pos);
    i++;
  }
  out.push({ t: 'eof', pos: src.length });
  return out;
}
