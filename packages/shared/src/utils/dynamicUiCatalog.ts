/**
 * Single source for allowed components, required fields and model signatures.
 * The model instructions (backend dynamicUiPrompt.ts) and Android's generated
 * DynamicUiCatalog.kt (scripts/generate-dynamic-ui-catalog.mjs) derive from it.
 *
 * `group` orders the prompt; `live` marks widgets whose data the server fills
 * (dynamicUiLive.ts) — the model only names their parameters.
 */
export const UI_COMPONENT_CATALOG = [
  // Layout
  {
    type: 'stack',
    group: 'layout',
    required: ['children'],
    signature: '{"type":"stack","gap"?:"sm|md|lg","children":[..]}',
  },
  {
    type: 'row',
    group: 'layout',
    required: ['children'],
    signature: '{"type":"row","children":[..]}',
  },
  {
    type: 'grid',
    group: 'layout',
    required: ['columns', 'children'],
    signature: '{"type":"grid","columns":1-4,"children":[..]}',
  },
  {
    type: 'card',
    group: 'layout',
    required: ['children'],
    signature:
      '{"type":"card","title"?,"subtitle"?,"highlight"?:"formula","image"?:Image,"expandable"?:bool,"actions"?:[{"label","action":Action}] (max 2),"children":[..]}',
  },
  {
    type: 'tabs',
    group: 'layout',
    required: ['tabs'],
    signature:
      '{"type":"tabs","bind"?:"number state = active index","tabs":[{"label","children":[..]}] (2-6)}',
  },
  {
    type: 'accordion',
    group: 'layout',
    required: ['items'],
    signature: '{"type":"accordion","items":[{"title","open"?:bool,"children":[..]}] (1-12)}',
  },
  {
    type: 'calculator',
    group: 'layout',
    required: ['inputs', 'outputs'],
    signature:
      '{"type":"calculator","title"?,"inputs":[inputs],"outputs":[kpis/text],"chart"?:chart}',
  },
  // Content
  {
    type: 'heading',
    group: 'content',
    required: ['text'],
    signature: '{"type":"heading","text","level"?:2|3}',
  },
  {
    type: 'text',
    group: 'content',
    required: ['text'],
    signature: '{"type":"text","text","tone"?:"default|muted|strong"}',
  },
  {
    type: 'markdown',
    group: 'content',
    required: ['text'],
    signature: '{"type":"markdown","text"}',
  },
  {
    type: 'badge',
    group: 'content',
    required: ['text'],
    signature: '{"type":"badge","text","tone"?:"neutral|success|warning|danger|accent"}',
  },
  {
    type: 'divider',
    group: 'content',
    required: [],
    signature: '{"type":"divider"}',
  },
  {
    type: 'callout',
    group: 'content',
    required: ['tone', 'text'],
    signature: '{"type":"callout","tone":"info|success|warning|danger|tip","title"?,"text"}',
  },
  {
    type: 'list',
    group: 'content',
    required: ['items'],
    signature:
      '{"type":"list","items":[{"title","subtitle"?,"trailing"?,"icon"?:Icon,"image"?:Image,"action"?:Action}] (1-30)}',
  },
  {
    type: 'timeline',
    group: 'content',
    required: ['items'],
    signature:
      '{"type":"timeline","items":[{"time"?,"title","text"?,"status"?:"done|current|upcoming"}] (1-20)}',
  },
  {
    type: 'carousel',
    group: 'content',
    required: ['items'],
    signature:
      '{"type":"carousel","aspect"?:Aspect,"items":[{"title","subtitle"?,"meta"?:[max 3 short texts],"badge"?,"image"?:Image,"action"?:Action}] (2-10)}',
  },
  {
    type: 'image',
    group: 'content',
    required: ['src', 'alt'],
    signature: '{"type":"image","src":"https URL","alt","caption"?,"aspect"?:Aspect}',
  },
  {
    type: 'rating',
    group: 'content',
    required: ['value'],
    signature: '{"type":"rating","value":0-5 (half steps),"count"?:number,"label"?}',
  },
  {
    type: 'progress',
    group: 'content',
    required: ['value'],
    signature:
      '{"type":"progress","value":"formula","max"?:"formula (default 100)","label"?,"format"?,"kind"?:"bar|ring"}',
  },
  {
    type: 'code',
    group: 'content',
    required: ['language', 'code'],
    signature: '{"type":"code","language","code","title"?}',
  },
  {
    type: 'math',
    group: 'content',
    required: ['tex'],
    signature: '{"type":"math","tex":"LaTeX","display"?:bool}',
  },
  // Data
  {
    type: 'kpi',
    group: 'data',
    required: ['label', 'value'],
    signature:
      '{"type":"kpi","label","value":"formula","format"?,"hint"?,"trend"?:"formula (positive = up)","delta"?:"formula","deltaFormat"?,"spark"?:"viewName","sparkKey"?:"field"}',
  },
  {
    type: 'table',
    group: 'data',
    required: ['data', 'columns'],
    signature:
      '{"type":"table","data":"viewName" or [rows],"columns":[{"key","label","format"?,"align"?}],"highlight"?:"formula over row","sortable"?:bool}',
  },
  {
    type: 'chart',
    group: 'data',
    required: ['kind', 'data', 'x', 'series'],
    signature:
      '{"type":"chart","kind":"bar|line|area|pie|scatter","data":"viewName" or [rows],"x":"field","series":[{"key","label"}] (1-6),"format"?,"height"?:120-480,"stacked"?,"ranges"?:[{"label","value"}],"rangeBind"?:"state set by the range segment"}',
  },
  {
    type: 'compare',
    group: 'data',
    required: ['items', 'specs'],
    signature:
      '{"type":"compare","bind"?:"stateName holding the chosen id","items":[{"id","title","subtitle"?,"badge"?,"values":{field:value}}],"specs":[{"key","label","format"?,"better"?:"higher|lower"}]}',
  },
  // Inputs
  {
    type: 'slider',
    group: 'input',
    required: ['bind', 'label', 'min', 'max'],
    signature: '{"type":"slider","bind","label","min","max","step"?,"format"?}',
  },
  {
    type: 'stepper',
    group: 'input',
    required: ['bind', 'label'],
    signature: '{"type":"stepper","bind":"number state","label","min"?,"max"?,"step"?,"format"?}',
  },
  {
    type: 'input',
    group: 'input',
    required: ['bind', 'label'],
    signature: '{"type":"input","bind","label","kind"?:"number|text","min"?,"max"?,"step"?}',
  },
  {
    type: 'textarea',
    group: 'input',
    required: ['bind', 'label'],
    signature: '{"type":"textarea","bind":"text state","label","rows"?:2-8,"placeholder"?}',
  },
  {
    type: 'date',
    group: 'input',
    required: ['bind', 'label'],
    signature:
      '{"type":"date","bind":"text state (YYYY-MM-DD)","label","min"?:"YYYY-MM-DD","max"?}',
  },
  {
    type: 'select',
    group: 'input',
    required: ['bind', 'label', 'options'],
    signature: '{"type":"select","bind","label","options":[{"value","label"}]}',
  },
  {
    type: 'segmented',
    group: 'input',
    required: ['bind', 'label', 'options'],
    signature: '{"type":"segmented",...same as select}',
  },
  {
    type: 'radio',
    group: 'input',
    required: ['bind', 'label', 'options'],
    signature: '{"type":"radio",...same as select (vertical)}',
  },
  {
    type: 'checkbox',
    group: 'input',
    required: ['bind', 'label'],
    signature: '{"type":"checkbox","bind","label"}',
  },
  {
    type: 'button',
    group: 'input',
    required: ['label', 'action'],
    signature: '{"type":"button","label","variant"?:"primary|secondary","action":Action}',
  },
  {
    type: 'form',
    group: 'input',
    required: ['children', 'submit'],
    signature:
      '{"type":"form","title"?,"children":[inputs..],"submit":{"label","message":"sent as the user\'s next message, use {{state}}"}}',
  },
  // Learning and plans
  {
    type: 'checklist',
    group: 'learning',
    required: ['id', 'items'],
    signature:
      '{"type":"checklist","id","title"?,"items":[{"id","label","detail"?}] (1-40),"copyable"?:bool}',
  },
  {
    type: 'quiz',
    group: 'learning',
    required: ['id', 'questions'],
    signature:
      '{"type":"quiz","id","title"?,"questions":[{"q","kind"?:"choice|text","options"?:[2-6 texts],"answer":option index or "text","hint"?,"explanation"?}] (1-20)}',
  },
  {
    type: 'flashcards',
    group: 'learning',
    required: ['id', 'cards'],
    signature: '{"type":"flashcards","id","cards":[{"front","back"}] (1-50)}',
  },
  // Live widgets: the server fetches the data
  {
    type: 'weather',
    group: 'live',
    required: ['id', 'location'],
    signature: '{"type":"weather","id","location":"place, optional country","days"?:1-10}',
  },
  {
    type: 'currency',
    group: 'live',
    required: ['id', 'from', 'to'],
    signature: '{"type":"currency","id","from":"ISO code","to":"ISO code","amount"?:number}',
  },
  {
    type: 'stock',
    group: 'live',
    required: ['id', 'symbol'],
    signature:
      '{"type":"stock","id","symbol":"ticker like AAPL, NESN.SW, SAP.DE","range"?:"1M|6M|1Y|5Y"}',
  },
  {
    type: 'entity',
    group: 'live',
    required: ['id', 'title'],
    signature: '{"type":"entity","id","title":"exact Wikipedia article title","lang"?:"de|en|.."}',
  },
  {
    type: 'news',
    group: 'live',
    required: ['id', 'query'],
    signature: '{"type":"news","id","query"}',
  },
  {
    type: 'gallery',
    group: 'live',
    required: ['id', 'query'],
    signature: '{"type":"gallery","id","query"}',
  },
  // Custom tiles: the model's own HTML/CSS/JS, run in a sandbox
  {
    type: 'widget',
    group: 'custom',
    required: ['id', 'html'],
    signature:
      '{"type":"widget","id","title"?,"height"?:80-1200 (fixed; default grows with content),"props"?:{JSON for plum.props},"live"?:{"name":{"type":"weather|currency|stock|entity|news|gallery",…same parameters as that widget}} (max 4),"state"?:{initial plum.state}} with its code in a ```plum-widget <id> block',
  },
] as const;

