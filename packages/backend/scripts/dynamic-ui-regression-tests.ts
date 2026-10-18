import assert from 'node:assert/strict';
import {
  evalExpr,
  applyDynamicUiPatch,
  recoverDynamicUi,
  mergeDynamicUiState,
  UI_COMPONENT_CATALOG,
  extractDynamicUi,
  formatUiValue,
  parseExpr,
  validateDynamicUi,
  type DynamicUiSpec,
} from '@plum-code-webui/shared';
import { DYNAMIC_UI_INSTRUCTIONS } from '../src/services/assistant/dynamicUiPrompt.js';
import {
  COMPOUND_INTEREST,
  PRODUCT_COMPARISON,
  SALES_DASHBOARD,
} from '../../frontend/src/components/assistant/dynamic-ui/fixtures.js';
import { UiRuntime } from '../../frontend/src/components/assistant/dynamic-ui/runtime.js';

let passed = 0;
function test(name: string, run: () => void) {
  run();
  passed++;
  console.log(`ok - ${name}`);
}
const scope = (values: Record<string, number | string | boolean> = {}) => ({
  lookup: (name: string) => (Object.hasOwn(values, name) ? values[name] : undefined),
  rows: () => [],
});
const calc = (source: string, values?: Record<string, number | string | boolean>) =>
  evalExpr(parseExpr(source), scope(values));

test('formulas follow precedence and stay inside the whitelist', () => {
  assert.equal(calc('1 + 2 * 3'), 7);
  assert.equal(calc('-2 ^ 2'), -4);
  assert.equal(calc('2 ^ 3 ^ 2'), 512);
  assert.equal(calc('a > 1 ? "gross" : "klein"', { a: 3 }), 'gross');
  assert.equal(calc('round(10 / 3, 2)'), 3.33);
  assert.equal(
    Math.round(
      Number(calc('start * (1 + rate / 100) ^ years', { start: 1000, rate: 5, years: 10 }))
    ),
    1629
  );
  assert.equal(Math.round(Number(calc('fv(0, 12, 100, 1000)'))), 2200);
  for (const bad of [
    'eval(1)',
    'constructor(1)',
    'toString()',
    'a.b',
    'window["x"]',
    'constructor',
    '1 +',
    '(1',
    'x = 1',
    '`x`',
  ]) {
    if (bad === 'constructor') {
      // Bare names only read declared values; prototype names are not reachable.
      assert.equal(calc(bad), null);
      continue;
    }
    assert.throws(() => parseExpr(bad), `"${bad}" must not parse`);
  }
});

test('the three reference fixtures validate', () => {
  for (const spec of [COMPOUND_INTEREST, SALES_DASHBOARD, PRODUCT_COMPARISON]) {
    const result = validateDynamicUi(spec);
    assert.ok(result.ok, result.ok ? '' : result.error);
  }
});

test('invalid descriptions are rejected with a reason', () => {
  const base = { version: 1, state: { a: 1 }, root: { type: 'text', text: 'Hallo' } };
  const cases: Array<[string, unknown]> = [
    ['unknown component', { ...base, root: { type: 'html', html: '<script>alert(1)</script>' } }],
    ['wrong version', { ...base, version: 2 }],
    [
      'bind to missing state',
      { ...base, root: { type: 'slider', bind: 'b', label: 'B', min: 0, max: 1 } },
    ],
    ['bad formula', { ...base, computed: { x: 'eval("1")' } }],
    ['template with bad formula', { ...base, root: { type: 'text', text: '{{a..b}}' } }],
    [
      'duplicate ids',
      {
        ...base,
        root: {
          type: 'stack',
          children: [
            { type: 'divider', id: 'x' },
            { type: 'divider', id: 'x' },
          ],
        },
      },
    ],
    [
      'unknown data source',
      { ...base, root: { type: 'table', data: 'nope', columns: [{ key: 'a', label: 'A' }] } },
    ],
    [
      'unknown format',
      { ...base, root: { type: 'kpi', label: 'K', value: 'a', format: 'currency:chf' } },
    ],
    ['not an object', 'plum'],
  ];
  for (const [name, input] of cases) {
    const result = validateDynamicUi(input);
    assert.equal(result.ok, false, name);
  }
  let deep: Record<string, unknown> = { type: 'divider' };
  for (let i = 0; i < 12; i++) deep = { type: 'stack', children: [deep] };
  assert.equal(validateDynamicUi({ version: 1, root: deep }).ok, false, 'too deep');
});

