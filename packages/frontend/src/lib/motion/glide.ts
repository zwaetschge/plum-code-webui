import { useEffect, type RefObject } from 'react';
import { onFrame, SpringBox, type Box } from './spring';
import { prefersReducedMotion } from './reducedMotion';
import { SPRINGS } from './tokens';

/**
 * RailGlide: one selection surface inside `container` that springs to the
 * element matching `selector` (the active route). Positions are relative to
 * the container, which must be `position: relative`. The marker follows
 * class changes, list re-renders and size changes on its own.
 */
export function useGlideMarker(
  container: RefObject<HTMLElement>,
  marker: RefObject<HTMLElement>,
  selector: string,
  enabled = true
) {
  useEffect(() => {
    const host = container.current;
    const mark = marker.current;
    if (!host || !mark || !enabled) return;
    let box: SpringBox | null = null;
    let visible = false;
    let stop: (() => void) | null = null;
    let scheduled = 0;
    let observed: Element | null = null;
    let hostSize = '';

    const paint = (b: Box) => {
      mark.style.transform = `translate(${b.left}px, ${b.top}px)`;
      mark.style.width = `${Math.max(0, b.right - b.left)}px`;
      mark.style.height = `${Math.max(0, b.bottom - b.top)}px`;
    };

    const measure = () => {
      scheduled = 0;
      const active = host.querySelector<HTMLElement>(selector);
      if (active !== observed) {
        if (observed) sizes.unobserve(observed);
        if (active) sizes.observe(active);
        observed = active;
      }
      if (!active || !active.offsetParent) {
        visible = false;
        mark.style.opacity = '0';
        return;
      }
      const base = host.getBoundingClientRect();
      const rect = active.getBoundingClientRect();
      // The container itself changed shape (the sidebar collapsing, a window
      // resize): that is layout, not navigation, so land without gliding. A
      // spring from the wide layout left the marker sticking out of the rail.
      const size = `${Math.round(base.width)}x${Math.round(base.height)}`;
      const relayout = hostSize !== '' && size !== hostSize;
      hostSize = size;
      const target: Box = {
        left: rect.left - base.left,
        top: rect.top - base.top,
        right: rect.right - base.left,
        bottom: rect.bottom - base.top,
      };
      // First appearance (or after hiding) lands without travelling in from 0,0.
      if (!box || !visible || relayout || prefersReducedMotion()) {
        stop?.();
        stop = null;
        box = box ?? new SpringBox(target);
        box.jump(target);
        paint(target);
        visible = true;
        mark.style.opacity = '1';
        return;
      }
      box.setTarget(target, SPRINGS.marker);
      if (!stop) {
        const current = box;
        stop = onFrame((dt) => {
          paint(current.step(dt));
          if (current.settled) {
            stop = null;
            return false;
          }
        });
      }
    };
    const schedule = () => {
      if (!scheduled) scheduled = requestAnimationFrame(measure);
    };
    const sizes = new ResizeObserver(schedule);
    sizes.observe(host);
    const changes = new MutationObserver(schedule);
    changes.observe(host, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'aria-current'],
    });
    measure();
    return () => {
      cancelAnimationFrame(scheduled);
      stop?.();
      sizes.disconnect();
      changes.disconnect();
    };
  }, [container, marker, selector, enabled]);
}
