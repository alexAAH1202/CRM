import { addDays, dateParts, diffDays, isIsoDate, workdaysBetween } from '../dates';
import {
  EMPTY,
  bool,
  date,
  err,
  fmtNum,
  isBlank,
  num,
  str,
  toBool,
  toDate,
  toNum,
  toStr,
} from './values';
import { FormulaError, type BinOp, type EvalEnv, type FValue, type Node } from './types';

function roundTo(x: number, digits: number): number {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e15) return x;
  const d = Math.trunc(digits);
  const abs = Math.abs(x);
  // Shift the decimal point as text so 1.005 rounds to 1.01 (binary floats would say 1.00).
  const shifted = Math.round(Number(`${abs}e${d}`));
  const back = Number(`${shifted}e${-d}`);
  return x < 0 ? -back : back;
}

function wholeNumber(v: FValue, what: string): number {
  const n = toNum(v);
  if (!Number.isInteger(n)) throw new FormulaError(`${what} must be a whole number`);
  return n;
}

function numbers(args: FValue[]): number[] {
  const out: number[] = [];
  for (const a of args) {
    if (a.t === 'err') throw new FormulaError(a.msg);
    if (isBlank(a)) continue;
    out.push(toNum(a));
  }
  return out;
}

// ------------------------------------------------------------------ operators

function arithmetic(op: '+' | '-' | '*' | '/' | '^', l: FValue, r: FValue): FValue {
  if (op === '+' || op === '-') {
    const ld = l.t === 'date';
    const rd = r.t === 'date';
    if (ld || rd) {
      if (op === '-' && ld && rd) return num(diffDays(l.v, r.v) ?? NaN);
      if (op === '+' && ld && rd) throw new FormulaError("Can't add two dates together");
      if (ld) {
        const out = addDays(l.v, op === '+' ? toNum(r) : -toNum(r));
        return out ? date(out) : err('That date is out of range');
      }
      if (op === '-') throw new FormulaError("Can't subtract a date from a number");
      const out = addDays((r as { v: string }).v, toNum(l));
      return out ? date(out) : err('That date is out of range');
    }
  }
  const a = toNum(l);
  const b = toNum(r);
  switch (op) {
    case '+':
      return num(a + b);
    case '-':
      return num(a - b);
    case '*':
      return num(a * b);
    case '/':
      if (b === 0) throw new FormulaError('Division by zero');
      return num(a / b);
    case '^':
      return num(a ** b);
  }
}

/** Compares two values; returns null when they can't be ordered (different kinds of thing). */
function cmp(l: FValue, r: FValue): number | null {
  if (l.t === 'err' || r.t === 'err')
    throw new FormulaError((l.t === 'err' ? l : (r as { msg: string })).msg);
  const asDate = (v: FValue) =>
    v.t === 'date' ? v.v : v.t === 'str' && isIsoDate(v.v) ? v.v : null;
  const lDate = asDate(l);
  const rDate = asDate(r);
  if (lDate && rDate) return lDate < rDate ? -1 : lDate > rDate ? 1 : 0;
  if (l.t === 'empty' && r.t === 'empty') return 0;
  // Empty compares as "", 0 or false depending on what it's compared with, and before any date.
  if (l.t === 'empty')
    return r.t === 'date'
      ? -1
      : cmp(
          r.t === 'num'
            ? { t: 'num', v: 0 }
            : r.t === 'bool'
              ? { t: 'bool', v: false }
              : { t: 'str', v: '' },
          r,
        );
  if (r.t === 'empty')
    return l.t === 'date'
      ? 1
      : cmp(
          l,
          l.t === 'num'
            ? { t: 'num', v: 0 }
            : l.t === 'bool'
              ? { t: 'bool', v: false }
              : { t: 'str', v: '' },
        );
  if (l.t === 'num' && r.t === 'num') return l.v < r.v ? -1 : l.v > r.v ? 1 : 0;
  if (l.t === 'bool' && r.t === 'bool') return Number(l.v) - Number(r.v);
  if (l.t === 'str' && r.t === 'str') {
    const a = l.v.toLowerCase();
    const b = r.v.toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  }
  // A number against numeric-looking text compares as numbers.
  if (l.t === 'num' && r.t === 'str' && r.v.trim() !== '' && Number.isFinite(Number(r.v)))
    return cmp(l, { t: 'num', v: Number(r.v) });
  if (l.t === 'str' && r.t === 'num' && l.v.trim() !== '' && Number.isFinite(Number(l.v)))
    return cmp({ t: 'num', v: Number(l.v) }, r);
  return null;
}

