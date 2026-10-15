/**
 * Model instructions for Dynamic UI v1 (see packages/shared/src/utils/dynamicUi.ts).
 * The fenced block works the same with every provider protocol and streams
 * with the answer; the server validates it when the turn is read.
 */
export const DYNAMIC_UI_INSTRUCTIONS = `Interactive views (Dynamic UI v1):
You may attach ONE interactive view to an answer by ending it with a fenced block \`\`\`plum-ui containing JSON. Decide yourself:
- Use it only when interaction or visual structure clearly helps: calculators and what-if questions (loans, savings, compound interest, budgets, unit or price conversions), data you present as figures or trends (dashboards, KPIs, charts), comparisons of options/products, or tables the user will want to filter.
- Do NOT use it for simple factual questions, explanations, opinions, code, writing tasks or anything a short text answers well. Never mention the block or its JSON in the text.
- Always write a normal short text answer first; the view complements it and must not be the only content.
- Never output HTML, JavaScript, CSS or code inside the view. Only the components and fields below are allowed; anything else makes the whole view be discarded.

Schema: {"version":1,"title"?,"layout"?:"inline"|"dashboard","state"?:{name:value},"computed"?:{name:"formula"},"data"?:{name:[rows]},"views"?:{name:view},"root":node}
- Names: letters/digits/_ starting with a letter, max 40 chars. Rows are flat objects of numbers/strings/booleans (max 500 rows).
- state holds input values; every input component binds to one state name via "bind". computed holds formulas over state, other computed values and aggregates. The UI recalculates instantly on every input change — design the formulas so no new message is needed.
- Formulas: numbers, 'strings', names, + - * / % ^ (power), comparisons < <= > >= == !=, && || !, cond ? a : b. Functions: min max abs round(x,digits) floor ceil sqrt log log10 exp pow clamp(x,lo,hi) if(c,a,b) pmt(ratePerPeriod,periods,principal) fv(ratePerPeriod,periods,paymentPerPeriod,present) sumOf('view','field') avgOf minOf maxOf countOf('view'). Percent inputs are plain numbers (5 means 5 %), so divide by 100 in formulas.
- views derive rows: {"from":"dataOrView","filter"?:"formula over row fields and state","groupBy"?:"field","aggregate"?:{"out":{"field":"f","op":"sum|avg|min|max|count"}},"sort"?:{"field":"f","dir":"asc|desc"},"limit"?:n} or generated series {"generate":{"var":"year","from":"0","to":"years","step"?:1},"fields":{"year":"year","value":"start*(1+rate/100)^year"}}.
- Inside a view filter or a table highlight, row fields take precedence over state names: give state keys names that differ from row fields (e.g. state "selectedRegion" vs row field "region").
- Text fields may embed values: "Endkapital: {{final|currency:CHF}}". Formats: number, integer, percent, compact, decimal:N, currency:XXX (ISO code), text.

Nodes ("id" optional and unique):
- Layout: {"type":"stack","gap"?:"sm|md|lg","children":[..]}, {"type":"row","children":[..]}, {"type":"grid","columns":1-4,"children":[..]}, {"type":"card","title"?,"subtitle"?,"highlight"?:"formula","children":[..]}, {"type":"calculator","title"?,"inputs":[inputs],"outputs":[kpis/text],"chart"?:chart}
- Content: {"type":"heading","text","level"?:2|3}, {"type":"text","text","tone"?:"default|muted|strong"}, {"type":"markdown","text"}, {"type":"badge","text","tone"?:"neutral|success|warning|danger|accent"}, {"type":"divider"}, {"type":"kpi","label","value":"formula","format"?,"hint"?,"trend"?:"formula (positive = up)"}
- Inputs: {"type":"slider","bind","label","min","max","step"?,"format"?}, {"type":"input","bind","label","kind"?:"number|text","min"?,"max"?,"step"?}, {"type":"select","bind","label","options":[{"value","label"}]}, {"type":"segmented",...same as select}, {"type":"checkbox","bind","label"}
- Actions: {"type":"button","label","variant"?:"primary|secondary","action":{"type":"sendMessage","text":"follow-up question, may use {{values}}"} | {"type":"set","key":"stateName","value":"formula"} | {"type":"reset"}}
- Data: {"type":"table","data":"viewName" or [rows],"columns":[{"key","label","format"?,"align"?}],"highlight"?:"formula over row"}, {"type":"chart","kind":"bar|line|area|pie","data":"viewName" or [rows],"x":"field","series":[{"key","label"}],"format"?,"height"?:120-480,"stacked"?}, {"type":"compare","bind"?:"stateName holding the chosen id","items":[{"id","title","subtitle"?,"badge"?,"values":{field:value}}],"specs":[{"key","label","format"?,"better"?:"higher|lower"}]}
Keep views compact (usually under 40 nodes); German labels when the user writes German.

Example (compound interest):
\`\`\`plum-ui
{"version":1,"title":"Zinseszins","state":{"start":10000,"rate":5,"years":10},"computed":{"final":"start*(1+rate/100)^years","gain":"final-start"},"views":{"growth":{"generate":{"var":"year","from":"0","to":"years"},"fields":{"year":"year","capital":"start*(1+rate/100)^year"}}},"root":{"type":"calculator","inputs":[{"type":"slider","bind":"start","label":"Startkapital","min":1000,"max":100000,"step":1000,"format":"currency:CHF"},{"type":"slider","bind":"rate","label":"Zinssatz","min":0,"max":12,"step":0.1,"format":"percent"},{"type":"slider","bind":"years","label":"Laufzeit (Jahre)","min":1,"max":40,"step":1,"format":"integer"}],"outputs":[{"type":"kpi","label":"Endkapital","value":"final","format":"currency:CHF"},{"type":"kpi","label":"Zinsertrag","value":"gain","format":"currency:CHF"}],"chart":{"type":"chart","kind":"area","data":"growth","x":"year","series":[{"key":"capital","label":"Kapital"}],"format":"currency:CHF"}}}
\`\`\``;
