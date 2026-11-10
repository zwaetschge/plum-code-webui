import {
  Component,
  lazy,
  Suspense,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  uiLiveKey,
  validateDynamicUi,
  mergeDynamicUiState,
  type DynamicUiSpec,
  type UiAction,
  type UiLiveNodeType,
  type UiNode,
  type UiNodeOf,
  type UiNodeType,
  type UiResults,
} from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { UiRuntime } from './runtime';
import { DynamicUiStateStore } from './state';
import type { Ctx, Renderer } from './context';
import { copyText, openExternal } from './actions';
import * as basic from './basic';
import { Accordion, Card, Tabs } from './layout';
import * as content from './content';
import { Carousel } from './Carousel';
import { Table } from './table';
import { Checklist, Flashcards, Quiz } from './learning';
import { LiveSkeleton } from './live/LiveFrame';
import { EntitySheet } from './EntityCard';
import { WidgetTile } from './WidgetTile';
import './dynamic-ui.css';
import './dynamic-ui-v2.css';

export interface DynamicUiProps {
  spec: DynamicUiSpec;
  stateStore?: DynamicUiStateStore;
  /** View identity without a server `viewId` (fixtures). */
  stateKey?: string;
  /** Runs a `sendMessage` action as a new chat message; omitted = disabled. */
  onSendMessage?: (text: string) => void;
  /** Runs a `prefill` action: puts the text into the composer. */
  onPrefill?: (text: string) => void;
  /** A request runs in this chat: inputs and chat actions are locked. */
  busy?: boolean;
  /** This view is still streaming: everything is locked. */
  streaming?: boolean;
  /** The message's turn; keys the per-message state in localStorage. */
  turnId?: string;
  /** Server data of live widgets (`turn.uiResults`). */
  results?: UiResults;
  /** „Erneut versuchen“ for a failed live widget. */
  onRefreshResult?: (nodeId: string) => Promise<void>;
  /** Newest turn of the chat: custom tiles may send messages only from there. */
  latest?: boolean;
}

/* Heavy parts load on first use: Recharts for charts, the live widget chunk. */
const ChartLazy = lazy(() => import('./chart'));
const live = () => import('./live');
const LIVE: {
  [T in UiLiveNodeType]: ComponentType<{ node: Extract<UiNode, { type: T }>; ctx: Ctx }>;
} = {
  weather: lazy(() => live().then((m) => ({ default: m.WeatherNode }))),
  currency: lazy(() => live().then((m) => ({ default: m.CurrencyNode }))),
  stock: lazy(() => live().then((m) => ({ default: m.StockNode }))),
  entity: lazy(() => live().then((m) => ({ default: m.EntityNode }))),
  news: lazy(() => live().then((m) => ({ default: m.NewsNode }))),
  gallery: lazy(() => live().then((m) => ({ default: m.GalleryNode }))),
};
function liveRenderer<T extends UiLiveNodeType>(type: T): Renderer<T> {
  const Widget = LIVE[type] as ComponentType<{ node: UiNodeOf<T>; ctx: Ctx }>;
  function LiveWidget({ node, ctx }: { node: UiNodeOf<T>; ctx: Ctx }) {
    return (
      <Suspense fallback={<LiveSkeleton type={type} />}>
        <Widget node={node} ctx={ctx} />
      </Suspense>
    );
  }
  return LiveWidget;
}
const Chart: Renderer<'chart'> = ({ node, ctx }) => (
  <Suspense
    fallback={
      <div className="dui-chart dui-sk is-block" style={{ height: (node.height ?? 240) + 44 }} />
    }
  >
    <ChartLazy node={node} ctx={ctx} />
  </Suspense>
);

/** The component registry: the only UI a model can reach. */
const REGISTRY: { [T in UiNodeType]: Renderer<T> } = {
  stack: basic.Stack,
  row: basic.Row,
  grid: basic.Grid,
  card: Card,
  calculator: basic.Calculator,
  heading: basic.Heading,
  text: basic.Text,
  markdown: basic.Markdown,
  badge: basic.Badge,
  divider: basic.Divider,
  kpi: basic.Kpi,
  slider: basic.Slider,
  input: basic.Input,
  select: basic.Select,
  segmented: basic.Segmented,
  checkbox: basic.Checkbox,
  button: basic.Button,
  table: Table,
  chart: Chart,
  compare: basic.Compare,
  tabs: Tabs,
  accordion: Accordion,
  carousel: Carousel,
  list: content.List,
  timeline: content.Timeline,
  callout: content.Callout,
  progress: content.Progress,
  rating: content.Rating,
  image: content.ImageNode,
  code: content.CodeBlock,
  math: content.MathNode,
  stepper: basic.Stepper,
  radio: basic.Radio,
  textarea: basic.Textarea,
  date: basic.DateInput,
  form: basic.Form,
  checklist: Checklist,
  quiz: Quiz,
  flashcards: Flashcards,
  weather: liveRenderer('weather'),
  currency: liveRenderer('currency'),
  stock: liveRenderer('stock'),
  entity: liveRenderer('entity'),
  news: liveRenderer('news'),
  gallery: liveRenderer('gallery'),
  widget: WidgetTile,
};

