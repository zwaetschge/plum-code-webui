/** Single source for allowed components, required fields and model signatures. */
export const UI_COMPONENT_CATALOG = [
  {
    type: 'stack',
    required: ['children'],
    signature: '{"type":"stack","gap"?:"sm|md|lg","children":[..]}',
  },
  {
    type: 'row',
    required: ['children'],
    signature: '{"type":"row","children":[..]}',
  },
  {
    type: 'grid',
    required: ['columns', 'children'],
    signature: '{"type":"grid","columns":1-4,"children":[..]}',
  },
  {
    type: 'card',
    required: ['children'],
    signature: '{"type":"card","title"?,"subtitle"?,"highlight"?:"formula","children":[..]}',
  },
  {
    type: 'calculator',
    required: ['inputs', 'outputs'],
    signature:
      '{"type":"calculator","title"?,"inputs":[inputs],"outputs":[kpis/text],"chart"?:chart}',
  },
  {
    type: 'heading',
    required: ['text'],
    signature: '{"type":"heading","text","level"?:2|3}',
  },
  {
    type: 'text',
    required: ['text'],
    signature: '{"type":"text","text","tone"?:"default|muted|strong"}',
  },
  {
    type: 'markdown',
    required: ['text'],
    signature: '{"type":"markdown","text"}',
  },
  {
    type: 'badge',
    required: ['text'],
    signature: '{"type":"badge","text","tone"?:"neutral|success|warning|danger|accent"}',
  },
  {
    type: 'divider',
    required: [],
    signature: '{"type":"divider"}',
  },
  {
    type: 'kpi',
    required: ['label', 'value'],
    signature:
      '{"type":"kpi","label","value":"formula","format"?,"hint"?,"trend"?:"formula (positive = up)"}',
  },
  {
    type: 'slider',
    required: ['bind', 'label', 'min', 'max'],
    signature: '{"type":"slider","bind","label","min","max","step"?,"format"?}',
  },
  {
    type: 'input',
    required: ['bind', 'label'],
    signature: '{"type":"input","bind","label","kind"?:"number|text","min"?,"max"?,"step"?}',
  },
  {
    type: 'select',
    required: ['bind', 'label', 'options'],
    signature: '{"type":"select","bind","label","options":[{"value","label"}]}',
  },
  {
    type: 'segmented',
    required: ['bind', 'label', 'options'],
    signature: '{"type":"segmented",...same as select}',
  },
  {
    type: 'checkbox',
    required: ['bind', 'label'],
    signature: '{"type":"checkbox","bind","label"}',
  },
  {
    type: 'button',
    required: ['label', 'action'],
    signature:
      '{"type":"button","label","variant"?:"primary|secondary","action":{"type":"sendMessage","text":"follow-up question, may use {{values}}"} | {"type":"set","key":"stateName","value":"formula"} | {"type":"reset"}}',
  },
  {
    type: 'table',
    required: ['data', 'columns'],
    signature:
      '{"type":"table","data":"viewName" or [rows],"columns":[{"key","label","format"?,"align"?}],"highlight"?:"formula over row"}',
  },
  {
    type: 'chart',
    required: ['kind', 'data', 'x', 'series'],
    signature:
      '{"type":"chart","kind":"bar|line|area|pie","data":"viewName" or [rows],"x":"field","series":[{"key","label"}],"format"?,"height"?:120-480,"stacked"?}',
  },
  {
    type: 'compare',
    required: ['items', 'specs'],
    signature:
      '{"type":"compare","bind"?:"stateName holding the chosen id","items":[{"id","title","subtitle"?,"badge"?,"values":{field:value}}],"specs":[{"key","label","format"?,"better"?:"higher|lower"}]}',
  },
] as const;

export const dynamicUiComponentInstructions = () =>
  UI_COMPONENT_CATALOG.map((c) => c.signature).join('\n');
