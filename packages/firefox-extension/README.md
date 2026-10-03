# Plum Browser (Firefox & Chrome)

One extension for both browsers. `src/` is shared; `src/targets/firefox`
(Manifest V2, persistent background page) and `src/targets/chrome` (Manifest V3
service worker, side panel, MAIN-world helpers) add the manifest and the
browser-only files. The package directory keeps its historical name.

Firefox extension that lets Plum Code agents drive your Firefox — the Firefox
counterpart of Claude in Chrome. Every Plum session works inside its own
Firefox tab group (`Plum · <session name>`) and only sees the tabs in it.

```
agent CLI ──stdio──▶ scripts/mcp-servers/firefox.mjs
                         │  POST /api/browser-bridge/internal/call (hook secret + session id)
                         ▼
                    Plum backend ── WebSocket /api/browser-bridge/ws ──▶ this extension ──▶ tabs
```

The extension dials out to Plum, so Firefox can sit behind NAT on any machine.
Behind Authelia/SSO it falls back to the `/mobile` gateway path automatically.

## Install

1. Plum → **Settings → Firefox browser** → download the `.xpi`.
2. Install it in Firefox (see _Signing_ — release Firefox needs a signed build).
3. The options page opens. In Plum click **Pair browser**, then paste the Plum
   address and the `plum_ff_…` token and press **Speichern & verbinden**.
4. New Plum sessions get the `firefox` MCP tools. Existing sessions pick them up
   after a restart, because MCP servers bind when the CLI starts.

The pairing token opens only the browser bridge. It cannot call the REST API.
Revoke it in Plum and the socket closes within a minute.

## Tools

`status`, `tabs_list`, `tab_open`, `tab_close`, `tab_activate`, `navigate`
(URL/back/forward/reload), `screenshot` (image pixels = CSS pixels),
`read_page` (outline with `ref_N` element refs), `find`, `get_page_text`,
`click`, `hover`, `type`, `press_key`, `scroll`, `form_input`, `evaluate_js`,
`read_console`, `wait_for`, `resize_window`.

Firefox gives extensions no debugger protocol, so input is synthesised: DOM
pointer/keyboard events plus the default action a real key would trigger
(`insertText`, focus moves, Enter submits the form, Tab moves focus). Events
are `isTrusted: false`, and sites that insist on trusted input will ignore
them. Firefox-internal pages (`about:*`, addons.mozilla.org) cannot be
scripted.

## What the user sees

- **Own window per session:** Plum creates one Firefox window per session (unfocused) holding its tab group. It never switches, reorders or focuses the user's own tabs and windows. A group left in a normal window by an older version is moved out on first use.
- **Virtual cursor:** A Plum pointer glides to every click, hover, type and scroll target, shows a ripple on clicks and stays in place across page loads. It and the violet frame are hidden while a screenshot is taken.
- **Chat sidebar:** The window's sidebar shows the session's Plum chat (`<plum>/session/<id>`, mobile layout at sidebar width). Firefox only opens sidebars on a user action; in a session window the Plum toolbar icon toggles it with one click, and `Alt+Shift+P` works too. Firefox restores it with the window, and new session windows usually inherit an open sidebar. Put it on the right with `sidebar.position_start = false`.

## Locked screen

Control keeps working while the desktop is locked or the Plum window is covered.
Pages are then `hidden`, so the extension skips cursor animation and paint
waits: a screenshot takes about 0.1 s, compared with 4 s when it waited for
frames. Firefox may restart while locked; it reconnects on its own. Only system
suspend stops it, so keep auto-suspend off on the controlled machine.

## Safety

- Only tabs in the session's tab group are visible. Drag a tab into a group to
  share it; close the group to take it away.
- A violet frame and a pill ("Plum steuert diesen Tab") show while an agent acts.
- The popup and options page can pause control; `evaluate_js` can be switched off.
- Console capture is active only in tabs that belong to a Plum session.
- Without the tab-group API (Firefox < 139) the extension tracks session tabs
  internally instead.

## Build

```bash
node packages/firefox-extension/scripts/build.mjs
# → dist/plum-browser-firefox.xpi, dist/plum-browser-chrome.zip, dist/chrome/ (all unsigned)
```

The Docker image runs this in the builder stage. It serves the Firefox package at
`GET /api/browser-bridge/extension.xpi` and the Chrome package at `/api/browser-bridge/extension-chrome.zip`.

## Chrome / Edge

