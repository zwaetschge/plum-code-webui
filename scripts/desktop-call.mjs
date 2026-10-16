#!/usr/bin/env node
// Calls a Plum Desktop tool through the bridge from inside a Plum session,
// without restarting the session's MCP servers. Images land in
// .claude-webui-images/ so they can be viewed.
//
//   node scripts/desktop-call.mjs desktop_status
//   node scripts/desktop-call.mjs desktop_click '{"ref":"d3"}'
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [tool, json = '{}'] = process.argv.slice(2);
if (!tool) {
  console.error('usage: desktop-call.mjs <desktop_tool> [json-args]');
  process.exit(2);
}
const backend = process.env.WEBUI_BACKEND_URL || 'http://localhost:3001';
const resp = await fetch(`${backend}/api/browser-bridge/internal/call`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-webui-hook-secret': process.env.WEBUI_HOOK_SECRET || '',
    'x-webui-session-id': process.env.WEBUI_SESSION_ID || '',
  },
  body: JSON.stringify({ tool, args: JSON.parse(json), timeoutMs: 180_000 }),
});
const body = await resp.json();
if (!body.success) {
  console.log('ERROR', body.error?.message);
  process.exit(1);
}
const dir = join(process.cwd(), '.claude-webui-images');
for (const item of body.data.content) {
  if (item.type === 'image') {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `desk-${Date.now()}.jpg`);
    writeFileSync(file, Buffer.from(item.data, 'base64'));
    console.log('IMAGE', file);
  } else console.log(item.text);
}
if (body.data.isError) process.exit(1);
