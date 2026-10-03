'use strict';

/* The browser panel (Chrome side panel, Firefox sidebar): the chat of one Plum
 * session, and a sessions view to pick, configure or start one. In a session
 * window it opens that window's session; elsewhere the last one chosen.
 */

const $ = (id) => document.getElementById(id);
const STATUS_TEXT = {
  connected: 'Verbunden',
  connecting: 'Verbinde …',
  error: 'Nicht verbunden',
  idle: 'Getrennt',
  unconfigured: 'Nicht eingerichtet',
};

// Opened as a tab only to grant the microphone (Chrome's side panel cannot prompt).
if (new URLSearchParams(location.search).has('grantMic')) {
  document.body.textContent = 'Bitte erlaube Plum den Zugriff aufs Mikrofon …';
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      stream.getTracks().forEach((track) => track.stop());
      document.body.textContent =
        'Mikrofon freigegeben. Du kannst diesen Tab schließen und im Panel 🎙 drücken.';
    })
    .catch(() => {
      document.body.textContent = 'Mikrofon wurde nicht freigegeben.';
    });
  // This tab is only for the permission prompt; the panel itself does not start.
  throw new Error('plum: microphone permission tab');
}

let windowId = null;
let windowSessionId = new URLSearchParams(location.search).get('session');
let serverUrl = '';
let lastStatus = null;

function relative(ms) {
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return 'gerade eben';
  if (seconds < 3600) return `vor ${Math.round(seconds / 60)} min`;
  return `vor ${Math.round(seconds / 3600)} h`;
}

function span(className, text) {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

function show(view) {
  $('chatView').hidden = view !== 'chat';
  $('sessionsView').hidden = view !== 'sessions';
  $('toSessions').textContent = view === 'chat' ? 'Sessions' : 'Chat';
  $('toSessions').disabled = view === 'sessions' && !chat.current();
}

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, windowId });
  return tab || null;
}

async function handOver(session) {
  const tab = await activeTab();
  if (!tab) throw new Error('Kein offener Tab gefunden');
  const reply = await browser.runtime.sendMessage({
    plumAdoptTab: { id: session.id, name: session.name },
    tabId: tab.id,
  });
  if (!reply || !reply.ok) throw new Error((reply && reply.error) || 'Übergabe fehlgeschlagen');
  return tab;
}

// ---------------------------------------------------------------- chat + picker

