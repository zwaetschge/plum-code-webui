import { dynamicUiComponentInstructions } from '@plum-code-webui/shared';

/**
 * Model instructions for Dynamic UI v2 (see packages/shared/src/utils/dynamicUi.ts).
 * The fenced block works the same with every provider protocol and streams
 * with the answer; the server validates it when the turn is read and fills
 * live widgets itself (dynamicUiLive.ts). Both texts are static, so they stay
 * inside the cacheable system-prompt prefix.
 */

const FOLLOWUP_RULE =
  '2-3 short, concrete next questions the user is likely to ask, in their voice and language (max 80 characters each; no generic "Mehr erfahren"/"Tell me more", no repeats of what you already answered). Skip them for small talk, when you ask the user something yourself, or when nothing natural follows.';

export const DYNAMIC_UI_INSTRUCTIONS = `Interactive views and suggestion chips (Dynamic UI v2):
You may end an answer with ONE fenced block \`\`\`plum-ui containing JSON: suggestion chips, an interactive view, or both. Never mention the block or its JSON in the text. Never put HTML, JavaScript, CSS or executable code in its JSON (custom tiles have their own block, see Custom tiles); only the components and fields below exist. Invalid components get a local fallback; invalid global data or formulas reject the view.

Suggestion chips: on most answers add "followups": ${FOLLOWUP_RULE} A block may hold only chips: {"version":2,"followups":["…","…"]}.

When a view helps (decide yourself; text alone stays right for simple facts, explanations, opinions, code and writing tasks):
- Current data (weather, share prices, exchange rates, people/places/works, news, pictures): use the live widgets weather, stock, currency, entity, news, gallery. The server fetches real data; you give only parameters. Never type temperatures, prices or rates yourself and never invent them; your text says briefly what the widget shows.
- Calculations and what-ifs (loans, savings, budgets, conversions): calculator with sliders/inputs and formulas, so the user explores without a new message.
- Figures and trends: kpi, chart, table. Weighing 2-4 options or products (also after web research): compare, not a Markdown table in the text; tabs when several aspects (overview, specs, pros/cons) need their own page; products, places, articles: carousel.
- Plans, recipes, how-tos: checklist (to do, to buy), timeline (steps with times, schedules, history), stepper bound to a number state (servings, people) with quantities as {{formulas}}; accordion for FAQs or optional detail.
- Learning: quiz (one question at a time, hint, explanation) or flashcards.
- Missing details you need before answering well: form; its submit message becomes the user's next message.
- Anything else where a tailored, interactive tile serves the user better than text or the components (tools, trackers, planners, games, simulations, explorable explanations, custom diagrams, dashboards combining live data): build your own tile (Custom tiles below). Invent freely; do not squeeze such content into ill-fitting components.
Always write a normal text answer first; the view complements it and is never the only content. Never repeat in the text what the view shows (ingredient or step lists, tables, quiz questions, prices): then 1-3 sentences of context are enough. In the text you may link people, places and things to their Wikipedia card: [Ada Lovelace](entity:Ada_Lovelace).
Limits: max 2 actions per card, carousel 2-10 items, max 6 chart series, max 6 live widgets per view; every image needs alt text and a real https URL you know from tool results or the user, never a guessed one (leave images out otherwise). Usually under 40 nodes. German labels when the user writes German.

Schema: {"version":2,"title"?,"layout"?:"inline"|"dashboard","state"?:{name:value},"computed"?:{name:"formula"},"data"?:{name:[rows]},"views"?:{name:view},"root"?:node,"followups"?:[text]}
- Names (state, computed, data, views, fields): letters/digits/_ starting with a letter, max 40 chars; ids may also use -. Rows are flat objects of numbers/strings/booleans (max 500 rows).
- state holds input values; every input binds to one state name via "bind". computed holds formulas over state, other computed values and aggregates; the view recalculates instantly on every input change.
- Formulas: numbers, 'strings', names, + - * / % ^ (power), comparisons < <= > >= == !=, && || !, cond ? a : b. Functions: min max abs round(x,digits) floor ceil sqrt log log10 exp pow clamp(x,lo,hi) if(c,a,b) pmt(ratePerPeriod,periods,principal) fv(ratePerPeriod,periods,paymentPerPeriod,present) sumOf('view','field') avgOf minOf maxOf countOf('view'). Percent inputs are plain numbers (5 means 5 %), so divide by 100 in formulas.
- views derive rows: {"from":"dataOrView","filter"?:"formula over row fields and state","groupBy"?:"field","aggregate"?:{"out":{"field":"f","op":"sum|avg|min|max|count"}},"sort"?:{"field":"f","dir":"asc|desc"},"limit"?:n} or generated series {"generate":{"var":"year","from":"0","to":"years","step"?:1},"fields":{"year":"year","value":"start*(1+rate/100)^year"}}. In filters and highlights row fields shadow state names, so name state keys differently (state "selectedRegion" vs row field "region").
- Text fields may embed values: "Endkapital: {{final|currency:CHF}}". Formats: number, integer, percent, compact, decimal:N, currency:XXX (ISO code), text.

Nodes (ids are required for live widgets, checklist, quiz and flashcards; give stable ids to anything you may update):
${dynamicUiComponentInstructions()}

Custom tiles: write the tile as a fenced block \`\`\`plum-widget <id> title="…" holding self-contained HTML with inline <style> and <script> (vanilla JS, SVG or <canvas>), before the plum-ui block; place it in the view with {"type":"widget","id":"<id>",…}, or omit the view and it shows below the text. Use catalog components for plain cases (one live widget, simple table, chart or checklist) and a tile for everything they cannot do well; to combine or compare several live data sets in one view (weather of three cities, several share prices), build one tile with several live inputs instead of a grid of widgets.
It runs offline in a sandbox: no network, no external scripts, fonts or images, no alert/confirm/forms. API window.plum:
- plum.props (node props); plum.live.<name> = {status:"pending|resolved|failed", data} for the node's live inputs, updated via plum.on("live", fn). Render a skeleton while a status is pending and a short note with a retry button (plum.refresh(name)) when it failed. data fields: weather location.label, current {temperature_c, description, icon, wind_kmh}, hourly[] {label, temperature_c, precip_chance}, daily[] {label, high_c, low_c, precip_chance, description}; currency rate, amount, converted, series[]; stock name, currency, price, change_percent, ranges["1M"|"6M"|"1Y"|"5Y"].points[] {date, close}; entity title, description, extract, image.src, url; news articles[] {title, url, source, date_text, excerpt}; gallery images[] {src, thumbnail, title}.
- await plum.image(httpsUrl) gives a data: URL for an <img> (only real URLs from live data or tool results).
- plum.state with plum.setState({…}) is saved with the message (localStorage works too); plum.sendMessage(text) sends as the user; plum.prefill(text); plum.copy(text); plum.openUrl(url); plum.requestFullscreen(); plum.format.number/currency/percent/date (de-CH).
- Style with the CSS variables --plum-text, --plum-muted, --plum-surface, --plum-surface-2, --plum-border, --plum-accent, --plum-accent-text, --plum-good, --plum-bad, --plum-warn, --plum-chart-1…6, --plum-radius, never fixed colours (plum.theme.mode is dark or light; background is transparent). Pre-styled like Plum: button (neutral), button.primary (accent, the main action), inputs, tables, .card, .muted.
Make it polished and alive (clear hierarchy, small transitions), usable from 320 to 900 px wide, by touch (targets ≥ 40 px) and keyboard; label controls; under 25 KB. Never invent facts in it: numbers come from plum.live, props or your own calculation.

To update the most recent view, emit {"version":2,"patch":[{"op":"replace","target":"id","node":node},{"op":"append","target":"containerId","node":node},{"op":"remove","target":"id"}],"state"?,"computed"?,"data"?,"views"?,"title"?,"followups"?}. append on a tabs id adds a tab {"label","children"}, on an accordion id a section {"title","children"}; tabs and sections with an "id" are targets too. Send only what changes, keep bind names so user input survives, and send a full spec for a completely different view. To change a tile, write its complete new code in a plum-widget block with the same id (its saved plum.state survives). Put state/computed/data/views first, then root or patch, followups last, and finish each child before the next, so the view can appear while streaming.

Examples:
\`\`\`plum-ui
{"version":2,"title":"Zinseszins","state":{"start":10000,"rate":5,"years":10},"computed":{"final":"start*(1+rate/100)^years","gain":"final-start"},"views":{"growth":{"generate":{"var":"year","from":"0","to":"years"},"fields":{"year":"year","capital":"start*(1+rate/100)^year"}}},"root":{"type":"calculator","inputs":[{"type":"slider","bind":"start","label":"Startkapital","min":1000,"max":100000,"step":1000,"format":"currency:CHF"},{"type":"slider","bind":"rate","label":"Zinssatz","min":0,"max":12,"step":0.1,"format":"percent"},{"type":"slider","bind":"years","label":"Laufzeit (Jahre)","min":1,"max":40,"step":1,"format":"integer"}],"outputs":[{"type":"kpi","label":"Endkapital","value":"final","format":"currency:CHF"},{"type":"kpi","label":"Zinsertrag","value":"gain","format":"currency:CHF"}],"chart":{"type":"chart","kind":"area","data":"growth","x":"year","series":[{"key":"capital","label":"Kapital"}],"format":"currency:CHF"}},"followups":["Was ändert eine monatliche Sparrate?","Wie viel frisst die Inflation weg?"]}
\`\`\`
\`\`\`plum-ui
{"version":2,"title":"Risotto","state":{"servings":4},"root":{"type":"stack","children":[{"type":"stepper","bind":"servings","label":"Portionen","min":1,"max":12},{"type":"checklist","id":"ingredients","title":"Zutaten","copyable":true,"items":[{"id":"rice","label":"{{servings*80|integer}} g Risottoreis"},{"id":"broth","label":"{{servings*0.25|number}} l Gemüsebrühe"},{"id":"parmesan","label":"{{servings*20|integer}} g Parmesan"}]},{"type":"timeline","items":[{"time":"5 Min.","title":"Zwiebel glasig dünsten"},{"time":"18 Min.","title":"Reis anrösten, Brühe nach und nach einrühren"},{"time":"2 Min.","title":"Butter und Parmesan unterziehen"}]}]},"followups":["Welcher Wein passt dazu?","Geht das auch vegan?"]}
\`\`\`
\`\`\`plum-ui
{"version":2,"root":{"type":"weather","id":"weather","location":"Zürich, Schweiz","days":5},"followups":["Brauche ich morgen einen Schirm?","Wie wird das Wochenende?"]}
\`\`\`
\`\`\`plum-widget pomodoro title="Fokus-Timer"
<div class="card" style="text-align:center"><div id="t" style="font-size:44px;font-weight:700">25:00</div><button class="primary" id="go">Start</button> <button id="reset">Zurücksetzen</button></div>
<script>let left=plum.state.left??1500,timer;const t=document.getElementById('t'),go=document.getElementById('go');const show=()=>{t.textContent=String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0')};go.onclick=()=>{if(timer){clearInterval(timer);timer=null;go.textContent='Weiter';plum.setState({left});return}go.textContent='Pause';timer=setInterval(()=>{left=Math.max(0,left-1);show();if(!left){clearInterval(timer);timer=null;go.textContent='Start';plum.setState({left:1500});left=1500}},1000)};document.getElementById('reset').onclick=()=>{clearInterval(timer);timer=null;left=1500;go.textContent='Start';show();plum.setState({left})};show();</script>
\`\`\`
\`\`\`plum-ui
{"version":2,"root":{"type":"widget","id":"pomodoro"},"followups":["Wie lange sollten Pausen sein?","Was hilft gegen Ablenkung?"]}
\`\`\``;

/** Personalisation „Darstellung: Einfach“: no views, only suggestion chips. */
export const DYNAMIC_UI_SIMPLE_INSTRUCTIONS = `Suggestion chips: the user chose the simple answer display, so never attach interactive views, widgets or tables in a plum-ui block. On most answers end with one fenced block \`\`\`plum-ui containing only {"version":2,"followups":["…","…"]}: ${FOLLOWUP_RULE} Never mention the block.`;

export type DynamicUiAnswerDisplay = 'standard' | 'simple';

/** Instructions for the personalisation „Darstellung“ (voice turns get none). */
export function dynamicUiInstructions(display: DynamicUiAnswerDisplay = 'standard') {
  return display === 'simple' ? DYNAMIC_UI_SIMPLE_INSTRUCTIONS : DYNAMIC_UI_INSTRUCTIONS;
}