export type UiCatalogGroup = (typeof UI_COMPONENT_CATALOG)[number]['group'];

/** Live widgets (catalog group `live`); `id` is required and keys `uiResults`. */
export const UI_LIVE_NODE_TYPES = [
  'weather',
  'currency',
  'stock',
  'entity',
  'news',
  'gallery',
] as const;
export type UiLiveNodeType = (typeof UI_LIVE_NODE_TYPES)[number];

/** Every action a button, card action, list/carousel item or form may trigger. */
export const UI_ACTION_TYPES = [
  'sendMessage',
  'set',
  'reset',
  'copy',
  'openUrl',
  'prefill',
  'openEntity',
] as const;

/**
 * Icon keys for `list` items. Renderers map them to their icon set (WebUI
 * lucide, Android Material); a single emoji is accepted as well.
 */
export const UI_ICON_NAMES = [
  'check',
  'info',
  'warning',
  'star',
  'heart',
  'clock',
  'calendar',
  'location',
  'phone',
  'mail',
  'link',
  'user',
  'users',
  'home',
  'work',
  'car',
  'train',
  'plane',
  'bike',
  'walk',
  'food',
  'coffee',
  'shopping',
  'money',
  'chart',
  'book',
  'school',
  'code',
  'tool',
  'idea',
  'sun',
  'cloud',
  'rain',
  'snow',
  'leaf',
  'fire',
  'gift',
  'music',
  'camera',
  'globe',
  'lock',
  'settings',
  'health',
  'sport',
] as const;
export type UiIconName = (typeof UI_ICON_NAMES)[number];