function binary(op: BinOp, l: FValue, r: FValue): FValue {
  switch (op) {
    case '+':
    case '-':
    case '*':
    case '/':
    case '^':
      return arithmetic(op, l, r);
    case '&':
      return str(toStr(l) + toStr(r));
    default: {
      const c = cmp(l, r);
      if (c === null) {
        if (op === '=') return bool(false);
        if (op === '<>') return bool(true);
        throw new FormulaError("Can't compare these two different kinds of value");
      }
      switch (op) {
        case '=':
          return bool(c === 0);
        case '<>':
          return bool(c !== 0);
        case '<':
          return bool(c < 0);
        case '<=':
          return bool(c <= 0);
        case '>':
          return bool(c > 0);
        default:
          return bool(c >= 0);
      }
    }
  }
}

// ------------------------------------------------------------------ functions

function call(name: string, args: FValue[], env: EvalEnv): FValue {
  const a = args;
  switch (name) {
    // Logic (IF / IFERROR are lazy and handled in evalNode)
    case 'AND':
      return bool(a.map(toBool).every(Boolean));
    case 'OR':
      return bool(a.map(toBool).some(Boolean));
    case 'NOT':
      return bool(!toBool(a[0] as FValue));
    case 'ISBLANK':
      return bool(isBlank(a[0] as FValue));

    // Math
    case 'SUM':
      return num(numbers(a).reduce((s, n) => s + n, 0));
    case 'AVG': {
      const n = numbers(a);
      return n.length ? num(n.reduce((s, x) => s + x, 0) / n.length) : EMPTY;
    }
    case 'MIN': {
      const n = numbers(a);
      return n.length ? num(Math.min(...n)) : EMPTY;
    }
    case 'MAX': {
      const n = numbers(a);
      return n.length ? num(Math.max(...n)) : EMPTY;
    }
    case 'ROUND': {
      const digits = a[1] === undefined ? 0 : wholeNumber(a[1], 'The number of digits');
      if (digits < -10 || digits > 10)
        throw new FormulaError('ROUND digits must be between -10 and 10');
      return num(roundTo(toNum(a[0] as FValue), digits));
    }
    case 'ABS':
      return num(Math.abs(toNum(a[0] as FValue)));
    case 'FLOOR':
      return num(Math.floor(toNum(a[0] as FValue)));
    case 'CEILING':
      return num(Math.ceil(toNum(a[0] as FValue)));
    case 'MOD': {
      const d = toNum(a[1] as FValue);
      if (d === 0) throw new FormulaError('Division by zero');
      const n = toNum(a[0] as FValue);
      return num(n - d * Math.floor(n / d)); // result takes the divisor's sign, like a calendar
    }
    case 'POWER':
      return num(toNum(a[0] as FValue) ** toNum(a[1] as FValue));
    case 'SQRT': {
      const n = toNum(a[0] as FValue);
      if (n < 0) throw new FormulaError("Can't take the square root of a negative number");
      return num(Math.sqrt(n));
    }
    case 'VALUE': {
      const v = a[0] as FValue;
      if (v.t === 'num') return v;
      if (isBlank(v)) return EMPTY;
      return num(toNum(v));
    }

    // Text
    case 'CONCATENATE':
      return str(a.map(toStr).join(''));
    case 'LEN':
      return num([...toStr(a[0] as FValue)].length);
    case 'UPPER':
      return str(toStr(a[0] as FValue).toUpperCase());
    case 'LOWER':
      return str(toStr(a[0] as FValue).toLowerCase());
    case 'TRIM':
      return str(
        toStr(a[0] as FValue)
          .trim()
          .replace(/\s+/g, ' '),
      );
    case 'LEFT':
    case 'RIGHT': {
      const chars = [...toStr(a[0] as FValue)];
      const n = a[1] === undefined ? 1 : wholeNumber(a[1], 'The count');
      if (n < 0) throw new FormulaError('The count must be zero or more');
      return str((name === 'LEFT' ? chars.slice(0, n) : n === 0 ? [] : chars.slice(-n)).join(''));
    }
    case 'MID': {
      const chars = [...toStr(a[0] as FValue)];
      const start = wholeNumber(a[1] as FValue, 'The start position');
      const n = wholeNumber(a[2] as FValue, 'The count');
      if (start < 1) throw new FormulaError('The start position must be 1 or more');
      if (n < 0) throw new FormulaError('The count must be zero or more');
      return str(chars.slice(start - 1, start - 1 + n).join(''));
    }
    case 'SUBSTITUTE': {
      const text = toStr(a[0] as FValue);
      const from = toStr(a[1] as FValue);
      return str(from === '' ? text : text.split(from).join(toStr(a[2] as FValue)));
    }
    case 'CONTAINS':
      return bool(
        toStr(a[0] as FValue)
          .toLowerCase()
          .includes(toStr(a[1] as FValue).toLowerCase()),
      );

    // Date
    case 'TODAY':
      return date(env.today);
    case 'DAYS': {
      const x = toDate(a[0] as FValue);
      const y = toDate(a[1] as FValue);
      if (x === null || y === null) return EMPTY;
      return num(diffDays(x, y) ?? NaN);
    }
    case 'WORKDAYS': {
      const x = toDate(a[0] as FValue);
      const y = toDate(a[1] as FValue);
      if (x === null || y === null) return EMPTY;
      return num(workdaysBetween(x, y) ?? NaN);
    }
    case 'ADD_DAYS': {
      const d = toDate(a[0] as FValue);
      if (d === null) return EMPTY;
      const out = addDays(d, wholeNumber(a[1] as FValue, 'The number of days'));
      return out ? date(out) : err('That date is out of range');
    }
    case 'YEAR':
    case 'MONTH':
    case 'DAY': {
      const d = toDate(a[0] as FValue);
      if (d === null) return EMPTY;
      const p = dateParts(d);
      if (!p) return err('Not a valid date');
      return num(name === 'YEAR' ? p.year : name === 'MONTH' ? p.month : p.day);
    }
    case 'START':
    case 'END': {
      const v = a[0] as FValue;
      if (v.t === 'err') throw new FormulaError(v.msg);
      if (v.t === 'empty') return EMPTY;
      if (v.t === 'range') return date(name === 'START' ? v.start : v.end);
      if (v.t === 'date') return v;
      throw new FormulaError(`${name} needs a Timeline column`);
    }
  }
  throw new FormulaError(`Unknown function ${name}`);
}

