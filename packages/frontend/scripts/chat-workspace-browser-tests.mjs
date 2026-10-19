// Real Chat UI regression with an isolated, stateful API (never production).
// Node ESM port of chat-workspace-browser-tests.py (playwright-core, no @playwright/test expect).
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightPath =
  process.env.PLAYWRIGHT_CORE_PATH || '/tmp/pwnode/node_modules/playwright-core';
const { chromium } = require(playwrightPath);

const url = process.env.PLUM_FIXTURE_URL || 'http://127.0.0.1:5188';
assert.ok(url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:'));
const output = '.screenshots';
mkdirSync(output, { recursive: true });
const stamp = '2026-10-19T12:00:00Z';
const EXPECT_TIMEOUT = 5000;

function resource(id, kind, title, body) {
  return { id, kind, title, body, revision: 1, createdAt: stamp, updatedAt: stamp };
}

// Minimal polling replacement for Playwright's expect().
async function waitFor(description, check, timeout = EXPECT_TIMEOUT) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      const result = await check();
      if (result === true) return;
      last = result;
    } catch (error) {
      last = error instanceof Error ? error.message.split('\n')[0] : String(error);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Expectation failed: ${description} (last: ${typeof last === 'string' ? last : JSON.stringify(last)})`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const expectVisible = (locator, label) =>
  waitFor(`${label} visible`, async () => (await locator.isVisible()) || 'not visible');
const expectCount = (locator, count, label) =>
  waitFor(`${label} count == ${count}`, async () => {
    const actual = await locator.count();
    return actual === count || `count ${actual}`;
  });
const expectChecked = (locator, label) =>
  waitFor(
    `${label} checked`,
    async () => (await locator.isChecked({ timeout: 1000 })) || 'not checked'
  );
const expectValue = (locator, value, label) =>
  waitFor(`${label} value == ${JSON.stringify(value)}`, async () => {
    const actual = await locator.inputValue({ timeout: 1000 });
    return actual === value || `value ${JSON.stringify(actual)}`;
  });
const expectAttribute = (locator, name, value, label) =>
  waitFor(`${label} [${name}] == ${JSON.stringify(value)}`, async () => {
    const actual = await locator.getAttribute(name, { timeout: 1000 });
    return actual === value || `${name}=${JSON.stringify(actual)}`;
  });
const expectURL = (page, expected) =>
  waitFor(`URL == ${expected}`, async () => page.url() === expected || `url ${page.url()}`);

const browser = await chromium.launch({
  executablePath: '/usr/local/bin/plum-chromium',
  headless: true,
});
let failed = false;
try {
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.addInitScript(
      "localStorage.setItem('claude-webui-auth',JSON.stringify({state:{token:'workspace-fixture'},version:0}))"
    );
    const state = {
      profiles: [],
      projects: [],
      sources: [
        resource('reference', 'source', 'Stilhandbuch', { text: 'Klare Sprache verwenden.' }),
      ],
      'api-chats': [],
    };
    const calls = [];
    const turns = [];
    let failNextSave = false;
    const providers = [
      {
        id: 'fixture',
        name: 'Testverbindung',
        protocol: 'openai',
        models: ['fixture-model', 'preferred-model'],
      },
    ];
    const kinds = {
      profiles: 'profile',
      projects: 'project',
      sources: 'source',
      'api-chats': 'api-chat',
    };

    const api = async (route) => {
      try {
        const request = route.request();
        const reqPath = new URL(request.url()).pathname;
        const postData = request.postData();
        const contentType = request.headers()['content-type'] || '';
        const payload =
          postData && contentType.includes('application/json') ? JSON.parse(postData) : {};
        calls.push([request.method(), reqPath, payload]);
        let data = reqPath.includes('settings') ? {} : [];
        const parts = (
          reqPath.startsWith('/api/assistant/') ? reqPath.slice('/api/assistant/'.length) : reqPath
        ).split('/');
        const collection = parts[0];
        if (reqPath === '/auth/me') {
          data = {
            id: 'workspace-alice',
            email: 'alice@example.invalid',
            username: 'Alice',
            role: 'admin',
          };
        } else if (reqPath === '/api/basic-auth/status') {
          data = { enabled: false };
        } else if (reqPath === '/api/assistant/personalization') {
          data = {
            revision: 0,
            nickname: '',
            voiceChat: false,
            suggestedPrompts: false,
            referencePhotos: { portrait: null, fullBody: null },
          };
        } else if (reqPath === '/api/assistant/api-chat-providers') {
          data = providers;
        } else if (reqPath === '/api/assistant/overview') {
          data = { counts: {}, recent: [], tasks: [], agents: [] };
        } else if (reqPath === '/api/assistant/references') {
          const ids = payload.ids || [];
          data = Object.values(state)
            .flat()
            .filter((item) => ids.includes(item.id));
        } else if (Object.prototype.hasOwnProperty.call(state, collection)) {
          const rows = state[collection];
          if (parts.length === 1) {
            if (request.method() === 'POST') {
              if (failNextSave) {
                failNextSave = false;
                await route.fulfill({
                  status: 422,
                  contentType: 'application/json',
                  body: JSON.stringify({
                    success: false,
                    error: { message: 'Speichern fehlgeschlagen. Bitte erneut versuchen.' },
                  }),
                });
                return;
              }
              data = resource(
                `${collection}-${rows.length + 1}`,
                kinds[collection],
                payload.title,
                'body' in payload ? payload.body : payload
              );
              rows.push(data);
            } else {
              data = rows;
            }
          } else {
            const item = rows.find((row) => row.id === parts[1]) ?? null;
            if (parts.length === 3 && parts[2] === 'turns') {
              if (request.method() === 'POST') {
                data = {
                  id: payload.commandId,
                  seq: turns.length + 1,
                  prompt: payload.prompt,
                  response: 'Antwort mit gemeinsamem Projektwissen.',
                  status: 'completed',
                  model: 'preferred-model',
                  sourceVersions: [],
                  imageAssetIds: [],
                  usage: null,
                  createdAt: stamp,
                };
                turns.push(data);
              } else {
                data = { chat: item, turns };
              }
            } else if (request.method() === 'PATCH') {
              assert.equal(payload.expectedRevision, item.revision);
              Object.assign(item, {
                title: payload.title,
                body: 'body' in payload ? payload.body : { ...item.body, ...payload },
                revision: item.revision + 1,
              });
              data = item;
            } else if (request.method() === 'DELETE') {
              assert.equal(payload.expectedRevision, item.revision);
              rows.splice(rows.indexOf(item), 1);
              data = item;
            } else {
              data = item;
            }
          }
        }
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data }),
        });
      } catch (error) {
        errors.push(`fixture handler: ${error instanceof Error ? error.message : error}`);
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { message: 'fixture error' } }),
        });
      }
    };

    await page.route('**/api/**', api);
    await page.route('**/auth/me', api);
    await page.route('**/socket.io/**', (route) => route.abort());

    let step = 'start';
    try {
      step = 'open assistants';
      await page.goto(url + '/chat/assistants');
      await expectVisible(
        page.getByRole('heading', { name: 'Deine Assistenten', exact: true }),
        'heading Deine Assistenten'
      );
      await expectCount(page.getByRole('dialog'), 0, 'dialog');

      step = 'create expert';
      await page.getByRole('link', { name: 'Neuer Assistent', exact: true }).click();
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Schreibcoach');
      await page
        .getByRole('textbox', { name: 'Anweisungen', exact: true })
        .fill('Antworte klar und auf Deutsch.');
      await expectCount(
        page.getByRole('textbox', { name: 'Gemeinsame Erinnerungen' }),
        0,
        'textbox Gemeinsame Erinnerungen'
      );
      await expectChecked(page.getByRole('radio', { name: 'Aus' }), "radio 'Aus'");
      await page.getByRole('radio', { name: 'Nutzen und dazulernen' }).check();
      await page.getByText('Modell und Wissen', { exact: true }).click();
      await page
        .getByRole('combobox', { name: 'Bevorzugte API-Verbindung', exact: true })
        .selectOption('fixture');
      await page
        .getByRole('combobox', { name: 'Bevorzugtes Modell', exact: true })
        .selectOption('preferred-model');
      await page.getByRole('checkbox', { name: 'Stilhandbuch', exact: true }).check();

      step = 'failed save keeps draft';
      failNextSave = true;
      await page.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expectVisible(page.getByRole('alert'), 'alert');
      await expectValue(
        page.getByRole('textbox', { name: 'Name', exact: true }),
        'Schreibcoach',
        'textbox Name'
      );

      step = 'save expert';
      await page.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expectURL(page, url + '/chat/assistants/profiles-1');
      assert.deepEqual(state.profiles[0].body.sourceIds, ['reference']);
      assert.equal(state.profiles[0].body.memory, 'read-write');
      assert.ok(!('sharedMemories' in state.profiles[0].body));

      step = 'edit expert';
      await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
      await expectValue(
        page.getByRole('textbox', { name: 'Anweisungen', exact: true }),
        'Antworte klar und auf Deutsch.',
        'textbox Anweisungen'
      );
      await page
        .getByRole('textbox', { name: 'Anweisungen', exact: true })
        .fill('Antworte klar, kurz und auf Deutsch.');
      await page.screenshot({
        path: path.join(output, `chat-workspace-editor-${width}.png`),
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expectURL(page, url + '/chat/assistants/profiles-1');
      assert.equal(state.profiles[0].revision, 2);

      step = 'create project';
      await page.goto(url + '/chat/projects');
      await page.getByRole('link', { name: 'Neues Projekt', exact: true }).click();
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Hausumbau');
      await page
        .getByRole('textbox', { name: 'Beschreibung', exact: true })
        .fill('Alle Gespräche zum Umbau');
      await page
        .getByRole('textbox', { name: 'Anweisungen', exact: true })
        .fill('Budget in Schweizer Franken berücksichtigen.');
      await expectChecked(
        page.getByRole('radio', { name: 'Standardgedächtnis' }),
        "radio 'Standardgedächtnis'"
      );
      await page.getByRole('radio', { name: 'Nur Projektgedächtnis' }).check();
      await page.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expectURL(page, url + '/chat/projects/projects-1');
      assert.equal(state.projects[0].body.memoryMode, 'project-only');
      await expectVisible(
        page.getByText('Nur Projektgedächtnis', { exact: true }).first(),
        "text 'Nur Projektgedächtnis'"
      );

      step = 'project source create/edit';
      await page
        .getByRole('navigation', { name: 'Projektinhalt' })
        .getByRole('link', { name: 'Quellen', exact: true })
        .click();
      await page.getByRole('link', { name: 'Neue Projektquelle', exact: true }).click();
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Umbau-Budget');
      await page
        .getByRole('textbox', { name: 'Quellentext', exact: true })
        .fill('Das Gesamtbudget beträgt 20000 CHF.');
      await page.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expectVisible(page.getByRole('link', { name: 'Umbau-Budget' }), 'link Umbau-Budget');
      assert.equal(state.sources.at(-1).body.projectId, 'projects-1');
      await page.getByRole('link', { name: 'Umbau-Budget' }).click();
      await page
        .getByRole('textbox', { name: 'Quellentext', exact: true })
        .fill('Das Gesamtbudget beträgt 25000 CHF.');
      await page.getByRole('button', { name: 'Speichern', exact: true }).click();

      step = 'new chat from project';
      await page
        .getByRole('navigation', { name: 'Projektinhalt' })
        .getByRole('link', { name: 'Gespräche', exact: true })
        .click();
      await page
        .getByRole('combobox', { name: 'Assistent', exact: true })
        .selectOption('profiles-1');
      await expectAttribute(
        page.getByRole('link', { name: 'Neuer Chat', exact: true }).last(),
        'href',
        '/chat?assistant=profiles-1&project=projects-1',
        'last link Neuer Chat'
      );
      await page.getByRole('link', { name: 'Neuer Chat', exact: true }).last().click();
      const workspace = page.locator('section[aria-label="Assistent und Projekt"]');
      await expectValue(
        workspace.getByRole('combobox', { name: 'Assistent', exact: true }),
        'profiles-1',
        'workspace Assistent'
      );
      await expectValue(
        workspace.getByRole('combobox', { name: 'Projekt', exact: true }),
        'projects-1',
        'workspace Projekt'
      );
      await page
        .getByRole('textbox', { name: 'Deine Nachricht', exact: true })
        .fill('Wie verteile ich mein Budget?');
      await page.getByRole('button', { name: 'Nachricht senden', exact: true }).click();
      await expectURL(page, url + '/chat/model/api-chats-1');
      await expectVisible(
        page.getByText('Antwort mit gemeinsamem Projektwissen.', { exact: true }),
        'text Antwort mit gemeinsamem Projektwissen.'
      );
      const creation = calls.find(
        ([method, p]) => method === 'POST' && p === '/api/assistant/api-chats'
      )?.[2];
      assert.ok(creation, 'api-chat creation call missing');
      assert.ok(
        creation.profileId === 'profiles-1' && creation.projectId === 'projects-1',
        JSON.stringify(creation)
      );
      assert.ok(
        creation.providerId === 'fixture' && creation.model === 'preferred-model',
        JSON.stringify(creation)
      );
      assert.ok(!calls.some(([method, p]) => method === 'POST' && p === '/api/sessions'));

      step = 'existing chat in project';
      const trail = page.getByRole('navigation', { name: 'Gesprächs-Arbeitsbereich' });
      await expectVisible(
        trail.getByRole('link', { name: 'Hausumbau', exact: true }),
        'trail link Hausumbau'
      );
      await trail.getByRole('link', { name: 'Hausumbau', exact: true }).click();
      await expectAttribute(
        page
          .locator('main')
          .last()
          .getByRole('link', { name: 'Wie verteile ich mein Budget?', exact: false }),
        'href',
        '/chat/model/api-chats-1',
        'chat link in project'
      );
      await page.screenshot({
        path: path.join(output, `chat-workspace-project-${width}.png`),
        fullPage: true,
      });
      assert.ok(
        !(await page.evaluate('document.documentElement.scrollWidth > innerWidth')),
        'horizontal overflow'
      );
      await expectCount(page.getByRole('dialog'), 0, 'dialog');

      step = 'expert filter';
      state.profiles.push(
        resource('other-expert', 'profile', 'Planungscoach', { instructions: 'Plane sachlich.' })
      );
      await page.goto(url + '/chat/projects/projects-1');
      await page
        .getByRole('combobox', { name: 'Assistent', exact: true })
        .selectOption('other-expert');
      await expectCount(
        page
          .locator('main')
          .last()
          .getByRole('link', { name: 'Wie verteile ich mein Budget?', exact: false }),
        0,
        'chat link (filtered out)'
      );
      await page
        .getByRole('combobox', { name: 'Assistent', exact: true })
        .selectOption('profiles-1');
      await expectVisible(
        page
          .locator('main')
          .last()
          .getByRole('link', { name: 'Wie verteile ich mein Budget?', exact: false }),
        'chat link (filtered in)'
      );

      step = 'edit project memory + Back';
      await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click();
      await page.getByRole('radio', { name: 'Standardgedächtnis' }).check();
      await page.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expectURL(page, url + '/chat/projects/projects-1');
      assert.equal(state.projects[0].body.memoryMode, 'default');
      await page.goBack();
      await expectVisible(
        page.getByRole('heading', { name: 'Projekt bearbeiten', exact: true }),
        'heading Projekt bearbeiten'
      );
      await page.getByRole('link', { name: 'Abbrechen', exact: true }).click();

      step = 'archive source';
      await page
        .getByRole('navigation', { name: 'Projektinhalt' })
        .getByRole('link', { name: 'Quellen', exact: true })
        .click();
      await page.getByRole('link', { name: 'Umbau-Budget' }).click();
      await page.getByRole('button', { name: 'Archivieren', exact: true }).click();
      await expectCount(page.getByRole('link', { name: 'Umbau-Budget' }), 0, 'link Umbau-Budget');

      step = 'archive expert';
      await page.goto(url + '/chat/assistants/profiles-1/edit');
      await page.getByRole('button', { name: 'Archivieren', exact: true }).click();
      await expectVisible(
        page.getByRole('heading', { name: 'Deine Assistenten', exact: true }),
        'heading Deine Assistenten'
      );
      assert.ok(!state.profiles.some((r) => r.id === 'profiles-1'));

      step = 'legacy redirects';
      await page.goto(url + '/chat?library=projects&resource=projects-1');
      await expectURL(page, url + '/chat/projects/projects-1');
      await page.goto(url + '/chat?workspace=projects&project=projects-1');
      await expectURL(page, url + '/chat/projects/projects-1');
      await expectCount(page.getByRole('dialog'), 0, 'dialog');
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${width}px: full-page expert/project create/edit; expert memory setting; ChatGPT project memory choice; source lifecycle; preferred model from deep link; new/existing chat navigation; expert filter; browser Back; legacy redirects; no dialogs, JS errors or horizontal overflow`
      );
    } catch (error) {
      failed = true;
      const shot = path.join(output, `chat-workspace-failure-${width}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      console.log(
        `FAIL ${width}px at step "${step}": ${error instanceof Error ? error.message : error}`
      );
      console.log(`  url: ${page.url()}`);
      if (errors.length) console.log(`  page errors: ${JSON.stringify(errors)}`);
      console.log(`  screenshot: ${shot}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
