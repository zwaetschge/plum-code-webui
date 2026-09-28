'use strict';

const $ = (id) => document.getElementById(id);

const STATUS_TEXT = {
  connected: 'Verbunden',
  connecting: 'Verbinde …',
  error: 'Nicht verbunden',
  idle: 'Getrennt',
  unconfigured: 'Nicht eingerichtet',
};

let lastStatus = null;
const picker = plumMountPicker($('picker'), {
  // Show the session's chat in this window's sidebar. open() has to run synchronously
  // inside the click, so it goes first and the panel is set afterwards.
  onChat: (session) => {
    if (!browser.sidebarAction) return;
    browser.sidebarAction.open();
    void browser.windows.getCurrent().then((win) =>
      browser.sidebarAction.setPanel({
        windowId: win.id,
        panel: browser.runtime.getURL(`panel.html?session=${encodeURIComponent(session.id)}`),
      })
    );
  },
});

function relative(ms) {
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return 'gerade eben';
  if (seconds < 3600) return `vor ${Math.round(seconds / 60)} min`;
  return `vor ${Math.round(seconds / 3600)} h`;
}

function render(state) {
  if (state.status === 'connected' && lastStatus !== 'connected') void picker.refresh();
  lastStatus = state.status;
  const paused = state.paused && state.status === 'connected';
  $('dot').className = `dot ${paused ? 'paused' : state.status}`;
  $('status').textContent = paused ? 'Pausiert' : STATUS_TEXT[state.status] || state.status;
  const details = [];
  if (state.status !== 'connected' && state.statusDetail) details.push(state.statusDetail);
  if (state.serverUrl) details.push(state.serverUrl.replace(/^https?:\/\//, ''));
  if (!state.tabGroups)
    details.push('Tab-Gruppen-API fehlt (Firefox 139+ nötig) – Tabs werden intern gruppiert.');
  $('detail').textContent = details.join(' · ');

  $('pause').textContent = state.paused ? 'Fortsetzen' : 'Pausieren';
  $('pause').classList.toggle('primary', !!state.paused);
  $('pause').disabled = !state.configured;
  $('reconnect').disabled = !state.configured;

  const sessions = [...state.sessions].sort((a, b) => b.lastUsed - a.lastUsed);
  $('sessions').replaceChildren(
    ...sessions.slice(0, 8).map((session) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'what';
      name.textContent = session.name;
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = session.lastUsed ? relative(session.lastUsed) : '';
      li.append(name, when);
      if (session.windowId != null) {
        li.classList.add('clickable');
        li.title = 'Fenster dieser Session anzeigen';
        li.addEventListener('click', () => {
          browser.runtime.sendMessage({ plumFocusSession: session.id });
          window.close();
        });
      }
      return li;
    })
  );
  $('noSessions').hidden = sessions.length > 0;

  $('actions').replaceChildren(
    ...state.recentActions.map((action) => {
      const li = document.createElement('li');
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = `${action.tool}${action.detail ? ` · ${action.detail}` : ''}`;
      what.title = `${action.session}: ${what.textContent}`;
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = relative(action.at);
      li.append(what, when);
      return li;
    })
  );
  $('noActions').hidden = state.recentActions.length > 0;
}

$('pause').addEventListener('click', async () => {
  const { paused } = await plumLoadSettings();
  await plumSaveSettings({ paused: !paused });
});
$('reconnect').addEventListener('click', async () => {
  render(await browser.runtime.sendMessage({ plumReconnect: true }));
});
$('options').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
  window.close();
});

browser.runtime.onMessage.addListener((message) => {
  if (message && message.plumState) render(message.plumState);
});

browser.runtime.sendMessage({ plumGetState: true }).then(render);
