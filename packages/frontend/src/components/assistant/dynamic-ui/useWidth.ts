import { useLayoutEffect, useRef, useState } from 'react';

/** Rendered width of an element, kept current by a ResizeObserver. */
export function useWidth<T extends Element>(initial = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measured = Math.round(element.getBoundingClientRect().width);
    if (measured > 0) setWidth(measured);
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry!.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
