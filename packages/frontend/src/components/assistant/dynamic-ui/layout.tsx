import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTruthy } from './runtime';
import { ActionButton } from './actions';
import type { Renderer } from './context';
import { Fullscreen, UiImg } from './media';

export const Card: Renderer<'card'> = ({ node, ctx }) => {
  const [full, setFull] = useState(false);
  const highlighted = node.highlight ? isTruthy(ctx.rt.safe(node.highlight)) : false;
  const title = node.title ? ctx.rt.template(node.title) : '';
  const [imageFailed, setImageFailed] = useState(false);
  const body = <div className="dui-stack dui-gap-md">{ctx.renderNodes(node.children)}</div>;
  return (
    <section className={cn('dui-card', highlighted && 'is-highlighted', node.image && 'has-image')}>
      {node.image && !imageFailed && (
        <UiImg
          className="dui-card-image"
          src={node.image.src}
          alt={node.image.alt}
          aspect="16 / 7"
          onFailed={() => setImageFailed(true)}
        />
      )}
      {(title || node.subtitle || node.expandable) && (
        <header className="dui-card-head">
          <div>
            {title && <h4>{title}</h4>}
            {node.subtitle && <p>{ctx.rt.template(node.subtitle)}</p>}
          </div>
          {node.expandable && (
            <button
              type="button"
              className="dui-icon-button is-quiet"
              aria-label="Vergrössern"
              title="Vergrössern"
              onClick={() => setFull(true)}
            >
              <Maximize2 size={15} />
            </button>
          )}
        </header>
      )}
      {body}
      {!!node.actions?.length && (
        <footer className="dui-card-actions">
          {node.actions.slice(0, 2).map((button, index) => (
            <ActionButton
              key={index}
              ctx={ctx}
              action={button.action}
              label={button.label}
              variant={button.variant ?? (index === 0 ? 'primary' : 'secondary')}
            />
          ))}
        </footer>
      )}
      {node.expandable && (
        <Fullscreen open={full} title={title || 'Ansicht'} onClose={() => setFull(false)}>
          {full && body}
        </Fullscreen>
      )}
    </section>
  );
};

/** Segmented tab bar with a sliding indicator; `bind` keeps the index in state. */
export const Tabs: Renderer<'tabs'> = ({ node, ctx }) => {
  const id = useId();
  const [local, setLocal] = useState(0);
  const bound = node.bind ? Number(ctx.rt.state[node.bind]) : Number.NaN;
  const active = Math.min(
    node.tabs.length - 1,
    Math.max(0, Number.isInteger(bound) ? bound : local)
  );
  const bar = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const element = bar.current?.querySelectorAll<HTMLElement>('[role="tab"]')[active];
    if (!element) return;
    const update = () => setIndicator({ left: element.offsetLeft, width: element.offsetWidth });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar.current!);
    return () => observer.disconnect();
  }, [active, node.tabs.length]);
  const select = (index: number) => {
    setLocal(index);
    if (node.bind) ctx.set(node.bind, index);
  };
  const tab = node.tabs[active];
  return (
    <div className="dui-tabs">
      <div
        ref={bar}
        className="dui-tabbar"
        role="tablist"
        onKeyDown={(event) => {
          const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          if (!delta) return;
          event.preventDefault();
          const next = (active + delta + node.tabs.length) % node.tabs.length;
          select(next);
          bar.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
        }}
      >
        {indicator && (
          <span
            className="dui-tab-indicator"
            aria-hidden
            style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
          />
        )}
        {node.tabs.map((item, index) => (
          <button
            key={item.id ?? index}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-selected={index === active}
            aria-controls={`${id}-panel`}
            tabIndex={index === active ? 0 : -1}
            className={cn(index === active && 'is-active')}
            onClick={() => select(index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        key={active}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${active}`}
        className="dui-tabpanel dui-stack dui-gap-md"
      >
        {tab && ctx.renderNodes(tab.children)}
      </div>
    </div>
  );
};

export const Accordion: Renderer<'accordion'> = ({ node, ctx }) => {
  const id = useId();
  const [open, setOpen] = useState<boolean[]>(() => node.items.map((item) => !!item.open));
  return (
    <div className="dui-accordion">
      {node.items.map((item, index) => {
        const expanded = open[index] ?? !!item.open;
        return (
          <section
            key={item.id ?? index}
            className={cn('dui-accordion-item', expanded && 'is-open')}
            style={{ ['--dui-i' as string]: index }}
          >
            <h4>
              <button
                type="button"
                id={`${id}-head-${index}`}
                aria-expanded={expanded}
                aria-controls={`${id}-body-${index}`}
                onClick={() =>
                  setOpen((current) => {
                    const next = node.items.map((entry, i) => current[i] ?? !!entry.open);
                    next[index] = !expanded;
                    return next;
                  })
                }
              >
                <span>{item.title}</span>
                <ChevronDown size={16} className="dui-accordion-chevron" aria-hidden />
              </button>
            </h4>
            <div
              id={`${id}-body-${index}`}
              role="region"
              aria-labelledby={`${id}-head-${index}`}
              className="dui-accordion-body"
              {...((expanded ? {} : { inert: '' }) as Record<string, string>)}
            >
              <div className="dui-accordion-inner">
                <div className="dui-stack dui-gap-md">{ctx.renderNodes(item.children)}</div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
};