/** Shared shapes referenced by several signatures, spelled out once in the prompt. */
export const UI_SIGNATURE_TERMS = {
  Image: '{"src":"https URL","alt"}',
  Aspect: '"16:9|4:3|1:1|3:4"',
  Icon: UI_ICON_NAMES.join('|') + ' or one emoji',
  Action:
    '{"type":"sendMessage","text":"follow-up, may use {{values}}"} | {"type":"prefill","text"} (fills the composer) | {"type":"copy","text"} | {"type":"openUrl","url":"https://…"} | {"type":"openEntity","title":"Wikipedia title"} | {"type":"set","key":"stateName","value":"formula"} | {"type":"reset"}',
} as const;

const GROUP_LABELS: Record<UiCatalogGroup, string> = {
  layout: 'Layout',
  content: 'Content',
  data: 'Data (formulas over state/views)',
  input: 'Inputs (bind to state)',
  learning: 'Learning and plans (state survives reloads)',
  live: 'Live widgets (the server fetches real data; you give only parameters, never the numbers)',
  custom: 'Custom tile (your own code, see Custom tiles below)',
};

/** All signatures, grouped, for the model instructions. */
export const dynamicUiComponentInstructions = () =>
  (Object.keys(GROUP_LABELS) as UiCatalogGroup[])
    .map(
      (group) =>
        `${GROUP_LABELS[group]}:\n` +
        UI_COMPONENT_CATALOG.filter((c) => c.group === group)
          .map((c) => c.signature)
          .join('\n')
    )
    .join('\n') +
  '\n' +
  Object.entries(UI_SIGNATURE_TERMS)
    .map(([name, value]) => `${name} = ${value}`)
    .join('\n');
