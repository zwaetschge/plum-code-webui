import type { ReactNode } from 'react';
import type {
  AnyUiResult,
  UiAction,
  UiLiveNode,
  UiNode,
  UiNodeOf,
  UiNodeType,
  UiValue,
} from '@plum-code-webui/shared';
import type { UiRuntime } from './runtime';

/**
 * Everything a component renderer may reach. One instance per message and
 * state snapshot; renderers never talk to the network or the chat directly.
 */
export interface Ctx {
  rt: UiRuntime;
  /** Writes view state (inputs, tabs). Ignored while the view still streams. */
  set: (key: string, value: UiValue) => void;
  reset: () => void;
  /** A request runs in this chat: inputs and chat actions are locked. */
  busy: boolean;
  /** The view is still arriving: everything is locked. */
  streaming: boolean;
  /** Runs an action of a button, card, list or carousel item. */
  run: (action: UiAction) => Promise<'done' | 'copied' | 'blocked'>;
  /** Same guards as `run`, but texts stay literal (custom tiles: no {{templates}}). */
  runLiteral: (action: UiAction) => Promise<'done' | 'copied' | 'blocked'>;
  /** The message is the newest turn of its chat; only then may tiles send messages. */
  latest: boolean;
  /** Whether `run(action)` would do something right now. */
  canRun: (action: UiAction) => boolean;
  /** The live result for a widget while its parameters still match. */
  live: (node: UiLiveNode) => AnyUiResult | undefined;
  /** „Erneut versuchen“ for a live widget; undefined without a chat (demo). */
  refresh?: (nodeId: string) => Promise<void>;
  /** localStorage key for per-message state (`turnId:nodeId`), null without a turn. */
  storageKey: (nodeId: string) => string | null;
  /** Opens the entity card (openEntity action). */
  openEntity: (title: string, lang?: string) => void;
  renderNodes: (nodes: UiNode[]) => ReactNode;
}

export type Renderer<T extends UiNodeType> = (props: { node: UiNodeOf<T>; ctx: Ctx }) => ReactNode;

/** Shared easing of every Dynamic UI motion (ChatGPT-like settle). */
export const DUI_EASE = 'cubic-bezier(.16,1,.3,1)';

/** Row entrance stagger, capped so long lists do not trail. */
export const stagger = (index: number) =>
  ({ ['--dui-i' as string]: Math.min(index, 12) }) as Record<string, number>;
