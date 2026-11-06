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
  // Sites the agent may not read or touch at all; it is told to ask the user.
  blockedSites: '',
  // Usage providers hidden in the popup and the icon ring (ids from usage.limits).
  usageHidden: [],
});

/** Providers usage.limits can report, in the server's order. */
const PLUM_USAGE_PROVIDERS = Object.freeze([
  ['codex', 'Codex'],
  ['claude', 'Claude'],
  ['zai', 'Z.AI'],
  ['alibaba', 'Token Plan'],
  ['mistral', 'Mistral'],
  ['vibe', 'Vibe'],
]);

const PLUM_STATUS_TEXT = Object.freeze({
  connected: 'Verbunden',
  connecting: 'Verbinde …',
  error: 'Nicht verbunden',
  idle: 'Getrennt',
  unconfigured: 'Nicht eingerichtet',
});

/** The non-empty entries of a site list. */
function plumRuleList(patterns) {
  return String(patterns || '')
    .split(/[\n,]+/)
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

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

/**
 * A pre-paired download from Plum ships `plum-config.json` next to the
 * manifest, so the browser connects right after "Load unpacked" without
 * copying the address and token by hand. Absent in the generic build.
 */
async function plumBundledSettings() {
  try {
    const response = await fetch(browser.runtime.getURL('plum-config.json'));
    return response.ok ? await response.json() : {};
  } catch {
    return {};
  }
}

async function plumLoadSettings() {
  const stored = await browser.storage.local.get(Object.keys(PLUM_DEFAULTS));
  const settings = { ...PLUM_DEFAULTS, ...stored };
  // Priority: options page (storage) > administrator policy > pre-paired bundle.
  for (const source of [plumManagedSettings, plumBundledSettings]) {
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

/** Whether a dotted version string is newer than another ("0.10.0" > "0.9.1"). */
function plumNewerVersion(latest, current) {
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

/** 'blocked', 'protected' or 'free' for a hostname under the current settings. */
function plumSiteState(hostname, settings) {
  if (plumIsProtected(hostname, settings.blockedSites)) return 'blocked';
  if (plumIsProtected(hostname, settings.protectedSites)) return 'protected';
  return 'free';
}

/**
 * Puts a host on the protected or blocked list (or takes it off both with
 * list = 'free'). Exact host entries only; patterns the user typed stay.
 */
async function plumSetSiteRule(hostname, list) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return;
  const settings = await plumLoadSettings();
  const lines = (value) =>
    String(value || '')
      .split(/[\n,]+/)
      .map((line) => line.trim())
      .filter(Boolean);
  const patch = {};
  for (const key of ['protectedSites', 'blockedSites']) {
    const wanted = (key === 'protectedSites' ? 'protected' : 'blocked') === list;
    const entries = lines(settings[key]).filter((line) => line.toLowerCase() !== host);
    if (wanted) entries.push(host);
    patch[key] = entries.join('\n');
  }
  await plumSaveSettings(patch);
}

/**
 * Pulls a Plum address and/or pairing token out of pasted text: a JSON
 * object, a "https://… plum_ff_…" line or either part on its own.
 */
function plumParsePairing(text) {
  const raw = String(text || '').trim();
  const found = {};
  try {
    const json = JSON.parse(raw);
    if (json && typeof json === 'object') {
      if (typeof json.serverUrl === 'string') found.serverUrl = json.serverUrl;
      if (typeof json.token === 'string') found.token = json.token;
      if (typeof json.label === 'string') found.label = json.label;
      return found;
    }
  } catch {
    /* not JSON */
  }
  const token = raw.match(/plum_ff_[A-Za-z0-9_-]+/);
  if (token) found.token = token[0];
  const url = raw.match(/https?:\/\/[^\s"'<>]+/i);
  if (url) found.serverUrl = url[0].replace(/[),.;]+$/, '');
  return found;
}
