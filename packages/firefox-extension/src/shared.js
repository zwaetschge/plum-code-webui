/* Settings shared by background, popup and options page. */
'use strict';

// One code base for Firefox (MV2, `browser.*`) and Chrome (MV3, `chrome.*`).
// Chrome's MV3 APIs return promises too, so aliasing is enough for calls.
if (typeof globalThis.browser === 'undefined') globalThis.browser = chrome;
const PLUM_IS_CHROME = browser.runtime.getURL('').startsWith('chrome-extension://');

/**
 * runtime.onMessage with promise replies in both browsers. Chrome ignores a
 * returned promise; it needs `return true` plus sendResponse.
 */
function plumOnMessage(handler) {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const reply = handler(message, sender);
    if (reply === undefined) return false;
    Promise.resolve(reply).then(sendResponse, (error) =>
      sendResponse({ error: String((error && error.message) || error) })
    );
    return true;
  });
}

const PLUM_DEFAULTS = Object.freeze({
  serverUrl: '',
  token: '',
  label: '',
  paused: false,
  allowJs: true,
  wsPath: '',
  // Sites where the agent asks on the page before every click or input.
  protectedSites: [
    '*bank*',
    'ubs.com',
    'postfinance.ch',
    'raiffeisen.ch',
    'twint.ch',
    'paypal.com',
    'stripe.com',
    'checkout.*',
    'mail.google.com',
    'outlook.live.com',
    'outlook.office.com',
    'accounts.google.com',
  ].join('\n'),
});

/** Whether a hostname matches one of the protected-site patterns (glob, or domain + subdomains). */
function plumIsProtected(hostname, patterns) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  return String(patterns || '')
    .split(/[\n,]+/)
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean)
    .some((pattern) => {
      if (!pattern.includes('*')) return host === pattern || host.endsWith(`.${pattern}`);
      const regex = new RegExp(
        `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
      );
      return regex.test(host);
    });
}

/**
 * Connection defaults an administrator provisioned through managed storage
 * (native manifest `managed-storage/plum-browser@zwaetschge-webui.ch.json` or
 * the `3rdparty` policy). Values entered on the options page always win.
 */
async function plumManagedSettings() {
  try {
    return (await browser.storage.managed.get(['serverUrl', 'token', 'label'])) || {};
  } catch {
    return {};
  }
}

async function plumLoadSettings() {
  const stored = await browser.storage.local.get(Object.keys(PLUM_DEFAULTS));
  const settings = { ...PLUM_DEFAULTS, ...stored };
  // Priority: options page (storage) > administrator policy.
  for (const source of [plumManagedSettings]) {
    if (settings.serverUrl && settings.token) break;
    const provided = await source();
    for (const key of ['serverUrl', 'token', 'label']) {
      if (!settings[key] && typeof provided[key] === 'string') settings[key] = provided[key];
    }
  }
  return settings;
}

async function plumSaveSettings(patch) {
  await browser.storage.local.set(patch);
}

/** "code.example.ch" → "https://code.example.ch", trailing slashes and /mobile removed. */
function plumNormalizeServerUrl(input) {
  let value = String(input || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname === '/mobile') pathname = '';
  return `${url.origin}${pathname}`;
}

/** Candidate WebSocket endpoints, direct first, then the /mobile gateway (no SSO wall). */
function plumSocketCandidates(serverUrl, rememberedPath) {
  const base = plumNormalizeServerUrl(serverUrl);
  if (!base) return [];
  const wsBase = base.replace(/^http/i, 'ws');
  const paths = ['/api/browser-bridge/ws', '/mobile/api/browser-bridge/ws'];
  if (rememberedPath && paths.includes(rememberedPath)) {
    paths.splice(paths.indexOf(rememberedPath), 1);
    paths.unshift(rememberedPath);
  }
  return paths.map((path) => ({ path, url: `${wsBase}${path}` }));
}
