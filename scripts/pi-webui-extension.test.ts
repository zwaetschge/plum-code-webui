/**
 * The Z.AI vision MCP is for GLM 5.3 only; every other Pi model is turned away
 * before the call reaches the server.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import webuiPermissions, { targetsZaiVision, zaiVisionAllowedFor } from './pi-webui-extension.ts';

test('calls to zai-vision are recognised directly and through the mcp proxy', () => {
  assert.equal(targetsZaiVision('mcp', { server: 'zai-vision' }), true);
  assert.equal(targetsZaiVision('mcp', { connect: 'zai-vision' }), true);
  assert.equal(targetsZaiVision('mcp', { tool: 'zai-vision_analyze_image', args: {} }), true);
  assert.equal(targetsZaiVision('mcp__zai_vision', { tool: 'analyze_image' }), true);
  assert.equal(targetsZaiVision('mcp', { tool: 'comfyui-images_generate_image' }), false);
  assert.equal(targetsZaiVision('mcp', { search: 'image' }), false);
  assert.equal(targetsZaiVision('read', { path: 'zai-vision.png' }), false);
});

test('only GLM 5.3 models may use it', () => {
  for (const id of ['glm-5.3', 'glm-5.3-flash', 'zai-glm-5-3']) {
    assert.equal(zaiVisionAllowedFor(id), true, id);
  }
  for (const id of ['deepseek-flash', 'deepseek-v4-pro', 'glm-5.1', 'glm-5', undefined]) {
    assert.equal(zaiVisionAllowedFor(id), false, String(id));
  }
});

test('the tool_call hook blocks DeepSeek and lets GLM 5.3 through', async () => {
  let handler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
  webuiPermissions({
    on: (_event: string, fn: typeof handler) => {
      handler = fn;
    },
  } as never);
  const call = { toolName: 'mcp', input: { tool: 'zai-vision_analyze_image' } };
  const blocked = (await handler!(call, { model: { id: 'deepseek-flash' } })) as {
    block?: boolean;
    reason?: string;
  };
  assert.equal(blocked?.block, true);
  assert.match(blocked?.reason ?? '', /GLM 5\.3/);
  assert.equal(await handler!(call, { model: { id: 'glm-5.3' } }), undefined);
});
