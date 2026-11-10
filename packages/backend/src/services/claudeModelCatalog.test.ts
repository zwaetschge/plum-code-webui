/**
 * A Claude model the Anthropic API already serves, but the installed Claude
 * Code does not know yet, still reaches the model picker.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claudeCatalogFromApiModels,
  mergeClaudeCatalogs,
  parseClaudeCliModelCatalog,
} from './cli-providers.js';

const cli = parseClaudeCliModelCatalog(
  [
    'Claude Fable 5.1',
    'Claude Opus 5.5',
    'Claude Sonnet 5.5',
    'Claude Haiku 5.5',
    'claude-fable-5-1',
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
  ].join('\n')
);

const api = claudeCatalogFromApiModels([
  { id: 'claude-fable-5-2', display_name: 'Claude Fable 5.2' },
  { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' },
  { id: 'claude-fable-5-1', display_name: 'Claude Fable 5.1' },
  { id: 'claude-opus-4-5-20251101', display_name: 'Claude Opus 4.5' },
]);

test('the API catalog keeps the newest model per family', () => {
  assert.deepEqual(api.models, ['claude-fable-5-2', 'claude-opus-5-5']);
  assert.equal(api.labels['claude-fable-5-2'], 'Fable 5.2');
});

test('a newer API model replaces the CLI one; other families stay', () => {
  const merged = mergeClaudeCatalogs(cli, api);
  assert.deepEqual(merged.models, [
    'claude-fable-5-2',
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
  ]);
  assert.equal(merged.labels.fable, 'Fable 5.2');
  assert.equal(merged.labels.opus, 'Opus 5.5');
});

test('without an API answer the CLI catalog is used as is', () => {
  assert.deepEqual(mergeClaudeCatalogs(cli, null).models, cli.models);
});
