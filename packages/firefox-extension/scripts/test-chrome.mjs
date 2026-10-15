#!/usr/bin/env node
// Headless check of the Chrome build against a fake Plum bridge: no Plum
// server, no token. Starts a local HTTP + WebSocket server that speaks the
// bridge protocol, loads dist/chrome into Chromium and sends real tool calls.
//
//   node packages/firefox-extension/scripts/build.mjs
//   node packages/firefox-extension/scripts/test-chrome.mjs
//
// Needs Chromium (PLUM_CHROMIUM, default /usr/local/bin/plum-chromium) and the
// `ws` package from packages/backend. Prints one line per check, exits 1 on a failure.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, '../backend/package.json'));
const { WebSocketServer } = require('ws');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PORT = 9477;
const DEBUG_PORT = 9334;
const EXTENSION_ID = 'oaacdgkogibamjhjppjlhncjknlcigof';

const PAGE = (host) => `<html><head><title>${host}</title></head><body><h1>${host}</h1>
<button id=b>Knopf</button>
<div id=spin>Wird geladen …</div><script>setTimeout(() => document.getElementById('spin').remove(), 1500)</script>
<table><caption>Preise</caption><tr><th>Produkt</th><th>Preis</th></tr>
<tr><td>Aero 14</td><td>1299</td></tr><tr><td>Pro 16</td><td>2499</td></tr></table>
<table><tr><th>A</th></tr><tr><td>1</td></tr></table></body></html>`;

// ---------------------------------------------------------------- fake bridge

const http = createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(PAGE(req.headers.host));
});
const wss = new WebSocketServer({ server: http, path: '/api/browser-bridge/ws' });
let bridge = null;
const replies = new Map();
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    const frame = JSON.parse(data);
    if (frame.type === 'hello') {
      bridge = ws;
      ws.send(JSON.stringify({ type: 'welcome', connectionId: 'test', latestVersion: '99.0.0' }));
    } else if (frame.type === 'result') replies.get(frame.id)?.(frame);
    else if (frame.type === 'rpc')
      ws.send(JSON.stringify({ type: 'rpcResult', id: frame.id, ok: true, data: {} }));
  });
});
await new Promise((resolve) => http.listen(PORT, '127.0.0.1', resolve));
let callId = 0;
const call = (tool, args = {}) =>
  new Promise((resolve) => {
    const id = `t${(callId += 1)}`;
    replies.set(id, resolve);
    bridge.send(
      JSON.stringify({ type: 'call', id, tool, args, session: { id: 's1', name: 'Test' } })
    );
  });

// ---------------------------------------------------------------- browser

const profile = mkdtempSync(join(tmpdir(), 'plum-ext-'));
const extension = join(root, 'dist/chrome');
const chromium = spawn(
  process.env.PLUM_CHROMIUM || '/usr/local/bin/plum-chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--host-resolver-rules=MAP *.test 127.0.0.1',
    'about:blank',
  ],
  { stdio: 'ignore' }
);
await sleep(2500);

async function devtools(match) {
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const target = targets.find((t) => t.type === 'page' && match(t));
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => (socket.onopen = resolve));
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
  };
  return (method, params = {}) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
}

