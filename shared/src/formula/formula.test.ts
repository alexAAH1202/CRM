import { describe, expect, it } from 'vitest';
import {
  evaluate,
  formatFValue,
  parseFormula,
  FUNCTION_LIST,
  MAX_FORMULA_LENGTH,
  type FValue,
} from './index';
import { bool, date, EMPTY, num, str } from './index';

const TODAY = '2026-06-15'; // a Monday

/** Evaluate `src` with the given column values (by lower-cased title). */
function run(src: string, cols: Record<string, FValue> = {}): FValue {
  const p = parseFormula(src);
  if (!p.ok) throw new Error(`parse failed: ${p.message}`);
  return evaluate(p.ast, {
    today: TODAY,
    ref: (name) => {
      const key = name.toLowerCase();
      // Own properties only: a column called "constructor" must not find Object.prototype.
      return Object.hasOwn(cols, key)
        ? (cols[key] as FValue)
        : { t: 'err', msg: `Unknown column {${name}}` };
    },
  });
}
const text = (src: string, cols?: Record<string, FValue>) => formatFValue(run(src, cols));
const errOf = (src: string, cols?: Record<string, FValue>) => {
  const v = run(src, cols);
  if (v.t !== 'err') throw new Error(`expected an error, got ${JSON.stringify(v)}`);
  return v.msg;
};
const parseErr = (src: string) => {
  const p = parseFormula(src);
  if (p.ok) throw new Error('expected a parse error');
  return p;
};

describe('arithmetic and precedence', () => {
  it.each([
    ['1 + 2', 3],
    ['2 + 3 * 4', 14],
    ['(2 + 3) * 4', 20],
    ['10 - 4 - 3', 3], // left-associative
    ['100 / 10 / 5', 2],
    ['2 ^ 3 ^ 2', 512], // right-associative
    ['-2 ^ 2', -4],
    ['2 ^ -1', 0.5],
    ['--3', 3],
    ['+5', 5],
    ['-(1 + 2)', -3],
    ['1.5 * 4', 6],
    ['.5 + .25', 0.75],
    ['7 / 2', 3.5],
    ['2 * (3 + (4 - 1))', 12],
  ])('%s = %s', (src, want) => {
    expect(run(src)).toEqual(num(want));
  });

  it('hides binary floating-point noise', () => {
    expect(run('0.1 + 0.2')).toEqual(num(0.3));
    expect(run('1.1 * 3')).toEqual(num(3.3));
    expect(text('0.1 + 0.2')).toBe('0.3');
    expect(run('1 / 3')).toEqual(num(0.333333333333));
  });

  it('allows a leading = and any amount of whitespace', () => {
    expect(run('=1+1')).toEqual(num(2));
    expect(run('  =  1 +\n 1  ')).toEqual(num(2));
  });

  it('treats blank cells as zero in arithmetic', () => {
    expect(run('{a} + 5', { a: EMPTY })).toEqual(num(5));
    expect(run('{a} * {b}', { a: EMPTY, b: num(4) })).toEqual(num(0));
  });

  it('coerces numeric text and booleans, but explains non-numeric text', () => {
    expect(run('{a} + 1', { a: str('41') })).toEqual(num(42));
    expect(run('TRUE + TRUE')).toEqual(num(2));
    expect(errOf('{a} + 1', { a: str('abc') })).toBe('Expected a number but got text "abc"');
  });

  it('division by zero and non-finite results are errors, not Infinity', () => {
    expect(errOf('1 / 0')).toBe('Division by zero');
    expect(errOf('{a} / {b}', { a: num(5), b: EMPTY })).toBe('Division by zero');
    expect(errOf('10 ^ 400')).toBe('The result is not a finite number');
  });
});

