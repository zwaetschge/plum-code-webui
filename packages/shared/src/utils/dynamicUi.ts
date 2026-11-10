/**
 * Dynamic UI (generative UI) for the model chat, schema versions 1 and 2.
 *
 * A model may append one fenced ```plum-ui block with a JSON description of an
 * interactive view to its answer. The description only selects components
 * from the registry below, binds inputs to named state, and wires values
 * through safe formulas (dynamicUiExpr). The server and the client both run
 * validateDynamicUi; anything invalid falls back to the plain text answer.
 *
 * Version 2 is a superset of version 1: both numbers are accepted and every
 * component is available in both. New in v2: `followups` (suggestion chips),
 * layout/content/input/learning components, live widgets whose data the server
 * fetches (dynamicUiLive.ts), and the actions copy/openUrl/prefill/openEntity.
 */
import { UI_COMPONENT_CATALOG, UI_ICON_NAMES, UI_LIVE_NODE_TYPES } from './dynamicUiCatalog.js';
import type { UiIconName, UiLiveNodeType } from './dynamicUiCatalog.js';
import { parseExpr, TEMPLATE_PATTERN, type UiRow, type UiValue } from './dynamicUiExpr.js';

/** Version a model should write; DYNAMIC_UI_VERSIONS lists every accepted one. */
export const DYNAMIC_UI_VERSION = 2;
export type DynamicUiVersion = 1 | 2;
export const DYNAMIC_UI_VERSIONS: readonly DynamicUiVersion[] = [1, 2];
export const DYNAMIC_UI_FENCE = 'plum-ui';

export type UiFormat =
  | 'number'
  | 'integer'
  | 'percent'
  | 'compact'
  | `decimal:${number}`
  | `currency:${string}`
  | 'text';

export interface UiOption {
  value: string | number;
  label: string;
}

/**
 * What a button, card action, list/carousel item may do. Templates
 * (`{{formula|format}}`) are resolved in sendMessage/prefill/copy text.
 * - sendMessage: a normal follow-up message in the same chat.
 * - prefill: puts the text into the composer without sending it.
 * - copy: copies the text, confirms with „Kopiert“.
 * - openUrl: https only; new tab (WebUI) / Custom Tab (Android).
 * - openEntity: opens the Wikipedia entity card (GET /api/assistant/ui/entity).
 */
export type UiAction =
  | { type: 'sendMessage'; text: string }
  | { type: 'set'; key: string; value: string }
  | { type: 'reset' }
  | { type: 'copy'; text: string }
  | { type: 'openUrl'; url: string }
  | { type: 'prefill'; text: string }
  | { type: 'openEntity'; title: string; lang?: string };
export type UiActionType = UiAction['type'];

/** Status tones of `callout`. */
export type UiTone = 'info' | 'success' | 'warning' | 'danger' | 'tip';
/** Fixed image formats (Apps SDK rule): width:height. */
export type UiAspect = '16:9' | '4:3' | '1:1' | '3:4';
export const UI_ASPECTS: readonly UiAspect[] = ['16:9', '4:3', '1:1', '3:4'];
/** An external https image; clients load it only through uiImageProxyUrl(). */
export interface UiImage {
  src: string;
  alt: string;
}
/** A button inside a card (`card.actions`, at most two). */
export interface UiActionButton {
  label: string;
  action: UiAction;
  variant?: 'primary' | 'secondary';
}
/** One tab; `id` makes it a patch target (append adds to its children). */
export interface UiTab {
  id?: string;
  label: string;
  children: UiNode[];
}
/** One accordion section; `id` makes it a patch target. */
export interface UiAccordionItem {
  id?: string;
  title: string;
  open?: boolean;
  children: UiNode[];
}
export interface UiCarouselItem {
  title: string;
  subtitle?: string;
  /** At most three short facts (price, distance, rating text …). */
  meta?: string[];
  badge?: string;
  image?: UiImage;
  action?: UiAction;
}
/** `title`, `subtitle` and `trailing` are templates. */
export interface UiListItem {
  title: string;
  subtitle?: string;
  /** Right-aligned value. */
  trailing?: string;
  /** A UI_ICON_NAMES key or a single emoji. */
  icon?: UiIconName | string;
  image?: UiImage;
  action?: UiAction;
}
export interface UiTimelineItem {
  time?: string;
  title: string;
  text?: string;
  status?: 'done' | 'current' | 'upcoming';
}
/**
 * `id` is unique within its checklist and keys the persisted tick state.
 * `label` and `detail` are templates (quantities can follow a stepper).
 */
export interface UiChecklistItem {
  id: string;
  label: string;
  detail?: string;
}
/**
 * A quiz question. Kind defaults to `choice` when `options` exist, else
 * `text` (see quizQuestionKind). Choice: `answer` is the 0-based option index.
 * Text: `answer` is the expected text (compare case-insensitively, trimmed).
 */
export interface UiQuizQuestion {
  q: string;
  kind?: 'choice' | 'text';
  options?: string[];
  answer: number | string;
  hint?: string;
  explanation?: string;
}
export interface UiFlashcard {
  front: string;
  back: string;
}
/** One segment above a chart; selecting it sets `rangeBind` to `value`. */
export interface UiChartRange {
  label: string;
  value: string | number;
}
/** `message` is a template sent as the user's next chat message. */
export interface UiFormSubmit {
  label: string;
  message: string;
}
export type UiStockRange = '1M' | '6M' | '1Y' | '5Y';
export const UI_STOCK_RANGES: readonly UiStockRange[] = ['1M', '6M', '1Y', '5Y'];

interface Base {
  id?: string;
}
export type UiNode =
  | (Base & { type: 'stack'; gap?: 'sm' | 'md' | 'lg'; children: UiNode[] })
  | (Base & { type: 'row'; gap?: 'sm' | 'md' | 'lg'; wrap?: boolean; children: UiNode[] })
  | (Base & { type: 'grid'; columns: number; children: UiNode[] })
  | (Base & {
      type: 'card';
      /** Template. */
      title?: string;
      /** Template. */
      subtitle?: string;
      highlight?: string;
      /** Header image. */
      image?: UiImage;
      /** Shows a full-screen button. */
      expandable?: boolean;
      /** At most two buttons in the card footer. */
      actions?: UiActionButton[];
      children: UiNode[];
    })
  | (Base & {
      type: 'calculator';
      title?: string;
      inputs: UiNode[];
      outputs: UiNode[];
      chart?: UiNode;
    })
  | (Base & { type: 'heading'; text: string; level?: 2 | 3 })
  | (Base & { type: 'text'; text: string; tone?: 'default' | 'muted' | 'strong' })
  | (Base & { type: 'markdown'; text: string })
  | (Base & {
      type: 'badge';
      text: string;
      tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
    })
  | (Base & { type: 'divider' })
  | (Base & {
      type: 'kpi';
      label: string;
      value: string;
      format?: UiFormat;
      hint?: string;
      trend?: string;
      /** Formula for the change shown next to the value (positive = success tone). */
      delta?: string;
      deltaFormat?: UiFormat;
      /** View or dataset for a mini line under the value. */
      spark?: string;
      /** Numeric field of `spark`; default: the first numeric field. */
      sparkKey?: string;
    })
  | (Base & {
      type: 'slider';
      bind: string;
      label: string;
      min: number;
      max: number;
      step?: number;
      format?: UiFormat;
    })
  | (Base & {
      type: 'input';
      bind: string;
      label: string;
      kind?: 'number' | 'text';
      min?: number;
      max?: number;
      step?: number;
      placeholder?: string;
    })
  | (Base & { type: 'select'; bind: string; label: string; options: UiOption[] })
  | (Base & { type: 'segmented'; bind: string; label: string; options: UiOption[] })
  | (Base & { type: 'checkbox'; bind: string; label: string })
  | (Base & { type: 'button'; label: string; action: UiAction; variant?: 'primary' | 'secondary' })
  | (Base & {
      type: 'table';
      data: string | UiRow[];
      columns: Array<{ key: string; label: string; format?: UiFormat; align?: 'left' | 'right' }>;
      highlight?: string;
      /** Sortable columns; default true above five rows (see tableSortable). */
      sortable?: boolean;
    })
  | (Base & {
      type: 'chart';
      kind: 'bar' | 'line' | 'area' | 'pie' | 'scatter';
      data: string | UiRow[];
      /** Category field; numeric for scatter. */
      x: string;
      series: Array<{ key: string; label: string }>;
      format?: UiFormat;
      height?: number;
      stacked?: boolean;
      /** Segment above the chart (2–6); requires rangeBind. */
      ranges?: UiChartRange[];
      /** State the selected range value is written to; views may filter by it. */
      rangeBind?: string;
    })
  | (Base & {
      type: 'compare';
      bind?: string;
      items: Array<{ id: string; title: string; subtitle?: string; badge?: string; values: UiRow }>;
      specs: Array<{ key: string; label: string; format?: UiFormat; better?: 'higher' | 'lower' }>;
    })
  // v2 layout
  | (Base & { type: 'tabs'; bind?: string; tabs: UiTab[] })
  | (Base & { type: 'accordion'; items: UiAccordionItem[] })
  // v2 content
  | (Base & { type: 'carousel'; aspect?: UiAspect; items: UiCarouselItem[] })
  | (Base & { type: 'list'; items: UiListItem[] })
  | (Base & { type: 'timeline'; items: UiTimelineItem[] })
  | (Base & {
      type: 'callout';
      tone: UiTone;
      /** Template. */
      title?: string;
      /** Template. */
      text: string;
    })
  | (Base & {
      type: 'progress';
      value: string;
      /** Formula; default 100. */
      max?: string;
      /** Template. */
      label?: string;
      format?: UiFormat;
      kind?: 'bar' | 'ring';
    })
  | (Base & { type: 'rating'; value: number; count?: number; label?: string })
  | (Base & { type: 'image'; src: string; alt: string; caption?: string; aspect?: UiAspect })
  | (Base & { type: 'code'; language: string; code: string; title?: string })
  | (Base & { type: 'math'; tex: string; display?: boolean })
  // v2 inputs
  | (Base & {
      type: 'stepper';
      bind: string;
      label: string;
      min?: number;
      max?: number;
      step?: number;
      format?: UiFormat;
    })
  | (Base & { type: 'radio'; bind: string; label: string; options: UiOption[] })
  | (Base & { type: 'textarea'; bind: string; label: string; rows?: number; placeholder?: string })
  | (Base & { type: 'date'; bind: string; label: string; min?: string; max?: string })
  | (Base & { type: 'form'; title?: string; children: UiNode[]; submit: UiFormSubmit })
  // v2 learning and plans (state persisted per message under `turnId:nodeId`)
  | (Base & {
      type: 'checklist';
      id: string;
      title?: string;
      items: UiChecklistItem[];
      /** Shows „Liste kopieren“. */
      copyable?: boolean;
    })
  | (Base & { type: 'quiz'; id: string; title?: string; questions: UiQuizQuestion[] })
  | (Base & { type: 'flashcards'; id: string; cards: UiFlashcard[] })
  // v2 live widgets (data in turn.uiResults[id], see dynamicUiLive.ts)
  | (Base & { type: 'weather'; id: string; location: string; days?: number })
  | (Base & { type: 'currency'; id: string; from: string; to: string; amount?: number })
  | (Base & { type: 'stock'; id: string; symbol: string; range?: UiStockRange })
  | (Base & { type: 'entity'; id: string; title: string; lang?: string })
  | (Base & { type: 'news'; id: string; query: string })
  | (Base & { type: 'gallery'; id: string; query: string })
  // v2.1 custom tiles: model-authored HTML/CSS/JS, run in a sandbox (ui-widget.html)
  | (Base & {
      type: 'widget';
      id: string;
      /**
       * Self-contained HTML (inline <style>/<script>). The model writes it in a
       * ```plum-widget <id> block; extractDynamicUi moves it here.
       */
      html: string;
      title?: string;
      /** Fixed height in px; without it the tile grows with its content. */
      height?: number;
      /** JSON handed to the tile's script as plum.props. */
      props?: Record<string, unknown>;
      /**
       * Live data the server fetches for the tile: name → live widget
       * parameters. Results arrive in turn.uiResults[uiWidgetLiveId(id, name)].
       */
      live?: Record<string, UiWidgetLiveInput>;
      /** Initial plum.state until the tile saves its own. */
      state?: Record<string, unknown>;
    });

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Parameters of a live widget without its id, as used in a tile's `live` map. */
export type UiWidgetLiveInput = DistributiveOmit<
  Extract<UiNode, { type: 'weather' | 'currency' | 'stock' | 'entity' | 'news' | 'gallery' }>,
  'id'
