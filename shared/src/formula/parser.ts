import { canonicalFunctionName, FUNCTIONS } from './functions';
import { tokenize, type Token } from './tokenizer';
import { FormulaError, type BinOp, type Node, type ParseResult } from './types';

const MAX_DEPTH = 60;

/**
 * Precedence, loosest → tightest:
 *   comparison (= <> < <= > >=)  <  & (join text)  <  + -  <  * /  <  unary -  <  ^
 * so `-2 ^ 2` is -4, `2 ^ -1` is 0.5 and `"a" & 1 + 2` is "a3".
 */
class Parser {
  private i = 0;
  private depth = 0;
  readonly refs = new Set<string>();
  readonly functions = new Set<string>();

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.i] as Token;
  }
  private next(): Token {
    return this.tokens[this.i++] as Token;
  }
  private isOp(...ops: string[]): boolean {
    const t = this.peek();
    return t.t === 'op' && ops.includes(t.v);
  }

  parse(): Node {
    const node = this.comparison();
    const t = this.peek();
    if (t.t !== 'eof') {
      if (t.t === ')') throw new FormulaError('There is a ) without a matching (', t.pos);
      throw new FormulaError('Unexpected text after the end of the formula', t.pos);
    }
    return node;
  }

  private enter(pos: number) {
    if (++this.depth > MAX_DEPTH) throw new FormulaError('This formula is nested too deeply', pos);
  }

  private comparison(): Node {
    let left = this.concat();
    while (this.isOp('=', '<>', '<', '<=', '>', '>=')) {
      const t = this.next() as Extract<Token, { t: 'op' }>;
      left = { k: 'bin', op: t.v as BinOp, l: left, r: this.concat(), pos: t.pos };
    }
    return left;
  }

  private concat(): Node {
    let left = this.additive();
    while (this.isOp('&')) {
      const t = this.next();
      left = { k: 'bin', op: '&', l: left, r: this.additive(), pos: t.pos };
    }
    return left;
  }

  private additive(): Node {
    let left = this.term();
    while (this.isOp('+', '-')) {
      const t = this.next() as Extract<Token, { t: 'op' }>;
      left = { k: 'bin', op: t.v as BinOp, l: left, r: this.term(), pos: t.pos };
    }
    return left;
  }

  private term(): Node {
    let left = this.unary();
    while (this.isOp('*', '/')) {
      const t = this.next() as Extract<Token, { t: 'op' }>;
      left = { k: 'bin', op: t.v as BinOp, l: left, r: this.unary(), pos: t.pos };
    }
    return left;
  }

  private unary(): Node {
    const t = this.peek();
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) {
      this.next();
      this.enter(t.pos);
      const e = this.unary();
      this.depth--;
      return t.v === '-' ? { k: 'neg', e, pos: t.pos } : e;
    }
    return this.power();
  }

  private power(): Node {
    const base = this.primary();
    if (this.isOp('^')) {
      const t = this.next();
      this.enter(t.pos);
      const exp = this.unary(); // right-associative, and allows 2 ^ -1
      this.depth--;
      return { k: 'bin', op: '^', l: base, r: exp, pos: t.pos };
    }
    return base;
  }

  private primary(): Node {
    const t = this.next();
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v, pos: t.pos };
      case 'str':
        return { k: 'str', v: t.v, pos: t.pos };
      case 'ref':
        this.refs.add(t.v.toLowerCase());
        return { k: 'ref', name: t.v, pos: t.pos };
      case '(': {
        this.enter(t.pos);
        const e = this.comparison();
        this.depth--;
        const close = this.next();
        if (close.t !== ')') throw new FormulaError('This ( is missing its closing )', t.pos);
        return e;
      }
      case 'ident':
        return this.identifier(t);
      case 'eof':
        throw new FormulaError('The formula ends too soon — something is missing', t.pos);
      case 'op':
        throw new FormulaError(`Unexpected "${t.v}" — a value was expected here`, t.pos);
      case ')':
        throw new FormulaError('Unexpected ) — a value was expected here', t.pos);
      case ',':
        throw new FormulaError('Unexpected comma — a value was expected here', t.pos);
    }
  }

  private identifier(t: Extract<Token, { t: 'ident' }>): Node {
    const up = t.v.toUpperCase();
    if (up === 'TRUE' || up === 'FALSE') {
      if (this.peek().t === '(') throw new FormulaError(`${up} is a value, not a function`, t.pos);
      return { k: 'bool', v: up === 'TRUE', pos: t.pos };
    }
    if (this.peek().t !== '(') {
      throw new FormulaError(
        `"${t.v}" isn't a column or value. Put column names in { }, like {${t.v}}`,
        t.pos,
      );
    }
    const name = canonicalFunctionName(t.v);
    const spec = FUNCTIONS.get(name);
    if (!spec) throw new FormulaError(`Unknown function ${t.v.toUpperCase()}`, t.pos);
    const open = this.next();
    this.enter(open.pos);
    const args: Node[] = [];
    if (this.peek().t !== ')') {
      for (;;) {
        args.push(this.comparison());
        const sep = this.next();
        if (sep.t === ',') continue;
        if (sep.t === ')') break;
        throw new FormulaError(`Expected a comma or ) in ${name}(…)`, sep.pos);
      }
    } else {
      this.next();
    }
    this.depth--;
    if (args.length < spec.min || args.length > spec.max) {
      const want =
        spec.max === Infinity
          ? `at least ${spec.min}`
          : spec.min === spec.max
            ? `${spec.min}`
            : `${spec.min} to ${spec.max}`;
      throw new FormulaError(
        `${name} takes ${want} argument${spec.max === 1 && spec.min === 1 ? '' : 's'} (you gave ${args.length})`,
        t.pos,
      );
    }
    this.functions.add(name);
    return { k: 'call', name, args, pos: t.pos };
  }
}

/** Parses a formula. A leading "=" is allowed and ignored. Never throws: errors come back as a result. */
export function parseFormula(source: string): ParseResult {
  let src = source;
  const trimmed = src.trimStart();
  if (trimmed.startsWith('=')) {
    // Blank out the "=" (instead of removing it) so error positions still match the original text.
    const lead = src.length - trimmed.length;
    src = ' '.repeat(lead + 1) + trimmed.slice(1);
  }
  if (src.trim() === '')
    return { ok: false, message: 'Type a formula, for example {Budget} * 2', pos: 0 };
  try {
    const parser = new Parser(tokenize(src));
    const ast = parser.parse();
    return { ok: true, ast, refs: [...parser.refs], functions: [...parser.functions] };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, message: e.message, pos: e.pos ?? 0 };
    throw e;
  }
}