- **Install:** Unzip `plum-browser-chrome.zip`, open `chrome://extensions`, turn on Developer mode, then choose _Load unpacked_. The extension ID is fixed (`oaacdgkogibamjhjppjlhncjknlcigof`, from the manifest `key`). Sites that forbid Developer mode need the Web Store or an enterprise policy.
- **Chat:** Each session's chat opens as a slim **popup window docked on the right** of the session window (placed via `system.display`; 440 px). It is a real window, so the normal Plum/Authelia login applies. A side-panel iframe cannot do this: Chrome withholds `SameSite=Lax` cookies from frames inside extension pages, which caused a login loop. The toolbar icon opens the **side panel** with status, pause, "Chat öffnen" and the session list.
- **Service worker:** Chrome stops idle service workers. The socket sends a ping every 20 s, and an alarm reconnects if the worker was stopped anyway.
- **Page context:** `evaluate_js` and console capture run in the MAIN world through `chrome.scripting`. Pages whose CSP forbids `unsafe-eval` reject `evaluate_js`. The console hook is registered at `document_start` only for the hosts of session tabs.
- **Screenshots:** `captureVisibleTab` delivers device pixels, and scaling uses the CSS viewport. If it stalls (locked screen, covered window), the capture falls back to DevTools `Page.captureScreenshot` (the `debugger` permission; Chrome shows its debugging banner briefly).
- **Back/forward:** Chrome skips history entries created without a user gesture, so `navigate back` falls back to the page's own `history.go`.
- **Provisioning:** Managed storage works via Chrome policy `3rdparty.extensions.<id>` = `{serverUrl, token, label}` (schema in `managed_schema.json`).
- **Tested:** Chromium 152 end to end, and a real Google Chrome 153 on the Geekom, including a locked screen.

## Tutorial modes

The panel's mode bar has two ways to teach and learn:

- **Vorführen** (demonstrate): do the task yourself while the extension records
  clicks, typed values (never passwords or card fields), Enter and shortcuts,
  page loads, tab switches and scrolling, plus a screenshot per click with the
  click circled. Review the steps, add a note and send them to the session; the
  agent learns from them and can replay them with the browser tools.
- **Anleiten** (guide): the agent watches your active tab and shows you what to
  do with its cursor (`point`), marks (`annotate`: circle, box, arrow,
  underline, with a label) and a pen (`draw`). Clicking, typing, scrolling and
  navigating are blocked for it, so you do every step yourself.

Both work on web pages only; native desktop apps are outside the browser.

## Signing

Release Firefox installs unsigned add-ons only temporarily
(`about:debugging` → _Load Temporary Add-on_). Developer Edition, Nightly and
ESR can set `xpinstall.signatures.required=false`. For a permanent install,
sign it once as an unlisted (self-distributed) add-on. It is not published on AMO:

```bash
packages/firefox-extension/scripts/sign-firefox.sh
```

The script builds, signs and copies the result to
`data/firefox/plum-browser-firefox.xpi`, the persistent backend data dir, from
where Plum serves it instead of the unsigned image copy. The AMO key (account
`zwaetschge`, from <https://addons.mozilla.org/developers/addon/api/key/>) lives
in `data/firefox/amo.env` as `AMO_JWT_ISSUER`/`AMO_JWT_SECRET`, mode 600, never
in git. AMO shows a new secret only once, right after generating it. Bump
`version` in both manifests before re-signing; AMO signs a version only once.

## Linux distro Firefox without signing (Fedora and others)

Distribution builds are often configured with `--with-unsigned-addon-scopes=app,system`
(check `about:buildconfig`). They load an unsigned `.xpi` from the application
scope permanently:

```bash
sudo install -m 644 plum-browser-firefox.xpi \
  /usr/lib64/firefox/browser/extensions/plum-browser@zwaetschge-webui.ch.xpi
# in the profile's user.js, so the sideload is scanned and not held for approval:
user_pref("extensions.autoDisableScopes", 11);
user_pref("extensions.startupScanScopes", 4);
```

To provision the connection too, use managed storage. The options page still
overrides it:

```bash
sudo install -m 600 -o "$USER" /dev/stdin \
  /usr/lib64/mozilla/managed-storage/plum-browser@zwaetschge-webui.ch.json <<'JSON'
{"name":"plum-browser@zwaetschge-webui.ch","description":"Plum Browser","type":"storage",
 "data":{"serverUrl":"https://code.example.ch","token":"plum_ff_…","label":"Desktop"}}
JSON
```

Restart Firefox after either change. Tested on a Geekom A8 Max (Fedora 44 KDE, Firefox 156, ultrawide 3440 px).

## End-to-end test

`packages/backend/scripts/browser-bridge-e2e.ts` runs the real bridge on its own
port, installs the extension into a Selenium Firefox container, fills in the
options page and exercises every tool against a test page:

```bash
docker run -d --name plum-ff-e2e --network <webui network> --shm-size 2g selenium/standalone-firefox
FIREFOX_WEBDRIVER=http://<ff-ip>:4444 BRIDGE_HOST=<webui-ip> E2E_USER_ID=<user id> \
  npx tsx packages/backend/scripts/browser-bridge-e2e.ts
```