describe('text and comparison', () => {
  it('joins with & and CONCATENATE', () => {
    expect(run('"a" & "b" & 1')).toEqual(str('ab1'));
    expect(run('"Total: " & 1 + 2')).toEqual(str('Total: 3')); // + binds tighter than &
    expect(run('CONCATENATE("x", 1, TRUE, "")')).toEqual(str('x1TRUE'));
    expect(run('CONCAT("a","b")')).toEqual(str('ab'));
  });

  it('supports both quote styles and doubled-quote escapes', () => {
    expect(run('"say ""hi"""')).toEqual(str('say "hi"'));
    expect(run("'it''s'")).toEqual(str("it's"));
    expect(run('"{not a ref}"')).toEqual(str('{not a ref}'));
  });

  it.each([
    ['1 = 1', true],
    ['1 <> 2', true],
    ['1 != 1', false],
    ['2 > 1', true],
    ['2 >= 2', true],
    ['1 < 1', false],
    ['1 <= 1', true],
    ['"abc" = "ABC"', true], // case-insensitive
    ['"apple" < "banana"', true],
    ['TRUE > FALSE', true],
    ['1 = "1"', true], // number vs numeric text
    ['1 = "one"', false],
    ['1 <> "one"', true],
    ['"" = {blank}', true],
    ['0 = {blank}', true],
    ['FALSE = {blank}', true],
  ])('%s → %s', (src, want) => {
    expect(run(src, { blank: EMPTY })).toEqual(bool(want));
  });

  it('refuses to order unrelated kinds of value', () => {
    expect(errOf('1 < "one"')).toBe("Can't compare these two different kinds of value");
  });

  it('compares dates, including ISO text, and treats blank as earlier than any date', () => {
    expect(run('{d} > "2026-01-01"', { d: date('2026-02-01') })).toEqual(bool(true));
    expect(run('{d} < {e}', { d: date('2026-01-01'), e: date('2026-01-02') })).toEqual(bool(true));
    expect(run('{d} < {e}', { d: EMPTY, e: date('2026-01-02') })).toEqual(bool(true));
    expect(run('{d} = {e}', { d: EMPTY, e: date('2026-01-02') })).toEqual(bool(false));
  });
});

describe('logic', () => {
  it('IF is lazy: the untaken branch is never evaluated', () => {
    expect(run('IF(TRUE, 1, 1/0)')).toEqual(num(1));
    expect(run('IF(FALSE, 1/0, 2)')).toEqual(num(2));
    expect(run('IF(FALSE, 1)')).toEqual(EMPTY);
  });
  it('IF accepts numbers and "true"/"false" text as conditions', () => {
    expect(run('IF(0, "y", "n")')).toEqual(str('n'));
    expect(run('IF(5, "y", "n")')).toEqual(str('y'));
    expect(run('IF({s}, "y", "n")', { s: str('TRUE') })).toEqual(str('y'));
    expect(errOf('IF("maybe", 1, 2)')).toBe('Expected true or false but got text "maybe"');
  });
  it('AND / OR / NOT / ISBLANK', () => {
    expect(run('AND(1 < 2, 2 < 3, TRUE)')).toEqual(bool(true));
    expect(run('AND(1 < 2, 3 < 2)')).toEqual(bool(false));
    expect(run('OR(FALSE, 0, 1)')).toEqual(bool(true));
    expect(run('NOT(1 = 2)')).toEqual(bool(true));
    expect(run('ISBLANK({a})', { a: EMPTY })).toEqual(bool(true));
    expect(run('ISBLANK({a})', { a: str('') })).toEqual(bool(true));
    expect(run('ISBLANK({a})', { a: num(0) })).toEqual(bool(false));
  });
  it('IFERROR catches errors from anywhere inside', () => {
    expect(run('IFERROR(1/0, "n/a")')).toEqual(str('n/a'));
    expect(run('IFERROR({missing}, 0)')).toEqual(num(0));
    expect(run('IFERROR(5, 0)')).toEqual(num(5));
    expect(run('IFERROR(IFERROR(1/0, 2/0), 9)')).toEqual(num(9));
  });
});

describe('math functions', () => {
  it.each([
    ['SUM(1, 2, 3)', 6],
    ['SUM(1, {b}, 3)', 4],
    ['AVG(2, 4, 6)', 4],
    ['AVERAGE(1, 2)', 1.5],
    ['MIN(3, 1, 2)', 1],
    ['MAX(3, 1, 2)', 3],
    ['ROUND(2.5)', 3],
    ['ROUND(-2.5)', -3],
    ['ROUND(1.005, 2)', 1.01],
    ['ROUND(1234.567, -2)', 1200],
    ['ROUND(3.14159, 3)', 3.142],
    ['ABS(-4.5)', 4.5],
    ['FLOOR(2.9)', 2],
    ['FLOOR(-2.1)', -3],
    ['CEILING(2.1)', 3],
    ['MOD(10, 3)', 1],
    ['MOD(-1, 3)', 2],
    ['POWER(2, 10)', 1024],
    ['SQRT(144)', 12],
    ['VALUE("12.5")', 12.5],
  ])('%s = %s', (src, want) => {
    expect(run(src, { b: EMPTY })).toEqual(num(want));
  });

  it('AVG/MIN/MAX of nothing is blank, SUM of nothing is 0', () => {
    expect(run('AVG({a})', { a: EMPTY })).toEqual(EMPTY);
    expect(run('MIN({a}, {a})', { a: EMPTY })).toEqual(EMPTY);
    expect(run('SUM({a})', { a: EMPTY })).toEqual(num(0));
  });

  it('reports bad inputs plainly', () => {
    expect(errOf('SQRT(-1)')).toBe("Can't take the square root of a negative number");
    expect(errOf('MOD(5, 0)')).toBe('Division by zero');
    expect(errOf('ROUND(1, 1.5)')).toBe('The number of digits must be a whole number');
    expect(errOf('ROUND(1, 11)')).toBe('ROUND digits must be between -10 and 10');
    expect(errOf('SUM("a", 1)')).toBe('Expected a number but got text "a"');
  });
});

