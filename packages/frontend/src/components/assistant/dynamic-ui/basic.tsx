import { useId, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDownRight, ArrowUpRight, Check, Minus, Plus, Send } from 'lucide-react';
import { formatUiValue, type UiRow } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { isTruthy } from './runtime';
import { ActionButton } from './actions';
import type { Ctx, Renderer } from './context';
import { LineChart } from './LineChart';
import { usePersistentState } from './persist';
import { useToneColors } from './theme';

export const Stack: Renderer<'stack'> = ({ node, ctx }) => (
  <div className={cn('dui-stack', `dui-gap-${node.gap ?? 'md'}`)}>
    {ctx.renderNodes(node.children)}
  </div>
);
export const Row: Renderer<'row'> = ({ node, ctx }) => (
  <div className={cn('dui-row', `dui-gap-${node.gap ?? 'md'}`, node.wrap !== false && 'is-wrap')}>
    {ctx.renderNodes(node.children)}
  </div>
);
export const Grid: Renderer<'grid'> = ({ node, ctx }) => (
  <div className="dui-grid" style={{ ['--dui-columns' as string]: node.columns }}>
    {ctx.renderNodes(node.children)}
  </div>
);
export const Heading: Renderer<'heading'> = ({ node, ctx }) =>
  node.level === 3 ? (
    <h4 className="dui-heading is-3 dui-fade">{ctx.rt.template(node.text)}</h4>
  ) : (
    <h3 className="dui-heading dui-fade">{ctx.rt.template(node.text)}</h3>
  );
export const Text: Renderer<'text'> = ({ node, ctx }) => (
  <p className={cn('dui-text dui-fade', node.tone && `is-${node.tone}`)}>
    {ctx.rt.template(node.text)}
  </p>
);
export const Markdown: Renderer<'markdown'> = ({ node, ctx }) => (
  <div className="dui-markdown dui-fade prose prose-sm max-w-none dark:prose-invert">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{ctx.rt.template(node.text)}</ReactMarkdown>
  </div>
);
export const Badge: Renderer<'badge'> = ({ node, ctx }) => (
  <span className={cn('dui-badge', `is-${node.tone ?? 'neutral'}`)}>
    {ctx.rt.template(node.text)}
  </span>
);
export const Divider: Renderer<'divider'> = () => <hr className="dui-divider" />;

/** The first numeric field of a dataset row. */
const numericKey = (rows: UiRow[]) =>
  Object.keys(rows[0] ?? {}).find((key) => typeof rows[0]?.[key] === 'number');

