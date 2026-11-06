/* Small pieces shared by the popup and the panel: activity log, site rule card. */
'use strict';

function plumRelative(ms) {
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return 'gerade eben';
  if (seconds < 3600) return `vor ${Math.round(seconds / 60)} min`;
  return `vor ${Math.round(seconds / 3600)} h`;
}

function plumSpan(className, text) {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

const PLUM_RESULT_LABEL = { ok: 'erledigt', error: 'Fehler', waiting: 'wartet auf Freigabe' };

/** Activity log rows: result dot, "session · tool · detail", duration or age. */
function plumRenderLog(list, empty, actions) {
  list.classList.add('log');
  list.replaceChildren(
    ...actions.map((action) => {
      const li = document.createElement('li');
      const result = action.result || 'ok';
      li.className = result;
      const dot = plumSpan(`result ${result}`, '');
      dot.title = PLUM_RESULT_LABEL[result] || result;
      const text = `${action.tool}${action.detail ? ` · ${action.detail}` : ''}`;
      const what = plumSpan('what', text);
      what.title = `${action.session}: ${text}`;
      const when = plumSpan(
        'when',
        action.ms != null && Date.now() - action.at < 60_000
          ? `${action.ms < 1000 ? `${action.ms} ms` : `${(action.ms / 1000).toFixed(1)} s`}`
          : plumRelative(action.at)
      );
      li.append(dot, what, when);
      return li;
    })
  );
  empty.hidden = actions.length > 0;
}

function plumRenderUpdate(banner, text, state) {
  const available = state.latestVersion && plumNewerVersion(state.latestVersion, state.version);
  banner.hidden = !available;
  if (available)
    text.textContent = `Version ${state.latestVersion} verfügbar (du hast ${state.version}).`;
}

function plumOpenUpdate(serverUrl) {
  const base = plumNormalizeServerUrl(serverUrl);
  if (base) void browser.tabs.create({ url: `${base}/settings?section=firefox-browser` });
}

const SITE_LABEL = { free: 'Frei', protected: 'Geschützt', blocked: 'Gesperrt' };
const SITE_HINT = {
  free: 'Agents dürfen hier lesen und handeln.',
  protected: 'Vor jedem Klick oder jeder Eingabe fragt der Agent dich auf der Seite.',
  blocked: 'Agents dürfen diese Seite weder lesen noch bedienen.',
};

/**
 * "Diese Seite" card: the active tab's host and a three-way switch between
 * free, protected (asks first) and blocked (off limits).
 */
function plumMountSiteCard(container, getWindowId) {
  container.className = 'glass card site-card';
  container.hidden = true;
  const title = document.createElement('h2');
  title.textContent = 'Diese Seite';
  const row = document.createElement('div');
  row.className = 'site';
  const host = plumSpan('host', '');
  const badge = plumSpan('site-state', '');
  row.append(host, badge);
  const switcher = document.createElement('div');
  switcher.className = 'segmented';
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', 'Regel für diese Seite');
  const hint = document.createElement('p');
  hint.className = 'muted small';
  const buttons = Object.keys(SITE_LABEL).map((rule) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = SITE_LABEL[rule];
    button.addEventListener('click', () => void plumSetSiteRule(current, rule).then(render));
    switcher.append(button);
    return [rule, button];
  });
  container.append(title, row, switcher, hint);

  let current = '';
  async function render() {
    const windowId = await getWindowId();
    const [tab] = await browser.tabs.query(
      windowId != null ? { active: true, windowId } : { active: true, currentWindow: true }
    );
    let hostname = '';
    try {
      const url = new URL(tab && tab.url ? tab.url : '');
      if (/^https?:$/.test(url.protocol)) hostname = url.hostname;
    } catch {
      /* no web page */
    }
    current = hostname;
    container.hidden = !hostname;
    if (!hostname) return;
    const rule = plumSiteState(hostname, await plumLoadSettings());
    host.textContent = hostname;
    badge.textContent = SITE_LABEL[rule];
    badge.className = `site-state ${rule}`;
    hint.textContent = SITE_HINT[rule];
    for (const [name, button] of buttons)
      button.setAttribute('aria-pressed', String(name === rule));
  }

  browser.tabs.onActivated.addListener(() => void render());
  browser.tabs.onUpdated.addListener((_id, change) => {
    if (change.url) void render();
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('protectedSites' in changes || 'blockedSites' in changes))
      void render();
  });
  void render();
  return { render };
}

