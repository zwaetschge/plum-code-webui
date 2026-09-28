/**
 * End-to-end check of the Firefox browser bridge against a real Firefox.
 *
 * Starts the real BrowserBridge on its own port (not the live backend), pairs a
 * throwaway token, drives a Selenium Firefox container through WebDriver to
 * install the extension and fill in its options page, then runs every tool the
 * `firefox` MCP server exposes against a local test page.
 *
 *   FIREFOX_WEBDRIVER=http://<container-ip>:4444 BRIDGE_HOST=<this-container-ip> \
 *     E2E_USER_ID=<user id> tsx scripts/browser-bridge-e2e.ts
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runPendingMigrations } from '../src/db/migrations.js';
import { BrowserBridge } from '../src/services/browserBridge/bridge.js';
import { createBrowserToken, revokeBrowserToken } from '../src/services/browserBridge/tokens.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEBDRIVER = process.env.FIREFOX_WEBDRIVER || 'http://localhost:4444';
const BRIDGE_HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const PORT = Number(process.env.BRIDGE_PORT || 3099);
const USER_ID = process.env.E2E_USER_ID || '';
const XPI = path.resolve(here, '../../firefox-extension/dist/plum-browser-firefox.xpi');
// Chromium loads the unpacked build; the container must see this path (bind mount).
const CHROME_DIR = path.resolve(here, '../../firefox-extension/dist/chrome');
const BROWSER = process.env.E2E_BROWSER === 'chrome' ? 'chrome' : 'firefox';
const CHROME_EXT_ID = 'oaacdgkogibamjhjppjlhncjknlcigof';
const EXT_ID = 'plum-browser@zwaetschge-webui.ch';
const EXT_UUID = '6d1b2c3a-9f4e-4b7a-8c1d-0e2f3a4b5c6d';
const OUT = process.env.E2E_OUT || '/tmp/plum-ff-e2e';

const TEST_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Plum E2E</title></head>
<body style="font-family:sans-serif;padding:20px">
<h1>Plum Browser Testseite</h1>
<nav><a href="/second.html" id="next">Zur zweiten Seite</a></nav>
<form id="f" onsubmit="event.preventDefault();document.getElementById('out').textContent='Gesendet: '+document.getElementById('q').value+' / '+document.getElementById('color').value+' / '+document.getElementById('agree').checked;console.log('form submitted', document.getElementById('q').value)">
  <label for="q">Suchbegriff</label><input id="q" name="q" placeholder="Suche…">
  <label for="color">Farbe</label><select id="color"><option value="r">Rot</option><option value="g">Grün</option><option value="b">Blau</option></select>
  <label><input type="checkbox" id="agree"> Einverstanden</label>
  <button type="submit">Absenden</button>
</form>
<div contenteditable="true" id="editor" aria-label="Editor" style="border:1px solid #999;min-height:40px"></div>
<button id="counter" onclick="this.dataset.n=(+this.dataset.n||0)+1;this.textContent='Zähler '+this.dataset.n">Zähler 0</button>
<p id="out">noch nichts</p>
<div style="height:3000px"></div><p id="bottom">Ganz unten</p>
<script>console.log('page ready');console.warn('a warning');window.pageSecret=42;</script>
</body></html>`;

async function wd(method: string, route: string, body?: unknown): Promise<any> {
  const response = await fetch(`${WEBDRIVER}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as { value: any };
  if (!response.ok)
    throw new Error(`WebDriver ${method} ${route}: ${JSON.stringify(json.value).slice(0, 400)}`);
  return json.value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function textOf(result: { content: Array<Record<string, unknown>> }): string {
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => String(item.text))
    .join('\n');
}

async function main(): Promise<void> {
  assert.ok(USER_ID, 'E2E_USER_ID is required');
  await runPendingMigrations();
  const { token, row } = await createBrowserToken(USER_ID, 'E2E Firefox');
  const bridge = new BrowserBridge();
  const server = createServer((req, res) => {
    if (req.url === '/test.html' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(TEST_PAGE);
    } else if (req.url?.startsWith('/session/')) {
      // Stands in for the Plum chat: framing is forbidden, as on the real server.
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-frame-options': 'DENY',
        'content-security-policy': "frame-ancestors 'none'",
      });
      res.end('<!doctype html><title>Chat</title><h1 id="chat">Plum-Chat-Testseite</h1>');
    } else if (req.url === '/second.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>Zweite Seite</title><h1>Zweite Seite erreicht</h1>');
    } else {
      res.writeHead(404).end();
    }
  });
  bridge.attach(server);
  await new Promise<void>((resolve) => server.listen(PORT, '0.0.0.0', resolve));
  const base = `http://${BRIDGE_HOST}:${PORT}`;
  console.log(`[e2e] bridge on ${base}`);

  let sessionId: string | null = null;
  const results: Record<string, string> = {};
  try {
    const extensionPage =
      BROWSER === 'chrome' ? `chrome-extension://${CHROME_EXT_ID}` : `moz-extension://${EXT_UUID}`;
    const created = await wd('POST', '/session', {
      capabilities: {
        alwaysMatch:
          BROWSER === 'chrome'
            ? {
                browserName: 'chrome',
                'goog:chromeOptions': {
                  args: [
                    `--load-extension=${CHROME_DIR}`,
                    '--disable-features=DisableLoadExtensionCommandLineSwitch',
                    '--window-size=1400,1000',
                  ],
                },
              }
            : {
                browserName: 'firefox',
                'moz:firefoxOptions': {
                  prefs: {
                    'extensions.webextensions.uuids': JSON.stringify({ [EXT_ID]: EXT_UUID }),
                  },
                },
              },
      },
    });
    sessionId = created.sessionId;
    const caps = created.capabilities;
    console.log(`[e2e] ${caps.browserName} ${caps.browserVersion}`);
    if (BROWSER === 'firefox') {
      await wd('POST', `/session/${sessionId}/moz/addon/install`, {
        addon: readFileSync(XPI).toString('base64'),
        temporary: true,
      });
    }
    await sleep(1500);
    // The extension opens its options page itself on install — switch to that tab.
    // (ChromeDriver does not list that tab, but may navigate to extension pages.)
    let found = false;
    if (BROWSER === 'chrome') {
      await wd('POST', `/session/${sessionId}/url`, { url: `${extensionPage}/options.html` });
      found = true;
    }
    for (let attempt = 0; attempt < 20 && !found; attempt++) {
      for (const handle of (await wd('GET', `/session/${sessionId}/window/handles`)) as string[]) {
        await wd('POST', `/session/${sessionId}/window`, { handle });
        const url = (await wd('GET', `/session/${sessionId}/url`)) as string;
        if (url.startsWith(`${extensionPage}/options.html`)) {
          found = true;
          break;
        }
      }
      if (!found) await sleep(500);
    }
    assert.ok(found, 'options page did not open on install');
    const fill = async (selector: string, value: string) => {
      const el = await wd('POST', `/session/${sessionId}/element`, {
        using: 'css selector',
        value: selector,
      });
      const id = Object.values(el)[0] as string;
      await wd('POST', `/session/${sessionId}/element/${id}/clear`, {});
      await wd('POST', `/session/${sessionId}/element/${id}/value`, { text: value });
    };
    await fill('#serverUrl', base);
    await fill('#token', token);
    await fill('#label', 'E2E Firefox');
    const submit = await wd('POST', `/session/${sessionId}/element`, {
      using: 'css selector',
      value: 'button[type=submit]',
    });
    await wd('POST', `/session/${sessionId}/element/${Object.values(submit)[0]}/click`, {});

    for (let i = 0; i < 40 && bridge.listConnections(USER_ID).length === 0; i++) await sleep(250);
    const connections = bridge.listConnections(USER_ID);
    assert.equal(connections.length, 1, 'extension did not connect');
    console.log(`[e2e] connected: ${JSON.stringify(connections[0])}`);
    const optionsShot = await wd('GET', `/session/${sessionId}/screenshot`);
    writeFileSync(`${OUT}-options.png`, Buffer.from(optionsShot, 'base64'));

    const session = { id: 'e2e-session', name: 'E2E Test' };
    const call = async (tool: string, args: Record<string, unknown> = {}) => {
      const result = await bridge.call(USER_ID, session, tool, args, { timeoutMs: 60_000 });
      const text = textOf(result);
      results[tool] = text;
      console.log(
        `\n=== ${tool} ${JSON.stringify(args).slice(0, 120)}${result.isError ? ' (ERROR)' : ''}\n${text.slice(0, 900)}`
      );
      return { ...result, text };
    };

    let r = await call('status');
    assert.ok(!r.isError);
    r = await call('tab_open', { url: `${base}/test.html` });
    assert.ok(!r.isError && r.text.includes('Plum E2E'), 'tab_open');
    r = await call('read_page');
    assert.ok(r.text.includes('Suchbegriff') && r.text.includes('ref_'), 'read_page');
    const refFor = (text: string, needle: string) => {
      const line = text.split('\n').find((candidate) => candidate.includes(needle));
      const match = line?.match(/\[(ref_\d+)\]/);
      assert.ok(match, `no ref for ${needle}`);
      return match[1];
    };
    const inputRef = refFor(r.text, 'Suchbegriff');
    const selectRef = refFor(r.text, 'combobox');
    const checkboxRef = refFor(r.text, 'checkbox');
    r = await call('type', { ref: inputRef, text: 'Firefox Test' });
    assert.ok(r.text.includes('Firefox Test'), 'type');
    r = await call('form_input', { ref: selectRef, value: 'Grün' });
    assert.ok(!r.isError, 'form_input select');
    r = await call('form_input', { ref: checkboxRef, value: true });
    assert.ok(r.text.includes('aktiviert'), 'form_input checkbox');
    r = await call('find', { query: 'Absenden' });
    const submitRef = refFor(r.text, 'Absenden');
    r = await call('click', { ref: submitRef });
    r = await call('get_page_text');
    assert.ok(r.text.includes('Gesendet: Firefox Test / g / true'), 'form submit via click');
    r = await call('find', { query: 'Zähler' });
    const counterRef = refFor(r.text, 'Zähler');
    await call('click', { ref: counterRef });
    r = await call('click', { ref: counterRef, double: true });
    r = await call('find', { query: 'Zähler' });
    assert.ok(r.text.includes('Zähler 3'), 'click counter');
    r = await call('type', {
      ref: refFor((await call('find', { query: 'Editor' })).text, 'Editor'),
      text: 'Hallo Editor',
    });
    assert.ok(r.text.includes('Hallo Editor'), 'contenteditable');
    r = await call('type', { ref: inputRef, text: 'per Enter', clear: true, submit: true });
    r = await call('get_page_text');
    assert.ok(r.text.includes('Gesendet: per Enter'), 'enter submits form');
    r = await call('press_key', { keys: 'Tab' });
    assert.ok(!r.isError, 'press_key');
    r = await call('scroll', { direction: 'down', amount: 2 });
    assert.ok(/gescrollt/.test(r.text), 'scroll');
    r = await call('scroll', { direction: 'top' });
    r = await call('evaluate_js', {
      code: 'return { secret: window.pageSecret, title: document.title }',
    });
    assert.ok(r.text.includes('42'), 'evaluate_js page context');
    r = await call('read_console');
    r = await call('navigate', { url: 'reload' });
    r = await call('read_console');
    assert.ok(r.text.includes('page ready'), 'console capture after reload');
    const shot = await bridge.call(USER_ID, session, 'screenshot', {}, { timeoutMs: 30_000 });
    const image = shot.content.find((item) => item.type === 'image');
    assert.ok(image, 'screenshot image');
    writeFileSync(`${OUT}-screenshot.jpg`, Buffer.from(String(image.data), 'base64'));
    console.log(`\n=== screenshot ${textOf(shot)}`);
    r = await call('click', {
      ref: refFor((await call('find', { query: 'Zur zweiten Seite' })).text, 'Zur zweiten'),
    });
    assert.ok(r.text.includes('second.html'), 'link navigation reported');
    r = await call('navigate', { url: 'back' });
    assert.ok(r.text.includes('test.html'), 'navigate back');
    r = await call('wait_for', { text: 'Testseite', seconds: 5 });
    assert.ok(r.text.startsWith('Gefunden'), 'wait_for');
    r = await call('tab_open', { url: `${base}/second.html` });
    r = await call('tabs_list');
    assert.equal((JSON.parse(r.text).tabs as unknown[]).length, 2, 'two tabs in group');
    // A second session must not see the first session's tabs.
    const other = await bridge.call(
      USER_ID,
      { id: 'e2e-other', name: 'Andere Session' },
      'tabs_list',
      {}
    );
    assert.equal(JSON.parse(textOf(other)).tabs.length, 0, 'session isolation');
    const foreign = await bridge.call(
      USER_ID,
      { id: 'e2e-other', name: 'Andere Session' },
      'read_page',
      {}
    );
    assert.ok(foreign.isError, 'other session cannot read without its own tab');
    const statusText = (await call('status')).text;
    console.log(
      `\n[e2e] group check: ${statusText.includes('native Firefox tab groups') ? 'native tab groups' : 'fallback'}`
    );
    const finalShot = await wd('GET', `/session/${sessionId}/screenshot`);
    writeFileSync(`${OUT}-window.png`, Buffer.from(finalShot, 'base64'));
    if (BROWSER === 'chrome') {
      // The session chat opens as a docked popup window. ChromeDriver does not
      // list extension-created popups, so check from an extension page instead.
      await wd('POST', `/session/${sessionId}/window/new`, { type: 'tab' });
      const handles = (await wd('GET', `/session/${sessionId}/window/handles`)) as string[];
      await wd('POST', `/session/${sessionId}/window`, { handle: handles[handles.length - 1] });
      await wd('POST', `/session/${sessionId}/url`, { url: `${extensionPage}/options.html` });
      const probe = (await wd('POST', `/session/${sessionId}/execute/async`, {
        script: `const done = arguments[0];
          (async () => {
            const state = await chrome.runtime.sendMessage({ plumGetState: true });
            const own = state.sessions.find((entry) => entry.id === 'e2e-session');
            const wins = await chrome.windows.getAll({ populate: true });
            const popup = wins.find((win) => win.type === 'popup' && win.tabs.some((tab) => tab.url.includes('/session/e2e-session')));
            let text = null;
            if (popup) {
              const [res] = await chrome.scripting.executeScript({ target: { tabId: popup.tabs[0].id }, func: () => document.getElementById('chat')?.textContent });
              text = res.result;
            }
            done(JSON.stringify({ chatWindowId: own && own.chatWindowId, popupId: popup && popup.id, left: popup && popup.left, text }));
          })().catch((error) => done(JSON.stringify({ error: error.message })));`,
        args: [],
      })) as string;
      console.log(`[e2e] chat window probe ${probe}`);
      const chat = JSON.parse(probe);
      assert.equal(chat.text, 'Plum-Chat-Testseite', 'chat window content');
      assert.equal(chat.chatWindowId, chat.popupId, 'chat window tracked');
      console.log('[e2e] chat window shows the session chat');
    }
    console.log('\n[e2e] ALL CHECKS PASSED');
  } finally {
    await revokeBrowserToken(USER_ID, row.id).catch(() => {});
    if (sessionId && !process.env.E2E_KEEP)
      await wd('DELETE', `/session/${sessionId}`).catch(() => {});
    bridge.close();
    server.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error('[e2e] FAILED:', error);
    process.exit(1);
  }
);
