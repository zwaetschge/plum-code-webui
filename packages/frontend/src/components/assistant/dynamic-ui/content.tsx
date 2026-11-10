import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Copy,
  Info,
  Lightbulb,
  OctagonAlert,
  Star,
} from 'lucide-react';
import { formatUiValue, type UiTone } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { copyText, useActionRunner } from './actions';
import { stagger, type Renderer } from './context';
import { UiIcon } from './icons';
import { aspectRatio, Lightbox, UiImg } from './media';
import { highlightCode } from './highlight';

const MathTex = lazy(() => import('./MathTex'));

/** Inline Markdown for short model texts (no HTML, no images). */
export function InlineMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      disallowedElements={['img']}
      unwrapDisallowed
      components={{
        p: ({ children }) => <span className="dui-md-p">{children}</span>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export const List: Renderer<'list'> = ({ node, ctx }) => {
  const { run } = useActionRunner(ctx);
  return (
    <ul className="dui-list">
      {node.items.map((item, index) => {
        const inner = (
          <>
            {item.image ? (
              <UiImg
                className="dui-list-thumb"
                src={item.image.src}
                alt={item.image.alt}
                aspect="1 / 1"
              />
            ) : item.icon ? (
              <span className="dui-list-icon">
                <UiIcon name={item.icon} size={17} />
              </span>
            ) : null}
            <span className="dui-list-text">
              <span className="dui-list-title">{ctx.rt.template(item.title)}</span>
              {item.subtitle && (
                <span className="dui-list-subtitle">{ctx.rt.template(item.subtitle)}</span>
              )}
            </span>
            {item.trailing && (
              <span className="dui-list-trailing">{ctx.rt.template(item.trailing)}</span>
            )}
            {item.action && <ChevronRight size={16} className="dui-list-chevron" aria-hidden />}
          </>
        );
        return (
          <li key={index} className="dui-list-row" style={stagger(index)}>
            {item.action ? (
              <button
                type="button"
                className="dui-list-item is-action"
                disabled={!ctx.canRun(item.action)}
                onClick={() => void run(item.action!)}
              >
                {inner}
              </button>
            ) : (
              <div className="dui-list-item">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export const Timeline: Renderer<'timeline'> = ({ node }) => (
  <ol className="dui-timeline">
    {node.items.map((item, index) => (
      <li
        key={index}
        className={cn('dui-timeline-item', `is-${item.status ?? 'upcoming'}`)}
        style={stagger(index)}
        aria-current={item.status === 'current' ? 'step' : undefined}
      >
        <span className="dui-timeline-dot" aria-hidden>
          {item.status === 'done' && <Check size={11} strokeWidth={3} />}
        </span>
        <div className="dui-timeline-body">
          {item.time && <span className="dui-timeline-time">{item.time}</span>}
          <span className="dui-timeline-title">{item.title}</span>
          {item.text && <p className="dui-timeline-text">{item.text}</p>}
        </div>
      </li>
    ))}
  </ol>
);

const CALLOUT_ICONS: Record<UiTone, ReactNode> = {
  info: <Info size={18} />,
  success: <CircleCheck size={18} />,
  warning: <CircleAlert size={18} />,
  danger: <OctagonAlert size={18} />,
  tip: <Lightbulb size={18} />,
};

export const Callout: Renderer<'callout'> = ({ node, ctx }) => (
  <aside
    className={cn('dui-callout', `is-${node.tone}`)}
    role={node.tone === 'danger' || node.tone === 'warning' ? 'note' : undefined}
  >
    <span className="dui-callout-icon" aria-hidden>
      {CALLOUT_ICONS[node.tone] ?? CALLOUT_ICONS.info}
    </span>
    <div className="dui-callout-body">
      {node.title && <strong>{ctx.rt.template(node.title)}</strong>}
      <div className="dui-callout-text">
        <InlineMarkdown text={ctx.rt.template(node.text)} />
      </div>
    </div>
  </aside>
);

export const Progress: Renderer<'progress'> = ({ node, ctx }) => {
  const value = Number(ctx.rt.safe(node.value));
  const max = node.max ? Number(ctx.rt.safe(node.max)) : 100;
  const ratio =
    Number.isFinite(value) && Number.isFinite(max) && max > 0
      ? Math.min(1, Math.max(0, value / max))
      : 0;
  const shown = node.format
    ? formatUiValue(Number.isFinite(value) ? value : null, node.format)
    : `${Math.round(ratio * 100)} %`;
  const label = node.label ? ctx.rt.template(node.label) : '';
  if (node.kind === 'ring') {
    const radius = 26;
    const circumference = 2 * Math.PI * radius;
    return (
      <div
        className="dui-progress-ring"
        role="meter"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || 'Fortschritt'}
      >
        <svg width={64} height={64} viewBox="0 0 64 64" aria-hidden>
          <circle className="dui-ring-track" cx={32} cy={32} r={radius} />
          <circle
            className="dui-ring-fill"
            cx={32}
            cy={32}
            r={radius}
            strokeDasharray={circumference}
            style={{ ['--dui-ring-full' as string]: circumference }}
            strokeDashoffset={circumference * (1 - ratio)}
          />
        </svg>
        <span className="dui-ring-value">{shown}</span>
        {label && <span className="dui-progress-label">{label}</span>}
      </div>
    );
  }
  return (
    <div
      className="dui-progress"
      role="meter"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || 'Fortschritt'}
    >
      <div className="dui-progress-head">
        {label && <span className="dui-progress-label">{label}</span>}
        <span className="dui-progress-value">{shown}</span>
      </div>
      <span className="dui-progress-track" aria-hidden>
        <span className="dui-progress-fill" style={{ transform: `scaleX(${ratio})` }} />
      </span>
    </div>
  );
};

export function Stars({ value, size = 15 }: { value: number; size?: number }) {
  return (
    <span className="dui-stars" aria-hidden>
      {[0, 1, 2, 3, 4].map((index) => {
        const fill = Math.min(1, Math.max(0, value - index));
        return (
          <span key={index} className="dui-star" style={{ width: size, height: size }}>
            <Star size={size} className="dui-star-empty" />
            <span className="dui-star-fill" style={{ width: `${fill * 100}%` }}>
              <Star size={size} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

export const Rating: Renderer<'rating'> = ({ node }) => (
  <div
    className="dui-rating"
    role="img"
    aria-label={`${formatUiValue(node.value, 'decimal:1')} von 5 Sternen${node.count !== undefined ? `, ${node.count} Bewertungen` : ''}`}
  >
    <Stars value={node.value} />
    <span className="dui-rating-value">{formatUiValue(node.value, 'decimal:1')}</span>
    {node.count !== undefined && (
      <span className="dui-rating-count">({formatUiValue(node.count, 'integer')})</span>
    )}
    {node.label && <span className="dui-rating-label">{node.label}</span>}
  </div>
);

export const ImageNode: Renderer<'image'> = ({ node }) => {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  if (failed) return null;
  return (
    <figure className="dui-figure">
      <button
        type="button"
        className="dui-figure-button"
        aria-label={`${node.alt} vergrössern`}
        onClick={() => setOpen(0)}
      >
        <UiImg
          src={node.src}
          alt={node.alt}
          aspect={node.aspect ? aspectRatio(node.aspect) : '16 / 9'}
          onFailed={() => setFailed(true)}
        />
      </button>
      {node.caption && <figcaption>{node.caption}</figcaption>}
      <Lightbox
        items={[{ src: node.src, alt: node.alt, title: node.caption }]}
        index={open}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
      />
    </figure>
  );
};

export const CodeBlock: Renderer<'code'> = ({ node }) => {
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => highlightCode(node.code, node.language), [node.code, node.language]);
  return (
    <div className="dui-code">
      <header className="dui-code-head">
        <span className="dui-code-lang">{node.title || node.language}</span>
        {node.title && <span className="dui-code-sub">{node.language}</span>}
        <button
          type="button"
          className="dui-code-copy"
          onClick={() =>
            void copyText(node.code).then((ok) => {
              if (!ok) return;
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            })
          }
        >
          {copied ? (
            <Check size={13} className="plum-pop" aria-hidden />
          ) : (
            <Copy size={13} aria-hidden />
          )}
          {copied ? 'Kopiert' : 'Kopieren'}
        </button>
      </header>
      <pre tabIndex={0}>
        <code>{tokens}</code>
      </pre>
    </div>
  );
};

export const MathNode: Renderer<'math'> = ({ node }) => (
  <Suspense fallback={<span className="dui-math is-loading">{node.tex}</span>}>
    <MathTex tex={node.tex} display={node.display !== false} />
  </Suspense>
);
