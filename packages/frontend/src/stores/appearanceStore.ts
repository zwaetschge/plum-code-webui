import { create } from 'zustand';
import type { BackgroundAnimation, Theme } from '@plum-code-webui/shared';

export const DEFAULT_BACKGROUND_ANIMATION: BackgroundAnimation = 'aurora';
export const THEME_STORAGE_KEY = 'theme';
export const BACKGROUND_ANIMATION_STORAGE_KEY = 'background-animation';

export const BACKGROUND_ANIMATION_OPTIONS: Array<{
  value: BackgroundAnimation;
  label: string;
  description: string;
}> = [
  {
    value: 'aurora',
    label: 'Plum Waves',
    description: 'The original animated wave background',
  },
  {
    value: 'glass',
    label: 'Misty Waterdrops',
    description: 'Soft droplets on fogged glass',
  },
  {
    value: 'ribbons',
    label: 'Neon Glow',
    description: 'Animated 3D neon tubes and travelling light',
  },
  {
    value: 'still',
    label: 'Aurora Galaxy',
    description: 'Slow starfield aurora drift',
  },
];

export function normalizeBackgroundAnimation(value: unknown): BackgroundAnimation {
  return value === 'aurora' || value === 'ribbons' || value === 'still' || value === 'glass'
    ? value
    : DEFAULT_BACKGROUND_ANIMATION;
}

export function normalizeTheme(value: unknown): Theme {
  return value === 'light' || value === 'dark' || value === 'system' || value === 'eink'
    ? value
    : 'dark';
}

function resolveSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
}

export function setStoredTheme(theme: unknown): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
}

let themeChangeSequence = 0;

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const next = normalizeTheme(theme);
  const resolved = next === 'system' ? resolveSystemTheme() : next;
  const root = document.documentElement;
  const themeChanged = root.dataset.resolvedTheme !== resolved;
  const changeSequence = themeChanged ? ++themeChangeSequence : themeChangeSequence;

  // Colour transitions on hundreds of controls can lag behind the new theme
  // while a WebGL or rain background is rendering, leaving white-on-white
  // text and half-dark buttons. Commit the new palette in a single paint.
  if (themeChanged) root.classList.add('theme-switching');

  root.classList.remove('light', 'dark', 'eink');
  root.classList.add(resolved);
  root.dataset.theme = next;
  root.dataset.resolvedTheme = resolved;

  const chromeColor = resolved === 'dark' ? '#172637' : resolved === 'eink' ? '#fafafa' : '#eff8f6';
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', chromeColor);
  document
    .querySelector<HTMLMetaElement>('meta[name="msapplication-TileColor"]')
    ?.setAttribute('content', chromeColor);

  if (themeChanged) {
    // A WebGL backdrop can throttle animation frames. Release the temporary
    // transition guard on wall time so it cannot linger after the palette is
    // already correct, even when the background is busy or the tab is hidden.
    window.setTimeout(() => {
      if (changeSequence === themeChangeSequence) root.classList.remove('theme-switching');
    }, 180);
  }
}

export function getStoredBackgroundAnimation(): BackgroundAnimation {
  if (typeof window === 'undefined') return DEFAULT_BACKGROUND_ANIMATION;
  return normalizeBackgroundAnimation(
    window.localStorage.getItem(BACKGROUND_ANIMATION_STORAGE_KEY)
  );
}

export function applyBackgroundAnimation(animation: BackgroundAnimation): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.backgroundAnimation = animation;
}

export function setStoredBackgroundAnimation(animation: BackgroundAnimation): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BACKGROUND_ANIMATION_STORAGE_KEY, animation);
}

interface AppearanceState {
  backgroundAnimation: BackgroundAnimation;
  setBackgroundAnimation: (animation: BackgroundAnimation) => void;
}

export const useAppearanceStore = create<AppearanceState>((set) => ({
  backgroundAnimation: getStoredBackgroundAnimation(),
  setBackgroundAnimation: (animation) => {
    const next = normalizeBackgroundAnimation(animation);
    setStoredBackgroundAnimation(next);
    applyBackgroundAnimation(next);
    set({ backgroundAnimation: next });
  },
}));
