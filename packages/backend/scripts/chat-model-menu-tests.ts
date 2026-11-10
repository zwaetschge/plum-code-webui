/**
 * Chat model menu chosen in the personalisation (`chatModels`, default first).
 * Run: pnpm --filter @plum-code-webui/backend test:chat-model-menu
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_PERSONALIZATION,
  orderChatApiProviders,
  selectChatModels,
  type AssistantApiProvider,
} from '@plum-code-webui/shared';
import {
  DEFAULT_CHAT_OUTPUT_TOKENS,
  chatOutputTokens,
} from '../src/services/assistant/apiTransport.js';

const providers: AssistantApiProvider[] = [
  { id: 'z-ai', name: 'Z-AI', protocol: 'openai', models: ['glm-5.3-flash', 'glm-5'] },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai',
    models: ['anthropic/claude-sonnet-5-5'],
  },
];

let passed = 0;
const test = (name: string, run: () => void) => {
  run();
  passed++;
  console.log(`ok - ${name}`);
};

test('an empty list offers every model in the usual order', () => {
  assert.deepEqual(DEFAULT_PERSONALIZATION.chatModels, []);
  assert.equal(selectChatModels(providers, []), providers);
  assert.equal(orderChatApiProviders(providers)[0]!.id, 'z-ai');
});

test('the chosen list filters, keeps its order and puts the default first', () => {
  const menu = selectChatModels(providers, [
    'deepseek/deepseek-v4-pro',
    'openrouter/anthropic/claude-sonnet-5-5',
    'z-ai/glm-5',
    'deepseek/deepseek-flash',
  ]);
  assert.deepEqual(
    menu.map((p) => [p.id, p.models, p.default ?? false]),
    [
      ['deepseek', ['deepseek-v4-pro', 'deepseek-flash'], true],
      ['openrouter', ['anthropic/claude-sonnet-5-5'], false],
      ['z-ai', ['glm-5'], false],
    ]
  );
  // The shared ordering (WebUI, app, desk) keeps the user's default first
  // instead of preferring GLM Flash.
  const ordered = orderChatApiProviders(menu);
  assert.deepEqual([ordered[0]!.id, ordered[0]!.models[0]], ['deepseek', 'deepseek-v4-pro']);
});

test('stale entries are skipped; with none left every model stays available', () => {
  assert.deepEqual(
    selectChatModels(providers, ['gone/model', 'z-ai/glm-4', 'z-ai/glm-5']).map((p) => p.models),
    [['glm-5']]
  );
  assert.equal(selectChatModels(providers, ['gone/model', 'deepseek/old']), providers);
});

test('chat turns get the model output budget unless another value was chosen', () => {
  assert.equal(chatOutputTokens('deepseek', 'deepseek-v4-pro', 4096), 4096);
  assert.equal(chatOutputTokens('deepseek', 'deepseek-v4-pro', 20000), 20000);
  // Unknown local models keep the old default instead of overflowing a small context.
  assert.equal(chatOutputTokens('strata-local', 'mystery-model'), DEFAULT_CHAT_OUTPUT_TOKENS);
  assert.equal(
    chatOutputTokens('strata-local', 'mystery-model', DEFAULT_CHAT_OUTPUT_TOKENS),
    DEFAULT_CHAT_OUTPUT_TOKENS
  );
  // A known family without a catalog entry: a quarter of the window, at most 32k.
  const auto = chatOutputTokens('unlisted', 'claude-sonnet-5-5', DEFAULT_CHAT_OUTPUT_TOKENS);
  assert.ok(auto > DEFAULT_CHAT_OUTPUT_TOKENS && auto <= 32768, String(auto));
});

console.log(`\n${passed} chat model menu tests passed`);
