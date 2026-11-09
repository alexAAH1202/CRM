/**
 * Formula engine value + AST types.
 *
 * The engine is a hand-written tokenizer → parser → tree-walking evaluator. There is no
 * `eval`, no `new Function`, and no access to anything outside the `EvalEnv` it is given
 * (spec section 3: "write a safe expression parser/evaluator").
 */
export type FValue =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'date'; v: string } // YYYY-MM-DD
  | { t: 'range'; start: string; end: string } // a Timeline value
  | { t: 'empty' }
  | { t: 'err'; msg: string };

export type Node =
  | { k: 'num'; v: number; pos: number }
  | { k: 'str'; v: string; pos: number }
  | { k: 'bool'; v: boolean; pos: number }
  | { k: 'ref'; name: string; pos: number }
  | { k: 'neg'; e: Node; pos: number }
  | { k: 'bin'; op: BinOp; l: Node; r: Node; pos: number }
  | { k: 'call'; name: string; args: Node[]; pos: number };

export type BinOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '<=' | '>' | '>=';

export interface EvalEnv {
  /** Today, YYYY-MM-DD (the viewer's timezone). */
  today: string;
  /** Value of the column called `name` for the current item. Return an `err` value if unknown. */
  ref(name: string): FValue;
}

export type ParseResult =
  | { ok: true; ast: Node; refs: string[]; functions: string[] }
  | { ok: false; message: string; pos: number };

export class FormulaError extends Error {
  constructor(
    message: string,
    readonly pos?: number,
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}
