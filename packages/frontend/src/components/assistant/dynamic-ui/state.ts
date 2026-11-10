import type { UiValue } from '@plum-code-webui/shared';
import { readPersisted, writePersisted } from './persist';

type Edits = Record<string, UiValue>;

const sanitize = (value: unknown): Edits | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Edits = {};
  for (const [key, entry] of Object.entries(value))
    if (entry === null || ['number', 'string', 'boolean'].includes(typeof entry))
      out[key] = entry as UiValue;
  return out;
};

/**
 * One store per conversation: dirty inputs survive streamed and patched specs.
 * With `persist`, the edits of each view also survive reloads, stored under
 * `plum-dui:<viewId>:state` (a view's ID is the turn that created it).
 */
export class DynamicUiStateStore {
  private values: Record<string, Edits> = {};
  private stored = new Map<string, Edits>();
  private listeners = new Set<() => void>();
  constructor(private readonly persist = false) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.values;
  /** Current edits of one view; reads the stored copy once (pure, no notification). */
  view(view: string): Edits {
    if (Object.hasOwn(this.values, view)) return this.values[view]!;
    if (!this.persist) return {};
    let stored = this.stored.get(view);
    if (!stored) {
      stored = sanitize(readPersisted(`${view}:state`)) ?? {};
      this.stored.set(view, stored);
    }
    return stored;
  }
  set(view: string, key: string, value: UiValue) {
    this.commit(view, { ...this.view(view), [key]: value });
  }
  reset(view: string) {
    this.commit(view, {});
  }
  private commit(view: string, edits: Edits) {
    this.values = { ...this.values, [view]: edits };
    if (this.persist)
      writePersisted(`${view}:state`, Object.keys(edits).length ? edits : undefined);
    for (const listener of this.listeners) listener();
  }
}
