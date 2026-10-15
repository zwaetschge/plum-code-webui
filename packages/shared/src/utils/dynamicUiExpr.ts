/**
 * Safe expression language for Dynamic UI. Models configure calculations as
 * small formulas ("start * (1 + rate / 100) ^ years"); they are parsed into an
 * AST and interpreted against a whitelist of operators and functions. There is
 * no eval, no property access and no way to reach the host environment.
 */

export type UiValue = number | string | boolean | null;
export type UiRow = Record<string, UiValue>;

export type ExprNode =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'id'; name: string }
  | { t: 'un'; op: '-' | '!' | '+'; arg: ExprNode }
  | { t: 'bin'; op: string; left: ExprNode; right: ExprNode }
  | { t: 'cond'; test: ExprNode; yes: ExprNode; no: ExprNode }
  | { t: 'call'; fn: string; args: ExprNode[] };

export const EXPR_MAX_LENGTH = 400;
const MAX_NODES = 200;

type Token =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string };

const OPERATORS = [
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '(',
  ')',
  ',',
  '?',
  ':',
  '<',
  '>',
  '!',
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
      if (!match) throw new Error(`Ungültige Zahl bei ${i}`);
      tokens.push({ k: 'num', v: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = source.indexOf(c, i + 1);
      if (end < 0) throw new Error('Offene Zeichenkette');
      tokens.push({ k: 'str', v: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!;
      tokens.push({ k: 'id', v: match[0] });
      i += match[0].length;
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (!op) throw new Error(`Unerwartetes Zeichen "${c}"`);
    tokens.push({ k: 'op', v: op });
    i += op.length;
  }
  return tokens;
}

const BINARY: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
  '^': 8,
};

/** Parses a formula into an AST, or throws with a readable reason. */
export function parseExpr(source: string): ExprNode {
  if (typeof source !== 'string') throw new Error('Ausdruck muss Text sein');
  if (source.length > EXPR_MAX_LENGTH) throw new Error('Ausdruck zu lang');
  const tokens = tokenize(source);
  let pos = 0;
  let nodes = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.k === 'op' && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`"${v}" erwartet`);
    pos++;
  };
  const make = <N extends ExprNode>(node: N): N => {
    if (++nodes > MAX_NODES) throw new Error('Ausdruck zu komplex');
    return node;
  };

  function primary(): ExprNode {
    const token = tokens[pos++];
    if (!token) throw new Error('Unvollständiger Ausdruck');
    if (token.k === 'num') return make({ t: 'num', v: token.v });
    if (token.k === 'str') return make({ t: 'str', v: token.v });
    if (token.k === 'id') {
      if (token.v === 'true' || token.v === 'false')
        return make({ t: 'bool', v: token.v === 'true' });
      if (isOp('(')) {
        pos++;
        const args: ExprNode[] = [];
        if (!isOp(')')) {
          do args.push(expression(0));
          while (isOp(',') && ++pos);
        }
        expect(')');
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, token.v))
          throw new Error(`Unbekannte Funktion ${token.v}`);
        return make({ t: 'call', fn: token.v, args });
      }
      return make({ t: 'id', name: token.v });
    }
    if (token.v === '(') {
      const inner = expression(0);
      expect(')');
      return inner;
    }
    if (token.v === '-' || token.v === '!' || token.v === '+')
      return make({ t: 'un', op: token.v, arg: expression(7) });
    throw new Error(`Unerwartetes "${token.v}"`);
  }

  function expression(minPrecedence: number): ExprNode {
    let left = primary();
    for (;;) {
      const token = peek();
      if (!token || token.k !== 'op') break;
      if (token.v === '?' && minPrecedence === 0) {
        pos++;
        const yes = expression(0);
        expect(':');
        const no = expression(0);
        left = make({ t: 'cond', test: left, yes, no });
        continue;
      }
      const precedence = BINARY[token.v];
      if (precedence === undefined || precedence < minPrecedence) break;
      pos++;
      // ^ is right-associative, everything else left-associative.
      const right = expression(token.v === '^' ? precedence : precedence + 1);
      left = make({ t: 'bin', op: token.v, left, right });
    }
    return left;
  }

  const ast = expression(0);
  if (pos !== tokens.length) throw new Error('Unerwartetes Ende des Ausdrucks');
  return ast;
}

export interface ExprScope {
  /** State, computed values, loop variables or row fields. */
  lookup(name: string): UiValue | undefined;
  /** Rows of a named dataset or view, for the *Of aggregate functions. */
  rows(name: string): UiRow[];
}

const num = (value: UiValue | undefined): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  return Number.NaN;
};
const truthy = (value: UiValue | undefined) =>
  typeof value === 'number' ? value !== 0 && !Number.isNaN(value) : !!value;

function column(scope: ExprScope, view: UiValue, field: UiValue): number[] {
  return scope
    .rows(String(view))
    .map((row) => num(row[String(field)]))
    .filter((value) => Number.isFinite(value));
}

type Fn = (args: UiValue[], scope: ExprScope) => UiValue;
const numeric =
  (f: (...values: number[]) => number): Fn =>
  (args) =>
    f(...args.map(num));

