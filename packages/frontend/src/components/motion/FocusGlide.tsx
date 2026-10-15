import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { boxOf, onFrame, SpringBox, type Box, type Edge } from '@/lib/motion/spring';
import { prefersReducedMotion } from '@/lib/motion/reducedMotion';
import { SPRINGS } from '@/lib/motion/tokens';

const INSET = 3;
const DROPLET = 360;
/** Text fields show focus through their own frame (the composer border). */
const SKIP =
  'textarea, select, [contenteditable="true"], input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"])';
const OUTSIDE =
  '[data-radix-popper-content-wrapper], [role="dialog"][aria-modal="true"], [data-no-focus-glide]';

const center = (b: Box) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

/**
 * FocusGlide: a single frame that follows keyboard focus inside the assistant
 * shell. Its four edges spring independently — the leading edge runs ahead,
 * the trailing one follows — and long jumps travel as a small droplet. The
 * browser focus stays the truth; pointer input hides the frame.
 */
export function FocusGlide() {
  const svg = useRef<SVGSVGElement>(null);
  const rect = useRef<SVGRectElement>(null);

  useEffect(() => {
    const frame = svg.current;
    const shape = rect.current;
    if (!frame || !shape) return;
    let box: SpringBox | null = null;
    let element: HTMLElement | null = null;
    let stop: (() => void) | null = null;
    let droplet = 0;

    const targetOf = (el: HTMLElement): Box => {
      const b = boxOf(el.getBoundingClientRect());
      return {
        left: b.left - INSET,
        top: b.top - INSET,
        right: b.right + INSET,
        bottom: b.bottom + INSET,
      };
    };
    const paint = (b: Box) => {
      const width = Math.max(0, b.right - b.left);
      const height = Math.max(0, b.bottom - b.top);
      shape.setAttribute('x', String(b.left));
      shape.setAttribute('y', String(b.top));
      shape.setAttribute('width', String(width));
      shape.setAttribute('height', String(height));
      shape.setAttribute('rx', String(Math.min(10, width / 2, height / 2)));
    };
    const animate = () => {
      if (stop || !box) return;
      const current = box;
      stop = onFrame((dt) => {
        paint(current.step(dt));
        if (current.settled && !droplet) {
          stop = null;
          return false;
        }
      });
    };
    const hide = () => {
      element = null;
      window.clearTimeout(droplet);
      droplet = 0;
      frame.classList.remove('is-visible');
      document.documentElement.classList.remove('plum-focus-glide-on');
    };
    const show = (el: HTMLElement) => {
      const target = targetOf(el);
      const wasVisible = !!element && !!box;
      element = el;
      frame.classList.add('is-visible');
      document.documentElement.classList.add('plum-focus-glide-on');
      window.clearTimeout(droplet);
      droplet = 0;
      if (!wasVisible || !box || prefersReducedMotion()) {
        box = box ?? new SpringBox(target);
        box.jump(target);
        paint(target);
        return;
      }
      const from = center(box.value);
      const to = center(target);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (Math.hypot(dx, dy) > DROPLET) {
        // Shrink to a droplet on the way, then open up around the target.
        box.setTarget(
          { left: to.x - 5, right: to.x + 5, top: to.y - 5, bottom: to.y + 5 },
          SPRINGS.rapid
        );
        droplet = window.setTimeout(() => {
          droplet = 0;
          if (element === el && box) {
            box.setTarget(targetOf(el), SPRINGS.side);
            animate();
          }
        }, 150);
      } else {
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const lead: Edge = horizontal ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';
        const trail: Edge = { right: 'left', left: 'right', bottom: 'top', top: 'bottom' }[
          lead
        ] as Edge;
        box.setTarget(
          target,
          (edge) => (edge === lead ? SPRINGS.lead : edge === trail ? SPRINGS.trail : SPRINGS.side),
          (edge) => (edge === trail ? 30 : 0)
        );
      }
      animate();
    };
    const onFocus = (event: FocusEvent) => {
      const el = event.target as HTMLElement | null;
      if (
        !el?.closest?.('.plum-assistant-shell') ||
        el.closest(OUTSIDE) ||
        el.matches(SKIP) ||
        !el.matches(':focus-visible')
      ) {
        hide();
        return;
      }
      show(el);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!event.relatedTarget) hide();
    };
    // Scrolling and resizing keep the frame glued to its element.
    const follow = () => {
      if (!element || !box) return;
      if (!element.isConnected) return hide();
      const target = targetOf(element);
      box.jump(target);
      paint(target);
    };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', follow, { capture: true, passive: true });
    window.addEventListener('resize', follow);
    return () => {
      hide();
      stop?.();
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('scroll', follow, { capture: true });
      window.removeEventListener('resize', follow);
    };
  }, []);

  return createPortal(
    <svg ref={svg} className="plum-focus-glide" aria-hidden="true">
      <rect ref={rect} />
    </svg>,
    document.body
  );
}
