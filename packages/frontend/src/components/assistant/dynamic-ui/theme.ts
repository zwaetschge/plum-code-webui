import { useMemo, useSyncExternalStore } from 'react';

/* SVG attributes cannot read var(); charts resolve the theme once per switch. */
const subscribe = (listener: () => void) => {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};
const isDark = () => document.documentElement.classList.contains('dark');

export function useIsDark() {
  return useSyncExternalStore(subscribe, isDark, () => true);
}

/** Up to six series colours for the current theme; the first is Plum's primary. */
export function readThemePalette(dark: boolean) {
  const styles = getComputedStyle(document.documentElement);
  const primary = styles.getPropertyValue('--primary').trim() || '168 72% 46%';
  return dark
    ? [
        `hsl(${primary})`,
        'hsl(262 83% 72%)',
        'hsl(38 92% 60%)',
        'hsl(199 89% 62%)',
        'hsl(340 82% 68%)',
        'hsl(142 60% 55%)',
      ]
    : [
        `hsl(${primary})`,
        'hsl(262 70% 56%)',
        'hsl(32 92% 48%)',
        'hsl(205 85% 46%)',
        'hsl(340 72% 52%)',
        'hsl(142 62% 36%)',
      ];
}

export function useThemePalette() {
  const dark = useIsDark();
  return useMemo(() => readThemePalette(dark), [dark]);
}

/** Class list of <html> (light/dark and the provider theme), for theme-derived values. */
export function useThemeClass() {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.className,
    () => 'dark'
  );
}

/** Tone colours for changes (stock, currency, KPI deltas). */
export function useToneColors() {
  const dark = useIsDark();
  return dark
    ? { positive: 'hsl(146 58% 52%)', negative: 'hsl(4 80% 64%)', neutral: 'hsl(210 10% 62%)' }
    : { positive: 'hsl(146 64% 32%)', negative: 'hsl(2 70% 48%)', neutral: 'hsl(210 8% 46%)' };
}
