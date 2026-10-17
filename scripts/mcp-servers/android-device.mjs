#!/usr/bin/env node
// Android device control for Plum sessions — phone tools over the Plum app's
// accessibility bridge, no adb. Tool calls go to the WebUI backend
// (POST /api/device-bridge/internal/call) with the hook secret and this CLI's
// WebUI session id; the backend relays them over the WebSocket the user's
// Plum Android app holds open (Settings → Browser → Device control).
//
// Pairing: no pairing code. The app is signed in as the user; enabling the
// accessibility service in the app connects the phone.
//
// Zero dependencies: newline-delimited JSON-RPC over stdio.

import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

function readParentEnv() {
  if (process.platform !== 'linux' || !process.ppid) return {};
  try {
    const raw = readFileSync(`/proc/${process.ppid}/environ`, 'utf8');
    const entries = {};
    for (const item of raw.split('\0')) {
      if (!item) continue;
      const separator = item.indexOf('=');
      if (separator <= 0) continue;
      entries[item.slice(0, separator)] = item.slice(separator + 1);
    }
    return entries;
  } catch {
    return {};
  }
}

// Codex starts MCP servers with the static config env block, which omits the
// dynamic WebUI session/auth env of the parent Codex process.
const RUNTIME_ENV = { ...readParentEnv(), ...process.env };

const BACKEND = RUNTIME_ENV.WEBUI_BACKEND_URL || 'http://localhost:3001';
const HOOK_SECRET = RUNTIME_ENV.WEBUI_HOOK_SECRET || '';
const SESSION_ID = RUNTIME_ENV.WEBUI_SESSION_ID || '';
const SESSION_CONTEXT_FILE = RUNTIME_ENV.WEBUI_SESSION_CONTEXT_FILE || '';

const log = (...args) => console.error('[mcp-android-device]', ...args);

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}
function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function getSessionId() {
  if (SESSION_ID) return SESSION_ID;
  if (!SESSION_CONTEXT_FILE) return '';
  try {
    const parsed = JSON.parse(readFileSync(SESSION_CONTEXT_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return '';
    if (Date.now() - Number(parsed.updatedAt || 0) > 6 * 60 * 60 * 1000) return '';
    return typeof parsed.webuiSessionId === 'string' ? parsed.webuiSessionId : '';
  } catch {
    return '';
  }
}

const XY = (axis) => ({
  type: 'number',
  description: `${axis} in pixels of the phone screen (read_screen/screenshot shows the size).`,
});

const TOOLS = [
  {
    name: 'devices',
    description:
      "List the user's Android phones connected through the Plum app's device control. Call this first; a phone is only present after the app's accessibility service is enabled (Plum app → Settings → Browser → Device control).",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'device_status',
    description:
      'Show the connected phone, current app and activity, screen size, and whether the accessibility service is running. Call before other tools.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_screen',
    description:
      'Read the current screen of the phone as a compact accessibility tree: visible elements with bounds, text, id, and whether they are clickable. Use the bounds to compute tap coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        max: {
          type: 'integer',
          description: 'Maximum number of elements returned (default 220).',
        },
      },
    },
  },
  {
    name: 'tap',
    description: 'Tap the phone screen at coordinates. Check the result with read_screen.',
    inputSchema: {
      type: 'object',
      properties: { x: XY('x'), y: XY('y') },
      required: ['x', 'y'],
    },
  },
  {
    name: 'long_press',
    description: 'Long-press the phone screen at coordinates.',
    inputSchema: {
      type: 'object',
      properties: { x: XY('x'), y: XY('y') },
      required: ['x', 'y'],
    },
  },
  {
    name: 'swipe',
    description:
      'Swipe from one point to another (drag or scroll gesture). For scrolling, prefer scroll.',
    inputSchema: {
      type: 'object',
      properties: {
        x1: XY('start x'),
        y1: XY('start y'),
        x2: XY('end x'),
        y2: XY('end y'),
        duration: { type: 'integer', description: 'Duration in ms (default 300).' },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the screen up or down by a fraction of the screen height.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'] },
        amount: {
          type: 'number',
          description: 'Fraction of the screen height (default 0.5).',
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'type_text',
    description:
      'Type text into the focused text field on the phone. Tap the field first if nothing is focused.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to type (replaces the field content).' } },
      required: ['text'],
    },
  },
  {
    name: 'press',
    description: 'Press a system key: back, home, recents, notifications, or quick settings.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          enum: ['back', 'home', 'recents', 'notifications', 'quick_settings'],
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'open_app',
    description:
      'Open an app on the phone by package name (see list_apps). Works with the launch intent.',
    inputSchema: {
      type: 'object',
      properties: { package: { type: 'string', description: 'App package, e.g. com.android.settings' } },
      required: ['package'],
    },
  },
  {
    name: 'list_apps',
    description: 'List installed launchable apps on the phone with their package names.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'screenshot',
    description:
      'Screenshot the phone screen and return it as an image. Coordinates read off the image can be passed straight to tap/long_press/swipe.',
    inputSchema: {
      type: 'object',
      properties: {
        scale: {
          type: 'number',
          description: 'Downscale factor 0.2–1 (default 0.6) to keep the payload small.',
        },
      },
    },
  },
];

function toolTimeoutMs(tool, args) {
  if (tool === 'screenshot') return 30_000;
  if (tool === 'devices' || tool === 'device_status') return 10_000;
  return 30_000;
}

async function callBackend(tool, args) {
  const sessionId = getSessionId();
  if (!sessionId) throw new Error('No WebUI session id; start this CLI from a Plum session.');
  const resp = await fetch(`${BACKEND}/api/device-bridge/internal/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webui-hook-secret': HOOK_SECRET,
      'x-webui-session-id': sessionId,
    },
    body: JSON.stringify({ tool, args, timeoutMs: toolTimeoutMs(tool, args) }),
    signal: AbortSignal.timeout(toolTimeoutMs(tool, args) + 10_000),
  });
  const raw = await resp.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`backend non-JSON response (${resp.status}): ${raw.slice(0, 200)}`);
  }
  if (!resp.ok || !body.success) throw new Error(body?.error?.message || `HTTP ${resp.status}`);
  return body.data;
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      return result(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'mcp-android-device', version: '0.1.0' },
        instructions:
          "Control the user's Android phone through the Plum app's device control (accessibility-driven, no adb). Check devices/device_status first; if no phone is connected, the user enables it in the Plum app under Settings → Browser → Device control. read_screen gives coordinates for tap; screenshot shows the screen. Announce what you are about to do before acting on the phone.",
      });
    }
    if (method === 'notifications/initialized' || method === 'initialized') return;
    if (method === 'ping') return result(id, {});
    if (method === 'tools/list') return result(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const name = params?.name;
      if (!TOOLS.some((tool) => tool.name === name)) {
        return error(id, -32601, `unknown tool: ${name}`);
      }
      try {
        const data = await callBackend(name, params?.arguments || {});
        return result(id, {
          content: data.content || [],
          ...(data.isError ? { isError: true } : {}),
        });
      } catch (e) {
        log('tool error', name, e.message);
        return result(id, {
          content: [{ type: 'text', text: `Error: ${e.message}` }],
          isError: true,
        });
      }
    }
    if (id === undefined) return;
    return error(id, -32601, `method not found: ${method}`);
  } catch (e) {
    log('handler error', e.message);
    return error(id, -32603, e.message);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    log('parse error', e.message);
    return;
  }
  void handleRequest(msg);
});

log(`ready (backend=${BACKEND}, session=${getSessionId() || '<unset>'})`);
