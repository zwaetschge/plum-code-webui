'use strict';

const $ = (id) => document.getElementById(id);

const STATUS_TEXT = PLUM_STATUS_TEXT;
let serverUrl = '';
plumMountSiteCard($('siteCard'), () => null);

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

const relative = plumRelative;

function render(state) {
  if (state.status === 'connected' && lastStatus !== 'connected') void picker.refresh();
  lastStatus = state.status;
  serverUrl = state.serverUrl || '';
  plumRenderUpdate($('updateBanner'), $('updateText'), state);
  // Before pairing only the setup steps make sense.
  $('onboarding').hidden = state.configured;
  for (const id of ['picker', 'sessionsCard', 'actionsCard']) $(id).hidden = !state.configured;
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

  plumRenderSessions($('sessions'), $('noSessions'), state.sessions, {
    limit: 8,
    onFocused: () => window.close(),
  });

  plumRenderLog($('actions'), $('noActions'), state.recentActions);
}

$('pause').addEventListener('click', async () => {
  const { paused } = await plumLoadSettings();
  await plumSaveSettings({ paused: !paused });
});
$('reconnect').addEventListener('click', async () => {
  render(await browser.runtime.sendMessage({ plumReconnect: true }));
});
$('clearActions').addEventListener('click', async () => {
  render(await browser.runtime.sendMessage({ plumClearActions: true }));
});
$('updateOpen').addEventListener('click', () => plumOpenUpdate(serverUrl));
$('setup').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
  window.close();
});
$('options').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
  window.close();
});

browser.runtime.onMessage.addListener((message) => {
  if (message && message.plumState) render(message.plumState);
});

browser.runtime.sendMessage({ plumGetState: true }).then(render);
