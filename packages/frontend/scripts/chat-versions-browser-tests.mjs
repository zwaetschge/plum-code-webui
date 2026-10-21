// Model chat regenerate/edit-in-place, version switcher and sidebar chat menu against an
// isolated stateful fixture API (never production). Requires the Vite dev server.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE_PATH || '/tmp/pwnode/node_modules/playwright-core'
);
const url = process.env.PLUM_FIXTURE_URL || 'http://127.0.0.1:5188';
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):/.test(url));
mkdirSync('.screenshots', { recursive: true });
const stamp = '2026-10-19T12:00:00Z';

async function waitFor(description, check, timeout = 6000) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      const result = await check();
      if (result === true) return;
      last = result;
    } catch (error) {
      last = String(error).split('\n')[0];
    }
    if (Date.now() > deadline) throw new Error(`Expectation failed: ${description} (${last})`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
const visible = (locator, label) =>
  waitFor(label, async () => (await locator.isVisible()) || 'not visible');
const count = (locator, n, label) =>
  waitFor(label, async () => (await locator.count()) === n || `count ${await locator.count()}`);

const browser = await chromium.launch({
  executablePath: '/usr/local/bin/plum-chromium',
  headless: true,
});
let failed = false;
for (const [width, height] of [
  [1440, 1000],
  [390, 844],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(
    "localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'versions-fixture'},version:0}))"
  );
  const project = {
    id: 'project-1', kind: 'project', title: 'Hausumbau', revision: 1,
    body: { memoryMode: 'default' }, createdAt: stamp, updatedAt: stamp,
  };
  const projects = [project];
  const chats = [
    {
      id: 'chat-1', kind: 'api-chat', title: 'Obstfrage', revision: 1, createdAt: stamp,
      updatedAt: '2026-10-19T12:05:00Z',
      body: { providerId: 'fixture', model: 'fixture-model', projectId: null, sourceIds: [] },
    },
    {
      id: 'chat-2', kind: 'api-chat', title: 'Zweiter Chat', revision: 1, createdAt: stamp,
      updatedAt: stamp,
      body: { providerId: 'fixture', model: 'fixture-model', projectId: null, sourceIds: [] },
    },
  ];
  // Turn rows mirror the server: hidden_by labels and version_of roots.
  let seq = 0;
  const rows = [];
  const add = (prompt, extra = {}) => {
    const row = {
      id: `turn-${++seq}`, seq, prompt, response: `Antwort ${seq} auf ${prompt}`,
      status: 'completed', model: 'fixture-model', error: null, createdAt: stamp,
      sourceVersions: [], imageAssetIds: [], usage: null, profileId: null,
      profileRevision: null, hidden_by: null, version_of: null, ...extra,
    };
    rows.push(row);
    return row;
  };
  add('Nenne drei Obstsorten.');
  add('Und drei Gemüse?');
  const view = () => {
    const shown = rows.filter((r) => !r.hidden_by).sort((a, b) => a.seq - b.seq);
    return shown.map(({ hidden_by: _h, version_of, ...turn }) => {
      const root = version_of ?? turn.id;
      const ids = rows.filter((r) => (r.version_of ?? r.id) === root).map((r) => r.id);
      return ids.length > 1 ? { ...turn, versions: ids } : turn;
    });
  };
  const calls = [];
  await page.route('**/socket.io/**', (route) => route.abort());
  const handler = async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const body = request.postData() ? JSON.parse(request.postData()) : {};
    calls.push([request.method(), p, body]);
    let data = p.includes('settings') ? {} : [];
    if (p === '/auth/me')
      data = { id: 'alice', email: 'alice@example.invalid', username: 'Alice', role: 'admin' };
    else if (p === '/api/basic-auth/status') data = { enabled: false };
    else if (p === '/api/assistant/personalization')
      data = { revision: 0, nickname: '', voiceChat: false, suggestedPrompts: false, referencePhotos: { portrait: null, fullBody: null } };
    else if (p === '/api/assistant/api-chat-providers')
      data = [{ id: 'fixture', name: 'Testverbindung', protocol: 'openai', models: ['fixture-model'] }];
    else if (p === '/api/assistant/api-chats') data = chats;
    else if (p === '/api/assistant/projects/project-1/delete' && request.method() === 'POST') {
      projects.length = 0;
      for (const c of [...chats]) if (c.body.projectId === 'project-1') chats.splice(chats.indexOf(c), 1);
      data = { chats: 1 };
    } else if (p.startsWith('/api/assistant/projects')) data = projects;
    else {
      const m = p.match(/^\/api\/assistant\/api-chats\/([^/]+)(?:\/(.*))?$/);
      const chat = m && chats.find((c) => c.id === m[1]);
      const rest = m?.[2] ?? '';
      if (m && !chat) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Nicht gefunden' } }) });
        return;
      }
      if (chat && rest === 'turns' && request.method() === 'GET') data = { chat, turns: chat.id === 'chat-1' ? view() : [] };
      else if (chat && rest === 'turns' && request.method() === 'POST') {
        let versionOf = null;
        const next = { id: body.commandId };
        if (body.regenerate) {
          const target = rows.find((r) => r.id === body.regenerate && !r.hidden_by);
          assert.ok(target, 'regenerate targets a visible turn');
          versionOf = target.version_of ?? target.id;
          for (const r of rows) if (!r.hidden_by && r.seq >= target.seq) r.hidden_by = next.id;
        }
        const row = add(body.prompt, { id: next.id, version_of: versionOf });
        data = row;
      } else if (chat && /^turns\/[^/]+\/activate$/.test(rest)) {
        const target = rows.find((r) => r.id === rest.split('/')[1]);
        const root = target.version_of ?? target.id;
        const shown = rows.find((r) => !r.hidden_by && (r.version_of ?? r.id) === root);
        const label = target.hidden_by;
        for (const r of rows) if (!r.hidden_by && r.seq >= shown.seq) r.hidden_by = target.id;
        for (const r of rows) if (r.hidden_by === label) r.hidden_by = null;
        data = {};
      } else if (chat && rest === 'meta') {
        if (body.title) chat.title = body.title;
        if (body.projectId !== undefined) chat.body = { ...chat.body, projectId: body.projectId };
        chat.revision++;
        data = chat;
      } else if (chat && rest === 'delete') {
        chats.splice(chats.indexOf(chat), 1);
        data = {};
      } else if (chat && !rest) data = chat;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  };
  await page.route('**/api/**', handler);
  await page.route('**/auth/me', handler);
  let step = 'open chat';
  try {
    await page.goto(url + '/chat/model/chat-1');
    const main = page.locator('.plum-api-conversation');
    await visible(page.getByText('Antwort 2 auf Und drei Gemüse?'), 'second answer');
    step = 'regenerate last answer';
    await page.getByRole('button', { name: 'Neu generieren' }).last().click();
    await visible(page.getByText('Antwort 3 auf Und drei Gemüse?'), 'regenerated answer');
    await count(page.getByText('Antwort 2 auf Und drei Gemüse?'), 0, 'old answer hidden');
    assert.equal(page.url(), url + '/chat/model/chat-1', 'stays in the same chat');
    assert.ok(!calls.some(([, p]) => p.endsWith('/branches')), 'no new chat created');
    const switcher = page.getByRole('group', { name: 'Antwortversionen' });
    await visible(switcher.getByText('2/2'), 'version 2/2');
    step = 'switch back to version 1';
    await switcher.getByRole('button', { name: 'Vorherige Version' }).click();
    await visible(page.getByText('Antwort 2 auf Und drei Gemüse?'), 'old answer back');
    await visible(switcher.getByText('1/2'), 'version 1/2');
    await page.screenshot({ path: `.screenshots/chat-versions-${width}.png`, fullPage: false });
    step = 'edit first message in place';
    const firstUser = page.locator('.plum-api-user-row').first();
    await firstUser.hover();
    await firstUser.getByRole('button', { name: 'Nachricht bearbeiten' }).click();
    const editor = page.getByRole('textbox', { name: 'Nachricht bearbeiten' });
    await editor.fill('Nenne vier Obstsorten.');
    await page.screenshot({ path: `.screenshots/chat-edit-${width}.png`, fullPage: false });
    await page.locator('.plum-api-user-edit').getByRole('button', { name: 'Senden' }).click();
    await visible(page.getByText('Antwort 4 auf Nenne vier Obstsorten.'), 'edited answer');
    await count(main.getByText('Und drei Gemüse?', { exact: true }), 0, 'later thread hidden');
    step = 'restore earlier thread';
    await page.getByRole('group', { name: 'Antwortversionen' }).first().getByRole('button', { name: 'Vorherige Version' }).click();
    await visible(page.getByText('Antwort 2 auf Und drei Gemüse?'), 'whole earlier thread restored');
    step = 'sidebar menu';
    if (width < 768) await page.getByRole('button', { name: /Navigation|Menü/ }).first().click();
    const row = page.locator('.sidebar-session-row', { hasText: 'Zweiter Chat' });
    await row.hover();
    await row.getByRole('button', { name: 'Optionen für Zweiter Chat' }).click();
    const items = await page.getByRole('menuitem').allInnerTexts();
    assert.deepEqual(items.map((t) => t.trim()), ['Umbenennen', 'In Projekt verschieben', 'Archivieren', 'Löschen']);
    await page.screenshot({ path: `.screenshots/chat-menu-${width}.png`, fullPage: false });
    await page.getByRole('menuitem', { name: 'Umbenennen' }).click();
    const rename = page.getByRole('textbox', { name: 'Chat umbenennen' });
    await rename.fill('Gemüsechat');
    await rename.press('Enter');
    await visible(page.locator('.sidebar-session-row', { hasText: 'Gemüsechat' }), 'renamed');
    step = 'move to project';
    const renamed = page.locator('.sidebar-session-row', { hasText: 'Gemüsechat' });
    await renamed.hover();
    await renamed.getByRole('button', { name: 'Optionen für Gemüsechat' }).click();
    await page.getByRole('menuitem', { name: 'In Projekt verschieben' }).click();
    await page.getByRole('menuitem', { name: 'Hausumbau' }).click();
    await waitFor('moved', async () => chats.find((c) => c.id === 'chat-2')?.body.projectId === 'project-1' || 'not moved');
    step = 'project chat leaves history for its folder';
    const history = page.getByRole('navigation', { name: 'Gesprächsverlauf' });
    await count(history.locator('.sidebar-session-row', { hasText: 'Gemüsechat' }), 0, 'not in history');
    const folder = page.locator('.sidebar-project', { hasText: 'Hausumbau' });
    await folder.locator('summary').click();
    const inFolder = folder.locator('.sidebar-session-row', { hasText: 'Gemüsechat' });
    await visible(inFolder, 'chat in project folder');
    await page.screenshot({ path: `.screenshots/chat-project-folder-${width}.png`, fullPage: false });
    step = 'delete with confirmation';
    await inFolder.hover();
    await inFolder.getByRole('button', { name: 'Optionen für Gemüsechat' }).click();
    await page.getByRole('menuitem', { name: 'Löschen' }).click();
    const dialog = page.getByRole('dialog');
    await visible(dialog.getByText('Chat löschen?'), 'confirm dialog');
    await page.screenshot({ path: `.screenshots/chat-delete-${width}.png`, fullPage: false });
    await dialog.getByRole('button', { name: 'Löschen' }).click();
    await count(page.locator('.sidebar-session-row', { hasText: 'Gemüsechat' }), 0, 'deleted from sidebar');
    assert.ok(calls.some(([m, p]) => m === 'POST' && p === '/api/assistant/api-chats/chat-2/delete'));
    step = 'delete project with its chats';
    chats[0].body = { ...chats[0].body, projectId: 'project-1' };
    await page.goto(`${url}/chat/projects/project-1`);
    await visible(page.getByRole('button', { name: 'Optionen für Obstfrage' }), 'chat menu on project page');
    await page.getByRole('main').getByRole('button', { name: 'Optionen für Projekt Hausumbau' }).click();
    await page.getByRole('menuitem', { name: 'Projekt löschen' }).click();
    const projectDialog = page.getByRole('dialog');
    await visible(projectDialog.getByText('Projekt löschen?'), 'project confirm dialog');
    assert.match(await projectDialog.innerText(), /mit seinem Chat/);
    await page.screenshot({ path: `.screenshots/project-delete-${width}.png`, fullPage: false });
    await projectDialog.getByRole('button', { name: 'Löschen' }).click();
    await waitFor('back on project list', async () => new URL(page.url()).pathname === '/chat/projects' || page.url());
    await count(page.locator('.sidebar-project'), 0, 'folder gone from sidebar');
    assert.equal(chats.length, 0, 'project chat deleted with the project');
    assert.ok(!(await page.evaluate('document.documentElement.scrollWidth > innerWidth')), 'no horizontal overflow');
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: regenerate in place, version switcher, edit hides and restores later thread, sidebar rename/move/archive/delete with confirmation, project folders, project deletion with its chats`);
  } catch (error) {
    failed = true;
    await page.screenshot({ path: `.screenshots/chat-versions-failure-${width}.png` }).catch(() => {});
    console.log(`FAIL ${width}px at "${step}": ${error.message}\n  url=${page.url()} errors=${JSON.stringify(errors)}`);
  }
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
