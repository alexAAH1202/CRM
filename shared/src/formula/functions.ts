export type FnGroup = 'Math' | 'Text' | 'Logic' | 'Date';

export interface FnSpec {
  name: string;
  min: number;
  max: number;
  signature: string;
  doc: string;
  group: FnGroup;
}

const v = Infinity;

/** Every function the engine knows. The parser checks names and argument counts against this. */
export const FUNCTION_LIST: readonly FnSpec[] = [
  {
    name: 'IF',
    min: 2,
    max: 3,
    signature: 'IF(test, then, else)',
    doc: 'then if test is true, otherwise else (blank if omitted).',
    group: 'Logic',
  },
  {
    name: 'AND',
    min: 1,
    max: v,
    signature: 'AND(a, b, …)',
    doc: 'True when every argument is true.',
    group: 'Logic',
  },
  {
    name: 'OR',
    min: 1,
    max: v,
    signature: 'OR(a, b, …)',
    doc: 'True when any argument is true.',
    group: 'Logic',
  },
  {
    name: 'NOT',
    min: 1,
    max: 1,
    signature: 'NOT(a)',
    doc: 'Flips true and false.',
    group: 'Logic',
  },
  {
    name: 'IFERROR',
    min: 2,
    max: 2,
    signature: 'IFERROR(value, fallback)',
    doc: 'fallback when value is an error.',
    group: 'Logic',
  },
  {
    name: 'ISBLANK',
    min: 1,
    max: 1,
    signature: 'ISBLANK(value)',
    doc: 'True when the value is empty.',
    group: 'Logic',
  },

  {
    name: 'SUM',
    min: 1,
    max: v,
    signature: 'SUM(a, b, …)',
    doc: 'Adds numbers; blanks are skipped.',
    group: 'Math',
  },
  {
    name: 'AVG',
    min: 1,
    max: v,
    signature: 'AVG(a, b, …)',
    doc: 'Average of the numbers; blanks are skipped.',
    group: 'Math',
  },
  {
    name: 'MIN',
    min: 1,
    max: v,
    signature: 'MIN(a, b, …)',
    doc: 'Smallest number.',
    group: 'Math',
  },
  { name: 'MAX', min: 1, max: v, signature: 'MAX(a, b, …)', doc: 'Largest number.', group: 'Math' },
  {
    name: 'ROUND',
    min: 1,
    max: 2,
    signature: 'ROUND(number, digits)',
    doc: 'Rounds to the given decimal places (0 if omitted).',
    group: 'Math',
  },
  {
    name: 'ABS',
    min: 1,
    max: 1,
    signature: 'ABS(number)',
    doc: 'Drops the minus sign.',
    group: 'Math',
  },
  {
    name: 'FLOOR',
    min: 1,
    max: 1,
    signature: 'FLOOR(number)',
    doc: 'Rounds down to a whole number.',
    group: 'Math',
  },
  {
    name: 'CEILING',
    min: 1,
    max: 1,
    signature: 'CEILING(number)',
    doc: 'Rounds up to a whole number.',
    group: 'Math',
  },
  {
    name: 'MOD',
    min: 2,
    max: 2,
    signature: 'MOD(number, divisor)',
    doc: 'Remainder after dividing.',
    group: 'Math',
  },
  {
    name: 'POWER',
    min: 2,
    max: 2,
    signature: 'POWER(base, exponent)',
    doc: 'base raised to exponent (same as base ^ exponent).',
    group: 'Math',
  },
  { name: 'SQRT', min: 1, max: 1, signature: 'SQRT(number)', doc: 'Square root.', group: 'Math' },
  {
    name: 'VALUE',
    min: 1,
    max: 1,
    signature: 'VALUE(text)',
    doc: 'Turns text like "12.5" into a number.',
    group: 'Math',
  },

  {
    name: 'CONCATENATE',
    min: 1,
    max: v,
    signature: 'CONCATENATE(a, b, …)',
    doc: 'Joins values into one piece of text (same as a & b).',
    group: 'Text',
  },
  {
    name: 'LEN',
    min: 1,
    max: 1,
    signature: 'LEN(text)',
    doc: 'Number of characters.',
    group: 'Text',
  },
  { name: 'UPPER', min: 1, max: 1, signature: 'UPPER(text)', doc: 'UPPER CASE.', group: 'Text' },
  { name: 'LOWER', min: 1, max: 1, signature: 'LOWER(text)', doc: 'lower case.', group: 'Text' },
  {
    name: 'TRIM',
    min: 1,
    max: 1,
    signature: 'TRIM(text)',
    doc: 'Removes extra spaces.',
    group: 'Text',
  },
  {
    name: 'LEFT',
    min: 1,
    max: 2,
    signature: 'LEFT(text, count)',
    doc: 'First characters (1 if count omitted).',
    group: 'Text',
  },
  {
    name: 'RIGHT',
    min: 1,
    max: 2,
    signature: 'RIGHT(text, count)',
    doc: 'Last characters (1 if count omitted).',
    group: 'Text',
  },
  {
    name: 'MID',
    min: 3,
    max: 3,
    signature: 'MID(text, start, count)',
    doc: 'count characters from position start (1 = first).',
    group: 'Text',
  },
  {
    name: 'SUBSTITUTE',
    min: 3,
    max: 3,
    signature: 'SUBSTITUTE(text, old, new)',
    doc: 'Replaces every old with new.',
    group: 'Text',
  },
  {
    name: 'CONTAINS',
    min: 2,
    max: 2,
    signature: 'CONTAINS(text, search)',
    doc: 'True if text includes search (ignores case).',
    group: 'Text',
  },

  { name: 'TODAY', min: 0, max: 0, signature: 'TODAY()', doc: 'Today’s date.', group: 'Date' },
  {
    name: 'DAYS',
    min: 2,
    max: 2,
    signature: 'DAYS(later, earlier)',
    doc: 'Days from earlier to later (negative if later is before earlier).',
    group: 'Date',
  },
  {
    name: 'WORKDAYS',
    min: 2,
    max: 2,
    signature: 'WORKDAYS(start, end)',
    doc: 'Working days (Mon–Fri) from start to end, both included.',
    group: 'Date',
  },
  {
    name: 'ADD_DAYS',
    min: 2,
    max: 2,
    signature: 'ADD_DAYS(date, days)',
    doc: 'The date this many days later (or earlier if negative).',
    group: 'Date',
  },
  {
    name: 'YEAR',
    min: 1,
    max: 1,
    signature: 'YEAR(date)',
    doc: 'The year of a date.',
    group: 'Date',
  },
  {
    name: 'MONTH',
    min: 1,
    max: 1,
    signature: 'MONTH(date)',
    doc: 'The month of a date (1–12).',
    group: 'Date',
  },
  {
    name: 'DAY',
    min: 1,
    max: 1,
    signature: 'DAY(date)',
    doc: 'The day of the month.',
    group: 'Date',
  },
  {
    name: 'START',
    min: 1,
    max: 1,
    signature: 'START(timeline)',
    doc: 'The start date of a Timeline column.',
    group: 'Date',
  },
  {
    name: 'END',
    min: 1,
    max: 1,
    signature: 'END(timeline)',
    doc: 'The end date of a Timeline column.',
    group: 'Date',
  },
];

export const FUNCTIONS: ReadonlyMap<string, FnSpec> = new Map(
  FUNCTION_LIST.map((f) => [f.name, f]),
);
export const ALIASES: Readonly<Record<string, string>> = { AVERAGE: 'AVG', CONCAT: 'CONCATENATE' };

export function canonicalFunctionName(name: string): string {
  const up = name.toUpperCase();
  return ALIASES[up] ?? up;
}
