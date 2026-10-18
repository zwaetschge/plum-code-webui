/**
 * Dynamic UI (generative UI) for the model chat, schema version 1.
 *
 * A model may append one fenced ```plum-ui block with a JSON description of an
 * interactive view to its answer. The description only selects components
 * from the registry below, binds inputs to named state, and wires values
 * through safe formulas (dynamicUiExpr). The server and the client both run
 * validateDynamicUi; anything invalid falls back to the plain text answer.
 */
import { UI_COMPONENT_CATALOG } from './dynamicUiCatalog.js';
import { parseExpr, TEMPLATE_PATTERN, type UiRow, type UiValue } from './dynamicUiExpr.js';

export const DYNAMIC_UI_VERSION = 1;
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

export type UiAction =
  | { type: 'sendMessage'; text: string }
  | { type: 'set'; key: string; value: string }
  | { type: 'reset' };

interface Base {
  id?: string;
}
export type UiNode =
  | (Base & { type: 'stack'; gap?: 'sm' | 'md' | 'lg'; children: UiNode[] })
  | (Base & { type: 'row'; gap?: 'sm' | 'md' | 'lg'; wrap?: boolean; children: UiNode[] })
  | (Base & { type: 'grid'; columns: number; children: UiNode[] })
  | (Base & {
      type: 'card';
      title?: string;
      subtitle?: string;
      highlight?: string;
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
    })
  | (Base & {
      type: 'chart';
      kind: 'bar' | 'line' | 'area' | 'pie';
      data: string | UiRow[];
      x: string;
      series: Array<{ key: string; label: string }>;
      format?: UiFormat;
      height?: number;
      stacked?: boolean;
    })
  | (Base & {
      type: 'compare';
      bind?: string;
      items: Array<{ id: string; title: string; subtitle?: string; badge?: string; values: UiRow }>;
      specs: Array<{ key: string; label: string; format?: UiFormat; better?: 'higher' | 'lower' }>;
    });

export type UiNodeType = UiNode['type'];

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
  version: 1;
  /** Server-assigned identity shared by incremental revisions. */
  viewId?: string;
  title?: string;
  layout?: 'inline' | 'dashboard';
  state?: Record<string, UiValue>;
  computed?: Record<string, string>;
  data?: Record<string, UiRow[]>;
  views?: Record<string, UiView>;
  root: UiNode;
}

export const UI_NODE_TYPES: readonly UiNodeType[] = UI_COMPONENT_CATALOG.map((c) => c.type);

const LIMITS = {
  nodes: 250,
  depth: 10,
  rows: 500,
  datasets: 12,
  views: 20,
  state: 40,
  computed: 60,
  text: 4000,
};
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const FORMAT = /^(number|integer|percent|compact|text|decimal:\d|currency:[A-Z]{3})$/;

type Result = { ok: true; spec: DynamicUiSpec } | { ok: false; error: string };

class Invalid extends Error {}
const fail = (path: string, message: string): never => {
  throw new Invalid(`${path}: ${message}`);
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Checks a model-produced description against schema v1: known components and
 * props only, bounded sizes, parseable formulas, bindings to declared state.
 */
export function validateDynamicUi(input: unknown): Result {
  try {
    if (!isObject(input)) fail('ui', 'Objekt erwartet');
    const spec = input as Record<string, unknown>;
    if (spec.version !== DYNAMIC_UI_VERSION) fail('version', `nur Version ${DYNAMIC_UI_VERSION}`);
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
    const counter = { nodes: 0, ids: new Set<string>() };
    checkNode('root', spec.root, 0, counter, new Set(stateKeys), sources);
    return { ok: true, spec: input as unknown as DynamicUiSpec };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : 'Ungültige Beschreibung' };
  }
}

