import type { UiValue } from '@plum-code-webui/shared';

/** One store per conversation: dirty inputs survive streamed and patched specs. */
export class DynamicUiStateStore {
  private values: Record<string, Record<string, UiValue>> = {};
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.values;
  set(view: string, key: string, value: UiValue) {
    this.values = { ...this.values, [view]: { ...this.values[view], [key]: value } };
    for (const listener of this.listeners) listener();
  }
  reset(view: string) {
    this.values = { ...this.values, [view]: {} };
    for (const listener of this.listeners) listener();
  }
}