const chat = plumMountChat($('chatView'), {
  onSwitch: () => {
    show('sessions');
    void picker.refresh();
  },
  onHandOver: async (session) => {
    if (!session) return;
    try {
      const tab = await handOver(session);
      picker.refresh();
      chat.relabel({});
      toast(`„${tab.title || tab.url}“ gehört jetzt zu ${session.name}.`);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  onOpenInPlum: (session) => {
    if (!session) return;
    if (PLUM_IS_CHROME) {
      void browser.runtime.sendMessage({ plumOpenChat: session.id, name: session.name });
      return;
    }
    const base = plumNormalizeServerUrl(serverUrl);
    if (base)
      void browser.tabs.create({ url: `${base}/session/${encodeURIComponent(session.id)}` });
  },
  onRecord: async (action, note) => {
    const session = chat.current();
    if (!session) return;
    const recording = windowRecording();
    if (action === 'macro') {
      const saved = await browser.runtime.sendMessage({ plumMacroSave: note, windowId });
      if (!saved || !saved.ok) throw new Error((saved && saved.error) || 'Nicht gespeichert');
      void renderMacros();
      toast(`Makro „${saved.data.name}“ gespeichert (${saved.data.steps} Schritte).`);
      return;
    }
    const message =
      action === 'send'
        ? { plumRecordSend: true, note, windowId }
        : action === 'discard'
          ? { plumRecordDiscard: true, windowId }
          : recording && recording.active
            ? { plumRecordStop: true, windowId }
            : { plumRecordStart: { session: { id: session.id, name: session.name }, windowId } };
    const reply = await browser.runtime.sendMessage(message);
    if (!reply || !reply.ok) {
      const error = new Error((reply && reply.error) || 'Aufnahme fehlgeschlagen');
      if (action === 'send') throw error;
      toast(error.message, 'error');
    }
  },
  onGuide: async () => {
    const session = chat.current();
    if (!session) return;
    const reply = await browser.runtime.sendMessage({
      plumGuide: { session: { id: session.id, name: session.name }, windowId, on: !guideOn() },
    });
    if (!reply || !reply.ok)
      toast((reply && reply.error) || 'Anleitungsmodus fehlgeschlagen', 'error');
  },
  // In guide mode every message says which tab the user is on.
  decorate: async (text) => {
    if (!guideOn()) return text;
    const tab = await activeTab().catch(() => null);
    return tab
      ? `[Anleitungsmodus – ich bin im Tab „${tab.title || ''}“ ${tab.url || ''}]\n${text}`
      : text;
  },
});

let lastState = null;

function guideOn() {
  const session = chat.current();
  return !!(
    session &&
    lastState &&
    (lastState.guides || []).some(
      (guide) => guide.sessionId === session.id && guide.windowId === windowId
    )
  );
}

/** The demonstration recorded in this window, if any (each window has its own). */
function windowRecording() {
  return (
    ((lastState && lastState.recordings) || []).find((rec) => rec.windowId === windowId) || null
  );
}

function renderModes() {
  chat.setModes({ recording: windowRecording(), guide: guideOn() });
}

const picker = plumMountPicker($('picker'), {
  onChat: (session) => openSession(session),
  onUpdated: (session) => {
    if (chat.current() && chat.current().id === session.id) {
      chat.relabel({ ...session, ...picker.labels(session) });
    }
  },
});

function toast(text, kind = 'ok') {
  const node = document.createElement('p');
  node.className = `toast message ${kind}`;
  node.textContent = text;
  document.body.append(node);
  setTimeout(() => node.remove(), 4_000);
}

function openSession(session) {
  void browser.storage.local.set({ panelSessionId: session.id, pickerSessionId: session.id });
  picker.select(session.id);
  show('chat');
  void chat
    .open(session, picker.labels(session))
    .then(renderModes)
    .then(() => sendPendingShare(session));
}

/** A context-menu share made before any session was chosen goes to this one. */
async function sendPendingShare(session) {
  const { pendingShare } = await browser.storage.local.get('pendingShare');
  if (!pendingShare) return;
  await browser.storage.local.remove('pendingShare');
  const reply = await browser.runtime.sendMessage({
    plumRpc: 'chat.send',
    params: {
      sessionId: session.id,
      message: pendingShare.message,
      clientMessageId: `share-${Date.now()}`,
      ...(pendingShare.images && pendingShare.images.length ? { images: pendingShare.images } : {}),
    },
  });
  toast(
    reply && reply.ok ? 'Geteilter Inhalt gesendet.' : 'Senden fehlgeschlagen.',
    reply && reply.ok ? 'ok' : 'error'
  );
}

// ---------------------------------------------------------------- macros

async function renderMacros() {
  const reply = await browser.runtime.sendMessage({ plumMacroList: true }).catch(() => null);
  const macros = (reply && reply.ok && reply.data) || [];
  $('macros').replaceChildren(
    ...macros.map((macro) => {
      const li = document.createElement('li');
      li.className = 'macro';
      const info = document.createElement('span');
      info.className = 'name';
      info.textContent = macro.name;
      info.title = `${macro.steps} Schritte · ${macro.startUrl}${
        macro.params.length
          ? ` · Parameter: ${macro.params.map((param) => param.name).join(', ')}`
          : ''
      }`;
      const run = document.createElement('button');
      run.type = 'button';
      run.className = 'primary';
      run.textContent = '▶';
      run.title = 'Die offene Session ausführen lassen';
      run.addEventListener('click', async () => {
        const session = chat.current();
        if (!session) {
          toast('Öffne zuerst eine Session.', 'error');
          return;
        }
        const params = macro.params.length
          ? ` Frag mich nach Werten für: ${macro.params.map((param) => `„${param.name}“`).join(', ')}, falls du sie nicht kennst.`
          : '';
        const sent = await browser.runtime.sendMessage({
          plumRpc: 'chat.send',
          params: {
            sessionId: session.id,
            message: `Führe das Makro „${macro.name}“ mit macro_run aus.${params}`,
            clientMessageId: `macro-${Date.now()}`,
          },
        });
        if (sent && sent.ok) show('chat');
        else toast((sent && sent.error) || 'Senden fehlgeschlagen', 'error');
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '✕';
      remove.title = 'Makro löschen';
      remove.setAttribute('aria-label', `Makro ${macro.name} löschen`);
      remove.addEventListener('click', async () => {
        await browser.runtime.sendMessage({ plumMacroDelete: macro.id });
        void renderMacros();
      });
      li.append(info, run, remove);
      return li;
    })
  );
  $('noMacros').hidden = macros.length > 0;
}

// ---------------------------------------------------------------- update hint

function newer(latest, current) {
  const a = String(latest || '')
    .split('.')
    .map(Number);
  const b = String(current || '')
    .split('.')
    .map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

function renderUpdate(state) {
  const available = state.latestVersion && newer(state.latestVersion, state.version);
  $('updateBanner').hidden = !available;
  if (available) {
    $('updateText').textContent =
      `Version ${state.latestVersion} verfügbar (du hast ${state.version}).`;
  }
}

$('updateOpen').addEventListener('click', () => {
  const base = plumNormalizeServerUrl(serverUrl);
  if (base) void browser.tabs.create({ url: `${base}/settings?section=firefox-browser` });
});

// ---------------------------------------------------------------- new session

function fillModels() {
  const provider = picker.providers().find((entry) => entry.id === $('newProvider').value);
  const select = $('newModel');
  select.replaceChildren();
  const standard = document.createElement('option');
  standard.value = '';
  standard.textContent = 'Standard';
  select.append(standard);
  for (const model of (provider && provider.models) || []) {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = (provider.modelLabels && provider.modelLabels[model]) || model;
    select.append(option);
  }
}

function fillProviders() {
  const select = $('newProvider');
  const current = select.value;
  select.replaceChildren();
  for (const provider of picker.providers()) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.name;
    select.append(option);
  }
  if (current) select.value = current;
  fillModels();
}

$('newProvider').addEventListener('change', fillModels);

$('newSession').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('newMessage');
  $('newSubmit').disabled = true;
  message.hidden = true;
  try {
    const reply = await browser.runtime.sendMessage({
      plumRpc: 'session.create',
      params: {
        name: $('newName').value.trim(),
        provider: $('newProvider').value,
        model: $('newModel').value,
        workingDirectory: $('newDir').value.trim(),
      },
    });
    if (!reply || !reply.ok) throw new Error((reply && reply.error) || 'Nicht erstellt');
    const session = reply.data;
    picker.add(session);
    if ($('newHandOver').checked) await handOver(session).catch(() => null);
    $('newName').value = '';
    openSession(session);
  } catch (error) {
    message.textContent = error.message;
    message.className = 'message error';
    message.hidden = false;
  } finally {
    $('newSubmit').disabled = false;
  }
});

// ---------------------------------------------------------------- connection state

function render(state) {
  renderUpdate(state);
  lastState = state;
  renderModes();
  serverUrl = state.serverUrl || '';
  const paused = state.paused && state.status === 'connected';
  $('dot').className = `dot ${paused ? 'paused' : state.status}`;
  $('status').textContent = paused ? 'Pausiert' : STATUS_TEXT[state.status] || state.status;
  $('pause').textContent = state.paused ? 'Fortsetzen' : 'Pause';
  $('pause').classList.toggle('primary', !!state.paused);
  $('pause').disabled = !state.configured;
  const details = [];
  if (state.status !== 'connected' && state.statusDetail) details.push(state.statusDetail);
  if (!state.configured) details.push('Öffne die Einstellungen (⚙), um Plum zu verbinden.');
  $('detail').textContent = details.join(' · ');

  const sessions = [...state.sessions].sort((a, b) => b.lastUsed - a.lastUsed);
  $('sessions').replaceChildren(
    ...sessions.map((session) => {
      const li = document.createElement('li');
      li.append(span('name', session.name));
      if (session.windowId != null) {
        const focus = document.createElement('button');
        focus.type = 'button';
        focus.textContent = 'Fenster';
        focus.addEventListener('click', () =>
          browser.runtime.sendMessage({ plumFocusSession: session.id })
        );
        li.append(focus);
      }
      return li;
    })
  );
  $('noSessions').hidden = sessions.length > 0;
  $('actions').replaceChildren(
    ...state.recentActions.map((action) => {
      const li = document.createElement('li');
      li.append(
        span('what', `${action.tool}${action.detail ? ` · ${action.detail}` : ''}`),
        span('when', relative(action.at))
      );
      return li;
    })
  );
  $('noActions').hidden = state.recentActions.length > 0;

  const connected = state.status === 'connected';
  if (connected && lastStatus !== 'connected') void onConnected();
  lastStatus = state.status;
}

let startedOnce = false;
/** First connection: pick the chat to show. Reconnects: reload what is open. */
async function onConnected() {
  void renderMacros();
  await picker.refresh();
  fillProviders();
  const defaults = await browser.runtime
    .sendMessage({ plumRpc: 'settings.defaults' })
    .catch(() => null);
  if (defaults && defaults.ok && defaults.data.defaultWorkingDir) {
    $('newDir').placeholder = `${defaults.data.defaultWorkingDir}/<Name>`;
  }
  if (startedOnce) {
    void chat.reopen();
    return;
  }
  startedOnce = true;
  const { panelSessionId } = await browser.storage.local.get('panelSessionId');
  const id = windowSessionId || panelSessionId;
  const session = id ? picker.find(id) : null;
  if (session) openSession(session);
  else show('sessions');
}

// ---------------------------------------------------------------- controls

$('toSessions').addEventListener('click', () => {
  if (!$('sessionsView').hidden && chat.current()) {
    show('chat');
    return;
  }
  show('sessions');
  void picker.refresh();
});
$('pause').addEventListener('click', async () => {
  const { paused } = await plumLoadSettings();
  await plumSaveSettings({ paused: !paused });
});
$('reconnect').addEventListener('click', async () => {
  render(await browser.runtime.sendMessage({ plumReconnect: true }));
});
$('options').addEventListener('click', () => browser.runtime.openOptionsPage());

browser.runtime.onMessage.addListener((message) => {
  if (message && message.plumState) render(message.plumState);
  if (message && message.plumToast) toast(message.plumToast, message.error ? 'error' : 'ok');
});

(async () => {
  windowId = (await browser.windows.getCurrent()).id;
  if (!windowSessionId) {
    const owned = await browser.runtime
      .sendMessage({ plumWindowSession: windowId })
      .catch(() => null);
    if (owned) windowSessionId = owned.sessionId;
  }
  picker.setWindowSession(windowSessionId);
  show('sessions');
  render(await browser.runtime.sendMessage({ plumGetState: true }));
})();
