/**
 * Dynamic UI v2 regression cases, registered by dynamic-ui-regression-tests.ts
 * (`pnpm --filter @plum-code-webui/backend test:dynamic-ui`). No network: every
 * live source and the image proxy run against fake fetchers.
 */
import assert from 'node:assert/strict';
import dns from 'node:dns';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  UI_ACTION_TYPES,
  UI_COMPONENT_CATALOG,
  UI_LIVE_NODE_TYPES,
  applyDynamicUiPatch,
  collectUiLiveNodes,
  extractDynamicUi,
  formatUiChange,
  formatUiPrice,
  formatUiTemperature,
  parseUiEntityHref,
  quizQuestionKind,
  recoverDynamicUi,
  sanitizeDynamicUiFollowups,
  uiImageProxyUrl,
  uiLiveKey,
  uiResultRefreshPath,
  uiWeatherCode,
  validateDynamicUi,
  type AnyUiResult,
  type DynamicUiSpec,
  type UiLiveNode,
  type UiResultEvent,
} from '@plum-code-webui/shared';
import {
  DYNAMIC_UI_INSTRUCTIONS,
  DYNAMIC_UI_SIMPLE_INSTRUCTIONS,
  dynamicUiInstructions,
} from '../src/services/assistant/dynamicUiPrompt.js';
import {
  createUiLiveResolver,
  dynamicUiBlockComplete,
  startTurnUiResolution,
  stooqSymbol,
  turnUiResults,
  yahooSymbol,
  type UiLiveDeps,
  type UiResultStore,
} from '../src/services/assistant/dynamicUiLive.js';
import {
  createUiImageProxy,
  sniffImageType,
} from '../src/services/assistant/dynamicUiImageProxy.js';

type Register = (name: string, run: () => void | Promise<void>) => void;

const STATE = {
  amount: 10,
  servings: 4,
  tab: 0,
  note: '',
  day: '2026-11-07',
  choice: 'a',
  flag: false,
  period: '1M',
};
const DATA = {
  rows: [
    { x: 1, y: 2, label: 'A', period: '1M' },
    { x: 2, y: 3, label: 'B', period: '6M' },
  ],
};
const spec = (root: unknown, extra: Record<string, unknown> = {}) => ({
  version: 2,
  state: STATE,
  data: DATA,
  root,
  ...extra,
});
const IMAGE = { src: 'https://upload.wikimedia.org/a/b/c.jpg', alt: 'Matterhorn' };
const text = (t = 'Hallo') => ({ type: 'text', text: t });

/** One valid instance per catalog type; the suite fails when a type has none. */
const VALID: Record<string, unknown> = {
  stack: { type: 'stack', gap: 'sm', children: [text()] },
  row: { type: 'row', children: [text()] },
  grid: { type: 'grid', columns: 2, children: [text(), text()] },
  card: {
    type: 'card',
    title: 'Betrag {{amount}}',
    image: IMAGE,
    expandable: true,
    actions: [
      { label: 'Kopieren', action: { type: 'copy', text: 'Betrag {{amount|integer}}' } },
      { label: 'Öffnen', action: { type: 'openUrl', url: 'https://example.com/a?b=1' } },
    ],
    children: [text()],
  },
  tabs: {
    type: 'tabs',
    bind: 'tab',
    tabs: [
      { id: 'overview', label: 'Überblick', children: [text()] },
      { label: 'Details', children: [text('Mehr')] },
    ],
  },
  accordion: {
    type: 'accordion',
    items: [{ id: 'faq1', title: 'Warum?', open: true, children: [text()] }],
  },
  calculator: {
    type: 'calculator',
    inputs: [{ type: 'slider', bind: 'amount', label: 'Betrag', min: 0, max: 100 }],
    outputs: [{ type: 'kpi', label: 'Doppelt', value: 'amount*2' }],
  },
  heading: { type: 'heading', text: 'Titel', level: 2 },
  text: text(),
  markdown: { type: 'markdown', text: '**fett**' },
  badge: { type: 'badge', text: 'Neu', tone: 'accent' },
  divider: { type: 'divider' },
  callout: { type: 'callout', tone: 'tip', title: 'Tipp', text: 'Für {{servings}} Personen' },
  list: {
    type: 'list',
    items: [
      {
        title: 'Zug',
        subtitle: 'IC 1',
        trailing: '{{amount|integer}} Min.',
        icon: 'train',
        action: { type: 'prefill', text: 'Verbindung nach Bern' },
      },
      { title: 'Velo', icon: '🚲', image: IMAGE },
    ],
  },
  timeline: {
    type: 'timeline',
    items: [
      { time: '1815', title: 'Geburt', status: 'done' },
      { title: 'Heute', text: 'Gedenktag', status: 'current' },
    ],
  },
  carousel: {
    type: 'carousel',
    aspect: '4:3',
    items: [
      {
        title: 'E-Bike A',
        subtitle: 'Pendeln',
        meta: ['CHF 3500', '25 kg'],
        badge: 'Tipp',
        image: IMAGE,
        action: { type: 'sendMessage', text: 'Mehr zu A' },
      },
      { title: 'E-Bike B', action: { type: 'openEntity', title: 'E-Bike', lang: 'de' } },
    ],
  },
  image: { type: 'image', src: IMAGE.src, alt: 'Berg', caption: 'Zermatt', aspect: '16:9' },
  rating: { type: 'rating', value: 4.5, count: 120, label: 'Bewertungen' },
  progress: {
    type: 'progress',
    value: 'amount',
    max: '100',
    label: '{{amount}} von 100',
    kind: 'ring',
  },
  code: { type: 'code', language: 'typescript', code: 'const a = 1;', title: 'Beispiel' },
  math: { type: 'math', tex: 'E = mc^2', display: true },
  kpi: {
    type: 'kpi',
    label: 'Umsatz',
    value: 'amount',
    delta: 'amount - 5',
    deltaFormat: 'percent',
    spark: 'rows',
    sparkKey: 'y',
  },
  table: {
    type: 'table',
    data: 'rows',
    columns: [{ key: 'label', label: 'Name' }],
    sortable: true,
  },
  chart: {
    type: 'chart',
    kind: 'scatter',
    data: 'rows',
    x: 'x',
    series: [{ key: 'y', label: 'Y' }],
    ranges: [
      { label: '1M', value: '1M' },
      { label: '6M', value: '6M' },
    ],
    rangeBind: 'period',
  },
  compare: {
    type: 'compare',
    items: [
      { id: 'a', title: 'A', values: { price: 1 } },
      { id: 'b', title: 'B', values: { price: 2 } },
    ],
    specs: [{ key: 'price', label: 'Preis', better: 'lower' }],
  },
  slider: { type: 'slider', bind: 'amount', label: 'Betrag', min: 0, max: 100 },
  stepper: { type: 'stepper', bind: 'servings', label: 'Portionen', min: 1, max: 12, step: 1 },
  input: { type: 'input', bind: 'note', label: 'Notiz', kind: 'text' },
  textarea: { type: 'textarea', bind: 'note', label: 'Nachricht', rows: 4, placeholder: '…' },
  date: { type: 'date', bind: 'day', label: 'Datum', min: '2026-01-01', max: '2026-12-31' },
  select: { type: 'select', bind: 'choice', label: 'Wahl', options: [{ value: 'a', label: 'A' }] },
  segmented: {
    type: 'segmented',
    bind: 'choice',
    label: 'Wahl',
    options: [{ value: 'a', label: 'A' }],
  },
  radio: {
    type: 'radio',
    bind: 'choice',
    label: 'Wahl',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  },
  checkbox: { type: 'checkbox', bind: 'flag', label: 'Ja' },
  button: { type: 'button', label: 'Los', action: { type: 'openEntity', title: 'Ada Lovelace' } },
  form: {
    type: 'form',
    title: 'Reise',
    children: [
      { type: 'date', bind: 'day', label: 'Abreise' },
      { type: 'stepper', bind: 'servings', label: 'Personen' },
    ],
    submit: { label: 'Planen', message: 'Plane eine Reise am {{day}} für {{servings}} Personen' },
  },
  checklist: {
    type: 'checklist',
    id: 'ingredients',
    title: 'Zutaten',
    copyable: true,
    items: [
      { id: 'rice', label: '{{servings*80|integer}} g Reis' },
      { id: 'broth', label: 'Brühe', detail: 'heiss halten' },
    ],
  },
  quiz: {
    type: 'quiz',
    id: 'planets',
    title: 'Planeten',
    questions: [
      {
        q: 'Grösster Planet?',
        options: ['Mars', 'Jupiter'],
        answer: 1,
        hint: 'Gas',
        explanation: 'Jupiter',
      },
      { q: 'Roter Planet?', kind: 'text', answer: 'Mars' },
    ],
  },
  flashcards: { type: 'flashcards', id: 'cards', cards: [{ front: 'H2O', back: 'Wasser' }] },
  weather: { type: 'weather', id: 'weather', location: 'Zürich, Schweiz', days: 5 },
  currency: { type: 'currency', id: 'fx', from: 'EUR', to: 'CHF', amount: 100 },
  stock: { type: 'stock', id: 'nesn', symbol: 'NESN.SW', range: '1Y' },
  entity: { type: 'entity', id: 'ada', title: 'Ada Lovelace', lang: 'en' },
  news: { type: 'news', id: 'news', query: 'Nestlé' },
  gallery: { type: 'gallery', id: 'pics', query: 'Matterhorn' },
  widget: {
    type: 'widget',
    id: 'tile',
    title: 'Würfel',
    height: 240,
    html: '<button id="roll">Würfeln</button><script>roll.onclick=()=>plum.setState({n:1})</script>',
    props: { sides: 6 },
    live: { zrh: { type: 'weather', location: 'Zürich', days: 3 } },
    state: { n: 0 },
  },
};