function checkText(path: string, value: unknown, max = 300) {
  if (typeof value !== 'string') fail(path, 'Text erwartet');
  if ((value as string).length > max) fail(path, 'zu lang');
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

function checkNode(
  path: string,
  value: unknown,
  depth: number,
  counter: { nodes: number; ids: Set<string> },
  state: Set<string>,
  sources: Set<string>
) {
  if (!isObject(value)) fail(path, 'Komponente erwartet');
  if (depth > LIMITS.depth) fail(path, 'zu tief verschachtelt');
  if (++counter.nodes > LIMITS.nodes) fail(path, 'zu viele Komponenten');
  const node = value as Record<string, unknown>;
  const type = node.type as UiNodeType;
  if (!UI_NODE_TYPES.includes(type)) fail(path, `unbekannte Komponente "${String(node.type)}"`);
  const at = `${path}<${type}>`;
  const contract = UI_COMPONENT_CATALOG.find((c) => c.type === type)!;
  for (const key of contract.required)
    if (node[key] === undefined) fail(`${at}.${key}`, 'Pflichtfeld fehlt');
  if (node.id !== undefined) {
    if (typeof node.id !== 'string' || !NAME.test(node.id)) fail(`${at}.id`, 'ungültige ID');
    if (counter.ids.has(node.id as string)) fail(`${at}.id`, 'ID doppelt');
    counter.ids.add(node.id as string);
  }
  const children = (key: string, required = true) => {
    const list = node[key];
    if (list === undefined && !required) return;
    if (!Array.isArray(list)) fail(`${at}.${key}`, 'Liste erwartet');
    (list as unknown[]).forEach((child, index) =>
      checkNode(`${at}.${key}[${index}]`, child, depth + 1, counter, state, sources)
    );
  };
  const bind = () => {
    if (typeof node.bind !== 'string' || !state.has(node.bind))
      fail(`${at}.bind`, 'muss auf einen State-Wert zeigen');
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
      children('children');
      break;
    case 'calculator':
      if (node.title !== undefined) checkText(`${at}.title`, node.title, 160);
      children('inputs');
      children('outputs');
      if (node.chart !== undefined)
        checkNode(`${at}.chart`, node.chart, depth + 1, counter, state, sources);
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
      const action = node.action as Record<string, unknown>;
      if (!isObject(action)) fail(`${at}.action`, 'Aktion erwartet');
      if (action.type === 'sendMessage') checkTemplate(`${at}.action.text`, action.text, 1000);
      else if (action.type === 'set') {
        if (typeof action.key !== 'string' || !state.has(action.key))
          fail(`${at}.action.key`, 'State-Wert erwartet');
        checkExpr(`${at}.action.value`, action.value);
      } else if (action.type !== 'reset') fail(`${at}.action.type`, 'sendMessage, set oder reset');
      break;
    }
    case 'table':
      checkData(`${at}.data`, node.data, sources);
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
      break;
    case 'chart':
      if (!['bar', 'line', 'area', 'pie'].includes(String(node.kind)))
        fail(`${at}.kind`, 'bar, line, area oder pie');
      checkData(`${at}.data`, node.data, sources);
      if (typeof node.x !== 'string') fail(`${at}.x`, 'Feldname erwartet');
      if (!Array.isArray(node.series) || !node.series.length || node.series.length > 6)
        fail(`${at}.series`, '1–6 Reihen');
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
  }
}

export interface ExtractedDynamicUi {
  /** The answer text without the UI block. */
  text: string;
  ui: DynamicUiSpec | null;
  /** Why a present block was rejected; the text answer stands on its own. */
  error: string | null;
  /** A block has started but not finished (streaming). */
  pending: boolean;
}

const OPEN = '```' + DYNAMIC_UI_FENCE;

