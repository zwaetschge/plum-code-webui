#!/usr/bin/env node
// On-demand access to MCP servers that are not loaded permanently.
//   node scripts/mcp-call.mjs list                       servers that can be called
//   node scripts/mcp-call.mjs tools <server>             tool names + one-line descriptions
//   node scripts/mcp-call.mjs schema <server> <tool>     input schema of one tool
//   node scripts/mcp-call.mjs call <server> <tool> '<json args>'
// Servers come from ~/.claude/mcp-disabled.json and ~/.claude/settings.json (mcpServers).
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readFileSync as read } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const home = process.env.WEBUI_CONFIG_HOME || join(homedir(), '.claude');
const load = (name) => {
  const file = join(home, name);
  if (!existsSync(file)) return {};
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return name === 'settings.json' ? (data.mcpServers ?? {}) : data;
};
const servers = { ...load('settings.json'), ...load('mcp-disabled.json') };
const [cmd, server, tool, rawArgs] = process.argv.slice(2);

if (cmd === 'list' || !cmd) {
  for (const [name, def] of Object.entries(servers)) console.log(`${name}\t${def.command} ${(def.args ?? []).join(' ')}`);
  process.exit(0);
}
const def = servers[server];
if (!def) {
  console.error(`Unknown server "${server}". Known: ${Object.keys(servers).join(', ')}`);
  process.exit(2);
}

// Bridges that call internal Plum routes need the hook secret / session id of the parent process.
const inherited = {};
try {
  for (const entry of read(`/proc/${process.ppid}/environ`, 'utf8').split('\0')) {
    const i = entry.indexOf('=');
    if (i > 0 && /^(WEBUI_|PLUM_)/.test(entry.slice(0, i))) inherited[entry.slice(0, i)] = entry.slice(i + 1);
  }
} catch { /* not available; the bridge will report a missing secret itself */ }

const child = spawn(def.command, def.args ?? [], { env: { ...process.env, ...inherited, ...(def.env ?? {}) }, stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = '';
let nextId = 1;
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) pending.get(message.id)(message);
    } catch { /* ignore non-JSON output */ }
  }
});
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), Number(process.env.MCP_CALL_TIMEOUT_MS || 600000));
    pending.set(id, (message) => { clearTimeout(timer); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

try {
  await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'plum-mcp-call', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  if (cmd === 'size') {
    const { tools } = await send('tools/list', {});
    console.log(`${tools.length}\t${JSON.stringify(tools).length}`);
  } else if (cmd === 'tools' || cmd === 'schema') {
    const { tools } = await send('tools/list', {});
    if (cmd === 'tools') for (const t of tools) console.log(`${t.name}\t${(t.description ?? '').split('\n')[0].slice(0, 110)}`);
    else console.log(JSON.stringify(tools.find((t) => t.name === tool)?.inputSchema ?? null, null, 2));
  } else if (cmd === 'call') {
    const result = await send('tools/call', { name: tool, arguments: rawArgs ? JSON.parse(rawArgs) : {} });
    for (const part of result.content ?? []) {
      if (part.type === 'text') console.log(part.text);
      else console.log(`[${part.type}${part.mimeType ? ' ' + part.mimeType : ''}, ${(part.data ?? '').length} base64 chars omitted]`);
    }
    if (result.isError) process.exitCode = 1;
  } else {
    console.error('Usage: list | tools <server> | schema <server> <tool> | call <server> <tool> <json>');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(String(error.message ?? error));
  process.exitCode = 1;
} finally {
  child.kill();
}
