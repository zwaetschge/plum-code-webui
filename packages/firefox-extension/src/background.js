/* Plum Browser — background page.
 *
 * Holds the WebSocket to Plum, keeps one tab group per Plum session and turns
 * tool calls into tab operations or content-script commands. Agents only ever
 * see tabs inside their own session's group.
 */
'use strict';

const EXTENSION_VERSION = browser.runtime.getManifest().version;
const actionApi = browser.action || browser.browserAction;
const BROWSER_NAME = PLUM_IS_CHROME
  ? /Edg\//.test(navigator.userAgent)
    ? 'Edge'
    : 'Chrome'
  : 'Firefox';
const BROWSER_VERSION =
  navigator.userAgent.match(
    PLUM_IS_CHROME ? /(?:Chrome|Edg)\/([\d.]+)/ : /Firefox\/([\d.]+)/
  )?.[1] || '';
const HAS_TAB_GROUPS =
  typeof browser.tabs.group === 'function' && typeof browser.tabGroups === 'object';
const GROUP_COLORS = ['purple', 'blue', 'cyan', 'green', 'orange', 'pink', 'red', 'yellow'];
const LOAD_TIMEOUT_MS = 30_000;

const state = {
  settings: { ...PLUM_DEFAULTS },
  socket: null,
  status: 'idle', // idle | connecting | connected | error | unconfigured
  statusDetail: '',
  connectionId: null,
  retryMs: 1_000,
  retryTimer: null,
  connectGeneration: 0,
  /** sessionId → { groupId|null, tabIds:Set (fallback), currentTabId, name, windowId, lastUsed } */
  sessions: new Map(),
  recentActions: [],
};

// ---------------------------------------------------------------- utilities

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function textContent(text) {
  return { type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text, null, 2) };
}

function describeTab(tab, currentTabId) {
  return {
    tabId: tab.id,
    title: tab.title || '',
    url: tab.url || '',
    active: !!tab.active,
    current: tab.id === currentTabId,
    status: tab.discarded ? 'unloaded' : tab.status,
  };
}