const options = await devtools(() => true);
await options('Page.navigate', { url: `chrome-extension://${EXTENSION_ID}/options.html` });
await sleep(1500);
const inExtension = async (expression) =>
  (await options('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))
    .result.result.value;

// ---------------------------------------------------------------- checks

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(28)} ${String(detail).replace(/\s+/g, ' ').slice(0, 110)}`
  );
}
const text = (reply) =>
  reply.ok ? String(reply.content?.[0]?.text ?? '') : `error: ${reply.error}`;

await inExtension(
  `chrome.storage.local.set({serverUrl:'http://127.0.0.1:${PORT}', token:'plum_ff_test', blockedSites:'secret.test', protectedSites:''}).then(() => chrome.runtime.sendMessage({plumReconnect:true}))`
);
for (let i = 0; i < 20 && !bridge; i += 1) await sleep(250);
check('connects', !!bridge);

let reply = await call('tab_open', { url: `http://open.test:${PORT}/` });
check('tab_open', reply.ok, text(reply));
reply = await call('tab_open', { url: `http://secret.test:${PORT}/` });
check('blocked tab_open refused', !reply.ok && /gesperrt/.test(reply.error), text(reply));
reply = await call('wait_for', { text: 'Wird geladen', gone: true, seconds: 5 });
check('wait_for gone', /Verschwunden/.test(text(reply)), text(reply));
reply = await call('wait_for', { url: 'open.test', seconds: 3 });
check('wait_for url', /Gefunden/.test(text(reply)), text(reply));
reply = await call('extract_table', {});
check('extract_table overview', /"index": 1/.test(text(reply)), text(reply));
reply = await call('extract_table', { index: 0 });
check(
  'extract_table data',
  /Aero 14/.test(text(reply)) && /Produkt/.test(text(reply)),
  text(reply)
);
const outline = text(await call('read_page', {}));
const button = (outline.match(/button "Knopf" \[(ref_\d+)\]/) || [])[1];
check('read_page ref', !!button, button);
reply = await call('get_page_text', { ref: button });
check('get_page_text ref', /Knopf/.test(text(reply)) && !/Aero/.test(text(reply)), text(reply));
reply = await call('screenshot', { ref: button });
check(
  'screenshot ref crop',
  reply.ok && reply.content[0].type === 'image',
  reply.content?.[1]?.text
);
reply = await call('status');
check(
  'status siteRules',
  /secret\.test/.test(text(reply)),
  JSON.parse(text(reply)).siteRules?.blocked
);

await inExtension(`chrome.runtime.sendMessage({plumStopSession:{id:'s1',stopped:true}})`);
reply = await call('find', { query: 'Knopf' });
check('stopped session refused', !reply.ok && /angehalten/.test(reply.error), text(reply));
await inExtension(`chrome.runtime.sendMessage({plumStopSession:{id:'s1',stopped:false}})`);
reply = await call('find', { query: 'Knopf' });
check('resumed session works', reply.ok, text(reply));

// Protected site: Escape on the approval card denies.
const page = await devtools((t) => t.url.includes('open.test'));
await inExtension(`chrome.storage.local.set({protectedSites:'open.test'})`);
await sleep(300);
const approval = call('click', { ref: button });
await sleep(1500);
for (const type of ['keyDown', 'keyUp'])
  await page('Input.dispatchKeyEvent', {
    type,
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
reply = await approval;
check('approval Escape denies', !reply.ok && /abgelehnt/.test(reply.error), text(reply));
await inExtension(`chrome.storage.local.set({protectedSites:''})`);
await sleep(300);

// In-page stop: a real click on the pill's button right after an action.
await call('hover', { ref: button });
const stopAt = (
  await page('Runtime.evaluate', {
    expression: `(() => { const host = document.querySelector('plum-browser-overlay'); return host ? 'present' : 'missing'; })()`,
    returnByValue: true,
  })
).result.result.value;
const size = JSON.parse(
  (
    await page('Runtime.evaluate', {
      expression: 'JSON.stringify([innerWidth, innerHeight])',
      returnByValue: true,
    })
  ).result.result.value
);
// The pill sits centred 18 px above the bottom; its stop button is at its right end.
for (const x of [size[0] / 2 + 70, size[0] / 2 + 85, size[0] / 2 + 100]) {
  for (const type of ['mousePressed', 'mouseReleased'])
    await page('Input.dispatchMouseEvent', {
      type,
      x,
      y: size[1] - 31,
      button: 'left',
      clickCount: 1,
    });
}
await sleep(300);
reply = await call('find', { query: 'Knopf' });
check(
  'in-page stop button',
  !reply.ok && /angehalten/.test(reply.error),
  `${stopAt} · ${text(reply)}`
);
await inExtension(`chrome.runtime.sendMessage({plumStopSession:{id:'s1',stopped:false}})`);

// Runaway guard: more than 60 inputs within a minute stop the session.
let tripped = 0;
for (let i = 1; i <= 64 && !tripped; i += 1) {
  reply = await call('press_key', { keys: 'Shift' });
  if (!reply.ok && /Notbremse/.test(reply.error)) tripped = i;
}
// Earlier inputs in the same minute count too, so it trips at or before the 61st.
check('runaway guard', tripped > 0 && tripped <= 61, `ausgelöst bei Aufruf ${tripped}`);
const state = await inExtension(`chrome.runtime.sendMessage({plumGetState:true})`);
check(
  'stop shown in state',
  state.sessions.some((session) => session.stopped)
);
check(
  'log has result + duration',
  state.recentActions.some((action) => action.result === 'error') &&
    state.recentActions.some((action) => typeof action.ms === 'number')
);

chromium.kill();
await new Promise((resolve) => chromium.once('exit', resolve));
http.close();
// Chromium's helper processes may still be writing; cleanup is best effort.
await sleep(500);
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
} catch {
  /* left in the temp dir */
}
console.log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'alle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
