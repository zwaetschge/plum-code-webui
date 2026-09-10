import { useEffect, useState } from 'react';

/**
 * Track a CSS media query from React.
 *
 * Needed wherever `hidden md:flex` is not enough: a display-none subtree is still
 * mounted, so its children keep running effects, timers and subscriptions. Two
 * copies of the same panel — one in the mobile sheet, one in the hidden desktop
 * dock — meant two live browser previews and two task pollers on a phone.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(query);
    const update = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mediaQuery.matches);
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/** The `md` breakpoint Tailwind uses, as a JS-side predicate. */
export function useIsDesktopLayout(): boolean {
  return useMediaQuery('(min-width: 768px)');
}