function evalNode(n: Node, env: EvalEnv): FValue {
  switch (n.k) {
    case 'num':
      return num(n.v);
    case 'str':
      return str(n.v);
    case 'bool':
      return bool(n.v);
    case 'ref':
      return env.ref(n.name);
    case 'neg':
      return num(-toNum(evalNode(n.e, env)));
    case 'bin':
      return binary(n.op, evalNode(n.l, env), evalNode(n.r, env));
    case 'call': {
      if (n.name === 'IF') {
        const test = toBool(evalNode(n.args[0] as Node, env));
        const branch = test ? n.args[1] : n.args[2];
        return branch ? evalNode(branch, env) : EMPTY;
      }
      if (n.name === 'IFERROR') {
        try {
          const v = evalNode(n.args[0] as Node, env);
          if (v.t === 'err') return evalNode(n.args[1] as Node, env);
          return v;
        } catch (e) {
          if (e instanceof FormulaError) return evalNode(n.args[1] as Node, env);
          throw e;
        }
      }
      return call(
        n.name,
        n.args.map((x) => evalNode(x, env)),
        env,
      );
    }
  }
}

/** Evaluates a parsed formula. Never throws: a problem becomes an `err` value with a plain-English message. */
export function evaluate(ast: Node, env: EvalEnv): FValue {
  try {
    return evalNode(ast, env);
  } catch (e) {
    if (e instanceof FormulaError) return err(e.message);
    if (e instanceof RangeError) return err('This formula is too complicated to calculate');
    throw e;
  }
}

/** Plain-text rendering of a result (used for previews and CONCATENATE-style output). */
export function formatFValue(v: FValue): string {
  switch (v.t) {
    case 'num':
      return fmtNum(v.v);
    case 'err':
      return `#ERROR: ${v.msg}`;
    default:
      return toStr(v);
  }
}
