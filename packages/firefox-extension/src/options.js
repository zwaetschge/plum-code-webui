'use strict';

const $ = (id) => document.getElementById(id);

const STATUS_TEXT = PLUM_STATUS_TEXT;
let lastState = null;

function showMessage(text, kind) {
  const box = $('message');
  box.textContent = text;
  box.className = `message ${kind}`;
  box.hidden = !text;
}

function renderStatus(state) {
  lastState = state;
  renderUpdate(state);
  renderFacts(state);
  $('dot').className =
    `dot ${state.paused && state.status === 'connected' ? 'paused' : state.status}`;
  const base = STATUS_TEXT[state.status] || state.status;
  $('status').textContent =
    state.status === 'connected'
      ? state.paused
        ? 'Verbunden · pausiert'
        : base
      : `${base}${state.statusDetail && state.statusDetail !== base ? ` – ${state.statusDetail}` : ''}`;
}

async function load() {
  const settings = await plumLoadSettings();
  $('serverUrl').value = settings.serverUrl;
  $('token').value = settings.token;
  $('label').value = settings.label;
  $('paused').checked = settings.paused;
  $('allowJs').checked = settings.allowJs;
  $('protectedSites').value = settings.protectedSites;
  $('blockedSites').value = settings.blockedSites;
  renderUsageProviders(settings.usageHidden);
  void renderShortcuts();
  renderStatus(await browser.runtime.sendMessage({ plumGetState: true }));
}

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  let serverUrl;
  try {
    serverUrl = plumNormalizeServerUrl($('serverUrl').value);
  } catch {
    showMessage('Die Plum-Adresse ist keine gültige URL.', 'error');
    return;
  }
  const token = $('token').value.trim();
  if (!token.startsWith('plum_ff_')) {
    showMessage(
      'Der Token muss mit „plum_ff_“ beginnen – erzeuge ihn in Plum unter Settings → Browser control.',
      'error'
    );
    return;
  }
  $('serverUrl').value = serverUrl;
  showMessage('Verbinde …', 'ok');
  await plumSaveSettings({ serverUrl, token, label: $('label').value.trim(), wsPath: '' });
  // Resolves once the background page has either connected or given up on every endpoint.
  const state = await browser.runtime.sendMessage({ plumReconnect: true });
  renderStatus(state);
  if (state.status === 'connected')
    showMessage('Verbunden. Deine Plum-Agents können jetzt diesen Browser steuern.', 'ok');
  else
    showMessage(
      `Verbindung fehlgeschlagen: ${state.statusDetail || 'unbekannter Fehler'}`,
      'error'
    );
});

$('disconnect').addEventListener('click', async () => {
  renderStatus(await browser.runtime.sendMessage({ plumDisconnect: true }));
  showMessage(
    `Getrennt. Beim nächsten Speichern oder ${PLUM_IS_CHROME ? 'Browser' : 'Firefox'}-Start wird wieder verbunden.`,
    'ok'
  );
});

$('paused').addEventListener('change', () => plumSaveSettings({ paused: $('paused').checked }));
$('allowJs').addEventListener('change', () => plumSaveSettings({ allowJs: $('allowJs').checked }));
$('protectedSites').addEventListener('change', () =>
  plumSaveSettings({ protectedSites: $('protectedSites').value })
);
$('blockedSites').addEventListener('change', () =>
  plumSaveSettings({ blockedSites: $('blockedSites').value })
);
// Site rules can also change from the popup or panel ("Diese Seite").
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const key of ['protectedSites', 'blockedSites', 'paused', 'allowJs']) {
    if (!(key in changes) || document.activeElement === $(key)) continue;
    const value = changes[key].newValue;
    if (typeof value === 'boolean') $(key).checked = value;
    else $(key).value = value ?? '';
  }
});

// ---------------------------------------------------------------- usage providers

