/** Small, local formula interpreter. Never executes JavaScript, URLs or external workbooks. */
export interface AssistantSheet {
  type: 'plum-sheet';
  version: 1;
  cells: string[][];
}
export type SheetValue = string | number | boolean;
export interface SheetResult {
  value: SheetValue;
  error?: string;
}
export function parseAssistantSheet(content: string): AssistantSheet {
  const data = JSON.parse(content) as AssistantSheet;
  if (
    data?.type !== 'plum-sheet' ||
    data.version !== 1 ||
    !Array.isArray(data.cells) ||
    data.cells.length > 1000 ||
    data.cells.reduce((total, row) => total + (Array.isArray(row) ? row.length : 20001), 0) >
      20000 ||
    data.cells.some(
      (row) =>
        !Array.isArray(row) ||
        row.length > 100 ||
        row.some((cell) => typeof cell !== 'string' || cell.length > 5000)
    )
  )
    throw new Error('Ungültige Plum-Tabelle');
  return { type: 'plum-sheet', version: 1, cells: data.cells };
}
export const serializeAssistantSheet = (cells: string[][]) =>
  JSON.stringify({ type: 'plum-sheet', version: 1, cells });
export function sheetColumn(index: number): string {
  let label = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  return label;
}
type Node =
  | { kind: 'literal'; value: SheetValue }
  | { kind: 'ref'; row: number; column: number }
  | { kind: 'range'; start: Node; end: Node }
  | { kind: 'op'; op: string; left: Node; right: Node }
  | { kind: 'unary'; op: string; value: Node }
  | { kind: 'call'; name: string; args: Node[] };