describe('text functions', () => {
  it.each([
    ['LEN("héllo")', num(5)],
    ['LEN("😀a")', num(2)], // counts characters, not UTF-16 units
    ['UPPER("abc")', str('ABC')],
    ['LOWER("ABC")', str('abc')],
    ['TRIM("  a   b  ")', str('a b')],
    ['LEFT("hello", 2)', str('he')],
    ['LEFT("hello")', str('h')],
    ['RIGHT("hello", 3)', str('llo')],
    ['RIGHT("hello", 0)', str('')],
    ['RIGHT("hi", 10)', str('hi')],
    ['MID("hello", 2, 3)', str('ell')],
    ['MID("hello", 4, 99)', str('lo')],
    ['SUBSTITUTE("a-b-c", "-", "+")', str('a+b+c')],
    ['SUBSTITUTE("abc", "", "x")', str('abc')],
    ['CONTAINS("Pay Electricity", "ELEC")', bool(true)],
    ['CONTAINS("abc", "z")', bool(false)],
  ])('%s', (src, want) => {
    expect(run(src)).toEqual(want);
  });
  it('validates counts', () => {
    expect(errOf('LEFT("a", -1)')).toBe('The count must be zero or more');
    expect(errOf('MID("abc", 0, 1)')).toBe('The start position must be 1 or more');
  });
});

describe('dates', () => {
  it('TODAY and DAYS (later − earlier)', () => {
    expect(run('TODAY()')).toEqual(date(TODAY));
    expect(run('DAYS({d}, TODAY())', { d: date('2026-06-20') })).toEqual(num(5));
    expect(run('DAYS({d}, TODAY())', { d: date('2026-06-10') })).toEqual(num(-5));
    expect(run('DAYS("2026-03-01", "2026-02-01")')).toEqual(num(28));
    expect(run('DAYS("2028-03-01", "2028-02-01")')).toEqual(num(29)); // leap year
  });
  it('date arithmetic: date ± days, date − date', () => {
    expect(run('{d} + 10', { d: date('2026-06-25') })).toEqual(date('2026-07-05'));
    expect(run('{d} - 30', { d: date('2026-03-01') })).toEqual(date('2026-01-30'));
    expect(run('7 + {d}', { d: date('2026-12-28') })).toEqual(date('2027-01-04'));
    expect(run('{a} - {b}', { a: date('2026-06-15'), b: date('2026-06-01') })).toEqual(num(14));
    expect(run('ADD_DAYS({d}, -1)', { d: date('2026-03-01') })).toEqual(date('2026-02-28'));
    expect(errOf('{a} + {b}', { a: date('2026-01-01'), b: date('2026-01-02') })).toBe(
      "Can't add two dates together",
    );
    expect(errOf('5 - {a}', { a: date('2026-01-01') })).toBe("Can't subtract a date from a number");
  });
  it('YEAR / MONTH / DAY', () => {
    const d = { d: date('2026-11-09') };
    expect(run('YEAR({d})', d)).toEqual(num(2026));
    expect(run('MONTH({d})', d)).toEqual(num(11));
    expect(run('DAY({d})', d)).toEqual(num(9));
  });
  it.each([
    ['2026-06-15', '2026-06-19', 5], // Mon–Fri
    ['2026-06-15', '2026-06-21', 5], // through Sunday
    ['2026-06-13', '2026-06-14', 0], // Sat–Sun
    ['2026-06-15', '2026-06-15', 1], // a single Monday
    ['2026-06-13', '2026-06-13', 0], // a single Saturday
    ['2026-06-01', '2026-06-30', 22],
    ['2026-06-19', '2026-06-15', -5], // backwards
    ['2026-01-01', '2026-12-31', 261],
  ])('WORKDAYS(%s, %s) = %s', (a, b, want) => {
    expect(run(`WORKDAYS("${a}", "${b}")`)).toEqual(num(want));
  });
  it('date formulas on blank cells stay blank', () => {
    expect(run('DAYS({d}, TODAY())', { d: EMPTY })).toEqual(EMPTY);
    expect(run('WORKDAYS({d}, TODAY())', { d: EMPTY })).toEqual(EMPTY);
    expect(run('ADD_DAYS({d}, 3)', { d: EMPTY })).toEqual(EMPTY);
    expect(run('YEAR({d})', { d: EMPTY })).toEqual(EMPTY);
  });
  it('START / END read Timeline values', () => {
    const t = { t: { t: 'range', start: '2026-01-05', end: '2026-01-09' } as FValue };
    expect(run('START({t})', t)).toEqual(date('2026-01-05'));
    expect(run('DAYS(END({t}), START({t}))', t)).toEqual(num(4));
    expect(errOf('START(5)')).toBe('START needs a Timeline column');
  });
  it('rejects things that are not dates', () => {
    expect(errOf('DAYS("hello", TODAY())')).toBe('Expected a date but got text "hello"');
    expect(errOf('DAYS("2026-02-30", TODAY())')).toBe('Expected a date but got text "2026-02-30"');
  });
  it('an overdue-style formula reads naturally', () => {
    const f =
      'IF({due} = "", "", IF(DAYS({due}, TODAY()) < 0, "Overdue by " & -DAYS({due}, TODAY()) & " days", "Due in " & DAYS({due}, TODAY()) & " days"))';
    expect(text(f, { due: date('2026-06-10') })).toBe('Overdue by 5 days');
    expect(text(f, { due: date('2026-06-18') })).toBe('Due in 3 days');
    expect(text(f, { due: EMPTY })).toBe('');
  });
});