function normalizeUrl(input) {
  const value = String(input || '').trim();
  if (!value) return 'about:blank';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  if (/^localhost(:\d+)?(\/|$)/i.test(value) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(value)) {
    return `${/^localhost/i.test(value) ? 'http' : 'https'}://${value}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

function isScriptableUrl(url) {
  if (!url) return false;
  if (
    /^(about|moz-extension|chrome|chrome-extension|edge|devtools|view-source|resource|jar):/i.test(
      url
    )
  )
    return false;
  if (/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url))
    return false;
  // Mozilla's own sites (AMO, accounts) are left to Firefox: its
  // extensions.webextensions.restrictedDomains pref blocks them by default.
  return /^(https?|file|data):/i.test(url);
}

function logAction(sessionName, tool, detail) {
  state.recentActions.unshift({ at: Date.now(), session: sessionName, tool, detail });
  state.recentActions.length = Math.min(state.recentActions.length, 30);
  broadcastState();
}

// ---------------------------------------------------------------- badge + popup state

function publicState() {
  return {
    status: state.status,
    statusDetail: state.statusDetail,
    paused: state.settings.paused,
    configured: !!(state.settings.serverUrl && state.settings.token),
    serverUrl: state.settings.serverUrl,
    label: state.settings.label,
    allowJs: state.settings.allowJs,
    tabGroups: HAS_TAB_GROUPS,
    sessions: [...state.sessions.entries()].map(([id, entry]) => ({
      id,
      name: entry.name,
      groupId: entry.groupId,
      windowId: entry.windowId ?? null,
      chatWindowId: entry.chatWindowId ?? null,
      chatUrl: chatUrl(id),
      lastUsed: entry.lastUsed,
    })),
    recentActions: state.recentActions.slice(0, 12),
  };
}

function broadcastState() {
  const s = state.status;
  const paused = state.settings.paused;
  const text = s === 'connected' ? (paused ? '❚❚' : 'ON') : s === 'error' ? '!' : '';
  const color = paused ? '#E89558' : s === 'connected' ? '#07CA6B' : '#EA2143';
  actionApi.setBadgeText({ text }).catch(() => {});
  actionApi.setBadgeBackgroundColor({ color }).catch(() => {});
  actionApi
    .setTitle({
      title:
        s === 'connected'
          ? paused
            ? 'Plum Browser – pausiert'
            : 'Plum Browser – verbunden'
          : s === 'connecting'
            ? 'Plum Browser – verbinde …'
            : `Plum Browser – ${state.statusDetail || 'nicht verbunden'}`,
    })
    .catch(() => {});
  browser.runtime.sendMessage({ plumState: publicState() }).catch(() => {});
}

function setStatus(status, detail = '') {
  state.status = status;
  state.statusDetail = detail;
  broadcastState();
}

// ---------------------------------------------------------------- connection

function scheduleReconnect() {
  clearTimeout(state.retryTimer);
  if (!state.settings.serverUrl || !state.settings.token) return;
  const delay = state.retryMs;
  state.retryMs = Math.min(state.retryMs * 2, 30_000);
  state.retryTimer = setTimeout(() => connect(), delay);
}

function disconnect() {
  state.connectGeneration += 1;
  clearTimeout(state.retryTimer);
  if (state.socket) {
    const socket = state.socket;
    state.socket = null;
    try {
      socket.close(1000, 'client disconnect');
    } catch {
      /* already closed */
    }
  }
}

/** Open one candidate endpoint; resolves true once Plum accepted the token. */
function tryEndpoint(candidate, generation) {
  return new Promise((resolve) => {
    let settled = false;
    let welcomed = false;
    const finish = (ok, detail) => {
      if (settled) return;
      settled = true;
      resolve({ ok, detail });
    };
    let socket;
    try {
      socket = new WebSocket(candidate.url);
    } catch (error) {
      finish(false, String(error.message || error));
      return;
    }
    const handshakeTimer = setTimeout(() => {
      finish(false, 'Zeitüberschreitung');
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }, 12_000);

    socket.addEventListener('open', async () => {
      const focused = await userHasFocus();
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          type: 'hello',
          token: state.settings.token,
          paused: state.settings.paused,
          tabGroups: HAS_TAB_GROUPS,
          reportsActivity: true,
          active: focused,
          client: {
            name: BROWSER_NAME,
            version: BROWSER_VERSION,
            extensionVersion: EXTENSION_VERSION,
            platform: navigator.platform,
            label: state.settings.label || 'Firefox',
          },
        })
      );
    });
    socket.addEventListener('message', (event) => {
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!welcomed) {
        if (frame.type === 'welcome') {
          welcomed = true;
          clearTimeout(handshakeTimer);
          if (generation !== state.connectGeneration) {
            socket.close(1000, 'superseded');
            finish(false, 'superseded');
            return;
          }
          state.socket = socket;
          state.connectionId = frame.connectionId;
          state.retryMs = 1_000;
          plumSaveSettings({ wsPath: candidate.path }).catch(() => {});
          state.settings.wsPath = candidate.path;
          setStatus('connected');
          finish(true);
        } else if (frame.type === 'error') {
          clearTimeout(handshakeTimer);
          finish(
            false,
            frame.code === 'UNAUTHORIZED' ? 'Token ungültig oder widerrufen' : frame.message
          );
        }
        return;
      }
      if (frame.type === 'call') void handleCall(socket, frame);
      else if (frame.type === 'rpcResult') settleRpc(frame);
      else if (frame.type === 'event') {
        // Live session events for the chat panels (they filter by session).
        browser.runtime.sendMessage({ plumEvent: frame }).catch(() => {});
      }
    });
    socket.addEventListener('close', (event) => {
      clearTimeout(handshakeTimer);
      if (!welcomed) {
        finish(
          false,
          event.code === 4401
            ? 'Token ungültig oder widerrufen'
            : `Verbindung abgelehnt (${event.code})`
        );
        return;
      }
      if (state.socket === socket) {
        state.socket = null;
        state.connectionId = null;
        setStatus('error', event.code === 4401 ? 'Token widerrufen' : 'Verbindung getrennt');
        if (event.code !== 4401) scheduleReconnect();
      }
    });
    socket.addEventListener('error', () => {
      /* close follows */
    });
  });
}

async function connect() {
  disconnect();
  const generation = state.connectGeneration;
  const { serverUrl, token, wsPath } = state.settings;
  if (!serverUrl || !token) {
    setStatus('unconfigured', 'Nicht eingerichtet');
    return;
  }
  setStatus('connecting');
  let lastDetail = 'Server nicht erreichbar';
  for (const candidate of plumSocketCandidates(serverUrl, wsPath)) {
    if (generation !== state.connectGeneration) return;
    const outcome = await tryEndpoint(candidate, generation);
    if (outcome.ok) return;
    if (outcome.detail === 'superseded') return;
    lastDetail = outcome.detail || lastDetail;
    if (/Token/.test(lastDetail)) break;
  }
  if (generation !== state.connectGeneration) return;
  setStatus('error', lastDetail);
  if (!/Token/.test(lastDetail)) scheduleReconnect();
}

function sendFrame(frame) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(frame));
  }
}

// ---------------------------------------------------------------- session picker
//
// The pairing token grants no REST access, so the picker's requests (list
// sessions and models, switch provider/model, bind a session to this browser)
// travel over the bridge socket and Plum answers them for the token's owner.

const pendingRpc = new Map();
let rpcCounter = 0;

function rpc(method, params = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Nicht mit Plum verbunden'));
  }
  const id = `rpc-${Date.now()}-${(rpcCounter += 1)}`;
  const timeoutMs = 35_000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRpc.delete(id);
      reject(new Error('Plum antwortet nicht'));
    }, timeoutMs);
    pendingRpc.set(id, { resolve, reject, timer });
    sendFrame({ type: 'rpc', id, method, params });
  });
}

function settleRpc(frame) {
  const pending = pendingRpc.get(frame.id);
  if (!pending) return;
  pendingRpc.delete(frame.id);
  clearTimeout(pending.timer);
  if (frame.ok) pending.resolve(frame.data);
  else pending.reject(new Error(frame.error || 'Fehler'));
}

/**
 * Chat panels showing a session, per session. Plum stops streaming a session's
 * events to this browser only when no panel shows it any more.
 */
const chatViewers = new Map();

function openChat(sessionId, pageId, limit) {
  let viewers = chatViewers.get(sessionId);
  if (!viewers) chatViewers.set(sessionId, (viewers = new Set()));
  viewers.add(pageId);
  return rpc('chat.open', { sessionId, limit });
}

function closeChat(sessionId, pageId) {
  const viewers = chatViewers.get(sessionId);
  if (!viewers) return Promise.resolve({ ok: true });
  viewers.delete(pageId);
  if (viewers.size) return Promise.resolve({ ok: true });
  chatViewers.delete(sessionId);
  return rpc('chat.close', { sessionId });
}

/**
 * Hand a tab the user is looking at to a session: bind the session to this
 * browser, move the tab into the session's window and tab group, and show it
 * there with the session's chat. Starts a session window if it has none yet.
 */
async function adoptTab(session, tabId) {
  await rpc('session.attach', { sessionId: session.id });
  const entry = sessionEntry(session);
  const { windowId, placeholderTabId } = await ensureSessionWindow(entry, session);
  let tab = await browser.tabs.get(tabId);
  if (tab.windowId !== windowId) {
    await browser.tabs.move(tabId, { windowId, index: -1 });
    tab = await browser.tabs.get(tabId);
  }
  await addTabToSession(entry, session, tab);
  if (placeholderTabId != null && placeholderTabId !== tabId) {
    await browser.tabs.remove(placeholderTabId).catch(() => {});
  }
  await browser.tabs.update(tabId, { active: true });
  await browser.windows.update(windowId, { focused: true });
  void syncConsoleHookRegistration();
  logAction(session.name, 'tab_übergeben', tab.title || tab.url || '');
  return { windowId, tabId };
}

// ---------------------------------------------------------------- user activity
//
// With several browsers paired (Firefox at home, Chrome at work) Plum drives
// the one the user used last. Only the user's own focus counts: agents work in
// unfocused session windows and never take focus.

let lastActivityReport = 0;

function reportActivity() {
  const now = Date.now();
  if (now - lastActivityReport < 15_000) return;
  lastActivityReport = now;
  sendFrame({ type: 'state', active: true });
}

async function userHasFocus() {
  try {
    const win = await browser.windows.getLastFocused();
    return !!win?.focused;
  } catch {
    return false;
  }
}

browser.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== browser.windows.WINDOW_ID_NONE) reportActivity();
});
browser.tabs.onActivated.addListener(({ windowId }) => {
  // Agents switch tabs inside unfocused session windows; that is not the user.
  void userHasFocus().then((focused) => {
    if (focused && sessionIdForWindow(windowId) == null) reportActivity();
  });
});

// ---------------------------------------------------------------- session groups

function groupTitle(name) {
  const clean = String(name || 'Session')
    .replace(/\s+/g, ' ')
    .trim();
  return `Plum · ${clean.length > 28 ? `${clean.slice(0, 27)}…` : clean}`;
}

function colorFor(sessionId) {
  let hash = 0;
  for (const char of sessionId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

let persistChain = Promise.resolve();
/**
 * Writes run one after another and snapshot the state when they run, so a
 * slow earlier write can never overwrite a newer one (e.g. the chat window id).
 */
function persistSessions() {
  persistChain = persistChain.then(writeSessions, writeSessions);
  return persistChain;
}

function writeSessions() {
  const serialisable = {};
  for (const [id, entry] of state.sessions) {
    serialisable[id] = {
      groupId: entry.groupId,
      windowId: entry.windowId ?? null,
      chatWindowId: entry.chatWindowId ?? null,
      tabIds: [...entry.tabIds],
      currentTabId: entry.currentTabId,
      name: entry.name,
      lastUsed: entry.lastUsed,
    };
  }
  return browser.storage.local.set({ sessions: serialisable });
}

async function restoreSessions() {
  const { sessions } = await browser.storage.local.get('sessions');
  for (const [id, entry] of Object.entries(sessions || {})) {
    state.sessions.set(id, {
      groupId: entry.groupId ?? null,
      windowId: entry.windowId ?? null,
      chatWindowId: entry.chatWindowId ?? null,
      tabIds: new Set(entry.tabIds || []),
      currentTabId: entry.currentTabId ?? null,
      name: entry.name || id,
      lastUsed: entry.lastUsed || 0,
    });
  }
}

function sessionEntry(session) {
  let entry = state.sessions.get(session.id);
  if (!entry) {
    entry = {
      groupId: null,
      windowId: null,
      tabIds: new Set(),
      currentTabId: null,
      name: session.name,
      lastUsed: 0,
    };
    state.sessions.set(session.id, entry);
  }
  entry.name = session.name || entry.name;
  entry.lastUsed = Date.now();
  return entry;
}

async function liveGroup(entry) {
  if (!HAS_TAB_GROUPS) return null;
  if (entry.groupId != null) {
    try {
      return await browser.tabGroups.get(entry.groupId);
    } catch {
      entry.groupId = null;
    }
  }
  // Group ids do not survive a browser restart; the restored group keeps its title.
  const [byTitle] = await browser.tabGroups
    .query({ title: groupTitle(entry.name) })
    .catch(() => []);
  if (!byTitle) return null;
  entry.groupId = byTitle.id;
  return byTitle;
}

/** Tabs that belong to this session, in tab-strip order. */
async function sessionTabs(entry) {
  if (HAS_TAB_GROUPS) {
    const group = await liveGroup(entry);
    if (!group) return [];
    const tabs = await browser.tabs.query({ windowId: group.windowId });
    return tabs.filter((tab) => tab.groupId === group.id);
  }
  const tabs = [];
  for (const tabId of [...entry.tabIds]) {
    try {
      tabs.push(await browser.tabs.get(tabId));
    } catch {
      entry.tabIds.delete(tabId);
    }
  }
  return tabs;
}

async function addTabToSession(entry, session, tab) {
  if (HAS_TAB_GROUPS) {
    const group = await liveGroup(entry);
    if (group) {
      await browser.tabs.group({ tabIds: [tab.id], groupId: group.id });
    } else {
      entry.groupId = await browser.tabs.group({
        tabIds: [tab.id],
        createProperties: { windowId: tab.windowId },
      });
      await browser.tabGroups.update(entry.groupId, {
        title: groupTitle(session.name),
        color: colorFor(session.id),
        collapsed: false,
      });
    }
  } else {
    entry.tabIds.add(tab.id);
  }
  entry.currentTabId = tab.id;
  await persistSessions();
}

async function resolveTab(entry, tabId) {
  const tabs = await sessionTabs(entry);
  if (tabId != null) {
    const tab = tabs.find((candidate) => candidate.id === Number(tabId));
    if (!tab) {
      throw new Error(
        `Tab ${tabId} gehört nicht zur Tab-Gruppe dieser Session. Nutze tabs_list oder tab_open.`
      );
    }
    entry.currentTabId = tab.id;
    return tab;
  }
  const current =
    tabs.find((tab) => tab.id === entry.currentTabId) || tabs.find((tab) => tab.active) || tabs[0];
  if (!current) {
    throw new Error('Diese Session hat noch keine Tabs. Öffne zuerst einen mit tab_open.');
  }
  entry.currentTabId = current.id;
  return current;
}

async function targetWindowId() {
  try {
    const win = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
    if (win && !win.incognito) return win.id;
  } catch {
    /* none focused */
  }
  const wins = await browser.windows.getAll({ windowTypes: ['normal'] });
  const normal = wins.find((win) => !win.incognito);
  if (normal) return normal.id;
  return (await browser.windows.create({})).id;
}

// ---------------------------------------------------------------- session windows
//
// Every session gets its own Firefox window holding its tab group. Plum never
// activates or reorders tabs in the user's windows and never takes focus, so
// the user keeps browsing while an agent works next to them. The window's
// panel (Firefox sidebar, Chrome side panel) shows that session's chat.

function chatUrl(sessionId) {
  const base = plumNormalizeServerUrl(state.settings.serverUrl);
  return base ? `${base}/session/${encodeURIComponent(sessionId)}` : null;
}

async function configureSessionWindow(windowId, sessionId, name) {
  // Chrome's side panel asks which session owns its window (plumWindowSession).
  if (!browser.sidebarAction) return;
  const panel = browser.runtime.getURL(`panel.html?session=${encodeURIComponent(sessionId)}`);
  try {
    await browser.sidebarAction.setPanel({ windowId, panel });
    await browser.sidebarAction.setTitle({ windowId, title: `Plum-Chat · ${name}` });
    // In a session window the toolbar icon toggles the chat directly (one click).
    await actionApi.setPopup({ windowId, popup: '' });
    await actionApi.setTitle({
      windowId,
      title: `Plum · ${name} – Chat ein-/ausblenden`,
    });
    await refreshChatBadge(windowId);
  } catch (error) {
    console.warn('[plum] configure window failed', error);
  }
}

async function refreshChatBadge(windowId) {
  if (!browser.sidebarAction) return;
  const open = await browser.sidebarAction.isOpen({ windowId }).catch(() => true);
  // null falls back to the global connection badge.
  await actionApi.setBadgeText({ windowId, text: open ? null : 'Chat' }).catch(() => {});
  if (!open) {
    await actionApi.setBadgeBackgroundColor({ windowId, color: '#7a4cff' }).catch(() => {});
  }
}

function sessionIdForWindow(windowId) {
  for (const [id, entry] of state.sessions) if (entry.windowId === windowId) return id;
  return null;
}

const CHAT_WINDOW_WIDTH = 440;

/** Primary display work area (Chrome only; Firefox/Wayland cannot place windows). */
async function workArea() {
  if (!PLUM_IS_CHROME || !browser.system?.display) return null;
  const displays = await browser.system.display.getInfo().catch(() => []);
  const primary = displays.find((display) => display.isPrimary) || displays[0];
  return primary ? primary.workArea : null;
}

async function createBackgroundWindow() {
  // focused:false keeps the user's current window in front. In Chrome the
  // session window leaves room on the right for its chat window.
  const area = await workArea();
  const placement = area
    ? {
        left: area.left,
        top: area.top,
        width: Math.max(800, area.width - CHAT_WINDOW_WIDTH),
        height: area.height,
      }
    : {};
  return browser.windows.create({ focused: false, url: 'about:blank', ...placement });
}

/**
 * Chrome, on request ("In Plum öffnen"): the full Plum chat page as a slim
 * popup window docked right of the session window. A side-panel iframe cannot carry the Plum/Authelia login — Chrome
 * withholds SameSite=Lax cookies from frames inside extension pages — while a
 * real window is first-party and shows Plum's own mobile layout.
 */
async function openChatWindow(entry, sessionId, focus) {
  const url = chatUrl(sessionId);
  if (!PLUM_IS_CHROME || !url) return false;
  if (entry.chatWindowId != null) {
    try {
      await browser.windows.get(entry.chatWindowId);
      if (focus) await browser.windows.update(entry.chatWindowId, { focused: true });
      return true;
    } catch {
      entry.chatWindowId = null;
    }
  }
  // After a browser restart the popup may have been restored with a new id.
  const popups = await browser.windows
    .getAll({ populate: true, windowTypes: ['popup'] })
    .catch(() => []);
  const restored = popups.find((win) => win.tabs?.some((tab) => (tab.url || '').startsWith(url)));
  if (restored) {
    entry.chatWindowId = restored.id;
    if (focus) await browser.windows.update(restored.id, { focused: true });
    await persistSessions();
    return true;
  }
  const area = await workArea();
  const win = await browser.windows.create({
    type: 'popup',
    url,
    focused: !!focus,
    ...(area
      ? {
          left: area.left + area.width - CHAT_WINDOW_WIDTH,
          top: area.top,
          width: CHAT_WINDOW_WIDTH,
          height: area.height,
        }
      : { width: CHAT_WINDOW_WIDTH, height: 900 }),
  });
  entry.chatWindowId = win.id;
  await persistSessions();
  return true;
}

/**
 * The session's own window, created on demand. A group that still sits among
 * the user's tabs (older versions opened it there) is moved out first.
 * Returns the window and, for a fresh window, its blank starter tab.
 */
async function ensureSessionWindow(entry, session) {
  const group = await liveGroup(entry);
  if (group) {
    const tabs = await browser.tabs.query({ windowId: group.windowId });
    if (tabs.every((tab) => tab.groupId === group.id)) {
      if (entry.windowId !== group.windowId) {
        entry.windowId = group.windowId;
        await configureSessionWindow(group.windowId, session.id, session.name);
      }
      return { windowId: group.windowId, placeholderTabId: null };
    }
    const win = await createBackgroundWindow();
    const placeholder = win.tabs?.[0]?.id;
    await browser.tabGroups.move(group.id, { windowId: win.id, index: -1 });
    if (placeholder != null) await browser.tabs.remove(placeholder).catch(() => {});
    entry.windowId = win.id;
    await configureSessionWindow(win.id, session.id, session.name);
    await persistSessions();
    return { windowId: win.id, placeholderTabId: null };
  }
  if (entry.windowId != null) {
    try {
      await browser.windows.get(entry.windowId);
      return { windowId: entry.windowId, placeholderTabId: null };
    } catch {
      entry.windowId = null;
    }
  }
  const win = await createBackgroundWindow();
  entry.windowId = win.id;
  await configureSessionWindow(win.id, session.id, session.name);
  await persistSessions();
  return { windowId: win.id, placeholderTabId: win.tabs?.[0]?.id ?? null };
}

/** Re-apply chat panels after a browser restart (window ids change). */
async function reattachSessionWindows() {
  for (const [id, entry] of state.sessions) {
    const group = await liveGroup(entry).catch(() => null);
    if (!group) continue;
    const tabs = await browser.tabs.query({ windowId: group.windowId });
    if (!tabs.every((tab) => tab.groupId === group.id)) continue;
    entry.windowId = group.windowId;
    await configureSessionWindow(group.windowId, id, entry.name);
  }
  await persistSessions();
}

// Cursor position per tab, so the virtual cursor survives navigations.
const cursorByTab = new Map();

// ---------------------------------------------------------------- tab loading

function waitForLoad(tabId, timeoutMs = LOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedId, info) => {
      if (updatedId === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    browser.tabs.onUpdated.addListener(listener);
    browser.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete' && tab.url !== 'about:blank') setTimeout(finish, 50);
      })
      .catch(finish);
  });
}

/** navigation starts asynchronously; wait for "loading" first so we don't return on the old page. */
async function navigateAndWait(tabId, start) {
  const loadingSeen = new Promise((resolve) => {
    const listener = (updatedId, info) => {
      if (updatedId === tabId && (info.status === 'loading' || info.url)) {
        browser.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };
    browser.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, 3_000);
  });
  await start();
  await loadingSeen;
  await waitForLoad(tabId);
  await sleep(150);
}

// ---------------------------------------------------------------- content-script bridge

async function injectContentScript(tabId) {
  if (browser.scripting) {
    await browser.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ['content.js'],
    });
  } else {
    await browser.tabs.executeScript(tabId, { file: 'content.js', runAt: 'document_idle' });
  }
}

/**
 * Chrome content scripts live in an isolated world, so page JavaScript and the
 * page's console are reached through the MAIN world instead (Firefox's content
 * script can do both itself via wrappedJSObject / window.eval).
 */
async function chromeEvaluate(tabId, code) {
  const [injection] = await browser.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: 'MAIN',
    args: [code],
    func: async (source) => {
      try {
        const run = (0, eval)(`(async () => { ${source}\n})`);
        const value = await run();
        try {
          return { ok: JSON.stringify(value === undefined ? null : value, null, 2) };
        } catch {
          return { ok: String(value) };
        }
      } catch (error) {
        return {
          error: `${(error && error.name) || 'Error'}: ${(error && error.message) || error}`,
        };
      }
    },
  });
  const result = injection && injection.result;
  if (!result) throw new Error('Keine Antwort aus der Seite');
  if (result.error) {
    throw new Error(
      /EvalError|unsafe-eval|Content Security Policy/i.test(result.error)
        ? `Die Seite verbietet per CSP die Ausführung von eigenem JavaScript (${result.error}).`
        : result.error
    );
  }
  return String(result.ok).slice(0, 50000);
}

async function chromeHookConsole(tabId) {
  await browser.scripting
    .executeScript({
      target: { tabId, frameIds: [0] },
      world: 'MAIN',
      injectImmediately: true,
      files: ['console-hook.js'],
    })
    .catch(() => {});
}

let consoleOrigins = '';
/** Register the MAIN-world hook at document_start for the hosts of session tabs only. */
async function syncConsoleHookRegistration() {
  if (!PLUM_IS_CHROME || !browser.scripting?.registerContentScripts) return;
  const hosts = new Set();
  for (const entry of state.sessions.values()) {
    for (const tab of await sessionTabs(entry).catch(() => [])) {
      try {
        const url = new URL(tab.url);
        if (/^https?:$/.test(url.protocol) && isScriptableUrl(tab.url)) {
          hosts.add(`${url.protocol}//${url.hostname}/*`);
        }
      } catch {
        /* not a URL */
      }
    }
  }
  const key = [...hosts].sort().join(' ');
  if (key === consoleOrigins) return;
  consoleOrigins = key;
  await browser.scripting.unregisterContentScripts({ ids: ['plum-console'] }).catch(() => {});
  if (!hosts.size) return;
  await browser.scripting
    .registerContentScripts([
      {
        id: 'plum-console',
        js: ['console-hook.js'],
        matches: [...hosts],
        runAt: 'document_start',
        world: 'MAIN',
        persistAcrossSessions: false,
      },
    ])
    .catch((error) => console.warn('[plum] console hook registration failed', error));
}