export const Kpi: Renderer<'kpi'> = ({ node, ctx }) => {
  const tones = useToneColors();
  const value = ctx.rt.safe(node.value);
  const trend = node.trend ? Number(ctx.rt.safe(node.trend)) : Number.NaN;
  const delta = node.delta ? ctx.rt.safe(node.delta) : null;
  const deltaNumber = typeof delta === 'number' && Number.isFinite(delta) ? delta : null;
  const tone =
    deltaNumber === null || deltaNumber === 0
      ? 'neutral'
      : deltaNumber > 0
        ? 'positive'
        : 'negative';
  const sparkRows = node.spark ? ctx.rt.rows(node.spark) : [];
  const sparkKey = node.sparkKey ?? numericKey(sparkRows);
  const spark = sparkKey
    ? sparkRows
        .map((row, index) => ({ x: index, y: Number(row[sparkKey]) }))
        .filter((point) => Number.isFinite(point.y))
    : [];
  const shown = formatUiValue(value, node.format);
  return (
    <div className="dui-kpi" role="group" aria-label={node.label}>
      <span className="dui-kpi-label">{node.label}</span>
      <span className="dui-kpi-line">
        {/* Keyed by the shown text so a change replays the short settle animation. */}
        <strong key={shown} className="dui-kpi-value" aria-live="polite">
          {shown}
        </strong>
        {deltaNumber !== null && (
          <span className={cn('dui-delta', `is-${tone}`)}>
            {tone === 'positive' ? (
              <ArrowUpRight size={13} aria-hidden />
            ) : tone === 'negative' ? (
              <ArrowDownRight size={13} aria-hidden />
            ) : null}
            {(deltaNumber > 0 ? '+' : '') + formatUiValue(deltaNumber, node.deltaFormat)}
          </span>
        )}
      </span>
      {spark.length > 1 && (
        <LineChart
          className="dui-kpi-spark"
          points={spark}
          height={34}
          padTop={3}
          strokeWidth={1.8}
          color={
            tone === 'neutral'
              ? 'hsl(var(--primary))'
              : tone === 'positive'
                ? tones.positive
                : tones.negative
          }
          ariaLabel={`Verlauf ${node.label}`}
        />
      )}
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

export const Slider: Renderer<'slider'> = ({ node, ctx }) => {
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
        disabled={ctx.busy}
        aria-valuetext={shown}
        style={{ ['--dui-fill' as string]: `${Math.min(100, Math.max(0, fill))}%` }}
        onChange={(event) => ctx.set(node.bind, Number(event.target.value))}
      />
    </div>
  );
};

export const Input: Renderer<'input'> = ({ node, ctx }) => {
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
        disabled={ctx.busy}
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

export const Select: Renderer<'select'> = ({ node, ctx }) => {
  const id = useId();
  return (
    <div className="dui-field">
      <label htmlFor={id}>{node.label}</label>
      <select
        id={id}
        className="dui-input"
        disabled={ctx.busy}
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

/** Segmented control; also used by chart ranges and live widgets. */
export function SegmentedControl<V extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
  className,
}: {
  label: string;
  options: Array<{ value: V; label: string }>;
  value: V | string;
  onChange: (value: V) => void;
  disabled?: boolean;
  className?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => String(option.value) === String(value))
  );
  return (
    <div
      className={cn('dui-segmented', className)}
      role="radiogroup"
      aria-label={label}
      style={{
        ['--dui-seg-count' as string]: options.length,
        ['--dui-seg-index' as string]: index,
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const next =
          options[
            (index + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length
          ]!;
        onChange(next.value);
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
        buttons[options.indexOf(next)]?.focus();
      }}
    >
      {options.map((option, position) => {
        const active = position === index && String(option.value) === String(value);
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active || (index < 0 && position === 0) ? 0 : -1}
            disabled={disabled}
            className={cn(active && 'is-active')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export const Segmented: Renderer<'segmented'> = ({ node, ctx }) => (
  <div className="dui-field">
    <span className="dui-field-label">{node.label}</span>
    <SegmentedControl
      label={node.label}
      options={node.options}
      value={String(ctx.rt.state[node.bind] ?? '')}
      disabled={ctx.busy}
      onChange={(value) => ctx.set(node.bind, value)}
    />
  </div>
);

export const Checkbox: Renderer<'checkbox'> = ({ node, ctx }) => {
  const id = useId();
  return (
    <label className="dui-check" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        disabled={ctx.busy}
        checked={isTruthy(ctx.rt.state[node.bind] ?? false)}
        onChange={(event) => ctx.set(node.bind, event.target.checked)}
      />
      <span>{node.label}</span>
    </label>
  );
};

/** Unknown action types never fall through to another action. */
export const Button: Renderer<'button'> = ({ node, ctx }) => (
  <ActionButton ctx={ctx} action={node.action} label={node.label} variant={node.variant} />
);

export const Compare: Renderer<'compare'> = ({ node, ctx }) => {
  const selected = node.bind ? String(ctx.rt.state[node.bind] ?? '') : '';
  // Best value per spec, for the subtle "best" marker.
  const best = useMemo(() => {
    const out = new Map<string, number>();
    for (const spec of node.specs) {
      if (!spec.better) continue;
      const values = node.items
        .map((item) => item.values[spec.key])
        .filter((v): v is number => typeof v === 'number');
      if (values.length)
        out.set(spec.key, spec.better === 'higher' ? Math.max(...values) : Math.min(...values));
    }
    return out;
  }, [node]);
  return (
    <div className="dui-compare" role={node.bind ? 'radiogroup' : undefined}>
      {node.items.map((item, index) => {
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
        const style = { ['--dui-i' as string]: index };
        return node.bind ? (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={ctx.busy}
            style={style}
            className={cn('dui-compare-item', active && 'is-active')}
            onClick={() => ctx.set(node.bind!, item.id)}
          >
            {body}
          </button>
        ) : (
          <div key={item.id} className="dui-compare-item" style={style}>
            {body}
          </div>
        );
      })}
    </div>
  );
};

export const Calculator: Renderer<'calculator'> = ({ node, ctx }) => (
  <section className="dui-card dui-calculator">
    {node.title && (
      <header className="dui-card-head">
        <h4>{node.title}</h4>
      </header>
    )}
    <div className="dui-calculator-body">
      <div className="dui-stack dui-gap-md">{ctx.renderNodes(node.inputs)}</div>
      <div className="dui-calculator-outputs">{ctx.renderNodes(node.outputs)}</div>
    </div>
    {node.chart && ctx.renderNodes([node.chart])}
  </section>
);

// v2 inputs

export const Stepper: Renderer<'stepper'> = ({ node, ctx }) => {
  const id = useId();
  const step = node.step ?? 1;
  const raw = Number(ctx.rt.state[node.bind] ?? node.min ?? 0);
  const value = Number.isFinite(raw) ? raw : 0;
  const clamp = (next: number) =>
    Math.min(node.max ?? Infinity, Math.max(node.min ?? -Infinity, Math.round(next / step) * step));
  const change = (delta: number) => ctx.set(node.bind, Number(clamp(value + delta).toFixed(6)));
  const shown = formatUiValue(
    value,
    node.format ?? (Number.isInteger(step) ? 'integer' : undefined)
  );
  return (
    <div className="dui-field dui-stepper-field">
      <span className="dui-field-label" id={id}>
        {node.label}
      </span>
      <div
        className="dui-stepper"
        role="spinbutton"
        tabIndex={ctx.busy ? -1 : 0}
        aria-labelledby={id}
        aria-valuenow={value}
        aria-valuemin={node.min}
        aria-valuemax={node.max}
        aria-valuetext={shown}
        onKeyDown={(event) => {
          if (ctx.busy) return;
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') change(step);
          else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') change(-step);
          else return;
          event.preventDefault();
        }}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label="Weniger"
          disabled={ctx.busy || (node.min !== undefined && value <= node.min)}
          onClick={() => change(-step)}
        >
          <Minus size={16} />
        </button>
        <output key={shown} className="dui-stepper-value">
          {shown}
        </output>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Mehr"
          disabled={ctx.busy || (node.max !== undefined && value >= node.max)}
          onClick={() => change(step)}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
};

export const Radio: Renderer<'radio'> = ({ node, ctx }) => {
  const name = useId();
  const current = String(ctx.rt.state[node.bind] ?? '');
  return (
    <fieldset className="dui-field dui-radio" disabled={ctx.busy}>
      <legend className="dui-field-label">{node.label}</legend>
      {node.options.map((option, index) => (
        <label
          key={String(option.value)}
          className={cn('dui-radio-option', String(option.value) === current && 'is-active')}
          style={{ ['--dui-i' as string]: index }}
        >
          <input
            type="radio"
            name={name}
            value={String(option.value)}
            checked={String(option.value) === current}
            onChange={() => ctx.set(node.bind, option.value)}
          />
          <span className="dui-radio-dot" aria-hidden />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
};

export const Textarea: Renderer<'textarea'> = ({ node, ctx }) => {
  const id = useId();
  const value = ctx.rt.state[node.bind];
  return (
    <div className="dui-field">
      <label htmlFor={id}>{node.label}</label>
      <textarea
        id={id}
        className="dui-input dui-textarea"
        rows={node.rows ?? 3}
        placeholder={node.placeholder}
        maxLength={200}
        disabled={ctx.busy}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(event) => ctx.set(node.bind, event.target.value)}
      />
    </div>
  );
};

export const DateInput: Renderer<'date'> = ({ node, ctx }) => {
  const id = useId();
  const value = ctx.rt.state[node.bind];
  return (
    <div className="dui-field">
      <label htmlFor={id}>{node.label}</label>
      <input
        id={id}
        type="date"
        className="dui-input"
        min={node.min}
        max={node.max}
        disabled={ctx.busy}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => ctx.set(node.bind, event.target.value)}
      />
    </div>
  );
};

/** Collects its inputs; „Senden“ posts the templated message as the next turn. */
export const Form: Renderer<'form'> = ({ node, ctx }) => {
  const [sent, setSent] = usePersistentState<string | null>(
    node.id ? ctx.storageKey(node.id) : null,
    () => null,
    (value) => (typeof value === 'string' ? value : undefined)
  );
  const [local, setLocal] = useState<string | null>(null);
  const action = { type: 'sendMessage' as const, text: node.submit.message };
  const message = ctx.rt.template(node.submit.message);
  const done = (sent ?? local) === message;
  return (
    <form
      className="dui-card dui-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ctx.canRun(action)) return;
        void ctx.run(action).then((result) => {
          if (result !== 'done') return;
          setLocal(message);
          if (node.id) setSent(message);
        });
      }}
    >
      {node.title && (
        <header className="dui-card-head">
          <h4>{node.title}</h4>
        </header>
      )}
      <div className="dui-stack dui-gap-md">{ctx.renderNodes(node.children)}</div>
      <footer className="dui-form-foot">
        {done && (
          <span className="dui-form-sent plum-pop" role="status">
            <Check size={14} aria-hidden /> Gesendet
          </span>
        )}
        <button type="submit" className="dui-button is-primary" disabled={!ctx.canRun(action)}>
          <Send size={14} aria-hidden />
          <span>{node.submit.label}</span>
        </button>
      </footer>
    </form>
  );
};

export type { Ctx };
