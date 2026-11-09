import { isIsoDate } from '../dates';
import { FormulaError, type FValue } from './types';

export const EMPTY: FValue = { t: 'empty' };

export function err(msg: string): FValue {
  return { t: 'err', msg };
}

/** Numbers are rounded to 12 significant digits so 0.1 + 0.2 shows as 0.3, not 0.30000000000000004. */
export function num(n: number): FValue {
  if (!Number.isFinite(n)) return err('The result is not a finite number');
  return { t: 'num', v: Number(n.toPrecision(12)) };
}

export const str = (v: string): FValue => ({ t: 'str', v });
export const bool = (v: boolean): FValue => ({ t: 'bool', v });
export const date = (v: string): FValue => ({ t: 'date', v });

function typeName(v: FValue): string {
  switch (v.t) {
    case 'num':
      return 'a number';
    case 'str':
      return `text "${v.v.length > 20 ? `${v.v.slice(0, 20)}…` : v.v}"`;
    case 'bool':
      return 'a true/false value';
    case 'date':
      return 'a date';
    case 'range':
      return 'a date range';
    case 'empty':
      return 'an empty value';
    case 'err':
      return 'an error';
  }
}

/** Errors travel as values; the moment something *uses* one it is re-thrown so it propagates. */
function check(v: FValue): FValue {
  if (v.t === 'err') throw new FormulaError(v.msg);
  return v;
}

export function toNum(v: FValue): number {
  check(v);
  switch (v.t) {
    case 'num':
      return v.v;
    case 'empty':
      return 0;
    case 'bool':
      return v.v ? 1 : 0;
    case 'str': {
      const t = v.v.trim();
      const n = Number(t);
      if (t !== '' && Number.isFinite(n)) return n;
      throw new FormulaError(`Expected a number but got ${typeName(v)}`);
    }
    default:
      throw new FormulaError(`Expected a number but got ${typeName(v)}`);
  }
}

export function fmtNum(n: number): string {
  return String(Number(n.toPrecision(12)));
}

export function toStr(v: FValue): string {
  check(v);
  switch (v.t) {
    case 'str':
      return v.v;
    case 'num':
      return fmtNum(v.v);
    case 'bool':
      return v.v ? 'TRUE' : 'FALSE';
    case 'date':
      return v.v;
    case 'range':
      return `${v.start} – ${v.end}`;
    default:
      return '';
  }
}

export function toBool(v: FValue): boolean {
  check(v);
  switch (v.t) {
    case 'bool':
      return v.v;
    case 'num':
      return v.v !== 0;
    case 'empty':
      return false;
    case 'str': {
      const t = v.v.trim().toLowerCase();
      if (t === 'true') return true;
      if (t === 'false' || t === '') return false;
      throw new FormulaError(`Expected true or false but got ${typeName(v)}`);
    }
    default:
      throw new FormulaError(`Expected true or false but got ${typeName(v)}`);
  }
}

/** A date, or null for an empty value (so date formulas on blank cells stay blank). */
export function toDate(v: FValue): string | null {
  check(v);
  if (v.t === 'date') return v.v;
  if (v.t === 'empty') return null;
  if (v.t === 'str' && isIsoDate(v.v.trim())) return v.v.trim();
  if (v.t === 'str' && v.v.trim() === '') return null;
  throw new FormulaError(`Expected a date but got ${typeName(v)}`);
}

export function isBlank(v: FValue): boolean {
  return v.t === 'empty' || (v.t === 'str' && v.v === '');
}
