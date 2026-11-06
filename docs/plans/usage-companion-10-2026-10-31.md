# Ten usage/companion improvements (desktop companion + browser extension), 2026-10-31

User asked to implement all ten ideas for Plum Desktop (packages/desktop-companion/plum_desktop.py, now 0.7.0) and the Plum Browser extension (packages/firefox-extension/src, now 0.9.4). Visible UI text is German with umlauts (ä ö ü, „…“), no helper copy. Both clients talk to Plum only over the bridge socket (RPC + pushed frames); the pairing token has no REST access.

## Server contract (implemented in packages/backend by the coordinating session)

### RPC `usage.limits` (existing, extended, still returns an array)
Params: `{ sessionId?: string }` — the provider of that session is marked `active`; without it the provider of the user's most recently active session.

```ts
type UsageRow = {
  provider: 'codex' | 'claude' | 'zai' | 'alibaba' | 'mistral' | 'vibe';
  label: string;            // "Codex", "Claude", "Z.AI", "Token Plan", "Mistral", "Vibe"
  estimate: boolean;        // local estimate, not an upstream number
  exhausted: boolean;       // provider reports the allowance used up
  active: boolean;          // provider of the session in focus (at most one row)
  analyticsPath: string;    // "/analytics?provider=<id>" — open as serverUrl + analyticsPath
  windows: Array<{
    label: string;          // "5 Std.", "Woche", "Woche Sonnet", "Monat", …
    utilization: number;    // whole percent, may exceed 100 for estimates
    resetsAt: string | null;
    forecast: {
      state: 'exhausts' | 'lasts' | 'unknown';
      at: string | null;    // 'exhausts': ISO time the window hits 100 % at the recent pace
    };
  }>;
};
```
Forecast German wording for clients: `exhausts` → „voll ca. <Zeit>“ (relative when < 24 h: „voll in ca. 40 Min.“ / „voll ca. 18:20“), `lasts` → „reicht bis Reset“, `unknown` → nothing.

### RPC `approvals.list` (new)
Params: none. Returns up to 10 open items, oldest first:
```ts
type Approval =
  | { kind: 'permission'; sessionId: string; sessionName: string | null; requestId: string;
      toolName: string; description: string; createdAt: number }
  | { kind: 'question'; sessionId: string; sessionName: string | null; requestId: string;
      providerSessionId: string | null;
      questions: Array<{ header: string; question: string; multiple: boolean;
                         options: Array<{ label: string; description?: string }> }>;
      createdAt: number };
```
Answer with the existing RPCs: `permission.respond {sessionId, requestId, action: 'allow_once'|'allow_project'|'deny'}` and `question.respond {requestId, providerSessionId?, answers?: string[][]}` (answers omitted = reject). Show at most the first question's options as buttons; „Ablehnen“ rejects.

### Pushed frames (server → every bridge client of the user, desktop and browser)
- `{ type: 'usage', rows: UsageRow[], at: string }` — after every booked turn (debounced ~6 s) and every 5 min while connected. Clients replace their usage state with it; no polling needed while frames arrive (keep a slow fallback poll of 5 min).
- `{ type: 'usage-alert', level: 'warning' | 'exhausted' | 'reset', provider, title, body }` — server-side threshold crossings using the user's `usageAlerts` settings (enabled, quotaPercent). Clients show a system notification (desktop: QSystemTrayIcon.showMessage; extension: browser.notifications) — nothing else.
- `{ type: 'notification', kind: 'approval' | 'question', sessionId, title, body }` — a new approval or question; clients refresh `approvals.list` if their popup is open, the desktop also shows a tray message, the extension a browser notification.
Unknown frame types must be ignored (older clients already do).

## The ten items per client

1. Usage ring on the icon: tray icon (desktop) and toolbar icon (extension) get a thin ring around the Plum logo showing the highest utilization of all rows (or of the active row when one is active): green < 75, orange 75–89, red ≥ 90 / exhausted. Mode colour stays recognisable (desktop: the inner disc keeps the mode colour). Extension: draw with OffscreenCanvas/ImageData into `action.setIcon({imageData})` (Chrome) / `browserAction.setIcon` (Firefox); keep the existing badge text logic untouched.
2. Forecast line per window (`forecast` above) under or next to the bar.
3. Active provider first and larger; the others compact below. A per-client setting which providers to show (extension: options page + storage; desktop: checkable submenu „Anbieter anzeigen“ in the tray menu, persisted in state.json under `usageProviders`). Default: all.
4. `usage-alert` frames → system/browser notification (extension needs the `notifications` permission in both manifests).
5. Consume pushed `usage` frames; drop the 60 s poll to a 5 min fallback.
6. Approvals in the popup: list from `approvals.list` with „Erlauben“, „Immer erlauben“ (allow_project), „Ablehnen“ for permissions; option buttons + „Ablehnen“ for questions. Refresh on open, on `notification` frames, after answering.
7. Sessions: the last 5 sessions from `sessions.list` with status (arbeitet / wartet / bereit; „wartet“ when an approval for it is open), click selects; a one-line input sends to the selected session via `chat.send {sessionId, text}` (check the existing rpc for the exact params).
8. Clicking a provider row opens `serverUrl + analyticsPath` in the browser (desktop: QDesktopServices.openUrl with the bridge's server base URL).
9. Shortcut: extension `commands` entry `_execute_browser_action` (Firefox) / `_execute_action` (Chrome) with suggested key Alt+Shift+P (keep existing commands). Desktop: a KDE global shortcut Meta+Alt+P via the existing KWin script/DBus machinery (`registerShortcut` in a KWin script calling the companion's DBus service to toggle the popup) plus a „Anheften“ toggle in the popup that keeps it open as a normal frameless always-on-top window until unpinned.
10. Health: desktop popup shows version and „aktuell“ / „Update wird installiert“ (on an `update` frame), last connected time, and keeps the last usage rows with „Stand vor …“ when offline instead of an error. Desktop popup follows the system light/dark palette (QGuiApplication.styleHints().colorScheme()). Extension popup already has the update banner; add „Stand vor …“ when the socket is down.

## Working rules
Other sessions edit this repo concurrently: targeted edits only, no git checkout/stash/reset, no commits. Work under /mnt/cache/appdata/claude-code-webui. Do not deploy; the coordinating session ports and deploys. Keep the existing look (extension ui.css variables, desktop POPUP_STYLE/CARD_STYLE). Bump versions: extension 0.9.5 in both manifests, desktop VERSION 0.8.0.