function plumButton(label, title, onClick, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.title = title;
  if (className) button.className = className;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

/**
 * Session windows with per-session controls: show the window, stop/resume
 * just this session, close its window. `onFocused` runs after "Fenster".
 */
function plumRenderSessions(list, empty, sessions, { limit = 50, onFocused } = {}) {
  const sorted = [...sessions].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, limit);
  list.classList.add('sessions');
  list.replaceChildren(
    ...sorted.map((session) => {
      const li = document.createElement('li');
      li.classList.toggle('stopped', !!session.stopped);
      const info = document.createElement('span');
      info.className = 'info';
      info.append(plumSpan('name', session.name));
      info.append(
        plumSpan(
          'when',
          session.stopped ? 'angehalten' : session.lastUsed ? plumRelative(session.lastUsed) : ''
        )
      );
      const actions = document.createElement('span');
      actions.className = 'actions';
      if (session.windowId != null) {
        actions.append(
          plumButton('Fenster', 'Fenster dieser Session anzeigen', () => {
            void browser.runtime.sendMessage({ plumFocusSession: session.id });
            if (onFocused) onFocused();
          })
        );
      }
      actions.append(
        plumButton(
          session.stopped ? 'Fortsetzen' : 'Anhalten',
          session.stopped
            ? 'Diese Session darf den Browser wieder steuern'
            : 'Nur diese Session anhalten, die anderen laufen weiter',
          () =>
            void browser.runtime.sendMessage({
              plumStopSession: { id: session.id, stopped: !session.stopped },
            }),
          session.stopped ? 'primary' : ''
        )
      );
      if (session.windowId != null) {
        actions.append(
          plumButton(
            '✕',
            'Session-Fenster schließen',
            () => void browser.runtime.sendMessage({ plumCloseSession: session.id })
          )
        );
      }
      li.append(info, actions);
      return li;
    })
  );
  empty.hidden = sorted.length > 0;
}

/** When a quota window resets: "in 2 Std. 10 Min." today, otherwise weekday or date. */
function plumResetText(iso) {
  if (!iso) return '';
  const at = new Date(iso);
  const minutes = Math.round((at.getTime() - Date.now()) / 60000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes <= 0) return 'jetzt';
  if (minutes < 60) return `in ${minutes} Min.`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    return `in ${hours}:${String(minutes % 60).padStart(2, '0')} Std.`;
  }
  const options =
    minutes < 7 * 24 * 60
      ? { weekday: 'short', hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat('de-CH', options).format(at);
}

/** One bridge RPC through the background page; throws its error text. */
async function plumCall(method, params = {}) {
  const reply = await browser.runtime.sendMessage({ plumRpc: method, params });
  if (!reply || !reply.ok) throw new Error((reply && reply.error) || 'Keine Antwort');
  return reply.data;
}

/** Opens a Plum page (path from the server, e.g. "/analytics?provider=codex") in a new tab. */
function plumOpenPlum(serverUrl, path) {
  const base = plumNormalizeServerUrl(serverUrl);
  if (!base || typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//'))
    return Promise.resolve();
  return browser.tabs.create({ url: `${base}${path}` }).catch(() => {});
}

/** "Stand vor 12 Min." for data that may be outdated (socket down). */
function plumStandText(at) {
  if (!at) return '';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 60) return `Stand vor ${Math.max(1, minutes)} Min.`;
  if (minutes < 24 * 60) return `Stand vor ${Math.round(minutes / 60)} Std.`;
  return `Stand vom ${new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'short' }).format(
    new Date(at)
  )}`;
}