const long = (n: number) => 'x'.repeat(n);
const many = <T>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));
/** [name, root, extra spec fields] that must be rejected. */
const INVALID: Array<[string, unknown, Record<string, unknown>?]> = [
  ['widget: no code', { type: 'widget', id: 'empty', html: '  ' }],
  ['widget: code too long', { type: 'widget', id: 'big', html: 'x'.repeat(60001) }],
  ['widget: height too small', { ...(VALID.widget as object), height: 20 }],
  [
    'widget: unknown live type',
    { type: 'widget', id: 'w', html: '<p>', live: { a: { type: 'map' } } },
  ],
  [
    'widget: live input invalid',
    {
      type: 'widget',
      id: 'w',
      html: '<p>',
      live: { a: { type: 'currency', from: 'EUR', to: 'EUR' } },
    },
  ],
  ['widget: props not an object', { type: 'widget', id: 'w', html: '<p>', props: [1, 2] }],
  ['tabs: one tab', { type: 'tabs', tabs: [{ label: 'A', children: [] }] }],
  ['tabs: seven tabs', { type: 'tabs', tabs: many(7, (i) => ({ label: `T${i}`, children: [] })) }],
  ['tabs: bind to text state', { ...(VALID.tabs as object), bind: 'note' }],
  [
    'tabs: tab without label',
    { type: 'tabs', tabs: [{ children: [] }, { label: 'B', children: [] }] },
  ],
  [
    'tabs: entry id clashes with node id',
    {
      type: 'tabs',
      tabs: [
        { id: 'dup', label: 'A', children: [{ type: 'divider', id: 'dup' }] },
        { label: 'B', children: [] },
      ],
    },
  ],
  ['accordion: empty', { type: 'accordion', items: [] }],
  [
    'accordion: 13 sections',
    { type: 'accordion', items: many(13, () => ({ title: 'T', children: [] })) },
  ],
  ['carousel: one item', { type: 'carousel', items: [{ title: 'A' }] }],
  ['carousel: 11 items', { type: 'carousel', items: many(11, (i) => ({ title: `A${i}` })) }],
  [
    'carousel: four meta',
    { type: 'carousel', items: [{ title: 'A', meta: ['1', '2', '3', '4'] }, { title: 'B' }] },
  ],
  [
    'carousel: http image',
    {
      type: 'carousel',
      items: [{ title: 'A', image: { src: 'http://x.com/a.png', alt: 'a' } }, { title: 'B' }],
    },
  ],
  [
    'carousel: image without alt',
    {
      type: 'carousel',
      items: [{ title: 'A', image: { src: IMAGE.src, alt: ' ' } }, { title: 'B' }],
    },
  ],
  [
    'carousel: bad aspect',
    { type: 'carousel', aspect: '21:9', items: [{ title: 'A' }, { title: 'B' }] },
  ],
  ['list: 31 items', { type: 'list', items: many(31, () => ({ title: 'A' })) }],
  ['list: unknown icon', { type: 'list', items: [{ title: 'A', icon: 'rocket-ship' }] }],
  ['timeline: 21 items', { type: 'timeline', items: many(21, () => ({ title: 'A' })) }],
  ['timeline: bad status', { type: 'timeline', items: [{ title: 'A', status: 'later' }] }],
  ['checklist: no id', { type: 'checklist', items: [{ id: 'a', label: 'A' }] }],
  [
    'checklist: duplicate item id',
    {
      type: 'checklist',
      id: 'c',
      items: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'B' },
      ],
    },
  ],
  [
    'checklist: 41 items',
    { type: 'checklist', id: 'c', items: many(41, (i) => ({ id: `i${i}`, label: 'A' })) },
  ],
  ['checklist: bad item id', { type: 'checklist', id: 'c', items: [{ id: '1-a', label: 'A' }] }],
  [
    'checklist: bad template',
    { type: 'checklist', id: 'c', items: [{ id: 'a', label: '{{eval(1)}}' }] },
  ],
  ['stepper: text state', { type: 'stepper', bind: 'note', label: 'X' }],
  ['stepper: min >= max', { type: 'stepper', bind: 'servings', label: 'X', min: 5, max: 5 }],
  ['stepper: step 0', { type: 'stepper', bind: 'servings', label: 'X', step: 0 }],
  ['radio: no options', { type: 'radio', bind: 'choice', label: 'X', options: [] }],
  ['textarea: rows 9', { type: 'textarea', bind: 'note', label: 'X', rows: 9 }],
  ['textarea: number state', { type: 'textarea', bind: 'amount', label: 'X' }],
  ['date: bad min', { type: 'date', bind: 'day', label: 'X', min: '2026-13-01' }],
  [
    'date: bad default',
    { type: 'date', bind: 'day', label: 'X' },
    { state: { ...STATE, day: 'morgen' } },
  ],
  [
    'date: min after max',
    { type: 'date', bind: 'day', label: 'X', min: '2026-12-01', max: '2026-01-01' },
  ],
  [
    'form: nested form',
    { type: 'form', children: [VALID.form], submit: { label: 'A', message: 'B' } },
  ],
  [
    'form: empty message',
    { type: 'form', children: [text()], submit: { label: 'A', message: ' ' } },
  ],
  ['form: no children', { type: 'form', children: [], submit: { label: 'A', message: 'B' } }],
  [
    'quiz: 21 questions',
    { type: 'quiz', id: 'q', questions: many(21, () => ({ q: 'A', kind: 'text', answer: 'B' })) },
  ],
  [
    'quiz: answer out of range',
    { type: 'quiz', id: 'q', questions: [{ q: 'A', options: ['a', 'b'], answer: 2 }] },
  ],
  [
    'quiz: one option',
    { type: 'quiz', id: 'q', questions: [{ q: 'A', options: ['a'], answer: 0 }] },
  ],
  [
    'quiz: text with options',
    {
      type: 'quiz',
      id: 'q',
      questions: [{ q: 'A', kind: 'text', options: ['a', 'b'], answer: 'a' }],
    },
  ],
  ['quiz: missing answer', { type: 'quiz', id: 'q', questions: [{ q: 'A', options: ['a', 'b'] }] }],
  [
    'quiz: long explanation',
    {
      type: 'quiz',
      id: 'q',
      questions: [{ q: 'A', kind: 'text', answer: 'a', explanation: long(601) }],
    },
  ],
  [
    'flashcards: 51 cards',
    { type: 'flashcards', id: 'f', cards: many(51, () => ({ front: 'a', back: 'b' })) },
  ],
  ['flashcards: empty back', { type: 'flashcards', id: 'f', cards: [{ front: 'a', back: '' }] }],
  ['callout: unknown tone', { type: 'callout', tone: 'error', text: 'A' }],
  ['callout: text over 2000', { type: 'callout', tone: 'info', text: long(2001) }],
  ['progress: bad formula', { type: 'progress', value: 'eval(1)' }],
  ['rating: above 5', { type: 'rating', value: 5.5 }],
  ['rating: not a half step', { type: 'rating', value: 3.3 }],
  ['rating: negative count', { type: 'rating', value: 3, count: -1 }],
  ['image: http', { type: 'image', src: 'http://example.com/a.png', alt: 'A' }],
  ['image: IP literal', { type: 'image', src: 'https://127.0.0.1/a.png', alt: 'A' }],
  ['image: javascript', { type: 'image', src: 'javascript:alert(1)', alt: 'A' }],
  ['image: credentials', { type: 'image', src: 'https://user:pw@example.com/a.png', alt: 'A' }],
  ['image: missing alt', { type: 'image', src: IMAGE.src }],
  ['code: bad language', { type: 'code', language: 'type script', code: 'a' }],
  ['code: too long', { type: 'code', language: 'js', code: long(4001) }],
  ['math: too long', { type: 'math', tex: long(1001) }],
  ['weather: no id', { type: 'weather', location: 'Bern' }],
  ['weather: 11 days', { type: 'weather', id: 'w', location: 'Bern', days: 11 }],
  ['weather: empty location', { type: 'weather', id: 'w', location: ' ' }],
  ['currency: lower case', { type: 'currency', id: 'c', from: 'eur', to: 'CHF' }],
  ['currency: same currency', { type: 'currency', id: 'c', from: 'CHF', to: 'CHF' }],
  ['currency: negative amount', { type: 'currency', id: 'c', from: 'EUR', to: 'CHF', amount: -1 }],
  ['stock: bad symbol', { type: 'stock', id: 's', symbol: 'NESN SW' }],
  ['stock: bad range', { type: 'stock', id: 's', symbol: 'AAPL', range: '3M' }],
  ['entity: host-like lang', { type: 'entity', id: 'e', title: 'A', lang: 'evil.example/' }],
  ['news: empty query', { type: 'news', id: 'n', query: '' }],
  ['gallery: no id', { type: 'gallery', query: 'Berg' }],
  [
    'live: seven widgets',
    { type: 'stack', children: many(7, (i) => ({ type: 'news', id: `n${i}`, query: 'x' })) },
  ],
  ['chart: unknown kind', { ...(VALID.chart as object), kind: 'radar' }],
  ['chart: ranges without rangeBind', { ...(VALID.chart as object), rangeBind: undefined }],
  ['chart: one range', { ...(VALID.chart as object), ranges: [{ label: 'A', value: 1 }] }],
  ['chart: rangeBind to unknown state', { ...(VALID.chart as object), rangeBind: 'nope' }],
  [
    'chart: seven series',
    { ...(VALID.chart as object), series: many(7, (i) => ({ key: `s${i}`, label: 'S' })) },
  ],
  [
    'card: three actions',
    {
      ...(VALID.card as object),
      actions: many(3, () => ({ label: 'A', action: { type: 'reset' } })),
    },
  ],
  ['kpi: unknown spark source', { type: 'kpi', label: 'K', value: '1', spark: 'nope' }],
  [
    'kpi: bad delta format',
    { type: 'kpi', label: 'K', value: '1', delta: '1', deltaFormat: 'euro' },
  ],
  ['table: sortable not boolean', { ...(VALID.table as object), sortable: 'yes' }],
  [
    'action: openUrl http',
    { type: 'button', label: 'A', action: { type: 'openUrl', url: 'http://example.com' } },
  ],
  [
    'action: openUrl javascript',
    { type: 'button', label: 'A', action: { type: 'openUrl', url: 'javascript:alert(1)' } },
  ],
  [
    'action: openUrl localhost',
    { type: 'button', label: 'A', action: { type: 'openUrl', url: 'https://localhost/' } },
  ],
  [
    'action: openEntity bad lang',
    { type: 'button', label: 'A', action: { type: 'openEntity', title: 'A', lang: 'de-CH' } },
  ],
  [
    'action: unknown type',
    { type: 'button', label: 'A', action: { type: 'download', url: 'https://x.com' } },
  ],
  [
    'action: copy too long',
    { type: 'button', label: 'A', action: { type: 'copy', text: long(2001) } },
  ],
  ['followups: four', text(), { followups: ['a', 'b', 'c', 'd'] }],
  ['followups: too long', text(), { followups: [long(81)] }],
  ['followups: not text', text(), { followups: [1] }],
];

