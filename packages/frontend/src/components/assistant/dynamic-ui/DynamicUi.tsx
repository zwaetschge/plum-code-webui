import {
  Component,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDownRight, ArrowUpRight, Check } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatUiValue,
  validateDynamicUi,
  type DynamicUiSpec,
  type UiNode,
  type UiNodeType,
  type UiValue,
} from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { isTruthy, UiRuntime } from './runtime';
import './dynamic-ui.css';

export interface DynamicUiProps {
  spec: DynamicUiSpec;
  /** Runs a `sendMessage` action as a new chat message; omitted = button disabled. */
  onSendMessage?: (text: string) => void;
  /** Disables actions while an answer runs. */
  busy?: boolean;
}

interface Ctx {
  rt: UiRuntime;
  set: (key: string, value: UiValue) => void;
  reset: () => void;
  send?: (text: string) => void;
  busy?: boolean;
}

type Renderer<T extends UiNodeType> = (props: {
  node: Extract<UiNode, { type: T }>;
  ctx: Ctx;
}) => ReactNode;

/* Chart colours come from the theme tokens; SVG attributes cannot read var(). */
function useThemePalette() {
  return useMemo(() => {
    const styles = getComputedStyle(document.documentElement);
    const primary = styles.getPropertyValue('--primary').trim() || '174 72% 46%';
    return [
      `hsl(${primary})`,
      'hsl(262 83% 66%)',
      'hsl(38 92% 56%)',
      'hsl(199 89% 56%)',
      'hsl(340 82% 62%)',
      'hsl(142 66% 48%)',
    ];
  }, []);
}

function Children({ nodes, ctx }: { nodes: UiNode[]; ctx: Ctx }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Node key={node.id ?? `${node.type}-${index}`} node={node} ctx={ctx} />
      ))}
    </>
  );
}

const Stack: Renderer<'stack'> = ({ node, ctx }) => (
  <div className={cn('dui-stack', `dui-gap-${node.gap ?? 'md'}`)}>
    <Children nodes={node.children} ctx={ctx} />
  </div>
);
const Row: Renderer<'row'> = ({ node, ctx }) => (
  <div className={cn('dui-row', `dui-gap-${node.gap ?? 'md'}`, node.wrap !== false && 'is-wrap')}>
    <Children nodes={node.children} ctx={ctx} />
  </div>
);
const Grid: Renderer<'grid'> = ({ node, ctx }) => (
  <div className="dui-grid" style={{ ['--dui-columns' as string]: node.columns }}>
    <Children nodes={node.children} ctx={ctx} />
  </div>
);
const Card: Renderer<'card'> = ({ node, ctx }) => {
  const highlighted = node.highlight ? isTruthy(ctx.rt.safe(node.highlight)) : false;
  return (
    <section className={cn('dui-card', highlighted && 'is-highlighted')}>
      {(node.title || node.subtitle) && (
        <header className="dui-card-head">
          {node.title && <h4>{ctx.rt.template(node.title)}</h4>}
          {node.subtitle && <p>{ctx.rt.template(node.subtitle)}</p>}
        </header>
      )}
      <div className="dui-stack dui-gap-md">
        <Children nodes={node.children} ctx={ctx} />
      </div>
    </section>
  );
};
const Calculator: Renderer<'calculator'> = ({ node, ctx }) => (
  <section className="dui-card dui-calculator">
    {node.title && (
      <header className="dui-card-head">
        <h4>{node.title}</h4>
      </header>
    )}
    <div className="dui-calculator-body">
      <div className="dui-stack dui-gap-md">
        <Children nodes={node.inputs} ctx={ctx} />
      </div>
      <div className="dui-calculator-outputs">
        <Children nodes={node.outputs} ctx={ctx} />
      </div>
    </div>
    {node.chart && <Node node={node.chart} ctx={ctx} />}
  </section>
);
const Heading: Renderer<'heading'> = ({ node, ctx }) =>
  node.level === 3 ? (
    <h4 className="dui-heading is-3">{ctx.rt.template(node.text)}</h4>
  ) : (
    <h3 className="dui-heading">{ctx.rt.template(node.text)}</h3>
  );
const Text: Renderer<'text'> = ({ node, ctx }) => (
  <p className={cn('dui-text', node.tone && `is-${node.tone}`)}>{ctx.rt.template(node.text)}</p>
);
const Markdown: Renderer<'markdown'> = ({ node, ctx }) => (
  <div className="dui-markdown prose prose-sm max-w-none dark:prose-invert">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{ctx.rt.template(node.text)}</ReactMarkdown>
  </div>
);
const Badge: Renderer<'badge'> = ({ node, ctx }) => (
  <span className={cn('dui-badge', `is-${node.tone ?? 'neutral'}`)}>
    {ctx.rt.template(node.text)}
  </span>
);
const Divider: Renderer<'divider'> = () => <hr className="dui-divider" />;