/** One switch per provider; unchecked ones are hidden in the popup and the icon ring. */
function renderUsageProviders(hidden) {
  const off = new Set(Array.isArray(hidden) ? hidden : []);
  $('usageProviders').replaceChildren(
    ...PLUM_USAGE_PROVIDERS.map(([id, label]) => {
      const row = document.createElement('label');
      row.className = 'field toggle';
      const name = document.createElement('span');
      name.textContent = label;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !off.has(id);
      box.dataset.provider = id;
      box.addEventListener('change', () => {
        const usageHidden = [...$('usageProviders').querySelectorAll('input')]
          .filter((input) => !input.checked)
          .map((input) => input.dataset.provider);
        void plumSaveSettings({ usageHidden });
      });
      row.append(name, box);
      return row;
    })
  );
}

// ---------------------------------------------------------------- one-paste pairing

/** Pasting Plum's pairing text into either field fills address and token at once. */
for (const id of ['serverUrl', 'token']) {
  $(id).addEventListener('paste', (event) => {
    const text = event.clipboardData && event.clipboardData.getData('text');
    const found = plumParsePairing(text);
    if (!(found.serverUrl && found.token)) return;
    event.preventDefault();
    $('serverUrl').value = found.serverUrl;
    $('token').value = found.token;
    if (found.label && !$('label').value) $('label').value = found.label;
    showMessage('Adresse und Token erkannt. Mit „Speichern & verbinden“ koppeln.', 'ok');
  });
}

$('showToken').addEventListener('click', () => {
  const visible = $('token').type === 'password';
  $('token').type = visible ? 'text' : 'password';
  $('showToken').textContent = visible ? 'Verbergen' : 'Anzeigen';
  $('showToken').setAttribute('aria-pressed', String(visible));
  $('showToken').setAttribute('aria-label', visible ? 'Token verbergen' : 'Token anzeigen');
});

// ---------------------------------------------------------------- update hint

function renderUpdate(state) {
  const available = state.latestVersion && plumNewerVersion(state.latestVersion, state.version);
  $('updateBanner').hidden = !available;
  if (available)
    $('updateText').textContent =
      `Version ${state.latestVersion} verfügbar (du hast ${state.version}).`;
}

$('updateOpen').addEventListener('click', () => {
  const base = lastState && plumNormalizeServerUrl(lastState.serverUrl);
  if (base) void browser.tabs.create({ url: `${base}/settings?section=firefox-browser` });
});

// ---------------------------------------------------------------- shortcuts

async function renderShortcuts() {
  const commands = browser.commands ? await browser.commands.getAll() : [];
  const names = {
    _execute_action: 'Panel öffnen',
    _execute_browser_action: 'Übersicht öffnen',
    _execute_sidebar_action: 'Chat-Seitenleiste',
    'toggle-pause': 'Not-Aus',
  };
  $('shortcuts').replaceChildren(
    ...commands.map((command) => {
      const li = document.createElement('li');
      const what = document.createElement('span');
      what.textContent = command.description || names[command.name] || command.name;
      const key = document.createElement('kbd');
      key.textContent = command.shortcut || 'nicht belegt';
      li.append(what, key);
      return li;
    })
  );
}

$('editShortcuts').addEventListener('click', async () => {
  if (PLUM_IS_CHROME) {
    void browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
    return;
  }
  if (browser.commands && browser.commands.openShortcutSettings) {
    await browser.commands.openShortcutSettings();
    return;
  }
  $('shortcutHint').hidden = false;
  $('shortcutHint').textContent =
    'In Firefox: about:addons → Zahnrad oben rechts → „Tastenkombinationen für Erweiterungen verwalten“.';
});

// ---------------------------------------------------------------- diagnostics

function renderFacts(state) {
  const rows = [
    ['Erweiterung', state.version],
    ['Browser', state.browser || '–'],
    ['Plum', state.serverUrl ? state.serverUrl.replace(/^https?:\/\//, '') : '–'],
    [
      'Zugang',
      state.endpoint
        ? state.endpoint.startsWith('/mobile')
          ? 'über /mobile (SSO-Ausnahme)'
          : 'direkt'
        : '–',
    ],
    [
      'Verbunden seit',
      state.connectedAt ? new Date(state.connectedAt).toLocaleString('de-CH') : '–',
    ],
    ['Neuverbindungen', String(state.reconnects ?? 0)],
    ['Tab-Gruppen', state.tabGroups ? 'ja' : 'nein (intern gruppiert)'],
    ['Sessions', String((state.sessions || []).length)],
  ];
  $('facts').replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    })
  );
  $('ping').disabled = state.status !== 'connected';
}