/** Forecast of one quota window: "voll in ca. 40 Min.", "voll ca. 18:20", "reicht bis Reset". */
function plumForecastText(window) {
  const forecast = window && window.forecast;
  if (!forecast || window.utilization >= 100) return null;
  if (forecast.state === 'lasts') return { text: 'reicht bis Reset', kind: 'ok' };
  if (forecast.state !== 'exhausts' || !forecast.at) return null;
  const at = new Date(forecast.at);
  const minutes = Math.round((at.getTime() - Date.now()) / 60000);
  if (!Number.isFinite(minutes)) return null;
  if (minutes < 60) return { text: `voll in ca. ${Math.max(1, minutes)} Min.`, kind: 'danger' };
  const options =
    minutes < 24 * 60
      ? { hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short', hour: '2-digit', minute: '2-digit' };
  return {
    text: `voll ca. ${new Intl.DateTimeFormat('de-CH', options).format(at).replace(',', '')}`,
    kind: 'warning',
  };
}

function plumUsageFill(value) {
  const fill = document.createElement('span');
  fill.className = `usage-fill${value >= 90 ? ' danger' : value >= 75 ? ' warning' : ''}`;
  fill.style.width = `${value}%`;
  const bar = document.createElement('span');
  bar.className = 'usage-bar';
  bar.append(fill);
  return bar;
}

/**
 * Account quotas from the usage.limits RPC (or a pushed `usage` frame). The
 * provider in focus comes first and in full: one bar per window with value,
 * reset time and forecast. The others follow compactly. Hidden providers are
 * left out; a click on a provider opens its analytics page.
 */
function plumRenderUsage(list, empty, rows, { hidden = [], onOpen } = {}) {
  const shown = rows.filter((row) => !hidden.includes(row.provider));
  const active = shown.find((row) => row.active) || null;
  const ordered = active ? [active, ...shown.filter((row) => row !== active)] : shown;
  list.replaceChildren(
    ...ordered.map((row) => {
      const compact = !!active && row !== active;
      const block = document.createElement('li');
      block.className = `usage-provider${row === active ? ' active' : ''}${compact ? ' compact' : ''}`;
      const head = document.createElement('div');
      head.className = 'usage-head';
      head.append(plumSpan('usage-name', row.label));
      if (row.exhausted) head.append(plumSpan('usage-tag danger', 'aufgebraucht'));
      else if (row.estimate) head.append(plumSpan('usage-tag', 'geschätzt'));
      block.append(head);
      const windows = document.createElement('div');
      windows.className = 'usage-windows';
      for (const window of row.windows || []) {
        const value = Math.min(100, Math.max(0, Number(window.utilization) || 0));
        const forecast = plumForecastText(window);
        const line = document.createElement('div');
        line.className = 'usage-window';
        line.title = window.resetsAt ? `Zurückgesetzt ${plumResetText(window.resetsAt)}` : '';
        line.append(
          plumSpan('usage-label', window.label),
          plumUsageFill(value),
          plumSpan('usage-value', `${window.utilization} %`)
        );
        if (!compact) line.append(plumSpan('usage-reset', plumResetText(window.resetsAt)));
        // Compact rows only warn; "reicht bis Reset" is the quiet default.
        if (forecast && (!compact || forecast.kind !== 'ok'))
          line.append(plumSpan(`usage-forecast ${forecast.kind}`, forecast.text));
        windows.append(line);
      }
      block.append(windows);
      if (onOpen) {
        block.classList.add('clickable');
        block.tabIndex = 0;
        block.setAttribute('role', 'link');
        block.title = `${row.label}: Auswertung öffnen`;
        block.addEventListener('click', () => onOpen(row));
        block.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen(row);
          }
        });
      }
      return block;
    })
  );
  empty.hidden = ordered.length > 0;
  if (!ordered.length) empty.textContent = rows.length ? 'Alle Anbieter ausgeblendet.' : '';
}

/** createdAt in ms (or seconds from older servers). */
function plumMs(value) {
  const number = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(number)) return Date.now();
  return number < 1e12 ? number * 1000 : number;
}