const Kpi: Renderer<'kpi'> = ({ node, ctx }) => {
  const value = ctx.rt.safe(node.value);
  const trend = node.trend ? Number(ctx.rt.safe(node.trend)) : Number.NaN;
  return (
    <div className="dui-kpi" role="group" aria-label={node.label}>
      <span className="dui-kpi-label">{node.label}</span>
      {/* Keyed by the shown text so a change replays the short settle animation. */}
      <strong key={formatUiValue(value, node.format)} className="dui-kpi-value" aria-live="polite">
        {formatUiValue(value, node.format)}
      </strong>
      {(node.hint || Number.isFinite(trend)) && (
        <span className="dui-kpi-hint">
          {Number.isFinite(trend) && trend !== 0 && (
            <span className={cn('dui-trend', trend > 0 ? 'is-up' : 'is-down')}>
              {trend > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            </span>
          )}
          {node.hint && ctx.rt.template(node.hint)}
        </span>
      )}
    </div>
  );
};

const Slider: Renderer<'slider'> = ({ node, ctx }) => {
  const id = useId();
  const value = Number(ctx.rt.state[node.bind] ?? node.min);
  const shown = formatUiValue(value, node.format);
  const fill = ((value - node.min) / (node.max - node.min)) * 100;
  return (
    <div className="dui-field">
      <div className="dui-field-head">
        <label htmlFor={id}>{node.label}</label>
        <output htmlFor={id}>{shown}</output>
      </div>
      <input
        id={id}
        type="range"
        className="dui-slider"
        min={node.min}
        max={node.max}
        step={node.step ?? 1}
        value={value}
        aria-valuetext={shown}
        style={{ ['--dui-fill' as string]: `${Math.min(100, Math.max(0, fill))}%` }}
        onChange={(event) => ctx.set(node.bind, Number(event.target.value))}
      />
    </div>
  );
};

const Input: Renderer<'input'> = ({ node, ctx }) => {
  const id = useId();
  const numeric = node.kind !== 'text';
  const value = ctx.rt.state[node.bind];
  return (
    <div className="dui-field">
      <label htmlFor={id}>{node.label}</label>
      <input
        id={id}
        className="dui-input"
        type={numeric ? 'number' : 'text'}
        inputMode={numeric ? 'decimal' : undefined}
        min={node.min}
        max={node.max}
        step={node.step}
        placeholder={node.placeholder}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(event) => {
          const raw = event.target.value;
          ctx.set(node.bind, numeric ? (raw === '' ? null : Number(raw)) : raw);
        }}
      />
    </div>
  );
};

/** Options keep their declared type: numeric option values stay numbers in state. */
const optionValue = (raw: string, options: Array<{ value: string | number }>) =>
  options.find((option) => String(option.value) === raw)?.value ?? raw;