async function contentCall(tab, op, args = {}, timeoutMs = 20_000) {
  if (!isScriptableUrl(tab.url)) {
    throw new Error(
      `Firefox erlaubt Erweiterungen keinen Zugriff auf ${tab.url || 'diese Seite'} (interne oder geschützte Seite).`
    );
  }
  // Session restore brings background tabs back unloaded; they have no
  // content script until they are loaded, so load them first.
  const live = await browser.tabs.get(tab.id);
  if (live.discarded) {
    await navigateAndWait(tab.id, () =>
      browser.tabs.reload(tab.id).catch(() => browser.tabs.update(tab.id, { url: live.url }))
    );
  }
  const message = { plum: true, op, args };
  const attempt = () =>
    Promise.race([
      browser.tabs.sendMessage(tab.id, message, { frameId: 0 }),
      sleep(timeoutMs).then(() => {
        throw new Error(`Zeitüberschreitung bei ${op}`);
      }),
    ]);
  let response;
  try {
    response = await attempt();
  } catch (error) {
    if (
      !/Receiving end does not exist|Could not establish connection/i.test(String(error.message))
    ) {
      throw error;
    }
    try {
      await injectContentScript(tab.id);
    } catch (error) {
      throw new Error(
        `Seite in Tab ${tab.id} ist nicht erreichbar (${error.message || error}). Mit navigate "reload" neu laden.`
      );
    }
    response = await attempt();
  }
  if (!response) throw new Error('Keine Antwort vom Content-Script');
  if (response.error) throw new Error(response.error);
  return response.result;
}