/** A broken component never takes its neighbours or the answer down. */
class NodeBoundary extends Component<{ children: ReactNode; type: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="dui-note">
        Dieser Baustein ({this.props.type}) konnte nicht dargestellt werden.
      </p>
    ) : (
      this.props.children
    );
  }
}

function Node({ node, ctx }: { node: UiNode; ctx: Ctx }) {
  const Render = REGISTRY[node.type] as unknown as
    | ((props: { node: UiNode; ctx: Ctx }) => ReactNode)
    | undefined;
  if (!Render) return null;
  return (
    <NodeBoundary type={node.type}>
      <Render node={node} ctx={ctx} />
    </NodeBoundary>
  );
}

/**
 * Renders a validated Dynamic UI description inside an assistant message.
 * All components of the message share one state; every change recomputes the
 * formulas, views and charts at once — no new model request.
 */
export default function DynamicUi({
  spec,
  onSendMessage,
  onPrefill,
  busy = false,
  streaming = false,
  stateStore,
  stateKey,
  turnId,
  results,
  onRefreshResult,
  latest = true,
}: DynamicUiProps) {
  // Client-side validation: the server already checked, but stored history or
  // fixtures must pass the same gate before anything renders.
  const checked = useMemo(() => validateDynamicUi(spec), [spec]);
  const localStore = useMemo(() => new DynamicUiStateStore(), []);
  const store = stateStore ?? localStore;
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [entity, setEntity] = useState<{ title: string; lang?: string } | null>(null);
  const view = spec.viewId ?? stateKey ?? 'local';
  if (!checked.ok)
    return <p className="dui-note">Interaktive Ansicht verworfen ({checked.error}).</p>;
  const state = mergeDynamicUiState(checked.spec.state ?? {}, store.view(view));
  const rt = new UiRuntime(checked.spec, state);
  const owner = turnId ?? stateKey;
  const canRun = (action: UiAction) => {
    if (streaming) return false;
    switch (action.type) {
      case 'sendMessage':
        return !!onSendMessage && !busy;
      case 'set':
      case 'reset':
        return !busy;
      case 'prefill':
        return !!onPrefill;
      case 'copy':
      case 'openUrl':
      case 'openEntity':
        return true;
      default:
        return false;
    }
  };
  /** `template` fills {{formulas}} of catalog texts; custom tiles pass literal text. */
  const execute = async (
    action: UiAction,
    template: (text: string) => string
  ): Promise<'done' | 'copied' | 'blocked'> => {
    if (!canRun(action)) return 'blocked';
    switch (action.type) {
      case 'sendMessage':
        onSendMessage?.(template(action.text));
        return 'done';
      case 'set':
        store.set(view, action.key, rt.safe(action.value));
        return 'done';
      case 'reset':
        store.reset(view);
        return 'done';
      case 'copy':
        return (await copyText(template(action.text))) ? 'copied' : 'blocked';
      case 'openUrl':
        return openExternal(action.url) ? 'done' : 'blocked';
      case 'prefill':
        onPrefill?.(template(action.text));
        return 'done';
      case 'openEntity':
        setEntity({ title: action.title, lang: action.lang });
        return 'done';
      default:
        // Unknown actions from a newer schema do nothing.
        return 'blocked';
    }
  };
  const ctx: Ctx = {
    rt,
    busy: busy || streaming,
    streaming,
    latest,
    set: (key, value) => {
      if (!streaming) store.set(view, key, value);
    },
    reset: () => {
      if (!streaming) store.reset(view);
    },
    canRun,
    run: (action) => execute(action, (text) => rt.template(text)),
    runLiteral: (action) => execute(action, (text) => text),
    live: (node) => {
      const result = results?.[node.id];
      return result && result.type === node.type && result.key === uiLiveKey(node)
        ? result
        : undefined;
    },
    refresh: onRefreshResult,
    storageKey: (nodeId) => (owner ? `${owner}:${nodeId}` : null),
    openEntity: (title, lang) => setEntity({ title, lang }),
    renderNodes: (nodes) =>
      nodes.map((node, index) => (
        <Node key={node.id ?? `${node.type}-${index}`} node={node} ctx={ctx} />
      )),
  };
  return (
    <div
      className={cn(
        'dui-root',
        checked.spec.layout === 'dashboard' && 'is-dashboard',
        streaming && 'is-streaming'
      )}
    >
      {checked.spec.title && <h3 className="dui-title">{checked.spec.title}</h3>}
      <fieldset disabled={streaming} className="dui-interactive-body">
        <Node node={checked.spec.root} ctx={ctx} />
      </fieldset>
      <EntitySheet entity={entity} onClose={() => setEntity(null)} />
    </div>
  );
}