$('ping').addEventListener('click', async () => {
  $('latency').textContent = 'misst …';
  const reply = await browser.runtime.sendMessage({ plumPing: true }).catch(() => null);
  $('latency').textContent =
    reply && reply.ok
      ? `Antwortzeit ${reply.ms} ms`
      : `Fehler: ${(reply && reply.error) || 'keine Antwort'}`;
});

$('copyDiag').addEventListener('click', async () => {
  // Everything that helps debugging, never the token.
  const state = lastState || {};
  const report = {
    extension: state.version,
    browser: state.browser,
    server: state.serverUrl,
    endpoint: state.endpoint,
    status: state.status,
    statusDetail: state.statusDetail,
    connectedAt: state.connectedAt ? new Date(state.connectedAt).toISOString() : null,
    reconnects: state.reconnects,
    tabGroups: state.tabGroups,
    sessions: (state.sessions || []).length,
    recent: (state.recentActions || []).slice(0, 10).map((action) => ({
      at: new Date(action.at).toISOString(),
      tool: action.tool,
      result: action.result,
      ms: action.ms,
    })),
  };
  await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  showMessage('Diagnose kopiert (ohne Token).', 'ok');
});

browser.runtime.onMessage.addListener((message) => {
  if (message && message.plumState) renderStatus(message.plumState);
});

$('label').placeholder = `z. B. ${PLUM_IS_CHROME ? 'Chrome' : 'Firefox'} Laptop`;
void load();

// ---------------------------------------------------------------- backup

function backupMessage(text, kind) {
  const box = $('backupMessage');
  box.textContent = text;
  box.className = `message ${kind}`;
  box.hidden = !text;
}

$('exportSettings').addEventListener('click', async () => {
  const settings = await plumLoadSettings();
  const { macros } = await browser.storage.local.get('macros');
  const backup = {
    kind: 'plum-browser-settings',
    version: 1,
    exportedAt: new Date().toISOString(),
    protectedSites: settings.protectedSites,
    blockedSites: settings.blockedSites,
    allowJs: settings.allowJs,
    macros: Array.isArray(macros) ? macros : [],
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `plum-browser-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  backupMessage(`Exportiert: ${backup.macros.length} Makros und beide Seitenlisten.`, 'ok');
});

$('importSettings').addEventListener('click', () => $('importFile').click());

$('importFile').addEventListener('change', async () => {
  const file = $('importFile').files && $('importFile').files[0];
  $('importFile').value = '';
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (!backup || backup.kind !== 'plum-browser-settings')
      throw new Error('Keine Plum-Browser-Sicherung');
    const patch = {};
    if (typeof backup.protectedSites === 'string') patch.protectedSites = backup.protectedSites;
    if (typeof backup.blockedSites === 'string') patch.blockedSites = backup.blockedSites;
    if (typeof backup.allowJs === 'boolean') patch.allowJs = backup.allowJs;
    // Macros merge by id; an imported macro replaces one with the same id.
    let added = 0;
    if (Array.isArray(backup.macros)) {
      const { macros } = await browser.storage.local.get('macros');
      const byId = new Map((Array.isArray(macros) ? macros : []).map((macro) => [macro.id, macro]));
      for (const macro of backup.macros) {
        if (!macro || typeof macro.id !== 'string' || !Array.isArray(macro.steps)) continue;
        if (!byId.has(macro.id)) added += 1;
        byId.set(macro.id, macro);
      }
      patch.macros = [...byId.values()];
    }
    await plumSaveSettings(patch);
    await load();
    backupMessage(`Importiert. ${added} neue Makros, Seitenlisten übernommen.`, 'ok');
  } catch (error) {
    backupMessage(`Import fehlgeschlagen: ${error.message}`, 'error');
  }
});