describe('column references', () => {
  it('look up by name, ignoring case and surrounding spaces, including names with spaces and symbols', () => {
    expect(run('{ Budget } * 2', { budget: num(4) })).toEqual(num(8));
    expect(run('{Due date}', { 'due date': date('2026-01-01') })).toEqual(date('2026-01-01'));
    expect(run('{Cost ($)} + 1', { 'cost ($)': num(1) })).toEqual(num(2));
  });
  it('an unknown column is a clear error', () => {
    expect(errOf('{Nope} + 1')).toBe('Unknown column {Nope}');
  });
  it('errors from a referenced column propagate through arithmetic, text and logic', () => {
    const bad = { x: { t: 'err', msg: 'Division by zero' } as FValue };
    expect(errOf('{x} + 1', bad)).toBe('Division by zero');
    expect(errOf('"a" & {x}', bad)).toBe('Division by zero');
    expect(errOf('IF({x}, 1, 2)', bad)).toBe('Division by zero');
    expect(errOf('SUM(1, {x})', bad)).toBe('Division by zero');
    expect(run('IFERROR({x}, 0)', bad)).toEqual(num(0));
  });
  it('reports the references and functions a formula uses', () => {
    const p = parseFormula('IF({Done}, SUM({A}, {a}), ROUND({B}))');
    expect(p.ok && [...p.refs].sort()).toEqual(['a', 'b', 'done']);
    expect(p.ok && [...p.functions].sort()).toEqual(['IF', 'ROUND', 'SUM']);
  });
});

describe('syntax errors point at the problem', () => {
  it.each([
    ['', 'Type a formula', 0],
    ['   ', 'Type a formula', 0],
    ['1 +', 'The formula ends too soon', 3],
    ['(1 + 2', 'This ( is missing its closing )', 0],
    ['1 + 2)', 'There is a ) without a matching (', 5],
    ['1 2', 'Unexpected text after the end', 2],
    ['* 2', 'Unexpected "*"', 0],
    ['1 + * 2', 'Unexpected "*"', 4],
    ['{Budget', 'missing its closing }', 0],
    ['{}', 'Put a column name between { }', 0],
    ['"abc', 'missing its closing quote', 0],
    ['1 # 2', 'Unexpected character "#"', 2],
    ['FOO(1)', 'Unknown function FOO', 0],
    ['Budget * 2', '"Budget" isn\'t a column or value. Put column names in { }', 0],
    ['IF(1, 2,)', 'Unexpected ) — a value was expected here', 8],
    ['SUM(1 2)', 'Expected a comma or ) in SUM', 6],
    ['ROUND()', 'ROUND takes 1 to 2 arguments (you gave 0)', 0],
    ['ROUND(1, 2, 3)', 'ROUND takes 1 to 2 arguments (you gave 3)', 0],
    ['TODAY(1)', 'TODAY takes 0 arguments (you gave 1)', 0],
    ['NOT(1, 2)', 'NOT takes 1 argument (you gave 2)', 0],
    ['SUM()', 'SUM takes at least 1 arguments', 0],
    ['TRUE()', 'TRUE is a value, not a function', 0],
    ['1.2.3', 'Unexpected text after the end', 3],
    ['= = 1', 'Unexpected "="', 2],
  ])('%j → %s', (src, fragment, pos) => {
    const p = parseErr(src);
    expect(p.message).toContain(fragment);
    expect(p.pos).toBe(pos);
  });
});