>;
/** Result key of a tile's live input (also its synthetic live-node id). */
export const uiWidgetLiveId = (widgetId: string, name: string) => `${widgetId}__${name}`;

export type UiNodeType = UiNode['type'];
export type UiNodeOf<T extends UiNodeType> = Extract<UiNode, { type: T }>;
/** A widget the server fills; see dynamicUiLive.ts for its `uiResults` data. */
export type UiLiveNode = UiNodeOf<UiLiveNodeType>;

export type UiView =
  | {
      from: string;
      filter?: string;
      groupBy?: string;
      aggregate?: Record<string, { field?: string; op: 'sum' | 'avg' | 'min' | 'max' | 'count' }>;
      sort?: { field: string; dir?: 'asc' | 'desc' };
      limit?: number;
    }
  | {
      generate: { var: string; from: string; to: string; step?: number };
      fields: Record<string, string>;
    };

export interface DynamicUiSpec {
  version: DynamicUiVersion;
  /** Server-assigned identity shared by incremental revisions. */
  viewId?: string;
  title?: string;
  layout?: 'inline' | 'dashboard';
  state?: Record<string, UiValue>;
  computed?: Record<string, string>;
  data?: Record<string, UiRow[]>;
  views?: Record<string, UiView>;
  /**
   * Model input only: extractDynamicUi moves suggestion chips to
   * ExtractedDynamicUi.followups (turn.followups), so a delivered `ui` never
   * carries them. A block may hold only followups (no root, no view).
   */
  followups?: string[];
  root: UiNode;
}

/** Targeted edit of the latest view; see applyDynamicUiPatch. */
export interface DynamicUiPatch {
  version: DynamicUiVersion;
  patch: Array<
    | { op: 'replace'; target: string; node: UiNode | UiTab | UiAccordionItem }
    | { op: 'append'; target: string; node: UiNode | UiTab | UiAccordionItem }
    | { op: 'remove'; target: string }
  >;
  state?: Record<string, UiValue>;
  computed?: Record<string, string>;
  data?: Record<string, UiRow[]>;
  views?: Record<string, UiView>;
  title?: string;
  followups?: string[];
}

export const UI_NODE_TYPES: readonly UiNodeType[] = UI_COMPONENT_CATALOG.map((c) => c.type);

export const DYNAMIC_UI_LIMITS = {
  nodes: 250,
  depth: 10,
  rows: 500,
  datasets: 12,
  views: 20,
  state: 40,
  computed: 60,
  /** text/markdown (v1). */
  text: 4000,
  /** Long text of v2 components (callout text). */
  longText: 2000,
  /** Default for other texts. */
  shortText: 300,
  liveWidgets: 6,
  followups: 3,
  followupLength: 80,
  tabs: [2, 6],
  accordionItems: [1, 12],
  carouselItems: [2, 10],
  carouselMeta: 3,
  listItems: [1, 30],
  timelineItems: [1, 20],
  checklistItems: [1, 40],
  quizQuestions: [1, 20],
  quizOptions: [2, 6],
  flashcards: [1, 50],
  chartSeries: [1, 6],
  chartRanges: [2, 6],
  cardActions: 2,
  formChildren: [1, 20],
  weatherDays: [1, 10],
  /** Custom tiles per view, their code size and JSON payloads. */
  widgets: 4,
  widgetHtml: 60000,
  widgetJson: 16000,
  widgetLive: 4,
  widgetHeight: [80, 1200],
} as const;
const LIMITS = DYNAMIC_UI_LIMITS;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
/** Component and entry IDs never appear in formulas, so they may also use '-' (models write eur-chf). */
const ID = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
const FORMAT = /^(number|integer|percent|compact|text|decimal:\d|currency:[A-Z]{3})$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** Public https host name (no IP literal, credentials or port other than 443). */
const HTTPS_URL =
  /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::443)?(?:[/?#][^\s<>"'`\\]*)?$/i;
const LANG = /^[a-z]{2,3}$/;
const EMOJI = /^\p{Extended_Pictographic}/u;
const LIVE_TYPES = new Set<string>(UI_LIVE_NODE_TYPES);

/** True for an https URL the image proxy and openUrl accept (checked again server-side). */
export function isUiHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2000 && HTTPS_URL.test(value);
}
/** Whether a node is a live widget whose data the server resolves. */
export function isUiLiveNode(node: { type?: unknown } | null | undefined): node is UiLiveNode {
  return !!node && LIVE_TYPES.has(String(node.type));
}
/** Effective kind of a quiz question: explicit, else choice with options, else text. */
export function quizQuestionKind(question: UiQuizQuestion): 'choice' | 'text' {
  return question.kind ?? (Array.isArray(question.options) ? 'choice' : 'text');
}
/** Tables sort by default above five rows unless `sortable` says otherwise. */
export function tableSortable(node: UiNodeOf<'table'>, rowCount: number): boolean {
  return node.sortable ?? rowCount > 5;
}

/** Direct child components of a node across all container fields. */
export function uiNodeChildren(node: UiNode): UiNode[] {
  switch (node.type) {
    case 'calculator':
      return [...node.inputs, ...node.outputs, ...(node.chart ? [node.chart] : [])];
    case 'tabs':
      return node.tabs.flatMap((tab) => tab.children);
    case 'accordion':
      return node.items.flatMap((item) => item.children);
    default:
      return 'children' in node && Array.isArray(node.children) ? node.children : [];
  }
}
/** Depth-first walk over a view's components. */
export function walkUiNodes(root: UiNode, visit: (node: UiNode) => void): void {
  visit(root);
  for (const child of uiNodeChildren(root)) walkUiNodes(child, visit);
}
/** Every live widget of a view, in document order. */
export function collectUiLiveNodes(spec: Pick<DynamicUiSpec, 'root'> | null | undefined) {
  const out: UiLiveNode[] = [];
  if (spec?.root)
    walkUiNodes(spec.root, (node) => {
      if (isUiLiveNode(node)) out.push(node);
      // A tile's live inputs resolve like widgets with the id `<tile>__<name>`.
      else if (node.type === 'widget' && node.live)
        for (const [name, input] of Object.entries(node.live))
          out.push({ ...input, id: uiWidgetLiveId(node.id, name) } as UiLiveNode);
    });
  return out;
}

type Result = { ok: true; spec: DynamicUiSpec } | { ok: false; error: string };

class Invalid extends Error {}
const fail = (path: string, message: string): never => {
  throw new Invalid(`${path}: ${message}`);
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface Walk {
  nodes: number;
  ids: Set<string>;
  live: number;
  widgets: number;
  state: Record<string, UiValue>;
  sources: Set<string>;
}

/**
 * Checks a model-produced description against schema v1/v2: known components
 * and props only, bounded sizes, parseable formulas, bindings to declared state.
 */
export function validateDynamicUi(input: unknown): Result {
  try {
    if (!isObject(input)) fail('ui', 'Objekt erwartet');
    const spec = input as Record<string, unknown>;
    if (!DYNAMIC_UI_VERSIONS.includes(spec.version as DynamicUiVersion))
      fail('version', 'nur Version 1 oder 2');
    if (
      spec.viewId !== undefined &&
      (typeof spec.viewId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(spec.viewId))
    )
      fail('viewId', 'ungültige Ansichtskennung');
    const known = new Set<string>();
    const state = spec.state ?? {};
    if (!isObject(state)) fail('state', 'Objekt erwartet');
    const stateKeys = Object.keys(state as object);
    if (stateKeys.length > LIMITS.state) fail('state', 'zu viele Werte');
    for (const [key, value] of Object.entries(state as object)) {
      if (!NAME.test(key)) fail(`state.${key}`, 'ungültiger Name');
      if (!['number', 'string', 'boolean'].includes(typeof value) && value !== null)
        fail(`state.${key}`, 'Zahl, Text oder Wahrheitswert erwartet');
      if (typeof value === 'string' && value.length > 200) fail(`state.${key}`, 'zu lang');
      known.add(key);
    }
    const data = spec.data ?? {};
    if (!isObject(data)) fail('data', 'Objekt erwartet');
    if (Object.keys(data as object).length > LIMITS.datasets) fail('data', 'zu viele Datensätze');
    for (const [name, rows] of Object.entries(data as object)) {
      if (!NAME.test(name)) fail(`data.${name}`, 'ungültiger Name');
      checkRows(`data.${name}`, rows);
    }
    const views = spec.views ?? {};
    if (!isObject(views)) fail('views', 'Objekt erwartet');
    if (Object.keys(views as object).length > LIMITS.views) fail('views', 'zu viele Sichten');
    const sources = new Set([...Object.keys(data as object), ...Object.keys(views as object)]);
    for (const [name, view] of Object.entries(views as object)) {
      if (!NAME.test(name)) fail(`views.${name}`, 'ungültiger Name');
      checkView(`views.${name}`, view, sources);
    }
    const computed = spec.computed ?? {};
    if (!isObject(computed)) fail('computed', 'Objekt erwartet');
    if (Object.keys(computed as object).length > LIMITS.computed)
      fail('computed', 'zu viele Formeln');
    for (const [key, expr] of Object.entries(computed as object)) {
      if (!NAME.test(key)) fail(`computed.${key}`, 'ungültiger Name');
      if (known.has(key)) fail(`computed.${key}`, 'Name bereits als State vergeben');
      checkExpr(`computed.${key}`, expr);
      known.add(key);
    }
    if (spec.title !== undefined) checkText('title', spec.title, 120);
    if (spec.layout !== undefined && spec.layout !== 'inline' && spec.layout !== 'dashboard')
      fail('layout', 'inline oder dashboard');
    if (spec.followups !== undefined) checkFollowups('followups', spec.followups);
    const walk: Walk = {
      nodes: 0,
      ids: new Set<string>(),
      live: 0,
      widgets: 0,
      state: state as Record<string, UiValue>,
      sources,
    };
    checkNode('root', spec.root, 0, walk, false);
    return { ok: true, spec: input as unknown as DynamicUiSpec };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : 'Ungültige Beschreibung' };
  }
}

/**
 * Lenient followups for display: the first three non-empty strings of at most
 * 80 characters (longer ones are dropped, never cut). Never throws.
 */
export function sanitizeDynamicUiFollowups(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.replace(/\s+/g, ' ').trim();
    if (!text || text.length > LIMITS.followupLength || out.includes(text)) continue;
    out.push(text);
    if (out.length >= LIMITS.followups) break;
  }
  return out;
}