test('answers split into text and view, streaming and fallbacks included', () => {
  const block = JSON.stringify(COMPOUND_INTEREST);
  const answer = `Hier ist dein Rechner.\n\n\`\`\`plum-ui\n${block}\n\`\`\`\n`;
  const done = extractDynamicUi(answer);
  assert.equal(done.text, 'Hier ist dein Rechner.');
  assert.ok(done.ui);
  assert.equal(done.pending, false);

  const streaming = extractDynamicUi(`Hier ist dein Rechner.\n\n\`\`\`plum-ui\n{"version":1,"roo`);
  assert.equal(streaming.text, 'Hier ist dein Rechner.');
  assert.equal(streaming.pending, true);
  assert.equal(streaming.ui, null);

  const broken = extractDynamicUi('Antwort.\n```plum-ui\n{nope}\n```\nNachsatz.');
  assert.equal(broken.ui, null);
  assert.match(broken.error ?? '', /JSON/);
  assert.equal(broken.text, 'Antwort.\n\nNachsatz.');

  const rejected = extractDynamicUi(
    'Antwort.\n```plum-ui\n{"version":1,"root":{"type":"iframe"}}\n```'
  );
  assert.equal(rejected.ui, null);
  assert.match(rejected.error ?? '', /verworfen/);
  assert.equal(rejected.text, 'Antwort.');

  const plain = extractDynamicUi('Nur Text mit ```js\ncode\n```');
  assert.equal(plain.ui, null);
  assert.equal(plain.error, null);
  assert.equal(plain.text, 'Nur Text mit ```js\ncode\n```');
});

test('one shared state recomputes formulas, views and aggregates', () => {
  const start = new UiRuntime(COMPOUND_INTEREST, { ...COMPOUND_INTEREST.state! });
  const final = Number(start.lookup('final'));
  assert.ok(final > 10000);
  assert.equal(start.rows('growth').length, 16);
  const later = new UiRuntime(COMPOUND_INTEREST, { ...COMPOUND_INTEREST.state!, years: 30 });
  assert.ok(Number(later.lookup('final')) > final);
  assert.equal(later.rows('growth').length, 31);
  assert.equal(later.template('{{years|integer}} Jahre'), '30 Jahre');

  const all = new UiRuntime(SALES_DASHBOARD, { region: 'Alle', channel: 'Alle' });
  const north = new UiRuntime(SALES_DASHBOARD, { region: 'Nord', channel: 'Alle' });
  assert.equal(all.rows('monthly').length, 6);
  assert.ok(Number(north.lookup('total')) < Number(all.lookup('total')));
  assert.equal(
    Number(north.lookup('total')),
    SALES_DASHBOARD.data!.sales!.filter((row) => row.region === 'Nord').reduce(
      (sum, row) => sum + Number(row.revenue),
      0
    )
  );

  const cyclic: DynamicUiSpec = {
    version: 1,
    computed: { a: 'b + 1', b: 'a + 1' },
    root: { type: 'divider' },
  };
  assert.equal(new UiRuntime(cyclic, {}).lookup('a'), null, 'cycles resolve to null');
  assert.equal(new UiRuntime(cyclic, {}).lookup('constructor'), undefined, 'no prototype names');
  assert.deepEqual(new UiRuntime(cyclic, {}).rows('constructor'), [], 'no prototype datasets');
});

test('values format for Swiss German', () => {
  assert.equal(formatUiValue(5.5, 'percent'), '5.5 %'); // Swiss German uses a decimal point
  assert.equal(formatUiValue(true), 'Ja');
  assert.equal(formatUiValue(null), '–');
  assert.match(formatUiValue(12500, 'currency:CHF'), /CHF/);
});