const Select: Renderer<'select'> = ({ node, ctx }) => {
  const id = useId();
  return (
    <div className="dui-field">
      <label htmlFor={id}>{node.label}</label>
      <select
        id={id}
        className="dui-input"
        value={String(ctx.rt.state[node.bind] ?? '')}
        onChange={(event) => ctx.set(node.bind, optionValue(event.target.value, node.options))}
      >
        {node.options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

const Segmented: Renderer<'segmented'> = ({ node, ctx }) => {
  const current = String(ctx.rt.state[node.bind] ?? '');
  return (
    <div className="dui-field">
      <span className="dui-field-label">{node.label}</span>
      <div className="dui-segmented" role="radiogroup" aria-label={node.label}>
        {node.options.map((option) => {
          const active = String(option.value) === current;
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={active}
              className={cn(active && 'is-active')}
              onClick={() => ctx.set(node.bind, option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const Checkbox: Renderer<'checkbox'> = ({ node, ctx }) => {
  const id = useId();
  return (
    <label className="dui-check" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={isTruthy(ctx.rt.state[node.bind] ?? false)}
        onChange={(event) => ctx.set(node.bind, event.target.checked)}
      />
      <span>{node.label}</span>
    </label>
  );
};

const Button: Renderer<'button'> = ({ node, ctx }) => {
  const { action } = node;
  const disabled = action.type === 'sendMessage' && (!ctx.send || ctx.busy);
  return (
    <button
      type="button"
      className={cn('dui-button', node.variant === 'secondary' ? 'is-secondary' : 'is-primary')}
      disabled={disabled}
      onClick={() => {
        if (action.type === 'sendMessage') ctx.send?.(ctx.rt.template(action.text));
        else if (action.type === 'set') ctx.set(action.key, ctx.rt.safe(action.value));
        else ctx.reset();
      }}
    >
      {node.label}
    </button>
  );
};

const Table: Renderer<'table'> = ({ node, ctx }) => {
  const rows = ctx.rt.source(node.data);
  return (
    <div className="dui-table-wrap" role="region" aria-label="Tabelle" tabIndex={0}>
      <table className="dui-table">
        <thead>
          <tr>
            {node.columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  (column.align
                    ? column.align === 'right'
                    : typeof rows[0]?.[column.key] === 'number') && 'is-right'
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              className={cn(
                node.highlight &&
                  isTruthy(ctx.rt.with(row).safe(node.highlight)) &&
                  'is-highlighted'
              )}
            >
              {node.columns.map((column) => {
                const value = row[column.key];
                const right = column.align ? column.align === 'right' : typeof value === 'number';
                return (
                  <td key={column.key} className={cn(right && 'is-right')}>
                    {formatUiValue(value, column.format)}
                  </td>
                );
              })}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={node.columns.length} className="dui-empty">
                Keine Einträge für diese Auswahl.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

const Chart: Renderer<'chart'> = ({ node, ctx }) => {
  const palette = useThemePalette();
  const rows = ctx.rt.source(node.data);
  const format = (value: unknown) => formatUiValue(value as UiValue, node.format);
  const axisFormat = (value: unknown) =>
    typeof value === 'number' && node.format?.startsWith('currency')
      ? formatUiValue(value, 'compact')
      : formatUiValue(value as UiValue, node.format === 'percent' ? 'percent' : undefined);
  const height = node.height ?? 240;
  const axis = { stroke: 'currentColor', fontSize: 11, tickLine: false, axisLine: false } as const;
  const grid = <CartesianGrid strokeOpacity={0.12} vertical={false} />;
  const tooltip = (
    <Tooltip
      formatter={(value) => format(value)}
      contentStyle={{
        background: 'hsl(var(--popover) / 0.92)',
        border: '1px solid hsl(var(--foreground) / 0.12)',
        borderRadius: 10,
        backdropFilter: 'blur(12px)',
      }}
    />
  );
  const legend = node.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null;
  let chart: ReactNode;
  if (node.kind === 'pie') {
    const series = node.series[0]!;
    chart = (
      <PieChart>
        <Pie
          data={rows}
          dataKey={series.key}
          nameKey={node.x}
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={2}
        >
          {rows.map((_, index) => (
            <Cell key={index} fill={palette[index % palette.length]} stroke="none" />
          ))}
        </Pie>
        {tooltip}
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    );
  } else if (node.kind === 'bar') {
    chart = (
      <BarChart data={rows}>
        {grid}
        <XAxis dataKey={node.x} {...axis} />
        <YAxis {...axis} width={56} tickFormatter={axisFormat} />
        {tooltip}
        {legend}
        {node.series.map((series, index) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            name={series.label}
            fill={palette[index % palette.length]}
            radius={[6, 6, 0, 0]}
            stackId={node.stacked ? 'stack' : undefined}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    );
  } else {
    const Lines = node.kind === 'line' ? LineChart : AreaChart;
    chart = (
      <Lines data={rows}>
        <defs>
          {node.series.map((series, index) => (
            <linearGradient
              key={series.key}
              id={`dui-fill-${series.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={palette[index % palette.length]} stopOpacity={0.35} />
              <stop offset="100%" stopColor={palette[index % palette.length]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {grid}
        <XAxis dataKey={node.x} {...axis} />
        <YAxis {...axis} width={56} tickFormatter={axisFormat} />
        {tooltip}
        {legend}
        {node.series.map((series, index) =>
          node.kind === 'line' ? (
            <Line
              key={series.key}
              dataKey={series.key}
              name={series.label}
              stroke={palette[index % palette.length]}
              strokeWidth={2.4}
              dot={false}
              isAnimationActive={false}
            />
          ) : (
            <Area
              key={series.key}
              dataKey={series.key}
              name={series.label}
              stroke={palette[index % palette.length]}
              strokeWidth={2.4}
              fill={`url(#dui-fill-${series.key})`}
              stackId={node.stacked ? 'stack' : undefined}
              isAnimationActive={false}
            />
          )
        )}
      </Lines>
    );
  }
  return (
    <figure className="dui-chart" aria-label={node.series.map((series) => series.label).join(', ')}>
      <ResponsiveContainer width="100%" height={height}>
        {chart as ReactElement}
      </ResponsiveContainer>
    </figure>
  );
};

const Compare: Renderer<'compare'> = ({ node, ctx }) => {
  const selected = node.bind ? String(ctx.rt.state[node.bind] ?? '') : '';
  // Best value per spec, for the subtle "best" marker.
  const best = new Map<string, number>();
  for (const spec of node.specs) {
    if (!spec.better) continue;
    const values = node.items
      .map((item) => item.values[spec.key])
      .filter((v): v is number => typeof v === 'number');
    if (values.length)
      best.set(spec.key, spec.better === 'higher' ? Math.max(...values) : Math.min(...values));
  }
  return (
    <div className="dui-compare" role={node.bind ? 'radiogroup' : undefined}>
      {node.items.map((item) => {
        const active = item.id === selected;
        const body = (
          <>
            <header className="dui-compare-head">
              <div>
                <h4>{item.title}</h4>
                {item.subtitle && <p>{item.subtitle}</p>}
              </div>
              {item.badge && <span className="dui-badge is-accent">{item.badge}</span>}
              {active && (
                <span className="dui-compare-check" aria-hidden>
                  <Check size={14} />
                </span>
              )}
            </header>
            <dl>
              {node.specs.map((spec) => {
                const value = item.values[spec.key];
                const isBest = typeof value === 'number' && best.get(spec.key) === value;
                return (
                  <div key={spec.key} className={cn(isBest && 'is-best')}>
                    <dt>{spec.label}</dt>
                    <dd>{formatUiValue(value, spec.format)}</dd>
                  </div>
                );
              })}
            </dl>
          </>
        );
        return node.bind ? (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={cn('dui-compare-item', active && 'is-active')}
            onClick={() => ctx.set(node.bind!, item.id)}
          >
            {body}
          </button>
        ) : (
          <div key={item.id} className="dui-compare-item">
            {body}
          </div>
        );
      })}
    </div>
  );
};

/** The component registry: the only UI a model can reach. */
const REGISTRY: { [T in UiNodeType]: Renderer<T> } = {
  stack: Stack,
  row: Row,
  grid: Grid,
  card: Card,
  calculator: Calculator,
  heading: Heading,
  text: Text,
  markdown: Markdown,
  badge: Badge,
  divider: Divider,
  kpi: Kpi,
  slider: Slider,
  input: Input,
  select: Select,
  segmented: Segmented,
  checkbox: Checkbox,
  button: Button,
  table: Table,
  chart: Chart,
  compare: Compare,
};

function Node({ node, ctx }: { node: UiNode; ctx: Ctx }) {
  const Render = REGISTRY[node.type] as unknown as (props: { node: UiNode; ctx: Ctx }) => ReactNode;
  return <Render node={node} ctx={ctx} />;
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="dui-note">Die interaktive Ansicht konnte nicht dargestellt werden.</p>
    ) : (
      this.props.children
    );
  }
}

/**
 * Renders a validated Dynamic UI description inside an assistant message.
 * All components of the message share one state; every change recomputes the
 * formulas, views and charts at once — no new model request.
 */
export default function DynamicUi({ spec, onSendMessage, busy }: DynamicUiProps) {
  // Client-side validation: the server already checked, but stored history or
  // fixtures must pass the same gate before anything renders.
  const checked = useMemo(() => validateDynamicUi(spec), [spec]);
  const initial = useMemo(() => ({ ...(spec.state ?? {}) }), [spec]);
  const [state, setState] = useState<Record<string, UiValue>>(initial);
  useEffect(() => setState(initial), [initial]);
  if (!checked.ok)
    return <p className="dui-note">Interaktive Ansicht verworfen ({checked.error}).</p>;
  const ctx: Ctx = {
    rt: new UiRuntime(checked.spec, state),
    set: (key, value) => setState((current) => ({ ...current, [key]: value })),
    reset: () => setState(initial),
    send: onSendMessage,
    busy,
  };
  return (
    <Boundary>
      <div className={cn('dui-root', checked.spec.layout === 'dashboard' && 'is-dashboard')}>
        {checked.spec.title && <h3 className="dui-title">{checked.spec.title}</h3>}
        <Node node={checked.spec.root} ctx={ctx} />
      </div>
    </Boundary>
  );
}