// ---------------------------------------------------------------- screenshots

const SCREENSHOT_MAX_EDGE = 1568;
/** tabId → factor between CSS pixels and the last screenshot's pixels (≤ 1). */
const screenshotScale = new Map();

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Scale a capture so its pixels are CSS pixels times `factor` (≤ 1), where
 * the long edge ends up at most SCREENSHOT_MAX_EDGE. Chrome captures in device
 * pixels (2× on HiDPI), Firefox in CSS pixels; sizing against the CSS viewport
 * keeps click coordinates right in both. DOM-free for Chrome's service worker.
 */
async function fitScreenshot(dataUrl, format, cssSize) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const css =
    cssSize && cssSize.width > 0 ? cssSize : { width: bitmap.width, height: bitmap.height };
  const factor = Math.min(1, SCREENSHOT_MAX_EDGE / Math.max(css.width, css.height));
  const width = Math.round(css.width * factor);
  const height = Math.round(css.height * factor);
  if (width === bitmap.width && height === bitmap.height) {
    bitmap.close();
    return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), width, height, factor };
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: `image/${format}`, quality: 0.85 });
  const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  return { base64, width, height, factor };
}

/**
 * Chrome's captureVisibleTab never settles while the screen is locked or the
 * window is fully covered. The DevTools protocol still renders the page, so
 * fall back to it for that one capture (attach, capture, detach).
 */
