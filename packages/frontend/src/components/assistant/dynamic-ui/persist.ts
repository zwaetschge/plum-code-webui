import { useCallback, useEffect, useRef, useState } from 'react';

/** Every Dynamic UI entry in localStorage starts with this prefix. */
export const DUI_STORAGE_PREFIX = 'plum-dui:';
const MAX_ENTRIES = 400;

export function readPersisted<T>(key: string | null): T | undefined {
  if (!key) return undefined;
  try {
    const raw = window.localStorage.getItem(DUI_STORAGE_PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

/** Writes one entry; the oldest entries go when the namespace grows too large. */
export function writePersisted(key: string | null, value: unknown) {
  if (!key) return;
  try {
    const storage = window.localStorage;
    if (value === undefined) storage.removeItem(DUI_STORAGE_PREFIX + key);
    else storage.setItem(DUI_STORAGE_PREFIX + key, JSON.stringify(value));
    if (Math.random() < 0.05) {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const name = storage.key(index);
        if (name?.startsWith(DUI_STORAGE_PREFIX)) keys.push(name);
      }
      for (const name of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)))
        storage.removeItem(name);
    }
  } catch {
    // Private mode or quota: state stays in memory for this page.
  }
}

/**
 * React state that survives reloads per message: stored under
 * `plum-dui:<turnId>:<nodeId>` (see Ctx.storageKey). `sanitize` rejects stale
 * shapes, e.g. after the model changed the number of questions.
 */
export function usePersistentState<T>(
  key: string | null,
  initial: () => T,
  sanitize: (value: unknown) => T | undefined = (value) => value as T
) {
  const [value, setValue] = useState<T>(() => {
    const stored = readPersisted<unknown>(key);
    return (stored === undefined ? undefined : sanitize(stored)) ?? initial();
  });
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    const stored = readPersisted<unknown>(key);
    setValue((stored === undefined ? undefined : sanitize(stored)) ?? initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = useCallback(
    (next: T | ((current: T) => T)) =>
      setValue((current) => {
        const resolved = typeof next === 'function' ? (next as (c: T) => T)(current) : next;
        writePersisted(keyRef.current, resolved);
        return resolved;
      }),
    []
  );
  return [value, update] as const;
}
