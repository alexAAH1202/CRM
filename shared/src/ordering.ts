/**
 * Fractional indexing: string order keys so a drag-reorder writes ONE document.
 * Algorithm after "Implementing Fractional Indexing" (David Greenspan) /
 * rocicorp/fractional-indexing (CC0). Keys compare with plain `<`, which also
 * matches Firestore's string ordering for this ASCII alphabet.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0] as string;
const SMALLEST_INTEGER = 'A' + ZERO.repeat(26);

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a.slice(-1) === ZERO || (b && b.slice(-1) === ZERO)) throw new Error('trailing zero');
  if (b) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0] as string) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0] as string) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB))] as string;
  if (b && b.length > 1) return b.slice(0, 1);
  return (DIGITS[digitA] as string) + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`invalid order key head: ${head}`);
}

function integerPart(key: string): string {
  const len = integerLength(key[0] as string);
  if (len > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, len);
}

function validate(key: string) {
  if (key === SMALLEST_INTEGER) throw new Error(`invalid order key: ${key}`);
  const i = integerPart(key);
  if (key.slice(i.length).slice(-1) === ZERO) throw new Error(`invalid order key: ${key}`);
}

function incrementInteger(x: string): string | null {
  const [head, ...digs] = x.split('') as [string, ...string[]];
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i] as string) + 1;
    if (d === DIGITS.length) digs[i] = ZERO;
    else {
      digs[i] = DIGITS[d] as string;
      carry = false;
    }
  }
  if (!carry) return head + digs.join('');
  if (head === 'Z') return 'a' + ZERO;
  if (head === 'z') return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > 'a') digs.push(ZERO);
  else digs.pop();
  return h + digs.join('');
}

function decrementInteger(x: string): string | null {
  const [head, ...digs] = x.split('') as [string, ...string[]];
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i] as string) - 1;
    if (d === -1) digs[i] = DIGITS.slice(-1);
    else {
      digs[i] = DIGITS[d] as string;
      borrow = false;
    }
  }
  if (!borrow) return head + digs.join('');
  if (head === 'a') return 'Z' + DIGITS.slice(-1);
  if (head === 'A') return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < 'Z') digs.push(DIGITS.slice(-1));
  else digs.pop();
  return h + digs.join('');
}

/** A key strictly between a and b (null = open end). */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) validate(a);
  if (b !== null) validate(b);
  if (a !== null && b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a === null) {
    if (b === null) return 'a' + ZERO;
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new Error('cannot decrement any more');
    return res;
  }
  if (b === null) {
    const ia = integerPart(a);
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(a.slice(ia.length), null) : i;
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i === null) throw new Error('cannot increment any more');
  if (i < b) return i;
  return ia + midpoint(fa, null);
}

/** n ascending keys strictly between a and b. */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [keyBetween(a, b)];
  if (b === null) {
    const out: string[] = [];
    let c = a;
    for (let i = 0; i < n; i++) out.push((c = keyBetween(c, null)));
    return out;
  }
  if (a === null) {
    const out: string[] = [];
    let c: string | null = b;
    for (let i = 0; i < n; i++) out.push((c = keyBetween(null, c)));
    return out.reverse();
  }
  const mid = Math.floor(n / 2);
  const c = keyBetween(a, b);
  return [...keysBetween(a, c, mid), c, ...keysBetween(c, b, n - mid - 1)];
}

/** Sort comparator for anything with an `order` key (ties broken by id for stability). */
export function byOrder<T extends { order: string; id?: string }>(x: T, y: T): number {
  if (x.order < y.order) return -1;
  if (x.order > y.order) return 1;
  return (x.id ?? '') < (y.id ?? '') ? -1 : (x.id ?? '') > (y.id ?? '') ? 1 : 0;
}
