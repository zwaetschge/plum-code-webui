import { dynamicUiComponentInstructions } from '@plum-code-webui/shared';

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
- Never output HTML, JavaScript, CSS or code inside the view. Only the components and fields below are allowed; invalid components are replaced with a local fallback; invalid global data or formulas reject the view.

Schema: {"version":1,"title"?,"layout"?:"inline"|"dashboard","state"?:{name:value},"computed"?:{name:"formula"},"data"?:{name:[rows]},"views"?:{name:view},"root":node}
- Names: letters/digits/_ starting with a letter, max 40 chars. Rows are flat objects of numbers/strings/booleans (max 500 rows).
- state holds input values; every input component binds to one state name via "bind". computed holds formulas over state, other computed values and aggregates. The UI recalculates instantly on every input change — design the formulas so no new message is needed.
- Formulas: numbers, 'strings', names, + - * / % ^ (power), comparisons < <= > >= == !=, && || !, cond ? a : b. Functions: min max abs round(x,digits) floor ceil sqrt log log10 exp pow clamp(x,lo,hi) if(c,a,b) pmt(ratePerPeriod,periods,principal) fv(ratePerPeriod,periods,paymentPerPeriod,present) sumOf('view','field') avgOf minOf maxOf countOf('view'). Percent inputs are plain numbers (5 means 5 %), so divide by 100 in formulas.
- views derive rows: {"from":"dataOrView","filter"?:"formula over row fields and state","groupBy"?:"field","aggregate"?:{"out":{"field":"f","op":"sum|avg|min|max|count"}},"sort"?:{"field":"f","dir":"asc|desc"},"limit"?:n} or generated series {"generate":{"var":"year","from":"0","to":"years","step"?:1},"fields":{"year":"year","value":"start*(1+rate/100)^year"}}.
- Inside a view filter or a table highlight, row fields take precedence over state names: give state keys names that differ from row fields (e.g. state "selectedRegion" vs row field "region").
- Text fields may embed values: "Endkapital: {{final|currency:CHF}}". Formats: number, integer, percent, compact, decimal:N, currency:XXX (ISO code), text.

Nodes (give stable unique ids to components you may update):
${dynamicUiComponentInstructions()}
To update the most recent interactive view, emit a plum-ui block {"version":1,"patch":[{"op":"replace","target":"nodeId","node":node},{"op":"append","target":"containerId","node":node},{"op":"remove","target":"nodeId"}],"state"?:{newDefault:value},"computed"?:{name:"formula"},"data"?:{name:[rows]},"views"?:{name:view},"title"?}. Only changed sections are needed. Keep the same bind names for existing inputs so their user values survive. Do not repeat the whole view for a small change. Targets must exist in the latest view. For a completely different view, send a full spec instead. Put state/computed/data/views BEFORE root or patch, so completed children can appear while streaming. Finish each child before starting the next.
Keep views compact (usually under 40 nodes); German labels when the user writes German.

Example (compound interest):
\`\`\`plum-ui
{"version":1,"title":"Zinseszins","state":{"start":10000,"rate":5,"years":10},"computed":{"final":"start*(1+rate/100)^years","gain":"final-start"},"views":{"growth":{"generate":{"var":"year","from":"0","to":"years"},"fields":{"year":"year","capital":"start*(1+rate/100)^year"}}},"root":{"type":"calculator","inputs":[{"type":"slider","bind":"start","label":"Startkapital","min":1000,"max":100000,"step":1000,"format":"currency:CHF"},{"type":"slider","bind":"rate","label":"Zinssatz","min":0,"max":12,"step":0.1,"format":"percent"},{"type":"slider","bind":"years","label":"Laufzeit (Jahre)","min":1,"max":40,"step":1,"format":"integer"}],"outputs":[{"type":"kpi","label":"Endkapital","value":"final","format":"currency:CHF"},{"type":"kpi","label":"Zinsertrag","value":"gain","format":"currency:CHF"}],"chart":{"type":"chart","kind":"area","data":"growth","x":"year","series":[{"key":"capital","label":"Kapital"}],"format":"currency:CHF"}}}
\`\`\``;