let visibleCaptureStalledAt = 0;

async function chromeCapture(tab, format) {
  // Right after a stall (screen still locked) skip the 4 s wait and go to DevTools.
  if (Date.now() - visibleCaptureStalledAt > 60_000) {
    const visible = browser.tabs.captureVisibleTab(tab.windowId, { format, quality: 80 });
    const timeout = sleep(4_000).then(() => null);
    const dataUrl = await Promise.race([visible.catch(() => null), timeout]);
    if (dataUrl) return dataUrl;
    visibleCaptureStalledAt = Date.now();
  }
  if (!browser.debugger)
    throw new Error('Screenshot nicht möglich (Fenster verdeckt oder Bildschirm gesperrt).');
  const target = { tabId: tab.id };
  await browser.debugger.attach(target, '1.3');
  try {
    const shot = await browser.debugger.sendCommand(target, 'Page.captureScreenshot', {
      format,
      quality: 80,
      fromSurface: true,
    });
    return `data:image/${format};base64,${shot.data}`;
  } finally {
    await browser.debugger.detach(target).catch(() => {});
  }
}

async function screenshot(tab, format) {
  if (!tab.active) {
    await browser.tabs.update(tab.id, { active: true });
    await sleep(250);
  }
  const imageFormat = format === 'png' ? 'png' : 'jpeg';
  let viewport = null;
  if (isScriptableUrl(tab.url)) {
    viewport = await contentCall(tab, 'viewport').catch(() => null);
  }
  // scale:1 renders at CSS pixels. Wide viewports (ultrawide, 4K) are then
  // shrunk to what a model actually sees; x/y given to click/hover/scroll are
  // screenshot pixels and get converted back with the remembered factor.
  const scriptable = isScriptableUrl(tab.url);
  if (scriptable) await contentCall(tab, 'overlay', { visible: false }).catch(() => {});
  let dataUrl;
  try {
    // Firefox's captureTab reads the tab itself, so the session window need not be in front.
    dataUrl =
      typeof browser.tabs.captureTab === 'function'
        ? await browser.tabs.captureTab(tab.id, { format: imageFormat, quality: 80, scale: 1 })
        : await chromeCapture(tab, imageFormat);
  } finally {
    if (scriptable) await contentCall(tab, 'overlay', { visible: true }).catch(() => {});
  }
  const { base64, width, height, factor } = await fitScreenshot(dataUrl, imageFormat, viewport);
  screenshotScale.set(tab.id, factor);
  const scaleNote =
    factor < 1
      ? ` Screenshot ${width}×${height} (Faktor ${factor.toFixed(3)}); x/y für click/hover/scroll in Screenshot-Pixeln angeben, sie werden umgerechnet.`
      : '';
  const details = viewport
    ? `Viewport ${viewport.width}×${viewport.height} CSS-px, scroll ${viewport.scrollX},${viewport.scrollY} of ${viewport.scrollWidth}×${viewport.scrollHeight}.${scaleNote} ${tab.title} – ${tab.url}`
    : `${scaleNote} ${tab.title} – ${tab.url}`.trim();
  return [
    { type: 'image', data: base64, mimeType: `image/${imageFormat}` },
    textContent(`Tab ${tab.id}: ${details}`),
  ];
}

