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

// Account quotas come from the background page (pushed frames, fallback poll);
// it fetches fresh rows when the popup opens. Offline the last rows stay, dated.
let lastState = null;
let usageKey = '';
let usageTick = 0;
function renderUsage(state) {
  const usage = state.usage || { rows: [], at: null };
  const connected = state.status === 'connected';
  // The state is broadcast on every agent action; rebuild only on real changes.
  const key = JSON.stringify([usage, state.usageHidden, connected, state.configured, usageTick]);
  if (key === usageKey) return;
  usageKey = key;
  $('usageCard').hidden = !state.configured || !usage.rows.length;
  plumRenderUsage($('usage'), $('noUsage'), usage.rows, {
    hidden: state.usageHidden || [],
    onOpen: (row) =>
      void plumOpenPlum(
        serverUrl,
        row.analyticsPath || `/analytics?provider=${encodeURIComponent(row.provider)}`
      ).then(() => window.close()),
  });
  $('usageWhen').textContent = usage.at
    ? connected
      ? plumRelative(usage.at)
      : plumStandText(usage.at)
    : '';
  $('usageWhen').classList.toggle('stale', !connected);
}
// Ages and forecasts are relative to now.
setInterval(() => {
  usageTick += 1;
  if (lastState) renderUsage(lastState);
}, 15_000);

// Open approvals and questions; the session list marks their sessions "wartet".
const approvals = plumMountApprovals($('approvals'), {
  onOpen: (item) =>
    void plumOpenPlum(serverUrl, `/session/${encodeURIComponent(item.sessionId)}`).then(() =>
      window.close()
    ),
  onChange: () => recent.render(),
});
const recent = plumMountRecentSessions($('recent'), {
  waiting: () => new Set(approvals.items().map((item) => item.sessionId)),
});
// Sessions change state while the popup stays open.
setInterval(() => {
  if (lastStatus === 'connected') void recent.refresh();
}, 30_000);

function render(state) {
  const connected = state.status === 'connected';
  if (connected && lastStatus !== 'connected') {
    void picker.refresh();
    void browser.runtime.sendMessage({ plumUsageRefresh: true }).catch(() => {});
    void approvals.refresh().then(() => recent.refresh());
  }
  approvals.setEnabled(connected);
  if (!connected) $('recent').hidden = true;
  lastStatus = state.status;
  lastState = state;
  renderUsage(state);
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
  if (message && message.plumApprovalsChanged && lastStatus === 'connected')
    void approvals.refresh();
});

browser.runtime.sendMessage({ plumGetState: true }).then(render);
