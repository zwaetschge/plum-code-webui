'use strict';

const $ = (id) => document.getElementById(id);

const STATUS_TEXT = {
  connected: 'Verbunden',
  connecting: 'Verbinde …',
  error: 'Nicht verbunden',
  idle: 'Getrennt',
  unconfigured: 'Nicht eingerichtet',
};

function showMessage(text, kind) {
  const box = $('message');
  box.textContent = text;
  box.className = `message ${kind}`;
  box.hidden = !text;
}

function renderStatus(state) {
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
  showMessage('Getrennt. Beim nächsten Speichern oder Firefox-Start wird wieder verbunden.', 'ok');
});

$('paused').addEventListener('change', () => plumSaveSettings({ paused: $('paused').checked }));
$('allowJs').addEventListener('change', () => plumSaveSettings({ allowJs: $('allowJs').checked }));

browser.runtime.onMessage.addListener((message) => {
  if (message && message.plumState) renderStatus(message.plumState);
});

void load();
