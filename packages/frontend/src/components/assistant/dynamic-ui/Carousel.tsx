import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useActionRunner } from './actions';
import type { Renderer } from './context';
import { aspectRatio, UiImg } from './media';
import { prefersReducedMotion } from '@/lib/motion/reducedMotion';

/**
 * Horizontal carousel: native scroll snap and momentum on touch, drag with
 * inertia for the mouse, arrows on fine pointers, dots and arrow keys.
 */
export function CarouselShell({
  label,
  slides,
  className,
}: {
  label: string;
  slides: ReactNode[];
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: false });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    x: number;
    scroll: number;
    lastX: number;
    lastT: number;
    velocity: number;
    moved: boolean;
  } | null>(null);
  const inertia = useRef(0);
  const count = slides.length;

  const slideAt = (index: number) =>
    track.current?.querySelectorAll<HTMLElement>('.dui-carousel-slide')[index];
  const measure = useCallback(() => {
    const element = track.current;
    if (!element) return;
    const items = element.querySelectorAll<HTMLElement>('.dui-carousel-slide');
    let nearest = 0;
    let distance = Infinity;
    items.forEach((item, index) => {
      const delta = Math.abs(item.offsetLeft - element.scrollLeft - items[0]!.offsetLeft);
      if (delta < distance) {
        distance = delta;
        nearest = index;
      }
    });
    const max = element.scrollWidth - element.clientWidth;
    // At the far end the last slides may never reach the start edge.
    setActive(element.scrollLeft >= max - 4 ? count - 1 : nearest);
    setEdges({ start: element.scrollLeft <= 4, end: element.scrollLeft >= max - 4 });
  }, [count]);
  useEffect(() => {
    measure();
    const element = track.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);
  useEffect(() => () => cancelAnimationFrame(inertia.current), []);

  const go = (index: number) => {
    const element = track.current;
    const target = slideAt(Math.max(0, Math.min(count - 1, index)));
    if (!element || !target) return;
    const first = slideAt(0)!;
    element.scrollTo({
      left: target.offsetLeft - first.offsetLeft,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };

  const settle = () => {
    setDragging(false);
    measure();
    window.requestAnimationFrame(() => {
      const element = track.current;
      if (!element) return;
      const items = element.querySelectorAll<HTMLElement>('.dui-carousel-slide');
      let nearest = 0;
      let distance = Infinity;
      items.forEach((item, index) => {
        const delta = Math.abs(item.offsetLeft - items[0]!.offsetLeft - element.scrollLeft);
        if (delta < distance) {
          distance = delta;
          nearest = index;
        }
      });
      go(nearest);
    });
  };

  return (
    <div
      className={cn('dui-carousel', className, edges.start && 'is-start', edges.end && 'is-end')}
      role="region"
      aria-roledescription="Karussell"
      aria-label={label}
    >
      <div
        ref={track}
        className={cn('dui-carousel-track', dragging && 'is-dragging')}
        tabIndex={0}
        onScroll={measure}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') go(active + 1);
          else if (event.key === 'ArrowLeft') go(active - 1);
          else return;
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse' || event.button !== 0 || !track.current) return;
          cancelAnimationFrame(inertia.current);
          drag.current = {
            x: event.clientX,
            scroll: track.current.scrollLeft,
            lastX: event.clientX,
            lastT: event.timeStamp,
            velocity: 0,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          const element = track.current;
          if (!state || !element) return;
          const dx = event.clientX - state.x;
          if (!state.moved && Math.abs(dx) > 4) {
            state.moved = true;
            setDragging(true);
            element.setPointerCapture(event.pointerId);
          }
          if (!state.moved) return;
          element.scrollLeft = state.scroll - dx;
          const dt = Math.max(1, event.timeStamp - state.lastT);
          state.velocity = 0.8 * ((event.clientX - state.lastX) / dt) + 0.2 * state.velocity;
          state.lastX = event.clientX;
          state.lastT = event.timeStamp;
        }}
        onPointerUp={() => {
          const state = drag.current;
          drag.current = null;
          if (!state?.moved) return;
          const element = track.current;
          // Swallow the click that ends a drag so cards do not open.
          element?.addEventListener(
            'click',
            (click) => {
              click.preventDefault();
              click.stopPropagation();
            },
            { capture: true, once: true }
          );
          let velocity = -state.velocity * 16;
          if (prefersReducedMotion() || !element) return settle();
          const step = () => {
            element.scrollLeft += velocity;
            velocity *= 0.93;
            if (Math.abs(velocity) > 0.6) inertia.current = requestAnimationFrame(step);
            else settle();
          };
          inertia.current = requestAnimationFrame(step);
        }}
        onPointerCancel={() => {
          if (drag.current?.moved) settle();
          drag.current = null;
        }}
      >
        {slides.map((slide, index) => (
          <div
            key={index}
            className="dui-carousel-slide"
            role="group"
            aria-roledescription="Folie"
            aria-label={`${index + 1} von ${count}`}
            style={{ ['--dui-i' as string]: Math.min(index, 6) }}
          >
            {slide}
          </div>
        ))}
      </div>
      {!edges.start && (
        <button
          type="button"
          className="dui-carousel-arrow is-prev"
          aria-label="Zurück"
          tabIndex={-1}
          onClick={() => go(active - 1)}
        >
          <ChevronLeft size={18} />
        </button>
      )}
      {!edges.end && (
        <button
          type="button"
          className="dui-carousel-arrow is-next"
          aria-label="Weiter"
          tabIndex={-1}
          onClick={() => go(active + 1)}
        >
          <ChevronRight size={18} />
        </button>
      )}
      {count > 1 && (
        <div className="dui-carousel-dots" role="tablist" aria-label="Folien">
          {slides.map((_, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              tabIndex={-1}
              aria-selected={index === active}
              aria-label={`Folie ${index + 1}`}
              className={cn(index === active && 'is-active')}
              onClick={() => go(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const Carousel: Renderer<'carousel'> = ({ node, ctx }) => {
  const { run } = useActionRunner(ctx);
  const ratio = aspectRatio(node.aspect, '4 / 3');
  return (
    <CarouselShell
      label={node.items[0]?.title ? `Auswahl: ${node.items.length} Einträge` : 'Karussell'}
      slides={node.items.map((item, index) => {
        const content = (
          <>
            {item.image && (
              <span className="dui-slide-media">
                <UiImg src={item.image.src} alt={item.image.alt} aspect={ratio} />
                {item.badge && <span className="dui-slide-badge">{item.badge}</span>}
              </span>
            )}
            <span className="dui-slide-body">
              {!item.image && item.badge && (
                <span className="dui-badge is-accent dui-slide-badge-inline">{item.badge}</span>
              )}
              <span className="dui-slide-title">{item.title}</span>
              {item.subtitle && <span className="dui-slide-subtitle">{item.subtitle}</span>}
              {!!item.meta?.length && (
                <span className="dui-slide-meta">
                  {item.meta.slice(0, 3).map((meta, position) => (
                    <span key={position}>{meta}</span>
                  ))}
                </span>
              )}
            </span>
            {item.action?.type === 'openUrl' && (
              <ExternalLink size={14} className="dui-slide-external" aria-hidden />
            )}
          </>
        );
        return item.action ? (
          <button
            key={index}
            type="button"
            className="dui-slide is-action"
            disabled={!ctx.canRun(item.action)}
            onClick={() => void run(item.action!)}
          >
            {content}
          </button>
        ) : (
          <div key={index} className="dui-slide">
            {content}
          </div>
        );
      })}
    />
  );
};