/** Splits a model answer into its text and its validated UI description. */
export function extractDynamicUi(
  response: string,
  options: { base?: DynamicUiSpec | null; viewId?: string; streaming?: boolean } = {}
): ExtractedDynamicUi {
  const start = response.indexOf(OPEN);
  if (start < 0) return { text: response, ui: null, error: null, pending: false };
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
  const empty = { text, ui: null, error: null, pending };
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
    if (Object.hasOwn(parsed, 'patch')) {
      if (!options.base)
        return pending
          ? empty
          : { ...empty, error: 'Keine vorherige Ansicht zum Ändern vorhanden.' };
      parsed = applyDynamicUiPatch(options.base, parsed, pending);
    } else parsed = { ...parsed, ...(options.viewId ? { viewId: options.viewId } : {}) };
    const result = recoverDynamicUi(parsed, pending);
    if (!result.ok)
      return pending
        ? empty
        : { ...empty, error: `Interaktive Ansicht verworfen (${result.error}).` };
    return {
      text,
      ui: result.spec,
      error: result.warnings.length
        ? `Einzelne Teile konnten nicht dargestellt werden (${result.warnings.join('; ')}).`
        : null,
      pending,
    };
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

/** Structural errors stay local to a component; global data/formulas remain strict. */
export function recoverDynamicUi(
  input: unknown,
  pending = false
): { ok: true; spec: DynamicUiSpec; warnings: string[] } | { ok: false; error: string } {
  if (!isObject(input)) return { ok: false, error: 'Objekt erwartet' };
  const shell = { ...input, root: { type: 'divider' } };
  const global = validateDynamicUi(shell);
  if (!global.ok) return global;
  const warnings: string[] = [];
  let count = 0;
  const ids = new Set<string>();
  const walk = (value: unknown, path: string, depth: number): UiNode | null => {
    if (++count > LIMITS.nodes || depth > LIMITS.depth)
      throw new Error('Komponentengrenze überschritten');
    if (!isObject(value)) return null;
    const node = { ...value };
    if (typeof node.id === 'string') {
      if (ids.has(node.id)) {
        warnings.push(`${path}: ID doppelt`);
        delete node.id;
      } else ids.add(node.id);
    }
    for (const key of ['children', 'inputs', 'outputs'])
      if (Array.isArray(node[key])) {
        node[key] = (node[key] as unknown[])
          .map((child, index) => walk(child, `${path}.${key}[${index}]`, depth + 1))
          .filter(Boolean);
      }
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

/** Bounded edits by component ID, never arbitrary object paths or executable code. */
export function applyDynamicUiPatch(
  base: DynamicUiSpec,
  patch: Record<string, unknown>,
  pending = false
): DynamicUiSpec {
  if (patch.version !== 1 || !Array.isArray(patch.patch) || patch.patch.length > 50)
    throw new Error('Ungültige Änderungsbeschreibung');
  const next = JSON.parse(JSON.stringify(base)) as DynamicUiSpec;
  for (const key of ['state', 'computed', 'data', 'views'] as const)
    if (patch[key] !== undefined) {
      if (!isObject(patch[key])) throw new Error(`Ungültiges Feld ${key}`);
      (next as unknown as Record<string, unknown>)[key] = {
        ...next[key],
        ...(patch[key] as object),
      };
    }
  if (patch.title !== undefined) next.title = patch.title as string;
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
    const edit = (node: UiNode): UiNode | null => {
      if (node.id === operation.target) {
        if (found) throw new Error('Mehrdeutiges Änderungsziel');
        found = true;
        if (operation.op === 'remove') return null;
        if (operation.op === 'replace') return { id: node.id, ...(operation.node as UiNode) };
        if (!('children' in node)) throw new Error('An dieses Ziel kann nichts angefügt werden');
        return { ...node, children: [...node.children, operation.node as UiNode] };
      }
      const copy = { ...node } as UiNode & Record<string, unknown>;
      for (const key of ['children', 'inputs', 'outputs'])
        if (Array.isArray(copy[key])) copy[key] = (copy[key] as UiNode[]).map(edit).filter(Boolean);
      if (copy.type === 'calculator' && copy.chart) copy.chart = edit(copy.chart) ?? undefined;
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