/**
 * Open approvals and agent questions from approvals.list, answerable in place:
 * permissions with allow once / always / deny, questions with the first
 * question's options or reject. Hidden while nothing waits.
 */
function plumMountApprovals(container, { onOpen, onChange } = {}) {
  container.className = 'glass card approvals';
  container.hidden = true;
  const head = document.createElement('div');
  head.className = 'log-head';
  const title = document.createElement('h2');
  title.textContent = 'Freigaben';
  const count = plumSpan('count', '');
  head.append(title, count);
  const list = document.createElement('ul');
  list.className = 'approval-list';
  const status = document.createElement('p');
  status.className = 'message error';
  status.hidden = true;
  container.append(head, list, status);

  let items = [];
  let enabled = true;

  function say(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  async function answer(item, method, params, buttons) {
    for (const button of buttons) button.disabled = true;
    say('');
    try {
      await plumCall(method, params);
    } catch (error) {
      say(`Nicht beantwortet: ${error.message}`);
    }
    await refresh();
  }

  function itemNode(item) {
    const li = document.createElement('li');
    li.className = `approval ${item.kind}`;
    const top = document.createElement('div');
    top.className = 'approval-top';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'approval-session';
    name.textContent = item.sessionName || 'Session';
    name.title = 'Session in Plum öffnen';
    name.addEventListener('click', () => onOpen && onOpen(item));
    top.append(name, plumSpan('when', plumRelative(plumMs(item.createdAt))));
    li.append(top);

    const actions = document.createElement('div');
    actions.className = 'approval-actions';
    const buttons = [];
    const add = (label, className, method, params) => {
      const button = plumButton(
        label,
        '',
        () => void answer(item, method, params, buttons),
        className
      );
      buttons.push(button);
      actions.append(button);
      return button;
    };

    if (item.kind === 'permission') {
      li.append(plumSpan('approval-tool', item.toolName || 'Werkzeug'));
      if (item.description) {
        const description = plumSpan('approval-text', item.description);
        description.title = item.description;
        li.append(description);
      }
      const base = { sessionId: item.sessionId, requestId: item.requestId };
      add('Erlauben', 'primary', 'permission.respond', { ...base, action: 'allow_once' });
      add('Immer erlauben', '', 'permission.respond', { ...base, action: 'allow_project' });
      add('Ablehnen', 'danger', 'permission.respond', { ...base, action: 'deny' });
    } else {
      const questions = Array.isArray(item.questions) ? item.questions : [];
      const first = questions[0] || { header: '', question: '', options: [] };
      if (first.header) li.append(plumSpan('approval-tool', first.header));
      if (first.question) {
        const text = plumSpan('approval-text', first.question);
        text.title = first.question;
        li.append(text);
      }
      const base = { requestId: item.requestId };
      if (item.providerSessionId) base.providerSessionId = item.providerSessionId;
      for (const option of first.options || []) {
        const button = add(option.label, '', 'question.respond', {
          ...base,
          answers: [[option.label], ...questions.slice(1).map(() => [])],
        });
        if (option.description) button.title = option.description;
      }
      if (questions.length > 1)
        li.append(plumSpan('approval-more', `+${questions.length - 1} weitere in Plum`));
      add('Ablehnen', 'danger', 'question.respond', base);
    }
    li.append(actions);
    return li;
  }

  function render() {
    const shown = enabled ? items : [];
    container.hidden = shown.length === 0;
    count.textContent = shown.length > 1 ? String(shown.length) : '';
    list.replaceChildren(...shown.map(itemNode));
    if (!shown.length) say('');
  }

  async function refresh() {
    if (!enabled) return items;
    try {
      const data = await plumCall('approvals.list');
      items = Array.isArray(data) ? data : [];
    } catch {
      // Offline or an older Plum without approvals.list.
      items = [];
    }
    render();
    if (onChange) onChange(items);
    return items;
  }

  return {
    refresh,
    items: () => items,
    /** Off while disconnected: nothing could be answered. */
    setEnabled(value) {
      if (enabled === value) return;
      enabled = value;
      if (!value) items = [];
      render();
      if (onChange) onChange(items);
    },
  };
}

/**
 * The last sessions with their state (arbeitet / wartet / bereit) and a
 * one-line field that sends a message to the selected one.
 */
function plumMountRecentSessions(container, { limit = 5, waiting = () => new Set() } = {}) {
  container.className = 'glass card recent';
  const title = document.createElement('h2');
  title.textContent = 'Zuletzt aktiv';
  const list = document.createElement('ul');
  list.className = 'recent-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Letzte Sessions');
  const form = document.createElement('form');
  form.className = 'quick-send with-action';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 4000;
  input.setAttribute('aria-label', 'Nachricht');
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'primary';
  send.textContent = 'Senden';
  form.append(input, send);
  const status = document.createElement('p');
  status.className = 'message';
  status.hidden = true;
  status.setAttribute('role', 'status');
  container.append(title, list, form, status);

  let sessions = [];
  let selectedId = null;
  let statusTimer = null;

  const time = (value) => Date.parse(value) || Number(value) || 0;
  const selected = () => sessions.find((session) => session.id === selectedId) || null;

  function say(text, kind) {
    clearTimeout(statusTimer);
    status.textContent = text;
    status.className = `message ${kind}`;
    status.hidden = !text;
    if (text && kind === 'ok') statusTimer = setTimeout(() => say(''), 4000);
  }

  function stateOf(session) {
    if (waiting().has(session.id)) return ['waiting', 'wartet'];
    if (session.busy) return ['working', 'arbeitet'];
    return ['ready', 'bereit'];
  }

  function render() {
    list.replaceChildren(
      ...sessions.map((session) => {
        const li = document.createElement('li');
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'recent-option';
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(session.id === selectedId));
        const icon = plumSpan(
          'picker-icon',
          (typeof PICKER_PROVIDER_ICONS !== 'undefined' &&
            PICKER_PROVIDER_ICONS[session.provider]) ||
            '•'
        );
        icon.setAttribute('aria-hidden', 'true');
        const name = plumSpan('recent-name', session.name || session.id);
        name.title = session.name || session.id;
        const [kind, label] = stateOf(session);
        option.append(icon, name, plumSpan(`chip ${kind}`, label));
        option.addEventListener('click', () => {
          selectedId = session.id;
          void browser.storage.local.set({ quickSessionId: session.id });
          render();
          input.focus();
        });
        li.append(option);
        return li;
      })
    );
    const current = selected();
    container.hidden = sessions.length === 0;
    input.placeholder = current ? `An „${current.name || current.id}“ …` : 'Session wählen …';
    input.disabled = !current;
    send.disabled = !current;
  }

  async function refresh() {
    try {
      const [rows, stored] = await Promise.all([
        plumCall('sessions.list'),
        browser.storage.local.get('quickSessionId'),
      ]);
      sessions = [...(Array.isArray(rows) ? rows : [])]
        .sort((a, b) => time(b.lastActivity) - time(a.lastActivity))
        .slice(0, limit);
      const ids = new Set(sessions.map((session) => session.id));
      if (!ids.has(selectedId))
        selectedId = ids.has(stored.quickSessionId)
          ? stored.quickSessionId
          : sessions[0]
            ? sessions[0].id
            : null;
    } catch {
      sessions = [];
    }
    render();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const session = selected();
    const message = input.value.trim();
    if (!session || !message) return;
    send.disabled = true;
    try {
      const ack = await plumCall('chat.send', {
        sessionId: session.id,
        message,
        clientMessageId: `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      if (ack && ack.status === 'rejected') throw new Error(ack.error || 'Abgelehnt');
      input.value = '';
      say(ack && ack.disposition === 'queued' ? 'In der Warteschlange.' : 'Gesendet.', 'ok');
      session.busy = true;
      render();
      setTimeout(() => void refresh(), 2000);
    } catch (error) {
      say(`Nicht gesendet: ${error.message}`, 'error');
    } finally {
      send.disabled = !selected();
    }
  });

  container.hidden = true;
  return { refresh, render };
}
