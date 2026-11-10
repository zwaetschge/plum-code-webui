/**
 * Every localStorage key the web UI writes per session, in one place, so a
 * deleted session or a logout does not leave them behind forever.
 *
 * Kept free of app imports so the regression script can run it under plain tsx.
 */

/** Keys of the form `<prefix><sessionId>`. */
export const SESSION_KEY_PREFIXES = [
  'sessionMode:',
  'activeFollowupMode:',
  'plum.chat.cursor.v2:',
  'plum.chat.cursor-verified.v2:',
  'webpreview_active_file_v1:',
] as const;

/** Drafts are `<prefix>${JSON.stringify([userId, sessionId, chatId])}`. */
export const CHAT_DRAFT_PREFIX = 'plum.chat.draft.v1:';

/** One key holding the unsent chat messages of every session. */
export const CHAT_OUTBOX_STORAGE_KEY = 'plum.chat.outbox.v1';

/** The subset of `Storage` these helpers need; lets tests pass a plain fake. */
export interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionKeyOwner {
  sessionId: string;
  /** Only drafts record their account. */
  userId?: string;
}

// WebPreview falls back to a working directory or `global` when it has no
// session; those keys are not session-owned and must never be swept.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isSessionId(value: string): boolean {
  return value !== 'global' && SESSION_ID_PATTERN.test(value);
}

/** Which session (and for drafts, which account) a key belongs to, or null. */
export function sessionKeyOwner(key: string): SessionKeyOwner | null {
  for (const prefix of SESSION_KEY_PREFIXES) {
    if (!key.startsWith(prefix)) continue;
    const sessionId = key.slice(prefix.length);
    return isSessionId(sessionId) ? { sessionId } : null;
  }
  if (key.startsWith(CHAT_DRAFT_PREFIX)) {
    try {
      const scope: unknown = JSON.parse(key.slice(CHAT_DRAFT_PREFIX.length));
      if (
        Array.isArray(scope) &&
        typeof scope[0] === 'string' &&
        typeof scope[1] === 'string' &&
        scope[1]
      ) {
        return { sessionId: scope[1], userId: scope[0] };
      }
    } catch {
      /* Not one of ours. */
    }
  }
  return null;
}

/** Keys owned by one session. */
export function keysForSession(keys: Iterable<string>, sessionId: string): string[] {
  const result: string[] = [];
  for (const key of keys) {
    if (sessionKeyOwner(key)?.sessionId === sessionId) result.push(key);
  }
  return result;
}

/** Every session-owned key, regardless of session or account. */
export function allSessionKeys(keys: Iterable<string>): string[] {
  const result: string[] = [];
  for (const key of keys) {
    if (sessionKeyOwner(key)) result.push(key);
  }
  return result;
}

/**
 * Keys of sessions the caller has positively confirmed do not exist.
 *
 * `knownSessionIds` must be the complete list of the signed-in account
 * (active and archived). Drafts of other accounts are left alone because that
 * list says nothing about their sessions.
 */
export function staleSessionKeys(
  keys: Iterable<string>,
  knownSessionIds: ReadonlySet<string>,
  userId: string
): string[] {
  const result: string[] = [];
  for (const key of keys) {
    const owner = sessionKeyOwner(key);
    if (!owner || knownSessionIds.has(owner.sessionId)) continue;
    if (owner.userId !== undefined && owner.userId !== userId) continue;
    result.push(key);
  }
  return result;
}

/**
 * The outbox JSON without the entries of one session; null when nothing
 * changes so callers can skip the write.
 */
export function outboxWithoutSession(raw: string | null, sessionId: string): string | null {
  if (!raw) return null;
  try {
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return null;
    const kept = entries.filter(
      (entry) => !(entry && typeof entry === 'object' && entry.sessionId === sessionId)
    );
    return kept.length === entries.length ? null : JSON.stringify(kept);
  } catch {
    return null;
  }
}

function storageKeys(storage: KeyValueStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

function removeAll(storage: KeyValueStorage, keys: string[]): number {
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}

/** Remove everything one session left in storage, including its unsent messages. */
export function removeSessionStorage(storage: KeyValueStorage, sessionId: string): number {
  const removed = removeAll(storage, keysForSession(storageKeys(storage), sessionId));
  const outbox = outboxWithoutSession(storage.getItem(CHAT_OUTBOX_STORAGE_KEY), sessionId);
  if (outbox !== null) storage.setItem(CHAT_OUTBOX_STORAGE_KEY, outbox);
  return removed;
}

/**
 * Remove keys of sessions missing from a complete, successfully loaded list.
 * The outbox is not swept: an unsent message is worth more than the bytes, and
 * the session delete and logout paths already clear it.
 */
export function sweepSessionStorage(
  storage: KeyValueStorage,
  knownSessionIds: ReadonlySet<string>,
  userId: string
): number {
  return removeAll(storage, staleSessionKeys(storageKeys(storage), knownSessionIds, userId));
}

/** Logout: drop every per-session key and the plain-text outbox. */
export function clearAllSessionStorage(storage: KeyValueStorage): number {
  const removed = removeAll(storage, allSessionKeys(storageKeys(storage)));
  storage.removeItem(CHAT_OUTBOX_STORAGE_KEY);
  return removed;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Browser wrappers; storage failures (private mode, blocked) are ignored. */
export function forgetSessionInBrowser(sessionId: string): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    removeSessionStorage(storage, sessionId);
  } catch {
    /* Best effort. */
  }
  window.dispatchEvent(new Event('plum:outbox-changed'));
}

export function clearSessionStorageInBrowser(): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    clearAllSessionStorage(storage);
  } catch {
    /* Best effort. */
  }
  window.dispatchEvent(new Event('plum:outbox-changed'));
}

export function sweepSessionStorageInBrowser(
  knownSessionIds: ReadonlySet<string>,
  userId: string
): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    sweepSessionStorage(storage, knownSessionIds, userId);
  } catch {
    /* Best effort. */
  }
}