// ---------------------------------------------------------------- tools

async function toolStatus(session, entry) {
  const tabs = await sessionTabs(entry);
  return [
    textContent({
      connected: true,
      browser: `${BROWSER_NAME} ${BROWSER_VERSION}`,
      tabGroups: HAS_TAB_GROUPS
        ? `native ${BROWSER_NAME} tab groups`
        : 'fallback (tab list, no visible group)',
      session: session.name,
      group: HAS_TAB_GROUPS && entry.groupId != null ? groupTitle(session.name) : null,
      javascriptAllowed: state.settings.allowJs,
      tabs: tabs.map((tab) => describeTab(tab, entry.currentTabId)),
    }),
  ];
}

const TOOLS = {
  async status(session, entry) {
    return toolStatus(session, entry);
  },

  async tabs_list(_session, entry) {
    const tabs = await sessionTabs(entry);
    return [textContent({ tabs: tabs.map((tab) => describeTab(tab, entry.currentTabId)) })];
  },

  async tab_open(session, entry, args) {
    const url = normalizeUrl(args.url);
    const { windowId, placeholderTabId } = await ensureSessionWindow(entry, session);
    let tab;
    if (placeholderTabId != null) {
      tab = await browser.tabs.get(placeholderTabId);
      await addTabToSession(entry, session, tab);
      if (url !== 'about:blank') {
        await navigateAndWait(tab.id, () => browser.tabs.update(tab.id, { url }));
      }
    } else {
      tab = await browser.tabs.create({
        windowId,
        url: url === 'about:blank' ? undefined : url,
        active: args.active !== false,
      });
      await addTabToSession(entry, session, tab);
      if (url !== 'about:blank') await waitForLoad(tab.id);
    }
    const fresh = await browser.tabs.get(tab.id);
    void syncConsoleHookRegistration();
    return [textContent({ opened: describeTab(fresh, entry.currentTabId) })];
  },

  async tab_close(_session, entry, args) {
    const tab = await resolveTab(entry, args.tabId);
    await browser.tabs.remove(tab.id);
    entry.tabIds.delete(tab.id);
    if (entry.currentTabId === tab.id) entry.currentTabId = null;
    await persistSessions();
    return [textContent(`Tab ${tab.id} geschlossen.`)];
  },

  async tab_activate(_session, entry, args) {
    const tab = await resolveTab(entry, args.tabId);
    await browser.tabs.update(tab.id, { active: true });
    await persistSessions();
    return [textContent(`Tab ${tab.id} ist jetzt aktiv: ${tab.title} – ${tab.url}`)];
  },

  async navigate(_session, entry, args) {
    const tab = await resolveTab(entry, args.tabId);
    const target = String(args.url || '')
      .trim()
      .toLowerCase();
    if (target === 'back' || target === 'forward') {
      // Chrome skips history entries created without a real user gesture, so
      // tabs.goBack can refuse where the page's own history.go still works.
      const delta = target === 'back' ? -1 : 1;
      await navigateAndWait(tab.id, () =>
        (delta < 0 ? browser.tabs.goBack(tab.id) : browser.tabs.goForward(tab.id)).catch(() =>
          contentCall(tab, 'history', { delta })
        )
      );
    } else if (target === 'reload')
      await navigateAndWait(tab.id, () => browser.tabs.reload(tab.id));
    else {
      const url = normalizeUrl(args.url);
      await navigateAndWait(tab.id, () => browser.tabs.update(tab.id, { url }));
    }
    const fresh = await browser.tabs.get(tab.id);
    return [
      textContent({ tabId: fresh.id, title: fresh.title, url: fresh.url, status: fresh.status }),
    ];
  },

  async screenshot(_session, entry, args) {
    const tab = await resolveTab(entry, args.tabId);
    return screenshot(await browser.tabs.get(tab.id), args.format);
  },

  async resize_window(_session, entry, args) {
    const tabs = await sessionTabs(entry);
    const windowId = tabs[0]?.windowId ?? (await targetWindowId());
    const width = Math.max(400, Math.min(Number(args.width) || 1280, 7680));
    const height = Math.max(300, Math.min(Number(args.height) || 800, 4320));
    await browser.windows.update(windowId, { state: 'normal', width, height });
    return [textContent(`Fenster auf ${width}×${height} gesetzt.`)];
  },

  async wait_for(_session, entry, args) {
    const tab = await resolveTab(entry, args.tabId);
    const seconds = Math.max(0.1, Math.min(Number(args.seconds) || 10, 60));
    if (!args.text && !args.selector) {
      await sleep(seconds * 1000);
      return [textContent(`${seconds}s gewartet.`)];
    }
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      const fresh = await browser.tabs.get(tab.id);
      const found = await contentCall(
        fresh,
        'check',
        { text: args.text, selector: args.selector },
        5_000
      ).catch(() => false);
      if (found) return [textContent(`Gefunden: ${args.text || args.selector}`)];
      await sleep(300);
    }
    return [
      textContent(`Nicht erschienen innerhalb von ${seconds}s: ${args.text || args.selector}`),
    ];
  },

  async evaluate_js(_session, entry, args) {
    if (!state.settings.allowJs) {
      throw new Error('JavaScript-Ausführung ist in der Plum-Browser-Erweiterung deaktiviert.');
    }
    const tab = await resolveTab(entry, args.tabId);
    if (PLUM_IS_CHROME) {
      if (!isScriptableUrl(tab.url)) throw new Error(`Kein Zugriff auf ${tab.url}`);
      return [textContent(await chromeEvaluate(tab.id, String(args.code || '')))];
    }
    const result = await contentCall(tab, 'evaluate_js', { code: String(args.code || '') }, 30_000);
    return [textContent(result)];
  },
};