test('model instructions describe the block and the restraint rule', () => {
  assert.match(DYNAMIC_UI_INSTRUCTIONS, /```plum-ui/);
  assert.match(DYNAMIC_UI_INSTRUCTIONS, /Do NOT use it for simple factual questions/);
  const example = /```plum-ui\n([\s\S]+?)\n```/.exec(DYNAMIC_UI_INSTRUCTIONS)?.[1] ?? '';
  const result = validateDynamicUi(JSON.parse(example));
  assert.ok(result.ok, result.ok ? '' : result.error);
});

test('streaming renders completed children before the fence ends and every preview validates', () => {
  const spec = {
    version: 1,
    state: { amount: 10 },
    root: {
      type: 'stack',
      id: 'panel',
      children: [
        { type: 'input', id: 'amountInput', bind: 'amount', label: 'Betrag' },
        { type: 'text', id: 'summary', text: 'Betrag: {{amount}}' },
      ],
    },
  };
  const prefix = 'Antwort.\n```plum-ui\n';
  const json = JSON.stringify(spec);
  let previews = 0;
  for (let n = 0; n < json.length; n++) {
    const result = extractDynamicUi(prefix + json.slice(0, n), {
      streaming: true,
      viewId: 'turn-1',
    });
    assert.equal(result.pending, true);
    assert.equal(result.error, null);
    if (result.ui) {
      assert.ok(validateDynamicUi(result.ui).ok);
      previews++;
    }
  }
  assert.ok(previews > 10, 'should render before all JSON arrives');
  const done = extractDynamicUi(prefix + json + '\n```', { streaming: false, viewId: 'turn-1' });
  assert.equal(done.ui?.viewId, 'turn-1');
  assert.equal(done.pending, false);
  const interrupted = extractDynamicUi(prefix + json.slice(0, -4), { streaming: false });
  assert.equal(
    interrupted.ui,
    null,
    'an interrupted preview must not become an actionable final view'
  );
  assert.equal(interrupted.pending, false);
});

test('one broken chart or forbidden action leaves valid siblings usable', () => {
  const result = recoverDynamicUi({
    version: 1,
    root: {
      type: 'stack',
      children: [
        { type: 'text', id: 'good', text: 'Bleibt sichtbar' },
        { type: 'chart', kind: 'evil' },
        {
          type: 'button',
          label: 'Unsafe',
          action: { type: 'fetch', url: 'https://invalid.example' },
        },
      ],
    },
  });
  assert.ok(result.ok);
  assert.equal(result.warnings.length, 2);
  assert.ok(validateDynamicUi(result.spec).ok);
  assert.match(JSON.stringify(result.spec), /Bleibt sichtbar/);
  assert.doesNotMatch(JSON.stringify(result.spec), /https:|fetch|evil/);
  const publicResult = extractDynamicUi(
    'Antwort.\n```plum-ui\n' +
      JSON.stringify({
        version: 1,
        root: {
          type: 'stack',
          children: [
            { type: 'text', text: 'Gut' },
            { type: 'chart', kind: 'internal-detail' },
          ],
        },
      }) +
      '\n```'
  );
  assert.ok(publicResult.ui);
  assert.doesNotMatch(publicResult.error ?? '', /root\.|internal-detail/);
  assert.equal(
    recoverDynamicUi({ version: 1, computed: { bad: 'eval(1)' }, root: { type: 'divider' } }).ok,
    false
  );
});

test('targeted changes preserve identity, unchanged components and dirty compatible inputs', () => {
  const base: DynamicUiSpec = {
    version: 1,
    viewId: 'view-a',
    state: { amount: 10, untouched: 1 },
    root: {
      type: 'stack',
      id: 'panel',
      children: [
        { type: 'input', id: 'amountInput', bind: 'amount', label: 'Betrag' },
        { type: 'text', id: 'summary', text: 'Alt' },
      ],
    },
  };
  const patch = {
    version: 1,
    state: { amount: 20, untouched: 2, added: true },
    patch: [
      { op: 'replace', target: 'summary', node: { type: 'text', text: 'Neu' } },
      {
        op: 'append',
        target: 'panel',
        node: { type: 'kpi', id: 'value', label: 'Wert', value: 'amount*2' },
      },
    ],
  };
  const response = 'Ergänzt.\n```plum-ui\n' + JSON.stringify(patch) + '\n```';
  const result = extractDynamicUi(response, { base, viewId: 'new-turn' });
  assert.ok(result.ui);
  assert.equal(result.ui.viewId, 'view-a');
  assert.match(JSON.stringify(result.ui), /amountInput/);
  assert.deepEqual(mergeDynamicUiState(result.ui.state!, { amount: 42, removed: 1 }), {
    amount: 42,
    untouched: 2,
    added: true,
  });
  assert.deepEqual(mergeDynamicUiState({ a: 'new' }, { a: 5 }), { a: 'new' });
  assert.equal(base.state?.amount, 10, 'base history must remain unchanged');
  assert.equal(extractDynamicUi(response).ui, null, 'no cross-chat/global base fallback');
  assert.throws(() =>
    applyDynamicUiPatch(base, { version: 1, patch: [{ op: 'remove', target: 'missing' }] })
  );
  assert.throws(() =>
    applyDynamicUiPatch(base, { version: 1, patch: [{ op: 'remove', target: 'panel' }] })
  );
  const removed = applyDynamicUiPatch(base, {
    version: 1,
    patch: [{ op: 'remove', target: 'summary' }],
  });
  assert.doesNotMatch(JSON.stringify(removed), /Alt/);
});

test('catalog supplies every component contract to the model exactly once', () => {
  assert.equal(new Set(UI_COMPONENT_CATALOG.map((c) => c.type)).size, 20);
  for (const component of UI_COMPONENT_CATALOG)
    assert.ok(DYNAMIC_UI_INSTRUCTIONS.includes(component.signature));
});

console.log(`\n${passed} Dynamic UI tests passed`);