function fakeFetch(
  routes: Array<[RegExp, (url: string, signal: AbortSignal) => Response | Promise<Response>]>
) {
  const calls: string[] = [];
  const fetch: UiLiveDeps['fetch'] = async (url, init) => {
    calls.push(url);
    for (const [pattern, reply] of routes) if (pattern.test(url)) return reply(url, init.signal);
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const NOW = new Date('2026-11-07T12:00:00Z');

const GEO = {
  results: [
    {
      name: 'Zurich',
      latitude: 41.5,
      longitude: -71.1,
      country: 'Vereinigte Staaten',
      country_code: 'US',
      admin1: 'Rhode Island',
      timezone: 'America/New_York',
    },
    {
      name: 'Zürich',
      latitude: 47.37,
      longitude: 8.55,
      country: 'Schweiz',
      country_code: 'CH',
      admin1: 'Kanton Zürich',
      timezone: 'Europe/Zurich',
    },
  ],
};
const hours = many(24, (i) => `2026-11-07T${String((4 + i) % 24).padStart(2, '0')}:00`);
const FORECAST = {
  timezone: 'Europe/Zurich',
  current: {
    time: '2026-11-07T04:30',
    temperature_2m: 8.1,
    apparent_temperature: 6.9,
    relative_humidity_2m: 95,
    is_day: 0,
    precipitation: 0,
    weather_code: 61,
    wind_speed_10m: 2.9,
    wind_direction_10m: 173,
  },
  hourly: {
    time: hours,
    temperature_2m: many(24, (i) => 8 + i / 10),
    precipitation_probability: many(24, (i) => (i < 6 ? 50 : 0)),
    precipitation: many(24, () => 0),
    weather_code: many(24, (i) => (i < 6 ? 61 : 2)),
    is_day: many(24, (i) => (i > 3 && i < 13 ? 1 : 0)),
  },
  daily: {
    time: ['2026-11-07', '2026-11-08', '2026-11-09'],
    weather_code: [61, 45, 0],
    temperature_2m_max: [10.5, 11.1, 9],
    temperature_2m_min: [6.9, 6.1, 2],
    precipitation_probability_max: [58, 10, 0],
    precipitation_sum: [0.2, 0, 0],
    sunrise: ['2026-11-07T07:21', '2026-11-08T07:23', '2026-11-09T07:24'],
    sunset: ['2026-11-07T17:01', '2026-11-08T17:00', '2026-11-09T16:58'],
  },
};
const STOOQ_CSV =
  'Date,Open,High,Low,Close,Volume\n2026-11-04,86,87,85,86.5,1000\n2026-11-05,86.6,87.5,86,87.23,2000\n2026-11-06,86.6,86.76,84.61,85.85,4852408\n';
const YAHOO = {
  chart: {
    result: [
      {
        meta: {
          currency: 'CHF',
          longName: 'Nestlé S.A.',
          fullExchangeName: 'Swiss',
          regularMarketPrice: 85.85,
          gmtoffset: 3600,
          fiftyTwoWeekHigh: 87.54,
          fiftyTwoWeekLow: 70.29,
        },
        timestamp: [1793865600, 1793952000],
        indicators: {
          quote: [
            {
              open: [86.6, 86.6],
              high: [87.5, 86.76],
              low: [86, 84.61],
              close: [87.23, 85.85],
              volume: [2000, 4852408],
            },
          ],
        },
      },
    ],
  },
};
const CHALLENGE =
  '<!DOCTYPE html><html><body><noscript>This site requires JavaScript</noscript></body></html>';
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

export function registerDynamicUiV2Tests(test: Register) {
  test('v2: every catalog type has a valid instance that validates in version 1 and 2', () => {
    for (const { type } of UI_COMPONENT_CATALOG) {
      assert.ok(Object.hasOwn(VALID, type), `missing valid example for ${type}`);
      for (const version of [1, 2]) {
        const result = validateDynamicUi(spec(VALID[type], { version }));
        assert.ok(result.ok, `${type}: ${result.ok ? '' : result.error}`);
      }
    }
    assert.equal(quizQuestionKind({ q: 'a', options: ['a', 'b'], answer: 0 }), 'choice');
    assert.equal(quizQuestionKind({ q: 'a', answer: 'x' }), 'text');
  });

  test('v2: limits and bad input are rejected with a reason', () => {
    for (const [name, root, extra] of INVALID) {
      const result = validateDynamicUi(spec(root, extra));
      assert.equal(result.ok, false, name);
      assert.ok(!result.ok && result.error.length > 0, name);
    }
    for (const version of [0, 3, '2'])
      assert.equal(validateDynamicUi(spec(text(), { version })).ok, false, `version ${version}`);
  });

  test('v2.1: custom tiles come from plum-widget blocks, stand alone or inside a view', () => {
    const code = '<div id="n">0</div>\n<script>\nn.textContent = plum.props.start;\n</script>';
    const answer =
      'Hier dein Zähler.\n\n```plum-widget counter title="Zähler" height=200\n' +
      code +
      '\n```\n\nViel Spass!\n```plum-ui\n' +
      JSON.stringify({
        version: 2,
        root: {
          type: 'stack',
          children: [
            {
              type: 'widget',
              id: 'counter',
              props: { start: 3 },
              live: { zrh: { type: 'weather', location: 'Zürich' } },
            },
            { type: 'text', text: 'Darunter' },
          ],
        },
        followups: ['Und rückwärts?'],
      }) +
      '\n```';
    const result = extractDynamicUi(answer, {});
    assert.equal(result.error, null);
    assert.equal(result.text, 'Hier dein Zähler.\n\nViel Spass!');
    const tile = (result.ui!.root as { children: Array<Record<string, unknown>> }).children[0]!;
    assert.equal(tile.html, code);
    assert.equal(tile.title, 'Zähler');
    assert.equal(tile.height, 200);
    assert.deepEqual(result.followups, ['Und rückwärts?']);
    // The tile's live input resolves like a weather widget with a namespaced id.
    const live = collectUiLiveNodes(result.ui);
    assert.deepEqual(
      live.map((node) => [node.id, node.type]),
      [['counter__zrh', 'weather']]
    );
    assert.equal(uiLiveKey(live[0]!), uiLiveKey({ type: 'weather', id: 'x', location: 'Zürich' }));

    // Without a view the tile stands alone; a view that ignores it gets it on top.
    const alone = extractDynamicUi('Bitte.\n```plum-widget\n<p>Hallo</p>\n```');
    assert.equal(alone.text, 'Bitte.');
    assert.equal(
      (alone.ui!.root as { children: Array<{ id: string }> }).children[0]!.id,
      'widget-1'
    );
    const loose = extractDynamicUi(
      'A\n```plum-widget w1\n<p>1</p>\n```\n```plum-ui\n{"version":2,"root":{"type":"text","text":"T"}}\n```'
    );
    const looseRoot = loose.ui!.root as { type: string; children: Array<{ type: string }> };
    assert.deepEqual(
      [looseRoot.type, looseRoot.children.map((child) => child.type)],
      ['stack', ['widget', 'text']]
    );

    // Streaming: an unfinished tile shows the placeholder and never leaks code into the text.
    const streaming = extractDynamicUi('Moment.\n```plum-widget clock\n<div>halb', {
      streaming: true,
    });
    assert.deepEqual([streaming.text, streaming.pending, streaming.ui], ['Moment.', true, null]);
    const cut = extractDynamicUi('Moment.\n```plum-widget clock\n<div>halb', { streaming: false });
    assert.equal(cut.text, 'Moment.');
    assert.match(cut.error ?? '', /nicht fertiggestellt/);

    // A patch keeps the code of a tile it re-places without a new block.
    const patched = extractDynamicUi(
      '```plum-ui\n' +
        JSON.stringify({
          version: 2,
          patch: [
            {
              op: 'replace',
              target: 'counter',
              node: { type: 'widget', id: 'counter', title: 'Neu' },
            },
          ],
        }) +
        '\n```',
      { base: result.ui }
    );
    const patchedTile = (patched.ui!.root as { children: Array<Record<string, unknown>> })
      .children[0]!;
    assert.deepEqual([patchedTile.title, patchedTile.html], ['Neu', code]);
    // New code for an existing tile replaces the old one.
    const replaced = extractDynamicUi(
      '```plum-widget counter\n<p>v2</p>\n```\n```plum-ui\n' +
        JSON.stringify({
          version: 2,
          patch: [{ op: 'replace', target: 'counter', node: { type: 'widget', id: 'counter' } }],
        }) +
        '\n```',
      { base: result.ui }
    );
    const replacedTile = (replaced.ui!.root as { children: Array<Record<string, unknown>> })
      .children[0]!;
    assert.equal(replacedTile.html, '<p>v2</p>');

    // A broken tile stays local: the rest of the view survives.
    const broken = extractDynamicUi(
      '```plum-ui\n{"version":2,"root":{"type":"stack","children":[{"type":"widget","id":"missing"},{"type":"text","text":"ok"}]}}\n```'
    );
    assert.ok(broken.ui);
    assert.match(broken.error ?? '', /Einige Teile/);
  });

  test('v2: inputs bound to an undeclared state get a neutral default instead of a rejected view', () => {
    const compare = {
      type: 'compare',
      bind: 'selectedBike',
      items: [
        { id: 'scott', title: 'Scott', values: { preis: 1999 } },
        { id: 'flyer', title: 'Flyer', values: { preis: 2999 } },
      ],
      specs: [{ key: 'preis', label: 'Preis', format: 'currency:CHF', better: 'lower' }],
    };
    const slider = { type: 'slider', bind: 'km', label: 'Distanz', min: 5, max: 40 };
    const answer =
      'Drei Modelle.\n```plum-ui\n' +
      JSON.stringify({ version: 2, root: { type: 'stack', children: [compare, slider] } }) +
      '\n```';
    const result = extractDynamicUi(answer, {});
    assert.equal(result.error, null);
    assert.ok(result.ui);
    assert.deepEqual(result.ui!.state, { selectedBike: null, km: 5 });
    // The repaired view also passes the strict validator the clients run.
    assert.ok(validateDynamicUi(result.ui).ok);
    // A declared state keeps its value.
    const kept = recoverDynamicUi({ version: 2, state: { km: 12 }, root: slider });
    assert.ok(kept.ok && kept.spec.state?.km === 12);
  });

  test('v2: component ids may use hyphens (DeepSeek writes eur-chf), state names may not', () => {
    const currency = { type: 'currency', id: 'eur-chf', from: 'EUR', to: 'CHF', amount: 100 };
    assert.ok(validateDynamicUi(spec(currency)).ok);
    const checklist = {
      type: 'checklist',
      id: 'zutaten-liste',
      items: [{ id: 'reis-1', label: 'Reis' }],
    };
    assert.ok(validateDynamicUi(spec(checklist)).ok);
    assert.equal(validateDynamicUi(spec(currency, { state: { 'eur-chf': 1 } })).ok, false);
    assert.equal(validateDynamicUi(spec({ ...currency, id: '1abc' })).ok, false);
  });

  test('v2: followups become chips, never part of the delivered view', () => {
    const only = extractDynamicUi(
      'Antwort.\n```plum-ui\n{"version":2,"followups":["Und morgen?","Wie warm wird es?"]}\n```'
    );
    assert.equal(only.ui, null);
    assert.equal(only.error, null);
    assert.deepEqual(only.followups, ['Und morgen?', 'Wie warm wird es?']);
    assert.equal(only.text, 'Antwort.');

    const full = extractDynamicUi(
      'A.\n```plum-ui\n' + JSON.stringify(spec(text(), { followups: ['Weiter?'] })) + '\n```'
    );
    assert.ok(full.ui);
    assert.equal('followups' in full.ui, false);
    assert.deepEqual(full.followups, ['Weiter?']);

    assert.deepEqual(
      sanitizeDynamicUiFollowups(['  Eins? ', 'Eins?', 7, long(81), '', 'Zwei?', 'Drei?', 'Vier?']),
      ['Eins?', 'Zwei?', 'Drei?']
    );
    const lenient = extractDynamicUi(
      'A.\n```plum-ui\n{"version":2,"followups":["a","b","c","d",' +
        JSON.stringify(long(90)) +
        ']}\n```'
    );
    assert.deepEqual(lenient.followups, ['a', 'b', 'c']);

    const streaming = extractDynamicUi('A.\n```plum-ui\n{"version":2,"followups":["Und morgen?"', {
      streaming: true,
    });
    assert.equal(streaming.pending, false, 'a chips-only block is no pending view');
    assert.equal(streaming.ui, null);
    assert.deepEqual(streaming.followups, []);
    const startingView = extractDynamicUi('A.\n```plum-ui\n{"version":2,"root":{"type":"stack"', {
      streaming: true,
    });
    assert.equal(startingView.pending, true);

    const brokenView = extractDynamicUi(
      'A.\n```plum-ui\n{"version":2,"root":{"type":"iframe"},"followups":["Trotzdem?"]}\n```'
    );
    assert.equal(brokenView.ui, null);
    assert.match(brokenView.error ?? '', /verworfen/);
    assert.deepEqual(brokenView.followups, ['Trotzdem?']);
  });

  test('v2: patches reach into tabs and accordion sections', () => {
    const base = {
      ...spec({
        type: 'stack',
        id: 'panel',
        children: [
          {
            type: 'tabs',
            id: 'tabs',
            tabs: [
              {
                id: 'overview',
                label: 'Überblick',
                children: [{ type: 'text', id: 'intro', text: 'Alt' }],
              },
              { id: 'specs', label: 'Daten', children: [] },
            ],
          },
          {
            type: 'accordion',
            id: 'faq',
            items: [
              { id: 'faq1', title: 'Eins', children: [text()] },
              { id: 'faq2', title: 'Zwei', children: [text()] },
            ],
          },
        ],
      }),
      viewId: 'view-a',
    } as DynamicUiSpec;
    assert.ok(validateDynamicUi(base).ok);
    const patched = applyDynamicUiPatch(base, {
      version: 2,
      patch: [
        { op: 'replace', target: 'intro', node: { type: 'text', text: 'Neu' } },
        {
          op: 'append',
          target: 'specs',
          node: { type: 'kpi', id: 'weight', label: 'Gewicht', value: '25' },
        },
        { op: 'append', target: 'tabs', node: { label: 'Preise', children: [text('CHF')] } },
        { op: 'append', target: 'faq', node: { title: 'Drei', children: [text()] } },
        { op: 'remove', target: 'faq1' },
        {
          op: 'replace',
          target: 'specs',
          node: {
            label: 'Technik',
            children: [{ type: 'kpi', id: 'weight', label: 'Gewicht', value: '24' }],
          },
        },
      ],
    });
    const result = validateDynamicUi(patched);
    assert.ok(result.ok, result.ok ? '' : result.error);
    const json = JSON.stringify(patched);
    assert.match(json, /"id":"intro","type":"text","text":"Neu"/);
    assert.match(json, /"id":"specs","label":"Technik"/);
    assert.match(json, /"label":"Preise"/);
    assert.doesNotMatch(json, /"faq1"/);
    assert.match(json, /"title":"Drei"/);
    assert.match(JSON.stringify(base), /Alt/, 'base history stays unchanged');
    assert.throws(() =>
      applyDynamicUiPatch(base, { version: 2, patch: [{ op: 'remove', target: 'missing' }] })
    );

    const viaAnswer = extractDynamicUi(
      'Ergänzt.\n```plum-ui\n' +
        JSON.stringify({
          version: 2,
          patch: [{ op: 'append', target: 'overview', node: text('Plus') }],
          followups: ['Und jetzt?'],
        }) +
        '\n```',
      { base, viewId: 'turn-2' }
    );
    assert.ok(viaAnswer.ui);
    assert.equal(viaAnswer.ui.viewId, 'view-a');
    assert.match(JSON.stringify(viaAnswer.ui), /Plus/);
    assert.deepEqual(viaAnswer.followups, ['Und jetzt?']);
  });

  test('v2: a broken child inside a tab stays local; streamed previews validate', () => {
    const recovered = recoverDynamicUi({
      version: 2,
      root: {
        type: 'tabs',
        tabs: [
          { label: 'A', children: [text('Bleibt'), { type: 'chart', kind: 'evil' }] },
          {
            label: 'B',
            children: [{ type: 'image', src: 'http://tracker.example/p.gif', alt: 'x' }],
          },
        ],
      },
    });
    assert.ok(recovered.ok);
    assert.equal(recovered.warnings.length, 2);
    assert.match(JSON.stringify(recovered.spec), /Bleibt/);
    assert.doesNotMatch(JSON.stringify(recovered.spec), /tracker|evil/);

    const numeric = recoverDynamicUi({
      version: 2,
      root: { type: 'progress', value: 40, max: 80 },
    });
    assert.ok(numeric.ok, 'numeric formulas are normalised to strings');

    const full = JSON.stringify(
      spec(
        { type: 'stack', children: [VALID.tabs, VALID.checklist, VALID.weather, VALID.quiz] },
        { followups: ['Weiter?'] }
      )
    );
    let previews = 0;
    for (let n = 0; n < full.length; n += 3) {
      const result = extractDynamicUi('A.\n```plum-ui\n' + full.slice(0, n), { streaming: true });
      assert.equal(result.error, null);
      if (result.ui) {
        assert.ok(validateDynamicUi(result.ui).ok);
        previews++;
      }
    }
    assert.ok(previews > 10);
    assert.equal(dynamicUiBlockComplete('A.\n```plum-ui\n' + full), false);
    assert.equal(dynamicUiBlockComplete('A.\n```plum-ui\n' + full + '\n```'), true);
  });

  test('v2: live nodes, keys, links and formatting helpers', () => {
    const view = validateDynamicUi(
      spec({
        type: 'tabs',
        tabs: [
          { label: 'A', children: [VALID.weather] },
          { label: 'B', children: [VALID.stock, VALID.currency] },
        ],
      })
    );
    assert.ok(view.ok);
    assert.deepEqual(
      collectUiLiveNodes(view.spec).map((node) => node.id),
      ['weather', 'nesn', 'fx']
    );
    assert.equal(
      uiLiveKey({ type: 'weather', id: 'a', location: '  zürich,  Schweiz ' }),
      uiLiveKey({ type: 'weather', id: 'b', location: 'Zürich, Schweiz', days: 7 })
    );
    assert.notEqual(
      uiLiveKey({ type: 'stock', id: 'a', symbol: 'AAPL' }),
      uiLiveKey({ type: 'stock', id: 'a', symbol: 'AAPL', range: '5Y' })
    );
    assert.equal(parseUiEntityHref('entity:Albert_Einstein'), 'Albert Einstein');
    assert.equal(parseUiEntityHref('https://example.com'), null);
    assert.equal(
      uiImageProxyUrl('https://a.example/b c.png'),
      '/api/assistant/ui/image?url=https%3A%2F%2Fa.example%2Fb%20c.png'
    );
    assert.equal(
      uiResultRefreshPath('c1', 't1', 'w1'),
      '/api/assistant/chats/c1/turns/t1/ui/w1/refresh'
    );
    assert.equal(formatUiChange(-1.38, -1.582), '−1.38 (−1.6 %)');
    assert.equal(formatUiChange(2, 1.25), '+2.00 (+1.3 %)');
    assert.match(formatUiPrice(85.85, 'CHF'), /^CHF\s85\.85$/);
    assert.equal(formatUiTemperature(-3.6), '−4 °C');
    assert.equal(formatUiTemperature(-0.4), '0 °C');
    assert.equal(formatUiTemperature(20, 'f'), '68 °F');
    assert.deepEqual(uiWeatherCode(0, false), { description: 'Klar', icon: 'clear-night' });
    assert.equal(uiWeatherCode(95).icon, 'thunderstorm');
    assert.equal(stooqSymbol('AAPL'), 'aapl.us');
    assert.equal(stooqSymbol('NESN.SW'), 'nesn.ch');
    assert.equal(stooqSymbol('SAP.DE'), 'sap.de');
    assert.equal(stooqSymbol('VOD.L'), 'vod.uk');
    assert.equal(stooqSymbol('^GSPC'), '^spx');
    assert.equal(stooqSymbol('nesn.ch'), 'nesn.ch');
    assert.equal(yahooSymbol('nesn.ch'), 'NESN.SW');
    assert.equal(yahooSymbol('AAPL'), 'AAPL');
  });

  test('v2: weather resolves through geocoding and forecast with German labels', async () => {
    const { fetch, calls } = fakeFetch([
      [/geocoding-api\.open-meteo\.com/, () => json(GEO)],
      [/api\.open-meteo\.com\/v1\/forecast/, () => json(FORECAST)],
    ]);
    const live = createUiLiveResolver({ fetch, now: () => NOW });
    const result = await live.resolve({
      type: 'weather',
      id: 'w',
      location: 'Zürich, Schweiz',
      days: 3,
    });
    assert.equal(result.status, 'resolved');
    assert.ok(result.type === 'weather' && result.data);
    const data = result.data;
    assert.equal(data.location.label, 'Zürich, Schweiz');
    assert.equal(data.location.country_code, 'CH');
    assert.match(calls[1]!, /latitude=47\.37/);
    assert.equal(data.current.description, 'Leichter Regen');
    assert.equal(data.current.icon, 'rain');
    assert.equal(data.current.temperature_text, '8 °C');
    assert.equal(data.current.feels_like_text, 'Gefühlt 7 °C');
    assert.equal(data.current.wind_text, '3 km/h S');
    assert.equal(data.hourly.length, 24);
    assert.equal(data.hourly[0]!.label, 'Jetzt');
    assert.equal(data.hourly[1]!.label, '05 Uhr');
    assert.equal(data.hourly[0]!.precip_chance, 50);
    assert.deepEqual(
      data.daily.map((day) => day.label),
      ['Heute', 'Morgen', 'Mo']
    );
    assert.equal(data.daily[1]!.icon, 'fog');
    assert.equal(data.daily[0]!.sunrise, '07:21');
    assert.equal(data.daily[2]!.date_text, '9. Nov.');

    const again = await live.resolve({
      type: 'weather',
      id: 'other',
      location: 'zürich, schweiz',
      days: 3,
    });
    assert.equal(calls.length, 2, 'second resolve comes from the cache');
    assert.equal(again.status, 'resolved');

    const missing = createUiLiveResolver({
      fetch: fakeFetch([[/geocoding/, () => json({})]]).fetch,
      now: () => NOW,
    });
    const failed = await missing.resolve({ type: 'weather', id: 'w', location: 'Atlantis' });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.retryable, false);
    assert.match(failed.error ?? '', /Atlantis/);
  });

  test('v2: currency and stock resolve with pre-formatted text and fallbacks', async () => {
    const fx = fakeFetch([
      [/frankfurter\.dev\/v1\/latest/, () => json({ date: '2026-11-06', rates: { CHF: 0.9143 } })],
      [
        /frankfurter\.dev\/v1\/2026-10-08\.\./,
        () => json({ rates: { '2026-11-06': { CHF: 0.9143 }, '2026-10-08': { CHF: 0.9326 } } }),
      ],
    ]);
    const currency = await createUiLiveResolver({ fetch: fx.fetch, now: () => NOW }).resolve({
      type: 'currency',
      id: 'fx',
      from: 'EUR',
      to: 'CHF',
      amount: 100,
    });
    assert.ok(currency.type === 'currency' && currency.data, currency.error);
    assert.equal(currency.data.converted_text.replace(/\s/g, ' '), 'CHF 91.43');
    assert.equal(currency.data.rate_text, '1 EUR = 0.9143 CHF');
    assert.equal(currency.data.change_tone, 'negative');
    assert.deepEqual(
      currency.data.series.map((point) => point.date),
      ['2026-10-08', '2026-11-06']
    );
    const unknown = await createUiLiveResolver({
      fetch: fakeFetch([[/frankfurter/, () => json({ message: 'not found' }, 404)]]).fetch,
      now: () => NOW,
    }).resolve({ type: 'currency', id: 'fx', from: 'XAU', to: 'CHF' });
    assert.equal(unknown.status, 'failed');
    assert.equal(unknown.retryable, false);

    const stooq = fakeFetch([
      [/stooq\.com\/q\/d\/l\//, () => new Response(STOOQ_CSV, { status: 200 })],
    ]);
    const fromStooq = await createUiLiveResolver({ fetch: stooq.fetch, now: () => NOW }).resolve({
      type: 'stock',
      id: 's',
      symbol: 'NESN.SW',
    });
    assert.ok(fromStooq.type === 'stock' && fromStooq.data, fromStooq.error);
    assert.match(stooq.calls[0]!, /s=nesn\.ch/);
    assert.equal(fromStooq.data.source.name, 'Stooq');
    assert.equal(fromStooq.data.currency, 'CHF');
    assert.equal(fromStooq.data.price, 85.85);
    assert.equal(fromStooq.data.change_text, '−1.38 (−1.6 %)');
    assert.equal(fromStooq.data.change_tone, 'negative');
    assert.match(fromStooq.data.trade_date_text, /^Schlusskurs vom 6\. Nov\. 2026$/);
    assert.equal(fromStooq.data.ranges['1M'].points.length, 3);
    assert.equal(fromStooq.data.default_range, '1M');
    assert.equal(fromStooq.data.metrics.find((m) => m.key === 'previous_close')?.value, 87.23);

    const blocked = fakeFetch([
      [
        /stooq\.com/,
        () => new Response(CHALLENGE, { status: 200, headers: { 'content-type': 'text/html' } }),
      ],
      [/query1\.finance\.yahoo\.com\/v8\/finance\/chart\/NESN\.SW/, () => json(YAHOO)],
    ]);
    const viaYahoo = await createUiLiveResolver({
      fetch: blocked.fetch,
      now: () => NOW,
      stockFallback: () => true,
    }).resolve({ type: 'stock', id: 's', symbol: 'NESN.SW', range: '1Y' });
    assert.ok(viaYahoo.type === 'stock' && viaYahoo.data, viaYahoo.error);
    assert.equal(viaYahoo.data.source.name, 'Yahoo Finance');
    assert.equal(viaYahoo.data.name, 'Nestlé S.A.');
    assert.equal(viaYahoo.data.default_range, '1Y');
    assert.equal(viaYahoo.data.metrics.find((m) => m.key === 'year_high')?.value, 87.54);

    const noFallback = fakeFetch([[/stooq\.com/, () => new Response(CHALLENGE, { status: 200 })]]);
    const refused = await createUiLiveResolver({
      fetch: noFallback.fetch,
      now: () => NOW,
      stockFallback: () => false,
    }).resolve({ type: 'stock', id: 's', symbol: 'AAPL' });
    assert.equal(refused.status, 'failed');
    assert.equal(refused.retryable, true);
    assert.equal(noFallback.calls.length, 1, 'no Yahoo request when the fallback is off');
  });

  test('v2: entity, news and gallery resolve; private links and hosts are dropped', async () => {
    const wiki = fakeFetch([
      [
        /^https:\/\/de\.wikipedia\.org\//,
        () => json({ type: 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found' }, 404),
      ],
      [
        /^https:\/\/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\/Ada_Lovelace/,
        () =>
          json({
            type: 'standard',
            title: 'Ada Lovelace',
            titles: { canonical: 'Ada_Lovelace', normalized: 'Ada Lovelace' },
            description: 'English mathematician',
            extract: '<b>Augusta Ada King</b> was an English mathematician.',
            content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ada_Lovelace' } },
            thumbnail: { source: 'https://upload.wikimedia.org/ada.jpg', width: 320, height: 400 },
          }),
      ],
    ]);
    const entity = await createUiLiveResolver({ fetch: wiki.fetch, now: () => NOW }).resolve({
      type: 'entity',
      id: 'e',
      title: 'Ada Lovelace',
    });
    assert.ok(entity.type === 'entity' && entity.data, entity.error);
    assert.equal(entity.data.lang, 'en', 'German 404 falls back to English');
    assert.equal(entity.data.extract, 'Augusta Ada King was an English mathematician.');
    assert.equal(entity.data.image?.src, 'https://upload.wikimedia.org/ada.jpg');
    assert.match(
      wiki.calls[0]!,
      /^https:\/\/de\.wikipedia\.org\/api\/rest_v1\/page\/summary\/Ada_Lovelace/
    );

    const moved = createUiLiveResolver({
      fetch: async () => {
        const response = json({ title: 'X' });
        Object.defineProperty(response, 'url', { value: 'https://evil.example/x' });
        return response;
      },
      now: () => NOW,
    });
    assert.equal((await moved.resolve({ type: 'entity', id: 'e', title: 'X' })).status, 'failed');

    const searx = fakeFetch([
      [
        /categories=news/,
        () =>
          json({
            results: [
              { title: 'Intern', url: 'http://192.168.1.10/news' },
              { title: 'Lokal', url: 'https://10.0.0.1/x' },
              {
                title: '<b>Nestlé</b> wächst',
                url: 'https://www.srf.ch/a',
                publishedDate: '2026-11-07T09:00:00',
                content: 'Text',
                thumbnail: '//img.srf.ch/a.jpg',
              },
              { title: 'Doppelt', url: 'https://www.srf.ch/a' },
              {
                title: 'Gestern',
                url: 'https://nzz.ch/b',
                publishedDate: '2026-11-06T06:00:00Z',
                img_src: 'http://insecure.example/a.jpg',
              },
            ],
          }),
      ],
      [
        /categories=images/,
        () =>
          json({
            results: [
              {
                title: 'Matterhorn',
                url: 'https://www.myswitzerland.com/x',
                img_src: 'https://www.myswitzerland.com/a.jpg',
                thumbnail_src: 'https://ts3.mm.bing.net/th?id=1',
                resolution: '1348×899',
              },
              { title: 'Privat', url: 'https://127.0.0.1/', img_src: 'https://example.com/b.jpg' },
              {
                title: 'Ohne Bild',
                url: 'https://example.com/c',
                img_src: 'data:image/png;base64,AAAA',
              },
            ],
          }),
      ],
    ]);
    const live = createUiLiveResolver({
      fetch: searx.fetch,
      now: () => NOW,
      searxngUrl: () => 'http://searxng.test:8080',
    });
    const news = await live.resolve({ type: 'news', id: 'n', query: 'Nestlé' });
    assert.ok(news.type === 'news' && news.data, news.error);
    assert.deepEqual(
      news.data.articles.map((a) => a.title),
      ['Nestlé wächst', 'Gestern']
    );
    assert.equal(news.data.articles[0]!.source, 'srf.ch');
    assert.equal(news.data.articles[0]!.image, 'https://img.srf.ch/a.jpg');
    assert.equal(news.data.articles[1]!.image, null);
    assert.equal(news.data.articles[1]!.date_text, 'gestern');
    assert.match(
      searx.calls[0]!,
      /^http:\/\/searxng\.test:8080\/search\?q=Nestl%C3%A9&format=json&categories=news$/
    );
    const gallery = await live.resolve({ type: 'gallery', id: 'g', query: 'Matterhorn' });
    assert.ok(gallery.type === 'gallery' && gallery.data, gallery.error);
    assert.equal(gallery.data.images.length, 1);
    assert.deepEqual([gallery.data.images[0]!.width, gallery.data.images[0]!.height], [1348, 899]);

    const unconfigured = await createUiLiveResolver({ searxngUrl: () => undefined }).resolve({
      type: 'news',
      id: 'n',
      query: 'x',
    });
    assert.equal(unconfigured.status, 'failed');
    assert.equal(unconfigured.retryable, false);
  });

  test('v2: slow sources time out, refreshes respect the cooldown, requests de-duplicate', async () => {
    const slow = createUiLiveResolver({
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_, reject) =>
          init.signal.addEventListener('abort', () => reject(init.signal.reason))
        ),
    });
    // AbortSignal.timeout does not keep the process alive; the server does, this script must.
    const alive = setInterval(() => {}, 1000);
    const timedOut = await slow
      .resolve({ type: 'entity', id: 'e', title: 'Langsam' })
      .finally(() => clearInterval(alive));
    assert.equal(timedOut.status, 'failed');
    assert.equal(timedOut.retryable, true);
    assert.match(timedOut.error ?? '', /antwortet gerade nicht/);

    let clock = NOW.getTime();
    const { fetch, calls } = fakeFetch([
      [/frankfurter/, () => json({ date: '2026-11-06', rates: { CHF: 0.9 } })],
    ]);
    const live = createUiLiveResolver({ fetch, now: () => new Date(clock) });
    const node: UiLiveNode = { type: 'currency', id: 'fx', from: 'EUR', to: 'CHF' };
    await Promise.all([live.resolve(node), live.resolve(node)]);
    assert.equal(calls.length, 2, 'latest + history once for two concurrent widgets');
    await live.resolve(node, { force: true });
    assert.equal(calls.length, 2, 'a refresh within 30 s reuses the result');
    clock += 31_000;
    await live.resolve(node, { force: true });
    assert.equal(calls.length, 4, 'a later refresh fetches again');
  });

  test('v2: turns store each widget result, push socket events and derive pending/failed', async () => {
    const { fetch } = fakeFetch([
      [/frankfurter/, () => json({ date: '2026-11-06', rates: { CHF: 0.9 } })],
      [/wikipedia/, () => json({}, 404)],
    ]);
    const resolver = createUiLiveResolver({ fetch, now: () => NOW });
    const writes: Array<[string, string, string, AnyUiResult]> = [];
    const events: Array<[string, UiResultEvent]> = [];
    const store: UiResultStore = {
      write: async (chatId, turnId, id, result) => {
        writes.push([chatId, turnId, id, result]);
        return true;
      },
      emit: (userId, event) => events.push([userId, event]),
    };
    const view = validateDynamicUi(
      spec({
        type: 'stack',
        children: [VALID.currency, { type: 'entity', id: 'nobody', title: 'Niemand' }],
      })
    );
    assert.ok(view.ok);
    const results = await startTurnUiResolution(
      { userId: 'u1', chatId: 'c1', turnId: 't1' },
      view.spec,
      { resolver, store }
    );
    assert.deepEqual(
      results.map((r) => r.status),
      ['resolved', 'failed']
    );
    assert.deepEqual(
      events.slice(0, 2).map(([, e]) => e.result.status),
      ['pending', 'pending']
    );
    assert.deepEqual(
      events
        .slice(2)
        .map(([user, e]) => [user, e.chatId, e.turnId, e.result.status])
        .sort(),
      [
        ['u1', 'c1', 't1', 'failed'],
        ['u1', 'c1', 't1', 'resolved'],
      ]
    );
    assert.deepEqual(writes.map(([, , id]) => id).sort(), ['fx', 'nobody']);

    const stored = Object.fromEntries(writes.map(([, , id, result]) => [id, result]));
    const old = { id: 't1', status: 'completed', updatedAt: '2026-11-01T00:00:00Z' };
    const delivered = turnUiResults(view.spec, stored, old);
    assert.equal(delivered.fx?.status, 'resolved');
    assert.equal(delivered.nobody?.status, 'failed');
    const changed = validateDynamicUi(spec({ ...(VALID.currency as object), amount: 5 }));
    assert.ok(changed.ok);
    assert.equal(
      turnUiResults(changed.spec, stored, old).fx?.status,
      'failed',
      'stale parameters are not shown'
    );
    assert.equal(
      turnUiResults(changed.spec, stored, { ...old, status: 'running' }).fx?.status,
      'pending'
    );
    assert.equal(
      turnUiResults(changed.spec, {}, { ...old, updatedAt: new Date().toISOString() }).fx?.status,
      'pending'
    );
    assert.deepEqual(turnUiResults(null, stored, old), {});
  });

  test('v2: image proxy refuses non-public, non-https and non-image targets', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plum-ui-image-'));
    try {
      const requests: string[] = [];
      let reply: (
        url: URL
      ) => { redirect: string } | { image: { bytes: Buffer; mimeType: string } } = () => ({
        image: { bytes: PNG, mimeType: 'image/png' },
      });
      const proxy = createUiImageProxy({
        cacheDir: async () => dir,
        resolve: async () => ({ address: '93.184.216.34', family: 4 }),
        request: async (url) => {
          requests.push(url.href);
          return reply(url);
        },
      });
      for (const bad of [
        'http://example.com/a.png',
        'https://127.0.0.1/a.png',
        'https://10.1.2.3/a.png',
        'https://169.254.169.254/latest/meta-data',
        'https://[::1]/a.png',
        'https://[::ffff:127.0.0.1]/a.png',
        'https://localhost/a.png',
        'https://intranet/a.png',
        'https://user:pw@example.com/a.png',
        'https://example.com:8443/a.png',
        'file:///etc/passwd',
      ])
        await assert.rejects(
          proxy.load(bad),
          (error: { statusCode?: number }) => error.statusCode === 400,
          bad
        );
      assert.equal(requests.length, 0, 'refused addresses never reach the network');

      reply = (url) =>
        url.hostname === 'cdn.example.com'
          ? { redirect: 'https://127.0.0.1/a.png' }
          : { image: { bytes: PNG, mimeType: 'image/png' } };
      await assert.rejects(
        proxy.load('https://cdn.example.com/a.png'),
        (error: { statusCode?: number }) => error.statusCode === 400
      );

      reply = (url) => ({ redirect: `https://hop.example.com/${url.pathname.length}` });
      await assert.rejects(proxy.load('https://loop.example.com/a.png'), /Weiterleitungen/);

      reply = () => ({
        image: {
          bytes: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
          ),
          mimeType: 'image/png',
        },
      });
      await assert.rejects(
        proxy.load('https://example.com/fake.png'),
        (error: { statusCode?: number }) => error.statusCode === 415
      );
      assert.equal(sniffImageType(PNG), 'image/png');
      assert.equal(sniffImageType(Buffer.from('<html><body>hello world</body></html>')), null);

      reply = () => ({ image: { bytes: PNG, mimeType: 'image/png' } });
      const before = requests.length;
      const image = await proxy.load('https://images.example.com/ok.png');
      assert.equal(image.mimeType, 'image/png');
      const cached = await proxy.load('https://images.example.com/ok.png');
      assert.equal(cached.bytes.length, PNG.length);
      assert.equal(requests.length, before + 1, 'second load is served from the disk cache');

      // DNS answers are checked too: a public-looking host resolving to a private address is refused.
      const lookup = dns.promises.lookup;
      (dns.promises as { lookup: unknown }).lookup = async () => [
        { address: '192.168.1.20', family: 4 },
      ];
      try {
        const real = createUiImageProxy({
          cacheDir: async () => dir,
          request: async () => {
            throw new Error('must not connect');
          },
        });
        await assert.rejects(
          real.load('https://rebind.example.com/a.png'),
          (error: { statusCode?: number }) => error.statusCode === 400
        );
      } finally {
        (dns.promises as { lookup: unknown }).lookup = lookup;
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('v2: prompt covers every component, action and live widget within budget', () => {
    for (const type of [...UI_LIVE_NODE_TYPES, ...UI_ACTION_TYPES])
      assert.ok(DYNAMIC_UI_INSTRUCTIONS.includes(`"${type}"`), type);
    assert.match(DYNAMIC_UI_INSTRUCTIONS, /Never type temperatures, prices or rates/);
    assert.match(DYNAMIC_UI_INSTRUCTIONS, /entity:Ada_Lovelace/);
    assert.ok(
      // About 4.3k tokens with custom tiles; it sits in the cached system prefix.
      DYNAMIC_UI_INSTRUCTIONS.length < 16500,
      `prompt has ${DYNAMIC_UI_INSTRUCTIONS.length} characters`
    );
    assert.ok(DYNAMIC_UI_SIMPLE_INSTRUCTIONS.length < 800);
    assert.equal(dynamicUiInstructions('simple'), DYNAMIC_UI_SIMPLE_INSTRUCTIONS);
    assert.equal(dynamicUiInstructions('standard'), DYNAMIC_UI_INSTRUCTIONS);
    for (const { type } of UI_COMPONENT_CATALOG)
      if (!['tabs', 'accordion'].includes(type))
        assert.doesNotMatch(DYNAMIC_UI_SIMPLE_INSTRUCTIONS, new RegExp(`"type":"${type}"`));
  });
}