class FormulaError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
function failure(code: string): never {
  throw new FormulaError(code);
}
function parseFormula(input: string): Node {
  if (input.length > 2000) failure('#LIMIT!');
  const tokens: string[] = [];
  const regex =
    /\s*("(?:[^"]|"")*"|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|\$?[A-Za-z]+\$?\d+|[A-Za-z_]+|<>|<=|>=|[+\-*/^=<>:,();])/y;
  let offset = 0;
  while (offset < input.length) {
    regex.lastIndex = offset;
    const match = regex.exec(input);
    if (!match) {
      if (input.slice(offset).trim() === '') break;
      failure('#PARSE!');
    }
    tokens.push(match[1]!);
    offset = regex.lastIndex;
    if (tokens.length > 1024) failure('#LIMIT!');
  }
  let index = 0,
    depth = 0;
  const peek = () => tokens[index],
    take = () => tokens[index++] ?? failure('#PARSE!');
  const expression = (minimum = 0): Node => {
    if (++depth > 64) failure('#LIMIT!');
    let left: Node;
    const token = take();
    if (token === '+' || token === '-') left = { kind: 'unary', op: token, value: expression(4) };
    else if (token === '(') {
      left = expression();
      if (take() !== ')') failure('#PARSE!');
    } else if (token.startsWith('"'))
      left = { kind: 'literal', value: token.slice(1, -1).replace(/""/g, '"') };
    else if (/^(?:\d|\.\d)/.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value)) failure('#NUM!');
      left = { kind: 'literal', value };
    } else if (/^\$?[A-Za-z]+\$?\d+$/.test(token)) {
      const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(token)!;
      let column = 0;
      for (const c of match[1]!.toUpperCase()) column = column * 26 + c.charCodeAt(0) - 64;
      const row = Number(match[2]) - 1;
      if (row < 0 || row >= 1000 || column > 100) failure('#REF!');
      left = { kind: 'ref', row, column: column - 1 };
    } else if (/^(TRUE|FALSE)$/i.test(token))
      left = { kind: 'literal', value: token.toUpperCase() === 'TRUE' };
    else if (/^[A-Za-z_]+$/.test(token) && peek() === '(') {
      take();
      const args: Node[] = [];
      if (peek() !== ')')
        while (true) {
          args.push(expression());
          if (peek() === ',' || peek() === ';') {
            take();
            continue;
          }
          break;
        }
      if (take() !== ')') failure('#PARSE!');
      left = { kind: 'call', name: token.toUpperCase(), args };
    } else failure(/^[A-Za-z_]+$/.test(token) ? '#NAME?' : '#PARSE!');
    const precedence: Record<string, number> = {
      '=': 1,
      '<>': 1,
      '<': 1,
      '>': 1,
      '<=': 1,
      '>=': 1,
      '+': 2,
      '-': 2,
      '*': 3,
      '/': 3,
      '^': 4,
      ':': 5,
    };
    while (peek() && (precedence[peek()!] ?? -1) >= minimum) {
      const op = take(),
        priority = precedence[op]!;
      const right = expression(priority + (op === '^' ? 0 : 1));
      left =
        op === ':'
          ? { kind: 'range', start: left!, end: right }
          : { kind: 'op', op, left: left!, right };
    }
    depth--;
    return left!;
  };
  if (!tokens.length) failure('#PARSE!');
  const ast = expression();
  if (index !== tokens.length) failure('#PARSE!');
  return ast;
}
export function evaluateAssistantSheet(sheet: AssistantSheet): SheetResult[][] {
  const cache = new Map<string, SheetResult>(),
    visiting = new Set<string>();
  let remaining = 200000;
  const count = () => {
    if (--remaining < 0) failure('#LIMIT!');
  };
  const numeric = (value: SheetValue) => {
    if (value === '') return 0;
    const number = typeof value === 'boolean' ? Number(value) : Number(value);
    if (!Number.isFinite(number)) failure('#VALUE!');
    return number;
  };
  const scalar = (value: SheetValue | SheetValue[]) =>
    Array.isArray(value) ? failure('#VALUE!') : value;
  const cell = (row: number, column: number): SheetResult => {
    const key = `${row}:${column}`,
      old = cache.get(key);
    if (old) return old;
    if (visiting.has(key)) failure('#CYCLE!');
    if (visiting.size > 128) failure('#LIMIT!');
    visiting.add(key);
    let result: SheetResult;
    try {
      count();
      const raw = sheet.cells[row]?.[column] ?? '';
      if (raw.startsWith('=')) result = { value: scalar(evaluate(parseFormula(raw.slice(1)))) };
      else if (raw.startsWith("'")) result = { value: raw.slice(1) };
      else if (
        raw.trim() &&
        /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim()) &&
        Number.isFinite(Number(raw))
      )
        result = { value: Number(raw) };
      else result = { value: raw };
    } catch (error) {
      const code = error instanceof FormulaError ? error.code : '#ERROR!';
      result = { value: code, error: code };
    }
    visiting.delete(key);
    cache.set(key, result);
    return result;
  };
  const reference = (row: number, column: number) => {
    const result = cell(row, column);
    if (result.error) failure(result.error);
    return result.value;
  };
  const evaluate = (node: Node): SheetValue | SheetValue[] => {
    count();
    if (node.kind === 'literal') return node.value;
    if (node.kind === 'ref') return reference(node.row, node.column);
    if (node.kind === 'range') {
      if (node.start.kind !== 'ref' || node.end.kind !== 'ref') failure('#REF!');
      const start = node.start as Extract<Node, { kind: 'ref' }>,
        end = node.end as Extract<Node, { kind: 'ref' }>,
        values: SheetValue[] = [];
      for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row++)
        for (
          let col = Math.min(start.column, end.column);
          col <= Math.max(start.column, end.column);
          col++
        )
          values.push(reference(row, col));
      return values;
    }
    if (node.kind === 'unary') {
      const number = numeric(scalar(evaluate(node.value)));
      return node.op === '-' ? -number : number;
    }
    if (node.kind === 'op') {
      const left = scalar(evaluate(node.left)),
        right = scalar(evaluate(node.right));
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) {
        const a = typeof left === 'number' ? left : String(left).toLocaleLowerCase(),
          b = typeof right === 'number' ? right : String(right).toLocaleLowerCase();
        if (node.op === '=') return a === b;
        if (node.op === '<>') return a !== b;
        if (node.op === '<') return a < b;
        if (node.op === '>') return a > b;
        if (node.op === '<=') return a <= b;
        return a >= b;
      }
      const a = numeric(left),
        b = numeric(right);
      if (node.op === '/' && b === 0) failure('#DIV/0!');
      const result =
        node.op === '+'
          ? a + b
          : node.op === '-'
            ? a - b
            : node.op === '*'
              ? a * b
              : node.op === '/'
                ? a / b
                : a ** b;
      if (!Number.isFinite(result)) failure('#NUM!');
      return result;
    }
    if (node.name === 'IF') {
      if (node.args.length !== 3) failure('#VALUE!');
      const condition = scalar(evaluate(node.args[0]!));
      return evaluate(node.args[condition ? 1 : 2]!);
    }
    if (!['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'].includes(node.name)) failure('#NAME?');
    const values = node.args.flatMap((argument) => {
      const value = evaluate(argument);
      return Array.isArray(value) ? value : [value];
    });
    const numbers = values.filter((value): value is number => typeof value === 'number');
    if (node.name === 'COUNT') return numbers.length;
    if (node.name === 'AVERAGE' && !numbers.length) failure('#DIV/0!');
    if (node.name === 'MIN') return numbers.length ? Math.min(...numbers) : 0;
    if (node.name === 'MAX') return numbers.length ? Math.max(...numbers) : 0;
    const total = numbers.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(total)) failure('#NUM!');
    return node.name === 'AVERAGE' ? total / numbers.length : total;
  };
  return sheet.cells.map((row, r) => row.map((_, c) => cell(r, c)));
}
