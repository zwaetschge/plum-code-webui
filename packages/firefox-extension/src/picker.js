'use strict';

/* Session picker, shared by Chrome's side panel and Firefox's sidebar/popup.
 *
 * Like the model picker in Claude's browser extension, except the choice is
 * one of the user's existing Plum sessions: pick it, adjust its provider and
 * model, and hand it the tab you are looking at. The session is then bound to
 * this browser and works in that tab's new session window.
 */

const PICKER_PROVIDER_ICONS = {
  codex: '◎',
  opencode: '◇',
  pi: 'π',
  kimi: 'K',
  vibe: 'M',
  claude: '✳',
  zai: 'Z',
};

function plumMountPicker(root, { onChat, onUpdated } = {}) {
  const view = {
    sessions: [],
    providers: [],
    selectedId: null,
    windowSessionId: null,
    filter: '',
    busy: false,
    message: '',
    messageKind: '',
    loaded: false,
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  root.classList.add('glass', 'card', 'picker');
  root.replaceChildren();
  const heading = el('h2', null, 'Session wählen');
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Session suchen …';
  search.setAttribute('aria-label', 'Session suchen');
  const list = el('ul', 'picker-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Plum-Sessions');
  const empty = el('p', 'muted small', 'Lade Sessions …');
  const detail = el('div', 'picker-detail');
  const status = el('p', 'message');
  status.hidden = true;
  status.setAttribute('role', 'status');
  root.append(heading, search, list, empty, detail, status);

  const providerById = (id) => view.providers.find((provider) => provider.id === id);
  const modelLabel = (provider, model) =>
    (provider && provider.modelLabels && provider.modelLabels[model]) || model;

  function meta(session) {
    const provider = providerById(session.provider);
    const parts = [provider ? provider.name : session.provider];
    const model = session.model || (provider && provider.defaultModel);
    if (model) parts.push(modelLabel(provider, model) + (session.model ? '' : ' (Standard)'));
    if (session.busy) parts.push('arbeitet');
    return parts.join(' · ');
  }

  function say(text, kind = '') {
    view.message = text;
    view.messageKind = kind;
    status.textContent = text;
    status.className = `message ${kind}`;
    status.hidden = !text;
  }

  async function call(method, params) {
    const reply = await browser.runtime.sendMessage({ plumRpc: method, params });
    if (!reply || !reply.ok) throw new Error((reply && reply.error) || 'Keine Antwort');
    return reply.data;
  }

  function selected() {
    return view.sessions.find((session) => session.id === view.selectedId) || null;
  }

  function renderList() {
    const needle = view.filter.trim().toLowerCase();
    const shown = view.sessions.filter(
      (session) =>
        !needle ||
        String(session.name).toLowerCase().includes(needle) ||
        meta(session).toLowerCase().includes(needle)
    );
    list.replaceChildren(
      ...shown.slice(0, 40).map((session) => {
        const item = el('li');
        const option = el('button', 'picker-option');
        option.type = 'button';
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(session.id === view.selectedId));
        const icon = el('span', 'picker-icon', PICKER_PROVIDER_ICONS[session.provider] || '•');
        icon.setAttribute('aria-hidden', 'true');
        const text = el('span', 'picker-text');
        const name = el('span', 'picker-name', session.name || session.id);
        text.append(name, el('span', 'picker-meta', meta(session)));
        option.append(icon, text);
        if (session.id === view.windowSessionId) option.append(el('span', 'badge', 'Fenster'));
        else if (session.pinnedHere) option.append(el('span', 'badge', 'Browser'));
        option.addEventListener('click', () => {
          view.selectedId = session.id;
          void browser.storage.local.set({ pickerSessionId: session.id });
          render();
        });
        item.append(option);
        return item;
      })
    );
    empty.hidden = !view.loaded || shown.length > 0;
    empty.textContent = view.sessions.length ? 'Keine Session passt.' : 'Keine Sessions gefunden.';
  }

  function select(labelText, options, value, onChange) {
    const wrap = el('label', 'picker-field');
    wrap.append(el('span', null, labelText));
    const control = el('select');
    for (const [optionValue, optionLabel] of options) {
      const option = el('option', null, optionLabel);
      option.value = optionValue;
      control.append(option);
    }
    control.value = value;
    control.disabled = view.busy;
    control.addEventListener('change', () => onChange(control.value));
    wrap.append(control);
    return wrap;
  }

  async function updateSession(method, params, doneText) {
    const session = selected();
    if (!session) return;
    view.busy = true;
    render();
    try {
      const updated = await call(method, { sessionId: session.id, ...params });
      Object.assign(session, updated);
      say(doneText, 'ok');
      if (onUpdated) onUpdated(session);
    } catch (error) {
      say(error.message, 'error');
    } finally {
      view.busy = false;
      render();
    }
  }

  async function activeTab() {
    const win = await browser.windows.getCurrent();
    const [tab] = await browser.tabs.query({ active: true, windowId: win.id });
    return tab || null;
  }

  function renderDetail() {
    const session = selected();
    detail.replaceChildren();
    if (!session) {
      detail.append(el('p', 'muted small', 'Wähle eine Session, die diesen Browser steuern soll.'));
      return;
    }
    const provider = providerById(session.provider);
    const providerOptions = view.providers.map((entry) => [entry.id, entry.name]);
    if (!provider) providerOptions.unshift([session.provider, session.provider]);
    detail.append(
      select('Provider', providerOptions, session.provider, (value) =>
        updateSession('session.setProvider', { provider: value }, 'Provider geändert.')
      )
    );
    const models = (provider && provider.models) || [];
    const modelOptions = [
      [
        '',
        `Standard${provider && provider.defaultModel ? ` (${modelLabel(provider, provider.defaultModel)})` : ''}`,
      ],
    ];
    for (const model of models) modelOptions.push([model, modelLabel(provider, model)]);
    if (session.model && !models.includes(session.model)) {
      modelOptions.push([session.model, session.model]);
    }
    detail.append(
      select('Modell', modelOptions, session.model || '', (value) =>
        updateSession('session.setModel', { model: value || null }, 'Modell geändert.')
      )
    );

    if (session.busy) {
      detail.append(
        el(
          'p',
          'hint',
          'Arbeitet gerade – ein Provider- oder Modellwechsel startet die Session neu.'
        )
      );
    }

    const actions = el('div', 'row');
    const handOver = el(
      'button',
      '',
      session.id === view.windowSessionId ? 'Steuert dieses Fenster' : 'Aktuellen Tab übergeben'
    );
    handOver.type = 'button';
    handOver.disabled = view.busy || session.id === view.windowSessionId;
    handOver.title =
      'Verschiebt den offenen Tab in das Fenster und die Tab-Gruppe dieser Session. Ab dann steuert sie diesen Browser.';
    handOver.addEventListener('click', async () => {
      view.busy = true;
      render();
      try {
        const tab = await activeTab();
        if (!tab) throw new Error('Kein offener Tab gefunden');
        const reply = await browser.runtime.sendMessage({
          plumAdoptTab: { id: session.id, name: session.name },
          tabId: tab.id,
        });
        if (!reply || !reply.ok)
          throw new Error((reply && reply.error) || 'Übergabe fehlgeschlagen');
        session.pinnedHere = true;
        say(`„${tab.title || tab.url}“ gehört jetzt zu ${session.name}.`, 'ok');
      } catch (error) {
        say(error.message, 'error');
      } finally {
        view.busy = false;
        render();
      }
    });
    const chat = el('button', 'primary', 'Chat öffnen');
    chat.type = 'button';
    chat.addEventListener('click', () => onChat && onChat(session));
    actions.append(chat, handOver);
    if (session.pinnedHere && session.id !== view.windowSessionId) {
      const release = el('button', '', 'Lösen');
      release.type = 'button';
      release.title = 'Die Session wählt ihren Browser wieder automatisch.';
      release.addEventListener('click', async () => {
        try {
          await call('session.detach', { sessionId: session.id });
          session.pinnedHere = false;
          say('Session wählt ihren Browser wieder automatisch.', 'ok');
        } catch (error) {
          say(error.message, 'error');
        }
        render();
      });
      actions.append(release);
    }
    detail.append(actions);
  }

  function render() {
    renderList();
    renderDetail();
  }

  search.addEventListener('input', () => {
    view.filter = search.value;
    renderList();
  });

  async function refresh() {
    try {
      const [sessions, providers, stored] = await Promise.all([
        call('sessions.list'),
        call('providers.list'),
        browser.storage.local.get('pickerSessionId'),
      ]);
      view.sessions = sessions;
      view.providers = providers;
      const ids = new Set(sessions.map((session) => session.id));
      if (!ids.has(view.selectedId)) {
        view.selectedId =
          (ids.has(view.windowSessionId) && view.windowSessionId) ||
          (ids.has(stored.pickerSessionId) && stored.pickerSessionId) ||
          null;
      }
      view.loaded = true;
      if (view.messageKind === 'error') say('');
    } catch (error) {
      view.loaded = true;
      say(error.message, 'error');
    }
    render();
  }

  render();
  // Sessions come and go while the panel stays open.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && view.loaded) void refresh();
  });

  function labels(session) {
    const provider = providerById(session.provider);
    const model = session.model || (provider && provider.defaultModel);
    return {
      providerName: provider ? provider.name : session.provider,
      modelLabel: model ? modelLabel(provider, model) : '',
    };
  }

  return {
    refresh,
    labels,
    providers: () => view.providers,
    find: (id) => view.sessions.find((session) => session.id === id) || null,
    select(id) {
      view.selectedId = id;
      render();
    },
    /** A session created elsewhere in the panel: list it and select it. */
    add(session) {
      view.sessions = [session, ...view.sessions.filter((entry) => entry.id !== session.id)];
      view.selectedId = session.id;
      render();
    },
    /** The session that owns the window this page lives in, if any. */
    setWindowSession(sessionId) {
      if (view.windowSessionId === sessionId) return;
      view.windowSessionId = sessionId;
      if (sessionId) view.selectedId = sessionId;
      render();
    },
  };
}