describe('safety (no eval, no escape from the sandbox)', () => {
  it('JavaScript-looking input is just a syntax error or inert text', () => {
    for (const evil of [
      'constructor.constructor("return 1")()',
      '__proto__',
      'this',
      'process.exit()',
      'globalThis',
      'alert(1)',
      'fetch("http://x")',
      '`${1}`',
      '1; 2',
      'a => a',
      'require("fs")',
    ]) {
      expect(parseFormula(evil).ok, evil).toBe(false);
    }
  });
  it('prototype-property names are ordinary (unknown) column names', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(errOf(`{${name}}`)).toBe(`Unknown column {${name}}`);
    }
    // Text that looks like code is only ever text.
    expect(run('"constructor" & "__proto__"')).toEqual(str('constructor__proto__'));
    expect(run('"alert(1)"')).toEqual(str('alert(1)'));
  });
  it('function names cannot reach inherited properties', () => {
    expect(parseErr('constructor(1)').message).toContain('Unknown function CONSTRUCTOR');
    expect(parseErr('toString()').message).toContain('Unknown function TOSTRING');
  });
  it('rejects over-long formulas', () => {
    const p = parseErr('1+'.repeat(MAX_FORMULA_LENGTH));
    expect(p.message).toContain(`at most ${MAX_FORMULA_LENGTH} characters`);
  });
  it('rejects absurd nesting instead of overflowing the stack', () => {
    const deep = `${'('.repeat(400)}1${')'.repeat(400)}`;
    expect(parseErr(deep).message).toContain('nested too deeply');
    const negs = `${'-'.repeat(500)}1`;
    expect(parseErr(negs).message).toContain('nested too deeply');
    const calls = `${'ABS('.repeat(150)}1${')'.repeat(150)}`;
    expect(parseErr(calls).message).toContain('nested too deeply');
  });
  it('long but flat formulas are fine', () => {
    const sum = Array.from({ length: 200 }, (_, i) => String(i)).join('+');
    expect(sum.length).toBeLessThan(MAX_FORMULA_LENGTH);
    expect(run(sum)).toEqual(num((199 * 200) / 2));
  });
  it('never throws for arbitrary input (fuzz)', () => {
    let seed = 1234;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const alphabet = [
      '1',
      '2',
      '.',
      '+',
      '-',
      '*',
      '/',
      '^',
      '&',
      '=',
      '<',
      '>',
      '(',
      ')',
      ',',
      '"',
      "'",
      '{',
      '}',
      ' ',
      'a',
      'IF(',
      'SUM(',
      'TODAY()',
      '{x}',
      'TRUE',
      '0',
      '\n',
      '\\',
      '$',
      '😀',
    ];
    for (let n = 0; n < 3000; n++) {
      const len = 1 + Math.floor(rnd() * 24);
      let src = '';
      for (let i = 0; i < len; i++) src += alphabet[Math.floor(rnd() * alphabet.length)];
      const p = parseFormula(src);
      if (p.ok) {
        const v = evaluate(p.ast, { today: TODAY, ref: () => num(2) });
        expect(['num', 'str', 'bool', 'date', 'empty', 'err']).toContain(v.t);
      } else {
        expect(typeof p.message).toBe('string');
        expect(p.pos).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('function reference', () => {
  it('every documented function parses with its minimum arguments', () => {
    for (const f of FUNCTION_LIST) {
      const args = Array.from({ length: f.min }, () => '1').join(', ');
      expect(parseFormula(`${f.name}(${args})`).ok, f.name).toBe(true);
    }
  });
  it('has unique names and sensible metadata', () => {
    const names = FUNCTION_LIST.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const f of FUNCTION_LIST) {
      expect(f.signature.startsWith(f.name)).toBe(true);
      expect(f.doc.length).toBeGreaterThan(5);
      expect(f.min).toBeLessThanOrEqual(f.max);
    }
  });
  it('is case-insensitive', () => {
    expect(run('sum(1,2)')).toEqual(num(3));
    expect(run('If(true, "a", "b")')).toEqual(str('a'));
  });
});
