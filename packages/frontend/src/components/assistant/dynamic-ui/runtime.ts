import {
  evalExpr,
  formatUiValue,
  parseExpr,
  TEMPLATE_PATTERN,
  type DynamicUiSpec,
  type ExprNode,
  type ExprScope,
  type UiRow,
  type UiValue,
  type UiView,
} from '@plum-code-webui/shared';

/* Parsed formulas are reused across renders; the cache is bounded. */
const parsed = new Map<string, ExprNode>();
function ast(source: string): ExprNode {
  let node = parsed.get(source);
  if (!node) {
    node = parseExpr(source);
    if (parsed.size > 2000) parsed.clear();
    parsed.set(source, node);
  }
  return node;
}

const MAX_GENERATED = 500;

/**
 * Evaluation context for one message's view at one state snapshot. Computed
 * values and views are resolved lazily and cached; cycles resolve to null
 * instead of recursing forever.
 */
export class UiRuntime implements ExprScope {
  private computedCache = new Map<string, UiValue>();
  private viewCache = new Map<string, UiRow[]>();
  private resolving = new Set<string>();

  constructor(
    readonly spec: DynamicUiSpec,
    readonly state: Record<string, UiValue>,
    private readonly locals: Record<string, UiValue> = {},
    private readonly parent?: UiRuntime
  ) {}

  /** A child scope with extra names, e.g. the fields of one table row. */
  with(locals: Record<string, UiValue>): UiRuntime {
    return new UiRuntime(this.spec, this.state, locals, this);
  }

  lookup(name: string): UiValue | undefined {
    // Own keys only: names like "constructor" must not reach the prototype chain.
    if (Object.hasOwn(this.locals, name)) return this.locals[name];
    if (this.parent) return this.parent.lookup(name);
    if (Object.hasOwn(this.state, name)) return this.state[name];
    const computed = this.spec.computed;
    if (!computed || !Object.hasOwn(computed, name)) return undefined;
    const formula = computed[name]!;
    if (this.computedCache.has(name)) return this.computedCache.get(name);
    if (this.resolving.has(name)) return null;
    this.resolving.add(name);
    const value = this.safe(formula);
    this.resolving.delete(name);
    this.computedCache.set(name, value);
    return value;
  }

  rows(name: string): UiRow[] {
    if (this.parent) return this.parent.rows(name);
    const cached = this.viewCache.get(name);
    if (cached) return cached;
    if (this.resolving.has(`view:${name}`)) return [];
    this.resolving.add(`view:${name}`);
    const views = this.spec.views ?? {};
    const data = this.spec.data ?? {};
    const rows = Object.hasOwn(views, name)
      ? this.buildView(views[name]!)
      : Object.hasOwn(data, name)
        ? data[name]!
        : [];
    this.resolving.delete(`view:${name}`);
    this.viewCache.set(name, rows);
    return rows;
  }

  /** Rows for a component's `data`: a dataset/view name or inline rows. */
  source(data: string | UiRow[]): UiRow[] {
    return typeof data === 'string' ? this.rows(data) : data;
  }

  /** Evaluates a formula; anything that fails yields null. */
  safe(formula: string): UiValue {
    try {
      const value = evalExpr(ast(formula), this);
      return typeof value === 'number' && !Number.isFinite(value) ? null : value;
    } catch {
      return null;
    }
  }

  /** Replaces `{{formula|format}}` placeholders in display text. */
  template(text: string): string {
    return text.replace(TEMPLATE_PATTERN, (_, formula: string, format?: string) =>
      formatUiValue(this.safe(formula), format)
    );
  }

  private buildView(view: UiView): UiRow[] {
    if ('generate' in view) {
      const from = Number(this.safe(view.generate.from));
      const to = Number(this.safe(view.generate.to));
      const step = view.generate.step ?? 1;
      if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
      const rows: UiRow[] = [];
      for (let value = from; value <= to + 1e-9 && rows.length < MAX_GENERATED; value += step) {
        const scope = this.with({ [view.generate.var]: value });
        const row: UiRow = {};
        for (const [field, formula] of Object.entries(view.fields))
          row[field] = scope.safe(formula);
        rows.push(row);
      }
      return rows;
    }
    let rows = this.rows(view.from);
    if (view.filter) {
      const filter = view.filter;
      rows = rows.filter((row) => {
        const value = this.with(row).safe(filter);
        return typeof value === 'number' ? value !== 0 : !!value;
      });
    }
    if (view.groupBy || view.aggregate) {
      const groups = new Map<string, UiRow[]>();
      for (const row of rows) {
        const key = view.groupBy ? String(row[view.groupBy] ?? '') : '';
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      rows = [...groups.entries()].map(([key, members]) => {
        const out: UiRow = view.groupBy
          ? { [view.groupBy]: members[0]?.[view.groupBy] ?? key }
          : {};
        for (const [name, agg] of Object.entries(view.aggregate ?? {})) {
          const values = members
            .map((row) => Number(agg.field ? row[agg.field] : 1))
            .filter((value) => Number.isFinite(value));
          out[name] =
            agg.op === 'count'
              ? members.length
              : !values.length
                ? 0
                : agg.op === 'sum'
                  ? values.reduce((a, b) => a + b, 0)
                  : agg.op === 'avg'
                    ? values.reduce((a, b) => a + b, 0) / values.length
                    : agg.op === 'min'
                      ? Math.min(...values)
                      : Math.max(...values);
        }
        return out;
      });
    }
    if (view.sort) {
      const { field, dir } = view.sort;
      const sign = dir === 'desc' ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const x = a[field];
        const y = b[field];
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
        return String(x ?? '').localeCompare(String(y ?? ''), 'de-CH') * sign;
      });
    }
    return view.limit ? rows.slice(0, view.limit) : rows;
  }
}

export const isTruthy = (value: UiValue) =>
  typeof value === 'number' ? value !== 0 && !Number.isNaN(value) : !!value;