/** The complete set of functions a model may call. */
export const FUNCTIONS: Record<string, Fn> = {
  min: numeric(Math.min),
  max: numeric(Math.max),
  abs: numeric(Math.abs),
  floor: numeric(Math.floor),
  ceil: numeric(Math.ceil),
  sqrt: numeric(Math.sqrt),
  log: numeric(Math.log),
  log10: numeric(Math.log10),
  exp: numeric(Math.exp),
  pow: numeric(Math.pow),
  round: numeric((x, digits = 0) => {
    const f = 10 ** Math.max(0, Math.min(10, Math.trunc(digits)));
    return Math.round(x * f) / f;
  }),
  clamp: numeric((x, lo, hi) => Math.min(hi, Math.max(lo, x))),
  if: (args) => (truthy(args[0]) ? (args[1] ?? null) : (args[2] ?? null)),
  /** Payment per period for a loan: rate per period, number of periods, present value. */
  pmt: numeric((rate, periods, present) =>
    rate === 0 ? present / periods : (present * rate) / (1 - (1 + rate) ** -periods)
  ),
  /** Future value: rate per period, periods, payment per period, present value. */
  fv: numeric((rate, periods, payment = 0, present = 0) =>
    rate === 0
      ? present + payment * periods
      : present * (1 + rate) ** periods + (payment * ((1 + rate) ** periods - 1)) / rate
  ),
  sumOf: (args, scope) => column(scope, args[0] ?? '', args[1] ?? '').reduce((a, b) => a + b, 0),
  avgOf: (args, scope) => {
    const values = column(scope, args[0] ?? '', args[1] ?? '');
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  },
  minOf: (args, scope) => {
    const values = column(scope, args[0] ?? '', args[1] ?? '');
    return values.length ? Math.min(...values) : 0;
  },
  maxOf: (args, scope) => {
    const values = column(scope, args[0] ?? '', args[1] ?? '');
    return values.length ? Math.max(...values) : 0;
  },
  countOf: (args, scope) => scope.rows(String(args[0] ?? '')).length,
};

/** Interprets a parsed formula. Unknown names evaluate to null. */
export function evalExpr(node: ExprNode, scope: ExprScope): UiValue {
  switch (node.t) {
    case 'num':
    case 'str':
    case 'bool':
      return node.v;
    case 'id':
      return scope.lookup(node.name) ?? null;
    case 'un': {
      const value = evalExpr(node.arg, scope);
      return node.op === '!' ? !truthy(value) : node.op === '-' ? -num(value) : num(value);
    }
    case 'cond':
      return truthy(evalExpr(node.test, scope))
        ? evalExpr(node.yes, scope)
        : evalExpr(node.no, scope);
    case 'call':
      if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, node.fn)) return null;
      return FUNCTIONS[node.fn]!(
        node.args.map((arg) => evalExpr(arg, scope)),
        scope
      );
    case 'bin': {
      if (node.op === '&&')
        return truthy(evalExpr(node.left, scope)) && truthy(evalExpr(node.right, scope));
      if (node.op === '||')
        return truthy(evalExpr(node.left, scope)) || truthy(evalExpr(node.right, scope));
      const a = evalExpr(node.left, scope);
      const b = evalExpr(node.right, scope);
      switch (node.op) {
        case '+':
          return typeof a === 'string' || typeof b === 'string'
            ? `${a ?? ''}${b ?? ''}`
            : num(a) + num(b);
        case '-':
          return num(a) - num(b);
        case '*':
          return num(a) * num(b);
        case '/':
          return num(b) === 0 ? Number.NaN : num(a) / num(b);
        case '%':
          return num(a) % num(b);
        case '^':
          return num(a) ** num(b);
        case '==':
          return typeof a === 'number' || typeof b === 'number' ? num(a) === num(b) : a === b;
        case '!=':
          return typeof a === 'number' || typeof b === 'number' ? num(a) !== num(b) : a !== b;
        case '<':
          return num(a) < num(b);
        case '<=':
          return num(a) <= num(b);
        case '>':
          return num(a) > num(b);
        case '>=':
          return num(a) >= num(b);
      }
      return null;
    }
  }
}

/** Names a formula reads, for validation and dependency checks. */
export function exprIdentifiers(node: ExprNode, out = new Set<string>()): Set<string> {
  if (node.t === 'id') out.add(node.name);
  else if (node.t === 'un') exprIdentifiers(node.arg, out);
  else if (node.t === 'bin') {
    exprIdentifiers(node.left, out);
    exprIdentifiers(node.right, out);
  } else if (node.t === 'cond') {
    exprIdentifiers(node.test, out);
    exprIdentifiers(node.yes, out);
    exprIdentifiers(node.no, out);
  } else if (node.t === 'call') node.args.forEach((arg) => exprIdentifiers(arg, out));
  return out;
}

/** `{{expr}}` or `{{expr|format}}` placeholders inside display text. */
export const TEMPLATE_PATTERN =
  /\{\{\s*([^}|]+?)\s*(?:\|\s*([a-zA-Z]+(?::[A-Za-z0-9]+)?)\s*)?\}\}/g;
