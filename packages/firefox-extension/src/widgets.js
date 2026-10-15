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
