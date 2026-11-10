import assert from 'node:assert/strict';
import type { Theme } from '@plum-code-webui/shared';
import {
  applyTheme,
  getStoredTheme,
  normalizeTheme,
  setStoredTheme,
} from '../src/stores/appearanceStore.ts';

function createClassList() {
  const classes = new Set<string>();
  return {
    add: (...values: string[]) => {
      values.forEach((value) => classes.add(value));
    },
    remove: (...values: string[]) => {
      values.forEach((value) => classes.delete(value));
    },
    contains: (value: string) => classes.has(value),
    values: () => Array.from(classes).sort(),
  };
}

function installLocalStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
  globalThis.window = { localStorage } as unknown as Window & typeof globalThis;
}

function createMeta(content: string) {
  const attributes = new Map<string, string>([['content', content]]);
  return {
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    getAttribute: (name: string) => attributes.get(name) ?? null,
  };
}

function testEinkThemeNormalizesAndAppliesAsStaticMode(): void {
  const classList = createClassList();
  // applyTheme also recolours the browser chrome through the theme-color and
  // tile-color meta tags, and drops the one-paint `theme-switching` guard on a timer.
  const meta = {
    'meta[name="theme-color"]': createMeta('#000000'),
    'meta[name="msapplication-TileColor"]': createMeta('#000000'),
  };
  const timers: Array<() => void> = [];
  globalThis.window = {
    setTimeout: (callback: () => void) => {
      timers.push(callback);
      return timers.length;
    },
  } as unknown as Window & typeof globalThis;
  globalThis.document = {
    documentElement: {
      classList,
      dataset: {},
    },
    querySelector: (selector: string) => meta[selector as keyof typeof meta] ?? null,
  } as unknown as Document;
  const flushTimers = () => timers.splice(0).forEach((callback) => callback());

  assert.equal(normalizeTheme('eink'), 'eink');

  applyTheme('eink' as Theme);
  assert.deepEqual(classList.values(), ['eink', 'theme-switching']);
  flushTimers();
  assert.deepEqual(classList.values(), ['eink']);
  assert.equal(classList.contains('dark'), false);
  assert.equal(classList.contains('light'), false);
  assert.equal(meta['meta[name="theme-color"]'].getAttribute('content'), '#fafafa');
  assert.equal(meta['meta[name="msapplication-TileColor"]'].getAttribute('content'), '#fafafa');

  applyTheme('light');
  flushTimers();
  assert.deepEqual(classList.values(), ['light']);
  assert.equal(classList.contains('eink'), false);
  assert.equal(meta['meta[name="theme-color"]'].getAttribute('content'), '#eff8f6');

  applyTheme('dark');
  flushTimers();
  assert.deepEqual(classList.values(), ['dark']);
  assert.equal(meta['meta[name="theme-color"]'].getAttribute('content'), '#172637');

  // Re-applying the same theme is no switch: no transition guard, no timer.
  applyTheme('dark');
  assert.equal(timers.length, 0);
  assert.deepEqual(classList.values(), ['dark']);
}

function testThemePersistsInDeviceStorage(): void {
  installLocalStorage();

  setStoredTheme('eink');
  assert.equal(getStoredTheme(), 'eink');

  setStoredTheme('not-a-theme');
  assert.equal(getStoredTheme(), 'dark');
}

testEinkThemeNormalizesAndAppliesAsStaticMode();
testThemePersistsInDeviceStorage();
console.log('appearance theme tests passed');