// Everything else is a DOM operation the content script handles.
const CONTENT_TOOLS = new Set([
  'read_page',
  'find',
  'get_page_text',
  'click',
  'hover',
  'type',
  'press_key',
  'scroll',
  'form_input',
  'read_console',
]);

const VISIBLE_TOOLS = new Set(['click', 'hover', 'type', 'press_key', 'scroll', 'form_input']);

async function runTool(tool, session, args) {
  const entry = sessionEntry(session);
  if (TOOLS[tool]) return TOOLS[tool](session, entry, args);
  if (!CONTENT_TOOLS.has(tool)) throw new Error(`Unbekanntes Werkzeug: ${tool}`);
  let tab = await resolveTab(entry, args.tabId);
  // Visible actions bring their tab to the front of the session window (never
  // the user's), so the cursor can be watched; reading stays in the background.
  if (VISIBLE_TOOLS.has(tool) && !tab.active) {
    await browser.tabs.update(tab.id, { active: true });
    await sleep(150);
    tab = await browser.tabs.get(tab.id);
  }
  const before = tab.url;
  const factor = screenshotScale.get(tab.id) || 1;
  if (factor < 1 && typeof args.x === 'number' && typeof args.y === 'number') {
    args = { ...args, x: args.x / factor, y: args.y / factor };
  }
  // Reported positions go back out in screenshot pixels too.
  args = { ...args, _scale: factor };
  const result = await contentCall(tab, tool, args, 25_000);
  const content = [textContent(result)];
  // Clicks and Enter often navigate; report where the tab ended up.
  if (tool === 'click' || tool === 'press_key' || tool === 'type') {
    await sleep(400);
    const fresh = await browser.tabs.get(tab.id);
    if (fresh.status === 'loading') await waitForLoad(tab.id, 15_000);
    const after = await browser.tabs.get(tab.id);
    if (after.url !== before)
      content.push(textContent(`Navigiert zu: ${after.title} – ${after.url}`));
  }
  return content;
}

async function handleCall(socket, frame) {
  const session = {
    id: String(frame.session?.id || 'unknown'),
    name: String(frame.session?.name || frame.session?.id || 'Session'),
  };
  const args = frame.args && typeof frame.args === 'object' ? frame.args : {};
  const reply = (payload) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'result', id: frame.id, ...payload }));
    }
  };
  if (state.settings.paused && frame.tool !== 'status') {
    reply({ ok: false, error: 'Browser-Steuerung ist in Firefox pausiert.' });
    return;
  }
  try {
    const content = await runTool(frame.tool, session, args);
    logAction(session.name, frame.tool, args.url || args.ref || args.query || '');
    reply({ ok: true, content });
  } catch (error) {
    logAction(session.name, frame.tool, `Fehler: ${error.message || error}`);
    reply({ ok: false, error: String(error.message || error) });
  }
}

// ---------------------------------------------------------------- messages from popup/options/content