function checkFollowups(path: string, value: unknown) {
  if (!Array.isArray(value) || value.length > LIMITS.followups)
    fail(path, `höchstens ${LIMITS.followups} Folgefragen`);
  (value as unknown[]).forEach((item, index) => {
    if (typeof item !== 'string' || !item.trim()) fail(`${path}[${index}]`, 'Text erwartet');
    if ((item as string).length > LIMITS.followupLength) fail(`${path}[${index}]`, 'zu lang');
  });
}
function checkText(path: string, value: unknown, max = 300) {
  if (typeof value !== 'string') fail(path, 'Text erwartet');
  if ((value as string).length > max) fail(path, 'zu lang');
}
/** Required, non-empty text. */
function checkLabel(path: string, value: unknown, max = 300) {
  checkText(path, value, max);
  if (!(value as string).trim()) fail(path, 'Text fehlt');
}
function checkExpr(path: string, value: unknown) {
  if (typeof value !== 'string') fail(path, 'Formel erwartet');
  try {
    parseExpr(value as string);
  } catch (error) {
    fail(path, (error as Error).message);
  }
}
function checkTemplate(path: string, value: unknown, max = 600) {
  checkText(path, value, max);
  for (const match of (value as string).matchAll(TEMPLATE_PATTERN)) {
    checkExpr(path, match[1]);
    if (match[2] && !FORMAT.test(match[2])) fail(path, `unbekanntes Format ${match[2]}`);
  }
}
function checkFormat(path: string, value: unknown) {
  if (value !== undefined && (typeof value !== 'string' || !FORMAT.test(value)))
    fail(path, 'unbekanntes Format');
}
function checkBool(path: string, value: unknown) {
  if (value !== undefined && typeof value !== 'boolean') fail(path, 'true oder false');
}
function checkEnum(path: string, value: unknown, allowed: readonly unknown[], optional = true) {
  if (value === undefined && optional) return;
  if (!allowed.includes(value)) fail(path, allowed.join(', '));
}
function checkNumber(path: string, value: unknown, min: number, max: number, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail(path, `Zahl ${min}–${max}`);
  if (integer && !Number.isInteger(value)) fail(path, 'ganze Zahl erwartet');
}
function checkList(path: string, value: unknown, [min, max]: readonly [number, number]) {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    fail(path, `${min}–${max} Einträge`);
  return value as unknown[];
}
function checkEntry(path: string, value: unknown) {
  if (!isObject(value)) fail(path, 'Objekt erwartet');
  return value as Record<string, unknown>;
}
function checkImage(path: string, value: unknown) {
  const image = checkEntry(path, value);
  if (!isUiHttpsUrl(image.src)) fail(`${path}.src`, 'öffentliche https-Adresse erwartet');
  checkLabel(`${path}.alt`, image.alt, 300);
}
function checkDate(path: string, value: unknown) {
  if (typeof value !== 'string' || !DATE.test(value)) fail(path, 'Datum YYYY-MM-DD erwartet');
}
function checkRows(path: string, rows: unknown) {
  if (!Array.isArray(rows)) fail(path, 'Liste erwartet');
  if ((rows as unknown[]).length > LIMITS.rows) fail(path, 'zu viele Zeilen');
  (rows as unknown[]).forEach((row, index) => {
    if (!isObject(row)) fail(`${path}[${index}]`, 'Objekt erwartet');
    const entries = Object.entries(row as object);
    if (entries.length > 24) fail(`${path}[${index}]`, 'zu viele Felder');
    for (const [key, value] of entries) {
      if (!NAME.test(key)) fail(`${path}[${index}].${key}`, 'ungültiger Name');
      if (!['number', 'string', 'boolean'].includes(typeof value) && value !== null)
        fail(`${path}[${index}].${key}`, 'einfacher Wert erwartet');
      if (typeof value === 'string' && value.length > 300)
        fail(`${path}[${index}].${key}`, 'zu lang');
    }
  });
}
function checkView(path: string, view: unknown, sources: Set<string>) {
  if (!isObject(view)) fail(path, 'Objekt erwartet');
  const v = view as Record<string, unknown>;
  if (v.generate !== undefined) {
    const generate = v.generate as Record<string, unknown>;
    if (!isObject(generate)) fail(`${path}.generate`, 'Objekt erwartet');
    if (typeof generate.var !== 'string' || !NAME.test(generate.var))
      fail(`${path}.generate.var`, 'Name erwartet');
    checkExpr(`${path}.generate.from`, String(generate.from));
    checkExpr(`${path}.generate.to`, String(generate.to));
    if (generate.step !== undefined && (typeof generate.step !== 'number' || generate.step <= 0))
      fail(`${path}.generate.step`, 'positive Zahl erwartet');
    if (!isObject(v.fields)) fail(`${path}.fields`, 'Objekt erwartet');
    for (const [key, expr] of Object.entries(v.fields as object)) {
      if (!NAME.test(key)) fail(`${path}.fields.${key}`, 'ungültiger Name');
      checkExpr(`${path}.fields.${key}`, expr);
    }
    return;
  }
  if (typeof v.from !== 'string' || !sources.has(v.from))
    fail(`${path}.from`, 'unbekannte Datenquelle');
  if (v.filter !== undefined) checkExpr(`${path}.filter`, v.filter);
  if (v.groupBy !== undefined && (typeof v.groupBy !== 'string' || !NAME.test(v.groupBy)))
    fail(`${path}.groupBy`, 'Feldname erwartet');
  if (v.aggregate !== undefined) {
    if (!isObject(v.aggregate)) fail(`${path}.aggregate`, 'Objekt erwartet');
    for (const [key, agg] of Object.entries(v.aggregate as object)) {
      if (!NAME.test(key) || !isObject(agg)) fail(`${path}.aggregate.${key}`, 'ungültig');
      if (
        !['sum', 'avg', 'min', 'max', 'count'].includes(String((agg as Record<string, unknown>).op))
      )
        fail(`${path}.aggregate.${key}.op`, 'sum, avg, min, max oder count');
    }
  }
  if (
    v.sort !== undefined &&
    (!isObject(v.sort) || typeof (v.sort as Record<string, unknown>).field !== 'string')
  )
    fail(`${path}.sort`, 'Feld erwartet');
  if (
    v.limit !== undefined &&
    (typeof v.limit !== 'number' || v.limit < 1 || v.limit > LIMITS.rows)
  )
    fail(`${path}.limit`, 'ungültig');
}
function checkData(path: string, value: unknown, sources: Set<string>) {
  if (typeof value === 'string') {
    if (!sources.has(value)) fail(path, 'unbekannte Datenquelle');
  } else checkRows(path, value);
}
function checkOptions(path: string, options: unknown) {
  if (!Array.isArray(options) || !options.length || options.length > 30)
    fail(path, '1–30 Optionen erwartet');
  (options as unknown[]).forEach((option, index) => {
    if (!isObject(option)) fail(`${path}[${index}]`, 'Objekt erwartet');
    const o = option as Record<string, unknown>;
    if (typeof o.value !== 'string' && typeof o.value !== 'number')
      fail(`${path}[${index}].value`, 'Wert erwartet');
    checkText(`${path}[${index}].label`, o.label, 80);
  });
}
function checkAction(path: string, value: unknown, walk: Walk) {
  if (!isObject(value)) fail(path, 'Aktion erwartet');
  const action = value as Record<string, unknown>;
  switch (action.type) {
    case 'sendMessage':
      checkTemplate(`${path}.text`, action.text, 1000);
      break;
    case 'set':
      if (typeof action.key !== 'string' || !Object.hasOwn(walk.state, action.key))
        fail(`${path}.key`, 'State-Wert erwartet');
      checkExpr(`${path}.value`, action.value);
      break;
    case 'reset':
      break;
    case 'copy':
    case 'prefill':
      checkTemplate(`${path}.text`, action.text, LIMITS.longText);
      break;
    case 'openUrl':
      if (!isUiHttpsUrl(action.url)) fail(`${path}.url`, 'öffentliche https-Adresse erwartet');
      break;
    case 'openEntity':
      checkLabel(`${path}.title`, action.title, 200);
      if (action.lang !== undefined && (typeof action.lang !== 'string' || !LANG.test(action.lang)))
        fail(`${path}.lang`, 'Sprachcode wie de oder en');
      break;
    default:
      fail(`${path}.type`, 'sendMessage, set, reset, copy, openUrl, prefill oder openEntity');
  }
}
/** Registers a component or entry ID in the view-wide namespace. */
function claimId(path: string, id: unknown, walk: Walk) {
  if (id === undefined) return;
  if (typeof id !== 'string' || !ID.test(id)) fail(path, 'ungültige ID');
  if (walk.ids.has(id as string)) fail(path, 'ID doppelt');
  walk.ids.add(id as string);
}