function routeMessage(message, sender) {
  if (!message || typeof message !== 'object') return undefined;
  if (message.plumGetState) return Promise.resolve(publicState());
  if (message.plumReconnect) {
    state.retryMs = 1_000;
    return plumLoadSettings().then(async (settings) => {
      state.settings = settings;
      return connect().then(() => publicState());
    });
  }
  if (message.plumDisconnect) {
    disconnect();
    setStatus('idle', 'Getrennt');
    return Promise.resolve(publicState());
  }
  if (message.plumForgetSession) {
    state.sessions.delete(message.plumForgetSession);
    return persistSessions().then(() => publicState());
  }
  // Content script asks at document_start whether to capture console output.
  if (message.plumCursor && sender.tab) {
    cursorByTab.set(sender.tab.id, message.plumCursor);
    return undefined;
  }
  if (message.plumCursorState && sender.tab) {
    return isManagedTab(sender.tab).then((managed) => ({
      managed,
      cursor: managed ? cursorByTab.get(sender.tab.id) || null : null,
    }));
  }
  if (message.plumRpc) {
    return rpc(message.plumRpc, message.params || {}).then(
      (data) => ({ ok: true, data }),
      (error) => ({ ok: false, error: String(error.message || error) })
    );
  }
  if (message.plumChatOpen) {
    return openChat(message.plumChatOpen, message.pageId, message.limit).then(
      (data) => ({ ok: true, data }),
      (error) => ({ ok: false, error: String(error.message || error) })
    );
  }
  if (message.plumChatClose) {
    return closeChat(message.plumChatClose, message.pageId).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error: String(error.message || error) })
    );
  }
  if (message.plumAdoptTab) {
    return adoptTab(message.plumAdoptTab, Number(message.tabId)).then(
      (data) => ({ ok: true, data }),
      (error) => ({ ok: false, error: String(error.message || error) })
    );
  }
  if (message.plumFocusSession) {
    const entry = state.sessions.get(message.plumFocusSession);
    if (entry?.windowId != null) {
      return browser.windows.update(entry.windowId, { focused: true }).then(
        () => true,
        () => false
      );
    }
    return Promise.resolve(false);
  }
  if (message.plumConsoleHook && sender.tab) {
    if (PLUM_IS_CHROME) void chromeHookConsole(sender.tab.id);
    return undefined;
  }
  if (message.plumOpenChat) {
    let entry = state.sessions.get(message.plumOpenChat);
    // Picked in the session picker before it ever used the browser.
    if (!entry && message.name)
      entry = sessionEntry({ id: message.plumOpenChat, name: message.name });
    return entry ? openChatWindow(entry, message.plumOpenChat, true) : Promise.resolve(false);
  }
  if (message.plumWindowSession != null) {
    const id = sessionIdForWindow(Number(message.plumWindowSession));
    const entry = id ? state.sessions.get(id) : null;
    return Promise.resolve(
      entry ? { sessionId: id, name: entry.name, chatUrl: chatUrl(id) } : null
    );
  }
  if (message.plumShouldCapture && sender.tab) {
    return isManagedTab(sender.tab).then((managed) => ({ capture: managed }));
  }
  return undefined;
}

// A restarted Chrome service worker must restore its sessions before answering.
plumOnMessage((message, sender) =>
  startupDone ? routeMessage(message, sender) : startup.then(() => routeMessage(message, sender))
);

async function isManagedTab(tab) {
  for (const entry of state.sessions.values()) {
    if (
      HAS_TAB_GROUPS
        ? tab.groupId != null && tab.groupId === entry.groupId
        : entry.tabIds.has(tab.id)
    ) {
      return true;
    }
  }
  return false;
}

// Connection settings are applied by the options page through plumReconnect;
// here only the live toggles need to reach the running state.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!('paused' in changes) && !('allowJs' in changes)) return;
  plumLoadSettings().then((settings) => {
    state.settings = settings;
    if ('paused' in changes) sendFrame({ type: 'state', paused: settings.paused });
    broadcastState();
  });
});

browser.tabs.onRemoved.addListener((tabId) => {
  cursorByTab.delete(tabId);
  screenshotScale.delete(tabId);
  for (const entry of state.sessions.values()) {
    entry.tabIds.delete(tabId);
    if (entry.currentTabId === tabId) entry.currentTabId = null;
  }
});

if (HAS_TAB_GROUPS && browser.tabGroups.onRemoved) {
  browser.tabGroups.onRemoved.addListener((group) => {
    for (const entry of state.sessions.values()) {
      if (entry.groupId === group.id) entry.groupId = null;
    }
    void persistSessions();
  });
}

globalThis.addEventListener?.('online', () => {
  if (state.status !== 'connected') {
    state.retryMs = 1_000;
    void connect();
  }
});

// ---------------------------------------------------------------- Chrome (MV3) specifics

/**
 * Chrome runs this file in a service worker that is stopped when idle. Traffic
 * on an open WebSocket keeps it alive (Chrome 116+), so the socket carries an
 * app-level ping every 20 s; an alarm restarts the connection if the worker
 * was stopped anyway. The side panel (chat, session picker, pause) opens
 * from the toolbar icon.
 */

if (PLUM_IS_CHROME) {
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  setInterval(() => sendFrame({ type: 'ping' }), 20_000);
  browser.alarms?.create('plum-keepalive', { periodInMinutes: 0.5 });
  browser.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'plum-keepalive') return;
    if (state.status !== 'connected' && state.status !== 'connecting' && state.settings.token) {
      state.retryMs = 1_000;
      void connect();
    }
  });
  // Page console of Plum tabs: hook the MAIN world as early as each load starts.
  browser.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status !== 'loading' && !info.url) return;
    void isManagedTab(tab).then((managed) => {
      if (!managed) return;
      void syncConsoleHookRegistration();
      if (isScriptableUrl(tab.url)) void chromeHookConsole(tabId);
    });
  });
}

// ---------------------------------------------------------------- startup

browser.windows.onRemoved.addListener((windowId) => {
  for (const entry of state.sessions.values()) {
    if (entry.windowId === windowId) entry.windowId = null;
    if (entry.chatWindowId === windowId) entry.chatWindowId = null;
  }
  void persistSessions();
});

// Only fires in session windows, where the popup is switched off.
actionApi.onClicked.addListener((tab) => {
  if (!browser.sidebarAction) return;
  // Must run synchronously inside the click handler (user-input requirement).
  browser.sidebarAction
    .toggle()
    .then(() => setTimeout(() => refreshChatBadge(tab.windowId), 300))
    .catch(() => {});
});

let startupDone = false;
const startup = (async () => {
  state.settings = await plumLoadSettings();
  await restoreSessions();
  broadcastState();
  await reattachSessionWindows().catch(() => {});
  startupDone = true;
})();
// Connecting can take a while (endpoint fallback); messages only wait for the state above.
void startup.then(() => {
  if (state.settings.serverUrl && state.settings.token) return connect();
  setStatus('unconfigured', 'Nicht eingerichtet');
  return undefined;
});

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') browser.runtime.openOptionsPage().catch(() => {});
});