function checkNode(path: string, value: unknown, depth: number, walk: Walk, inForm: boolean) {
  if (!isObject(value)) fail(path, 'Komponente erwartet');
  if (depth > LIMITS.depth) fail(path, 'zu tief verschachtelt');
  if (++walk.nodes > LIMITS.nodes) fail(path, 'zu viele Komponenten');
  const node = value as Record<string, unknown>;
  const type = node.type as UiNodeType;
  if (!UI_NODE_TYPES.includes(type)) fail(path, `unbekannte Komponente "${String(node.type)}"`);
  const at = `${path}<${type}>`;
  const contract = UI_COMPONENT_CATALOG.find((c) => c.type === type)!;
  for (const key of contract.required as readonly string[])
    if (node[key] === undefined) fail(`${at}.${key}`, 'Pflichtfeld fehlt');
  claimId(`${at}.id`, node.id, walk);
  const nested = (childPath: string, list: unknown) => {
    if (!Array.isArray(list)) fail(childPath, 'Liste erwartet');
    (list as unknown[]).forEach((child, index) =>
      checkNode(`${childPath}[${index}]`, child, depth + 1, walk, inForm || type === 'form')
    );
  };
  const children = (key: string) => nested(`${at}.${key}`, node[key]);
  /** Binding to declared state; `kind` also requires that type unless the default is null. */
  const bind = (key = 'bind', kind?: 'number' | 'string') => {
    const name = node[key];
    if (typeof name !== 'string' || !Object.hasOwn(walk.state, name))
      fail(`${at}.${key}`, 'muss auf einen State-Wert zeigen');
    const current = walk.state[name as string];
    if (kind && current !== null && typeof current !== kind)
      fail(`${at}.${key}`, kind === 'number' ? 'Zahl-State erwartet' : 'Text-State erwartet');
  };
  switch (type) {
    case 'stack':
    case 'row':
      children('children');
      break;
    case 'grid':
      if (typeof node.columns !== 'number' || node.columns < 1 || node.columns > 4)
        fail(`${at}.columns`, '1–4');
      children('children');
      break;
    case 'card':
      if (node.title !== undefined) checkTemplate(`${at}.title`, node.title, 160);
      if (node.subtitle !== undefined) checkTemplate(`${at}.subtitle`, node.subtitle, 240);
      if (node.highlight !== undefined) checkExpr(`${at}.highlight`, node.highlight);
      if (node.image !== undefined) checkImage(`${at}.image`, node.image);
      checkBool(`${at}.expandable`, node.expandable);
      if (node.actions !== undefined)
        checkList(`${at}.actions`, node.actions, [1, LIMITS.cardActions]).forEach((item, i) => {
          const button = checkEntry(`${at}.actions[${i}]`, item);
          checkLabel(`${at}.actions[${i}].label`, button.label, 40);
          checkAction(`${at}.actions[${i}].action`, button.action, walk);
          checkEnum(`${at}.actions[${i}].variant`, button.variant, ['primary', 'secondary']);
        });
      children('children');
      break;
    case 'calculator':
      if (node.title !== undefined) checkText(`${at}.title`, node.title, 160);
      children('inputs');
      children('outputs');
      if (node.chart !== undefined) checkNode(`${at}.chart`, node.chart, depth + 1, walk, inForm);
      break;
    case 'heading':
      checkTemplate(`${at}.text`, node.text, 200);
      break;
    case 'text':
    case 'badge':
      checkTemplate(`${at}.text`, node.text, type === 'badge' ? 80 : LIMITS.text);
      break;
    case 'markdown':
      checkTemplate(`${at}.text`, node.text, LIMITS.text);
      break;
    case 'divider':
      break;
    case 'kpi':
      checkText(`${at}.label`, node.label, 80);
      checkExpr(`${at}.value`, node.value);
      checkFormat(`${at}.format`, node.format);
      if (node.hint !== undefined) checkTemplate(`${at}.hint`, node.hint, 200);
      if (node.trend !== undefined) checkExpr(`${at}.trend`, node.trend);
      if (node.delta !== undefined) checkExpr(`${at}.delta`, node.delta);
      checkFormat(`${at}.deltaFormat`, node.deltaFormat);
      if (node.spark !== undefined) checkData(`${at}.spark`, String(node.spark), walk.sources);
      if (
        node.sparkKey !== undefined &&
        (typeof node.sparkKey !== 'string' || !NAME.test(node.sparkKey))
      )
        fail(`${at}.sparkKey`, 'Feldname erwartet');
      break;
    case 'slider':
      bind();
      checkText(`${at}.label`, node.label, 80);
      if (typeof node.min !== 'number' || typeof node.max !== 'number' || node.min >= node.max)
        fail(`${at}`, 'min < max erwartet');
      if (node.step !== undefined && (typeof node.step !== 'number' || node.step <= 0))
        fail(`${at}.step`, 'positiv');
      checkFormat(`${at}.format`, node.format);
      break;
    case 'input':
      bind();
      checkText(`${at}.label`, node.label, 80);
      if (node.kind !== undefined && node.kind !== 'number' && node.kind !== 'text')
        fail(`${at}.kind`, 'number oder text');
      break;
    case 'select':
    case 'segmented':
    case 'radio':
      bind();
      checkText(`${at}.label`, node.label, 80);
      checkOptions(`${at}.options`, node.options);
      break;
    case 'checkbox':
      bind();
      checkText(`${at}.label`, node.label, 120);
      break;
    case 'button': {
      checkText(`${at}.label`, node.label, 60);
      checkAction(`${at}.action`, node.action, walk);
      checkEnum(`${at}.variant`, node.variant, ['primary', 'secondary']);
      break;
    }
    case 'table':
      checkData(`${at}.data`, node.data, walk.sources);
      if (!Array.isArray(node.columns) || !node.columns.length || node.columns.length > 12)
        fail(`${at}.columns`, '1–12 Spalten');
      (node.columns as unknown[]).forEach((column, index) => {
        const c = column as Record<string, unknown>;
        if (!isObject(c) || typeof c.key !== 'string')
          fail(`${at}.columns[${index}]`, 'Spalte erwartet');
        checkText(`${at}.columns[${index}].label`, c.label, 60);
        checkFormat(`${at}.columns[${index}].format`, c.format);
      });
      if (node.highlight !== undefined) checkExpr(`${at}.highlight`, node.highlight);
      checkBool(`${at}.sortable`, node.sortable);
      break;
    case 'chart':
      if (!['bar', 'line', 'area', 'pie', 'scatter'].includes(String(node.kind)))
        fail(`${at}.kind`, 'bar, line, area, pie oder scatter');
      checkData(`${at}.data`, node.data, walk.sources);
      if (typeof node.x !== 'string') fail(`${at}.x`, 'Feldname erwartet');
      checkList(`${at}.series`, node.series, LIMITS.chartSeries);
      (node.series as unknown[]).forEach((series, index) => {
        const s = series as Record<string, unknown>;
        if (!isObject(s) || typeof s.key !== 'string')
          fail(`${at}.series[${index}]`, 'Reihe erwartet');
        checkText(`${at}.series[${index}].label`, s.label, 60);
      });
      checkFormat(`${at}.format`, node.format);
      if (
        node.height !== undefined &&
        (typeof node.height !== 'number' || node.height < 120 || node.height > 480)
      )
        fail(`${at}.height`, '120–480');
      checkBool(`${at}.stacked`, node.stacked);
      if (node.ranges !== undefined || node.rangeBind !== undefined) {
        if (node.ranges === undefined || node.rangeBind === undefined)
          fail(`${at}.ranges`, 'ranges und rangeBind gehören zusammen');
        bind('rangeBind');
        checkList(`${at}.ranges`, node.ranges, LIMITS.chartRanges).forEach((item, i) => {
          const range = checkEntry(`${at}.ranges[${i}]`, item);
          checkLabel(`${at}.ranges[${i}].label`, range.label, 30);
          if (typeof range.value !== 'string' && typeof range.value !== 'number')
            fail(`${at}.ranges[${i}].value`, 'Wert erwartet');
        });
      }
      break;
    case 'compare':
      if (node.bind !== undefined) bind();
      if (!Array.isArray(node.items) || node.items.length < 2 || node.items.length > 6)
        fail(`${at}.items`, '2–6 Einträge');
      (node.items as unknown[]).forEach((item, index) => {
        const i = item as Record<string, unknown>;
        if (!isObject(i) || typeof i.id !== 'string')
          fail(`${at}.items[${index}]`, 'Eintrag mit id erwartet');
        checkText(`${at}.items[${index}].title`, i.title, 80);
        if (!isObject(i.values)) fail(`${at}.items[${index}].values`, 'Objekt erwartet');
        checkRows(`${at}.items[${index}].values`, [i.values]);
      });
      if (!Array.isArray(node.specs) || !node.specs.length || node.specs.length > 16)
        fail(`${at}.specs`, '1–16 Merkmale');
      (node.specs as unknown[]).forEach((spec, index) => {
        const s = spec as Record<string, unknown>;
        if (!isObject(s) || typeof s.key !== 'string')
          fail(`${at}.specs[${index}]`, 'Merkmal erwartet');
        checkText(`${at}.specs[${index}].label`, s.label, 60);
        checkFormat(`${at}.specs[${index}].format`, s.format);
      });
      break;
    // v2 layout
    case 'tabs':
      if (node.bind !== undefined) bind('bind', 'number');
      checkList(`${at}.tabs`, node.tabs, LIMITS.tabs).forEach((item, i) => {
        const tab = checkEntry(`${at}.tabs[${i}]`, item);
        claimId(`${at}.tabs[${i}].id`, tab.id, walk);
        checkLabel(`${at}.tabs[${i}].label`, tab.label, 40);
        nested(`${at}.tabs[${i}].children`, tab.children);
      });
      break;
    case 'accordion':
      checkList(`${at}.items`, node.items, LIMITS.accordionItems).forEach((item, i) => {
        const section = checkEntry(`${at}.items[${i}]`, item);
        claimId(`${at}.items[${i}].id`, section.id, walk);
        checkLabel(`${at}.items[${i}].title`, section.title, 160);
        checkBool(`${at}.items[${i}].open`, section.open);
        nested(`${at}.items[${i}].children`, section.children);
      });
      break;
    // v2 content
    case 'carousel':
      checkEnum(`${at}.aspect`, node.aspect, UI_ASPECTS);
      checkList(`${at}.items`, node.items, LIMITS.carouselItems).forEach((item, i) => {
        const entry = checkEntry(`${at}.items[${i}]`, item);
        const p = `${at}.items[${i}]`;
        checkLabel(`${p}.title`, entry.title, 120);
        if (entry.subtitle !== undefined) checkText(`${p}.subtitle`, entry.subtitle, 200);
        if (entry.meta !== undefined)
          checkList(`${p}.meta`, entry.meta, [0, LIMITS.carouselMeta]).forEach((meta, m) =>
            checkLabel(`${p}.meta[${m}]`, meta, 60)
          );
        if (entry.badge !== undefined) checkText(`${p}.badge`, entry.badge, 40);
        if (entry.image !== undefined) checkImage(`${p}.image`, entry.image);
        if (entry.action !== undefined) checkAction(`${p}.action`, entry.action, walk);
      });
      break;
    case 'list':
      checkList(`${at}.items`, node.items, LIMITS.listItems).forEach((item, i) => {
        const entry = checkEntry(`${at}.items[${i}]`, item);
        const p = `${at}.items[${i}]`;
        checkTemplate(`${p}.title`, entry.title, 160);
        if (!(entry.title as string).trim()) fail(`${p}.title`, 'Text fehlt');
        if (entry.subtitle !== undefined) checkTemplate(`${p}.subtitle`, entry.subtitle, 300);
        if (entry.trailing !== undefined) checkTemplate(`${p}.trailing`, entry.trailing, 80);
        if (
          entry.icon !== undefined &&
          !(UI_ICON_NAMES as readonly unknown[]).includes(entry.icon) &&
          !(typeof entry.icon === 'string' && entry.icon.length <= 16 && EMOJI.test(entry.icon))
        )
          fail(`${p}.icon`, 'bekanntes Symbol oder ein Emoji');
        if (entry.image !== undefined) checkImage(`${p}.image`, entry.image);
        if (entry.action !== undefined) checkAction(`${p}.action`, entry.action, walk);
      });
      break;
    case 'timeline':
      checkList(`${at}.items`, node.items, LIMITS.timelineItems).forEach((item, i) => {
        const entry = checkEntry(`${at}.items[${i}]`, item);
        const p = `${at}.items[${i}]`;
        if (entry.time !== undefined) checkText(`${p}.time`, entry.time, 60);
        checkLabel(`${p}.title`, entry.title, 160);
        if (entry.text !== undefined) checkText(`${p}.text`, entry.text, 600);
        checkEnum(`${p}.status`, entry.status, ['done', 'current', 'upcoming']);
      });
      break;
    case 'callout':
      checkEnum(`${at}.tone`, node.tone, ['info', 'success', 'warning', 'danger', 'tip'], false);
      if (node.title !== undefined) checkTemplate(`${at}.title`, node.title, 160);
      checkTemplate(`${at}.text`, node.text, LIMITS.longText);
      break;
    case 'progress':
      checkExpr(`${at}.value`, node.value);
      if (node.max !== undefined) checkExpr(`${at}.max`, node.max);
      if (node.label !== undefined) checkTemplate(`${at}.label`, node.label, 120);
      checkFormat(`${at}.format`, node.format);
      checkEnum(`${at}.kind`, node.kind, ['bar', 'ring']);
      break;
    case 'rating':
      checkNumber(`${at}.value`, node.value, 0, 5);
      if (!Number.isInteger((node.value as number) * 2)) fail(`${at}.value`, 'halbe Schritte');
      if (node.count !== undefined) checkNumber(`${at}.count`, node.count, 0, 1e9, true);
      if (node.label !== undefined) checkText(`${at}.label`, node.label, 80);
      break;
    case 'image':
      if (!isUiHttpsUrl(node.src)) fail(`${at}.src`, 'öffentliche https-Adresse erwartet');
      checkLabel(`${at}.alt`, node.alt, 300);
      if (node.caption !== undefined) checkText(`${at}.caption`, node.caption, 300);
      checkEnum(`${at}.aspect`, node.aspect, UI_ASPECTS);
      break;
    case 'code':
      if (typeof node.language !== 'string' || !/^[A-Za-z0-9+#._-]{1,24}$/.test(node.language))
        fail(`${at}.language`, 'Sprachname erwartet');
      checkLabel(`${at}.code`, node.code, LIMITS.text);
      if (node.title !== undefined) checkText(`${at}.title`, node.title, 120);
      break;
    case 'math':
      checkLabel(`${at}.tex`, node.tex, 1000);
      checkBool(`${at}.display`, node.display);
      break;
    // v2 inputs
    case 'stepper':
      bind('bind', 'number');
      checkText(`${at}.label`, node.label, 80);
      for (const key of ['min', 'max'] as const)
        if (node[key] !== undefined) checkNumber(`${at}.${key}`, node[key], -1e12, 1e12);
      if (
        node.min !== undefined &&
        node.max !== undefined &&
        (node.min as number) >= (node.max as number)
      )
        fail(at, 'min < max erwartet');
      if (node.step !== undefined && (typeof node.step !== 'number' || !(node.step > 0)))
        fail(`${at}.step`, 'positiv');
      checkFormat(`${at}.format`, node.format);
      break;
    case 'textarea':
      bind('bind', 'string');
      checkText(`${at}.label`, node.label, 80);
      if (node.rows !== undefined) checkNumber(`${at}.rows`, node.rows, 2, 8, true);
      if (node.placeholder !== undefined) checkText(`${at}.placeholder`, node.placeholder, 120);
      break;
    case 'date': {
      bind('bind', 'string');
      checkText(`${at}.label`, node.label, 80);
      const current = walk.state[node.bind as string];
      if (typeof current === 'string' && current !== '') checkDate(`state.${node.bind}`, current);
      if (node.min !== undefined) checkDate(`${at}.min`, node.min);
      if (node.max !== undefined) checkDate(`${at}.max`, node.max);
      if (
        node.min !== undefined &&
        node.max !== undefined &&
        (node.min as string) > (node.max as string)
      )
        fail(at, 'min ≤ max erwartet');
      break;
    }
    case 'form': {
      if (inForm) fail(at, 'Formulare lassen sich nicht verschachteln');
      if (node.title !== undefined) checkText(`${at}.title`, node.title, 160);
      checkList(`${at}.children`, node.children, LIMITS.formChildren);
      children('children');
      const submit = checkEntry(`${at}.submit`, node.submit);
      checkLabel(`${at}.submit.label`, submit.label, 60);
      checkTemplate(`${at}.submit.message`, submit.message, 1000);
      if (!(submit.message as string).trim()) fail(`${at}.submit.message`, 'Text fehlt');
      break;
    }
    // v2 learning
    case 'checklist': {
      if (node.title !== undefined) checkText(`${at}.title`, node.title, 160);
      const seen = new Set<string>();
      checkList(`${at}.items`, node.items, LIMITS.checklistItems).forEach((item, i) => {
        const entry = checkEntry(`${at}.items[${i}]`, item);
        const p = `${at}.items[${i}]`;
        if (typeof entry.id !== 'string' || !ID.test(entry.id)) fail(`${p}.id`, 'ungültige ID');
        if (seen.has(entry.id as string)) fail(`${p}.id`, 'ID doppelt');
        seen.add(entry.id as string);
        checkTemplate(`${p}.label`, entry.label, 200);
        if (!(entry.label as string).trim()) fail(`${p}.label`, 'Text fehlt');
        if (entry.detail !== undefined) checkTemplate(`${p}.detail`, entry.detail, 300);
      });
      checkBool(`${at}.copyable`, node.copyable);
      break;
    }
    case 'quiz':
      if (node.title !== undefined) checkText(`${at}.title`, node.title, 160);
      checkList(`${at}.questions`, node.questions, LIMITS.quizQuestions).forEach((item, i) => {
        const question = checkEntry(`${at}.questions[${i}]`, item);
        const p = `${at}.questions[${i}]`;
        checkLabel(`${p}.q`, question.q, 300);
        checkEnum(`${p}.kind`, question.kind, ['choice', 'text']);
        const kind = quizQuestionKind(question as unknown as UiQuizQuestion);
        if (kind === 'choice') {
          const options = checkList(`${p}.options`, question.options, LIMITS.quizOptions);
          options.forEach((option, o) => checkLabel(`${p}.options[${o}]`, option, 200));
          if (
            typeof question.answer !== 'number' ||
            !Number.isInteger(question.answer) ||
            question.answer < 0 ||
            question.answer >= options.length
          )
            fail(`${p}.answer`, 'Index einer Option erwartet');
        } else {
          if (question.options !== undefined) fail(`${p}.options`, 'nur bei Auswahlfragen');
          checkLabel(`${p}.answer`, question.answer, 200);
        }
        if (question.hint !== undefined) checkText(`${p}.hint`, question.hint, 300);
        if (question.explanation !== undefined)
          checkText(`${p}.explanation`, question.explanation, 600);
      });
      break;
    case 'flashcards':
      checkList(`${at}.cards`, node.cards, LIMITS.flashcards).forEach((item, i) => {
        const card = checkEntry(`${at}.cards[${i}]`, item);
        checkLabel(`${at}.cards[${i}].front`, card.front, 300);
        checkLabel(`${at}.cards[${i}].back`, card.back, 600);
      });
      break;
    // v2 live widgets
    case 'weather':
      checkLabel(`${at}.location`, node.location, 120);
      if (node.days !== undefined)
        checkNumber(`${at}.days`, node.days, LIMITS.weatherDays[0], LIMITS.weatherDays[1], true);
      break;
    case 'currency':
      for (const key of ['from', 'to'] as const)
        if (typeof node[key] !== 'string' || !/^[A-Z]{3}$/.test(node[key] as string))
          fail(`${at}.${key}`, 'ISO-Währungscode wie EUR');
      if (node.from === node.to) fail(`${at}.to`, 'zwei verschiedene Währungen');
      if (node.amount !== undefined) checkNumber(`${at}.amount`, node.amount, 0, 1e12);
      break;
    case 'stock':
      if (
        typeof node.symbol !== 'string' ||
        !/^[A-Za-z0-9^][A-Za-z0-9.^=_-]{0,19}$/.test(node.symbol)
      )
        fail(`${at}.symbol`, 'Börsenkürzel erwartet');
      checkEnum(`${at}.range`, node.range, UI_STOCK_RANGES);
      break;
    case 'entity':
      checkLabel(`${at}.title`, node.title, 200);
      if (node.lang !== undefined && (typeof node.lang !== 'string' || !LANG.test(node.lang)))
        fail(`${at}.lang`, 'Sprachcode wie de oder en');
      break;
    case 'news':
    case 'gallery':
      checkLabel(`${at}.query`, node.query, 200);
      break;
    // v2.1 custom tile: code runs only in the sandbox, so it is size-checked, not parsed.
    case 'widget': {
      if (++walk.widgets > LIMITS.widgets) fail(at, `höchstens ${LIMITS.widgets} eigene Kacheln`);
      if (typeof node.id !== 'string') fail(`${at}.id`, 'Pflichtfeld fehlt');
      if (typeof node.html !== 'string' || !node.html.trim()) fail(`${at}.html`, 'Code fehlt');
      if ((node.html as string).length > LIMITS.widgetHtml)
        fail(`${at}.html`, `Code länger als ${LIMITS.widgetHtml} Zeichen`);
      if (node.title !== undefined) checkLabel(`${at}.title`, node.title, 80);
      if (node.height !== undefined)
        checkNumber(`${at}.height`, node.height, ...LIMITS.widgetHeight, true);
      for (const key of ['props', 'state'] as const) {
        if (node[key] === undefined) continue;
        if (!isObject(node[key])) fail(`${at}.${key}`, 'Objekt erwartet');
        if (JSON.stringify(node[key]).length > LIMITS.widgetJson)
          fail(`${at}.${key}`, `grösser als ${LIMITS.widgetJson} Zeichen`);
      }
      if (node.live !== undefined) {
        if (!isObject(node.live)) fail(`${at}.live`, 'Objekt erwartet');
        const inputs = Object.entries(node.live as Record<string, unknown>);
        if (inputs.length > LIMITS.widgetLive)
          fail(`${at}.live`, `höchstens ${LIMITS.widgetLive} Live-Daten`);
        for (const [name, input] of inputs) {
          if (!NAME.test(name)) fail(`${at}.live.${name}`, 'ungültiger Name');
          if (!isObject(input) || !LIVE_TYPES.has(String(input.type)))
            fail(`${at}.live.${name}`, 'weather, currency, stock, entity, news oder gallery');
          const liveId = uiWidgetLiveId(node.id as string, name);
          if (!ID.test(liveId)) fail(`${at}.live.${name}`, 'Kachel-ID und Name zu lang');
          // Same checks, id namespace and live-widget limit as a stand-alone widget.
          checkNode(
            `${at}.live.${name}`,
            { ...(input as Record<string, unknown>), id: liveId },
            depth + 1,
            walk,
            inForm
          );
        }
      }
      break;
    }
  }
  if (LIVE_TYPES.has(type)) {
    if (node.id === undefined) fail(`${at}.id`, 'Pflichtfeld fehlt');
    if (++walk.live > LIMITS.liveWidgets)
      fail(at, `höchstens ${LIMITS.liveWidgets} Live-Bausteine`);
  }
}

export interface ExtractedDynamicUi {
  /** The answer text without the UI block. */
  text: string;
  ui: DynamicUiSpec | null;
  /**
   * 0–3 suggestion chips for under the answer (never part of the copied text).
   * Empty while the block streams; present even when `ui` is null.
   */
  followups: string[];
  /** Why a present block was rejected; the text answer stands on its own. */
  error: string | null;
  /**
   * A view block has started but not finished (streaming). False for a block
   * that so far holds only followups, so clients show no view placeholder.
   */
  pending: boolean;
}

const OPEN = '```' + DYNAMIC_UI_FENCE;
/** Fence of a custom tile's code: ```plum-widget <id> title="…" height=320 */
export const DYNAMIC_UI_WIDGET_FENCE = 'plum-widget';

interface UiWidgetSource {
  id: string;
  html: string;
  title?: string;
  height?: number;
}

/** A fence-line attribute list: first bare word is the id, then key="value" pairs. */
function widgetHeader(line: string, index: number, taken: Set<string>) {
  const attrs: Record<string, string> = {};
  let bare: string | undefined;
  for (const match of line.matchAll(/([A-Za-z]+)=(?:"([^"]*)"|'([^']*)'|(\S+))|(\S+)/g)) {
    if (match[5] !== undefined) bare ??= match[5];
    else attrs[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  let id = (attrs.id ?? bare ?? '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^[^A-Za-z_]+/, '')
    .slice(0, 30);
  if (!id) id = `widget-${index + 1}`;
  let unique = id;
  for (let n = 2; taken.has(unique); n++) unique = `${id}-${n}`;
  taken.add(unique);
  const height = Number(attrs.height);
  return {
    id: unique,
    ...(attrs.title ? { title: attrs.title.slice(0, 80) } : {}),
    ...(Number.isInteger(height) &&
    height >= LIMITS.widgetHeight[0] &&
    height <= LIMITS.widgetHeight[1]
      ? { height }
      : {}),
  };
}

/**
 * Takes the ```plum-widget blocks out of an answer. `pending` means the last
 * block is still streaming (its code is not used yet).
 */
function splitUiWidgets(response: string): {
  text: string;
  widgets: UiWidgetSource[];
  pending: boolean;
} {
  const open = new RegExp('(^|\n)[ \t]*```' + DYNAMIC_UI_WIDGET_FENCE + '(?=[ \t\n]|$)', 'g');
  if (!open.test(response)) return { text: response, widgets: [], pending: false };
  open.lastIndex = 0;
  const parts: string[] = [];
  const widgets: UiWidgetSource[] = [];
  const taken = new Set<string>();
  let cursor = 0;
  let pending = false;
  for (let match = open.exec(response); match; match = open.exec(response)) {
    const fenceStart = match.index + match[1]!.length;
    if (fenceStart < cursor) continue;
    parts.push(response.slice(cursor, fenceStart));
    const headerEnd = response.indexOf('\n', fenceStart);
    if (headerEnd < 0) {
      pending = true;
      cursor = response.length;
      break;
    }
    const close = /\n[ \t]*```[ \t]*(?=\n|$)/g;
    close.lastIndex = headerEnd;
    const end = close.exec(response);
    if (!end) {
      pending = true;
      cursor = response.length;
      break;
    }
    const header = response.slice(fenceStart + 3 + DYNAMIC_UI_WIDGET_FENCE.length, headerEnd);
    widgets.push({
      ...widgetHeader(header, widgets.length, taken),
      html: response.slice(headerEnd + 1, end.index),
    });
    cursor = end.index + end[0].length;
    open.lastIndex = cursor;
  }
  parts.push(response.slice(cursor));
  return {
    text: parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n\n'),
    widgets,
    pending,
  };
}

const widgetNode = (source: UiWidgetSource) => ({ type: 'widget', ...source });

const dynamicUiWarning = (warnings: string[]) =>
  warnings.length
    ? 'Einige Teile der interaktiven Ansicht konnten nicht dargestellt werden. Die übrige Ansicht bleibt nutzbar.'
    : null;

/**
 * Puts each tile's code into the widget nodes of a view (by id; a patch keeps
 * the previous code of an unchanged tile) and places tiles the view does not
 * reference above it.
 */
function attachUiWidgets(
  spec: Record<string, unknown>,
  widgets: UiWidgetSource[],
  base?: DynamicUiSpec | null
): Record<string, unknown> {
  const sources = new Map(widgets.map((widget) => [widget.id, widget]));
  const previous = new Map<string, string>();
  if (base?.root)
    walkUiNodes(base.root, (node) => {
      if (node.type === 'widget') previous.set(node.id, node.html);
    });
  const used = new Set<string>();
  const skip = new Set(['props', 'state', 'live', 'data', 'views', 'computed']);
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > LIMITS.depth * 3) return value;
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1));
    if (!isObject(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value))
      out[key] = skip.has(key) ? child : visit(child, depth + 1);
    if (out.type === 'widget' && typeof out.id === 'string') {
      const source = sources.get(out.id);
      if (source) used.add(source.id);
      // Code written in this answer wins; otherwise inline code or the tile's previous code.
      if (source) out.html = source.html;
      else if (typeof out.html !== 'string') out.html = previous.get(out.id as string) ?? out.html;
      if (out.title === undefined && source?.title) out.title = source.title;
      if (out.height === undefined && source?.height) out.height = source.height;
    }
    return out;
  };
  const attached = visit(spec, 0) as Record<string, unknown>;
  const loose = widgets.filter((widget) => !used.has(widget.id)).map(widgetNode);
  if (loose.length && isObject(attached.root))
    attached.root = { type: 'stack', children: [...loose, attached.root] };
  return attached;
}

/** Splits a model answer into its text and its validated UI description. */
export function extractDynamicUi(
  response: string,
  options: { base?: DynamicUiSpec | null; viewId?: string; streaming?: boolean } = {}
): ExtractedDynamicUi {
  const split = splitUiWidgets(response);
  const result = extractUiBlock(split.text, options, split.widgets);
  if (!split.pending) return result;
  // A tile is still being written: show the placeholder, or report it.
  return options.streaming === false
    ? { ...result, error: result.error ?? 'Eine eigene Kachel wurde nicht fertiggestellt.' }
    : { ...result, pending: true };
}

function extractUiBlock(
  response: string,
  options: { base?: DynamicUiSpec | null; viewId?: string; streaming?: boolean },
  widgets: UiWidgetSource[]
): ExtractedDynamicUi {
  const start = response.indexOf(OPEN);
  if (start < 0) {
    const none = { text: response, ui: null, followups: [], error: null, pending: false };
    if (!widgets.length) return none;
    // Tiles without a view block stand on their own.
    const result = recoverDynamicUi({
      version: DYNAMIC_UI_VERSION,
      ...(options.viewId ? { viewId: options.viewId } : {}),
      root: { type: 'stack', children: widgets.map(widgetNode) },
    });
    return result.ok
      ? { ...none, ui: result.spec, error: dynamicUiWarning(result.warnings) }
      : { ...none, error: `Eigene Kachel verworfen (${result.error}).` };
  }
  const bodyStart = response.indexOf('\n', start);
  const end = bodyStart < 0 ? -1 : response.indexOf('\n```', bodyStart);
  const before = response.slice(0, start).trimEnd();
  const pending = end < 0;
  const text = pending
    ? before
    : [
        before,
        response
          .slice(end + 4)
          .replace(/^[^\n]*\n?/, '')
          .trim(),
      ]
        .filter(Boolean)
        .join('\n\n');
  const empty: ExtractedDynamicUi = { text, ui: null, followups: [], error: null, pending };
  if (pending && options.streaming === false)
    return {
      ...empty,
      pending: false,
      error: 'Die interaktive Ansicht wurde nicht fertiggestellt.',
    };
  if (bodyStart < 0) return empty;
  try {
    const raw = response.slice(bodyStart + 1, pending ? undefined : end);
    let parsed: unknown = pending ? parsePartialUiJson(raw) : JSON.parse(raw);
    if (!isObject(parsed))
      return pending ? empty : { ...empty, error: 'Interaktive Ansicht: Objekt erwartet.' };
    const { followups: rawFollowups, ...body } = parsed;
    // Followups come last, so a streaming block that already has them but no
    // root/patch holds chips only: no view placeholder for it.
    if (
      pending &&
      rawFollowups !== undefined &&
      !Object.hasOwn(body, 'root') &&
      !Object.hasOwn(body, 'patch')
    )
      return { ...empty, pending: false };
    const withChips = {
      ...empty,
      followups: pending ? [] : sanitizeDynamicUiFollowups(rawFollowups),
    };
    if (Object.hasOwn(body, 'patch')) {
      if (!options.base)
        return pending
          ? empty
          : { ...withChips, error: 'Keine vorherige Ansicht zum Ändern vorhanden.' };
      parsed = applyDynamicUiPatch(
        options.base,
        attachUiWidgets(body, widgets, options.base),
        pending
      );
    } else {
      // A block may carry only suggestion chips (no view)…
      if (body.root === undefined) {
        if (!widgets.length) return withChips;
        // …next to tiles of their own.
        body.root = { type: 'stack', children: [] };
      }
      parsed = { ...body, ...(options.viewId ? { viewId: options.viewId } : {}) };
    }
    if (isObject(parsed)) parsed = attachUiWidgets(parsed, widgets, options.base);
    const result = recoverDynamicUi(parsed, pending);
    if (!result.ok)
      return pending
        ? empty
        : { ...withChips, error: `Interaktive Ansicht verworfen (${result.error}).` };
    return { ...withChips, ui: result.spec, error: dynamicUiWarning(result.warnings) };
  } catch (error) {
    return pending
      ? empty
      : {
          ...empty,
          error: `Interaktive Ansicht ungültig (${error instanceof Error ? error.message : 'JSON'}).`,
        };
  }
}

/** Parse only received JSON values. No evaluation or invented string contents. */
export function parsePartialUiJson(source: string): unknown {
  if (source.length > 50000) throw new Error('JSON zu gross');
  let i = 0;
  const ws = () => {
    while (/\s/.test(source[i] ?? '') && i < source.length) i++;
  };
  const read = (depth: number): unknown => {
    if (depth > 32) throw new Error('JSON zu tief');
    ws();
    if (source[i] === '{') {
      i++;
      const out: Record<string, unknown> = Object.create(null);
      while (i < source.length) {
        ws();
        if (source[i] === '}') {
          i++;
          break;
        }
        const key = read(depth + 1);
        if (typeof key !== 'string') break;
        ws();
        if (source[i++] !== ':') break;
        const value = read(depth + 1);
        if (value === undefined) break;
        out[key] = value;
        ws();
        if (source[i] === ',') {
          i++;
          continue;
        }
        if (source[i] === '}') i++;
        break;
      }
      return out;
    }
    if (source[i] === '[') {
      i++;
      const out: unknown[] = [];
      while (i < source.length) {
        ws();
        if (source[i] === ']') {
          i++;
          break;
        }
        const value = read(depth + 1);
        if (value === undefined) break;
        out.push(value);
        ws();
        if (source[i] === ',') {
          i++;
          continue;
        }
        if (source[i] === ']') i++;
        break;
      }
      return out;
    }
    const start = i;
    if (source[i] === '"') {
      i++;
      let escaped = false;
      while (i < source.length) {
        const char = source[i++];
        if (char === '"' && !escaped) return JSON.parse(source.slice(start, i));
        escaped = char === '\\' && !escaped;
      }
      return undefined;
    }
    while (i < source.length && !/[\s,}\]]/.test(source[i] ?? '')) i++;
    if (start === i) return undefined;
    try {
      return JSON.parse(source.slice(start, i));
    } catch {
      return undefined;
    }
  };
  return read(0);
}

/** Formula fields that a model sometimes writes as plain numbers. */
const FORMULA_FIELDS: Partial<Record<UiNodeType, readonly string[]>> = {
  kpi: ['value', 'trend', 'delta'],
  progress: ['value', 'max'],
};

/** Initial value for a state a model bound an input to but forgot to declare. */
function undeclaredBindDefault(node: Record<string, unknown>): string | number | boolean | null {
  const min = typeof node.min === 'number' && Number.isFinite(node.min) ? node.min : 0;
  switch (node.type) {
    case 'slider':
    case 'stepper':
      return min;
    case 'checkbox':
      return false;
    case 'input':
      return node.kind === 'number' ? min : '';
    case 'textarea':
      return '';
    default:
      // compare, select, segmented, radio, date …: nothing chosen yet.
      return null;
  }
}

/**
 * Models often bind an input ("bind":"selectedBike") without declaring the
 * state. Declare such names with a neutral default instead of rejecting the view.
 */
function declareUndeclaredBinds(input: Record<string, unknown>): Record<string, unknown> {
  if (input.state !== undefined && !isObject(input.state)) return input;
  const state: Record<string, unknown> = { ...((input.state as object | undefined) ?? {}) };
  let added = false;
  let seen = 0;
  const visit = (value: unknown, depth: number) => {
    if (depth > LIMITS.depth * 3 || ++seen > LIMITS.nodes * 4) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!isObject(value)) return;
    const node = value as Record<string, unknown>;
    const name = node.bind;
    if (
      typeof node.type === 'string' &&
      typeof name === 'string' &&
      NAME.test(name) &&
      !Object.hasOwn(state, name) &&
      Object.keys(state).length < LIMITS.state
    ) {
      state[name] = undeclaredBindDefault(node);
      added = true;
    }
    for (const child of Object.values(node)) if (typeof child === 'object') visit(child, depth + 1);
  };
  visit(input.root, 0);
  return added ? { ...input, state } : input;
}

/** Structural errors stay local to a component; global data/formulas remain strict. */
export function recoverDynamicUi(
  raw: unknown,
  pending = false
): { ok: true; spec: DynamicUiSpec; warnings: string[] } | { ok: false; error: string } {
  if (!isObject(raw)) return { ok: false, error: 'Objekt erwartet' };
  const input = declareUndeclaredBinds(raw);
  const shell = { ...input, root: { type: 'divider' } };
  const global = validateDynamicUi(shell);
  if (!global.ok) return global;
  const warnings: string[] = [];
  let count = 0;
  const ids = new Set<string>();
  const uniqueId = (owner: Record<string, unknown>, path: string) => {
    if (typeof owner.id !== 'string') return;
    if (ids.has(owner.id)) {
      warnings.push(`${path}: ID doppelt`);
      delete owner.id;
    } else ids.add(owner.id);
  };
  const walkList = (list: unknown[], path: string, depth: number) =>
    list
      .map((child, index) => walk(child, `${path}[${index}]`, depth + 1))
      .filter(Boolean) as UiNode[];
  const walk = (value: unknown, path: string, depth: number): UiNode | null => {
    if (++count > LIMITS.nodes || depth > LIMITS.depth)
      throw new Error('Komponentengrenze überschritten');
    if (!isObject(value)) return null;
    const node = { ...value };
    uniqueId(node, path);
    for (const key of FORMULA_FIELDS[node.type as UiNodeType] ?? [])
      if (typeof node[key] === 'number' && Number.isFinite(node[key]))
        node[key] = String(node[key]);
    for (const key of ['children', 'inputs', 'outputs'])
      if (Array.isArray(node[key]))
        node[key] = walkList(node[key] as unknown[], `${path}.${key}`, depth);
    const entries = node.type === 'tabs' ? 'tabs' : node.type === 'accordion' ? 'items' : null;
    if (entries && Array.isArray(node[entries]))
      node[entries] = (node[entries] as unknown[]).map((entry, index) => {
        if (!isObject(entry) || !Array.isArray(entry.children)) return entry;
        const copy = { ...entry };
        uniqueId(copy, `${path}.${entries}[${index}]`);
        copy.children = walkList(entry.children, `${path}.${entries}[${index}].children`, depth);
        return copy;
      });
    if (node.type === 'calculator' && node.chart !== undefined) {
      const chart = walk(node.chart, `${path}.chart`, depth + 1);
      if (chart) node.chart = chart;
      else delete node.chart;
    }
    const checked = validateDynamicUi({ ...shell, root: node });
    if (checked.ok) return checked.spec.root;
    if (pending) return null;
    if (warnings.length < 10) warnings.push(`${path}: ${checked.error}`);
    if (depth === 0) return null;
    return { type: 'text', text: 'Dieser Teil der Ansicht ist nicht verfügbar.', tone: 'muted' };
  };
  try {
    const root = walk(input.root, 'root', 0);
    if (!root) return { ok: false, error: warnings[0] ?? 'Ansicht noch unvollständig' };
    const result = validateDynamicUi({ ...input, root });
    return result.ok ? { ...result, warnings } : result;
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Bounded edits by component ID, never arbitrary object paths or executable code.
 * Targets are component IDs or IDs of tab/accordion entries:
 * - replace: swaps the target (keeps its ID unless the new one has another).
 * - append: adds to the target's children; on `tabs` it adds a tab
 *   ({label, children}), on `accordion` a section ({title, children}).
 * - remove: deletes the target (the root cannot be removed).
 */
export function applyDynamicUiPatch(
  base: DynamicUiSpec,
  patch: Record<string, unknown>,
  pending = false
): DynamicUiSpec {
  if (
    !DYNAMIC_UI_VERSIONS.includes(patch.version as DynamicUiVersion) ||
    !Array.isArray(patch.patch) ||
    patch.patch.length > 50
  )
    throw new Error('Ungültige Änderungsbeschreibung');
  const next = JSON.parse(JSON.stringify(base)) as DynamicUiSpec;
  delete next.followups;
  for (const key of ['state', 'computed', 'data', 'views'] as const)
    if (patch[key] !== undefined) {
      if (!isObject(patch[key])) throw new Error(`Ungültiges Feld ${key}`);
      (next as unknown as Record<string, unknown>)[key] = {
        ...next[key],
        ...(patch[key] as object),
      };
    }
  if (patch.title !== undefined) next.title = patch.title as string;
  type Entry = Record<string, unknown> & { id?: string; children: UiNode[] };
  for (const operation of patch.patch) {
    if (
      !isObject(operation) ||
      typeof operation.target !== 'string' ||
      !['replace', 'append', 'remove'].includes(String(operation.op))
    ) {
      if (pending) break;
      throw new Error('Ungültige Komponentenänderung');
    }
    if (operation.op !== 'remove' && !isObject(operation.node)) {
      if (pending) break;
      throw new Error('Komponente fehlt');
    }
    let found = false;
    const hit = () => {
      if (found) throw new Error('Mehrdeutiges Änderungsziel');
      found = true;
    };
    const editEntry = (entry: Entry): Entry | null => {
      if (entry.id === operation.target) {
        hit();
        if (operation.op === 'remove') return null;
        if (operation.op === 'replace')
          return { id: entry.id, ...(operation.node as object) } as Entry;
        return { ...entry, children: [...entry.children, operation.node as UiNode] };
      }
      return Array.isArray(entry.children)
        ? { ...entry, children: entry.children.map(edit).filter(Boolean) as UiNode[] }
        : entry;
    };
    const edit = (node: UiNode): UiNode | null => {
      if (node.id === operation.target) {
        hit();
        if (operation.op === 'remove') return null;
        if (operation.op === 'replace') return { id: node.id, ...(operation.node as UiNode) };
        if (node.type === 'tabs')
          return { ...node, tabs: [...node.tabs, operation.node as unknown as UiTab] };
        if (node.type === 'accordion')
          return {
            ...node,
            items: [...node.items, operation.node as unknown as UiAccordionItem],
          };
        if (!('children' in node)) throw new Error('An dieses Ziel kann nichts angefügt werden');
        return { ...node, children: [...node.children, operation.node as UiNode] };
      }
      const copy = { ...node } as UiNode & Record<string, unknown>;
      for (const key of ['children', 'inputs', 'outputs'])
        if (Array.isArray(copy[key])) copy[key] = (copy[key] as UiNode[]).map(edit).filter(Boolean);
      if (copy.type === 'calculator' && copy.chart) copy.chart = edit(copy.chart) ?? undefined;
      const entries = copy.type === 'tabs' ? 'tabs' : copy.type === 'accordion' ? 'items' : null;
      if (entries && Array.isArray(copy[entries]))
        copy[entries] = (copy[entries] as Entry[]).map(editEntry).filter(Boolean);
      return copy;
    };
    const root = edit(next.root);
    if (!found) {
      if (pending) break;
      throw new Error(`Änderungsziel ${operation.target} nicht gefunden`);
    }
    if (!root) throw new Error('Wurzel kann nicht entfernt werden');
    next.root = root;
  }
  return next;
}

/** Formats a value for display; locale de-CH, currency codes like CHF or EUR. */
export function formatUiValue(value: UiValue | undefined, format?: string): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (typeof value === 'string' || format === 'text') return String(value);
  if (!Number.isFinite(value)) return '–';
  const locale = 'de-CH';
  if (!format || format === 'number')
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0,
    }).format(value);
  if (format === 'integer')
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  if (format === 'percent')
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value) + ' %';
  if (format === 'compact')
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
      value
    );
  if (format.startsWith('decimal:')) {
    const digits = Number(format.slice(8));
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }
  if (format.startsWith('currency:'))
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: format.slice(9),
      maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    }).format(value);
  return String(value);
}

/** Retain only explicitly edited fields that still exist with a compatible type. */
export function mergeDynamicUiState(
  defaults: Record<string, UiValue>,
  edits: Record<string, UiValue>
): Record<string, UiValue> {
  const state = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (
      Object.hasOwn(edits, key) &&
      (defaults[key] === null || edits[key] === null || typeof defaults[key] === typeof edits[key])
    )
      state[key] = edits[key]!;
  }
  return state;
}
