# Wear OS companion (2026-10-31)

User: "als nächstes brauchen wir die Wear-OS-Companion-App". Goal: the watch shows what the desktop companion and the browser extension now show — account usage with forecast, open approvals/questions with answer buttons, recent sessions with status and a quick (voice) reply — live, with a tile and a complication. Visible text German with umlauts, short.

Existing: `packages/android/wear` (1.2.0, vc3, View-based, applicationId must equal the phone's `com.claudewebui.app` incl. `.debug` suffix) mirrors a phone widget snapshot over the Wearable Data Layer every 15 min (`app/.../wear/WearSync.kt`, `WearBridgeService.kt`; watch `WearDataListenerService`, `PlumTileService`, `ApprovalsComplicationService`). Keep that snapshot path working as fallback while the watch is not paired.

## Architecture
The watch talks to Plum itself over the bridge WebSocket (same protocol as desktop companion and extension), with its own **watch-scoped** token handed over once by the phone app through the Data Layer. Internet on the watch comes via Wi-Fi/LTE or the phone's Bluetooth proxy.

## Server (packages/backend) — agent "backend+phone"
- Migration `026-browser-token-scope` in `db/migrations.ts`: `ALTER TABLE browser_tokens ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'browser'`.
- `services/browserBridge/tokens.ts`: `createBrowserToken(userId, name, scope = 'browser')`; `resolveBrowserToken` also returns `scope`.
- `bridge.ts`: `BridgeClientKind = 'browser' | 'desktop' | 'watch'`. A watch-scope token always connects as kind `watch` (ignore the requested kind); a browser-scope token may announce `watch` too. Watch connections never receive tool calls (they are not `browser`/`desktop` connections), no desktop `update` frames, but do get `sendAll` frames (`usage`, `usage-alert`, `notification`).
- `rpc.ts`: pass the connection kind in the RPC context; for kind `watch` allow only: `usage.limits`, `approvals.list`, `sessions.list`, `chat.open`, `chat.close`, `chat.send`, `chat.interrupt`, `permission.respond`, `question.respond`. Everything else → `Error('Not allowed for watch')`.
- `routes/browserBridge.ts`:
  - `POST /api/browser-bridge/watch-token` body `{ name }` (1–80 chars), `requireAuth`, `rateLimiters.strict`, **allowed through the mobile gateway** (do not call `rejectGatewayCaller`): revokes the caller's previous watch-scope tokens with the same name, creates a watch-scope token, returns `{ success, data: { id, name, token } }` (secret only here).
  - `DELETE /api/browser-bridge/watch-token/:id`: revokes only a watch-scope token of the caller, disconnects it.
- Tests for scope enforcement and the RPC allowlist (node:test, pattern of `services/browserBridge/*.test.ts`).

Bridge wire format (already live, read `bridge.ts`/`firefox-extension/src/background.js` for details such as keep-alive/ping and reconnect backoff):
- Client → server first frame `{ type: 'hello', token, client: { kind: 'watch', name: 'Uhr', version, platform: 'Wear OS', label: '<watch model>' } }`; answer `{ type: 'welcome', … }` or `{ type: 'error', code: 'UNAUTHORIZED' }` + close 4401.
- RPC `{ type: 'rpc', id, method, params }` → `{ type: 'rpcResult', id, ok, data | error }`.
- Pushed: `{ type: 'usage', rows, at }`, `{ type: 'usage-alert', level, provider, title, body }`, `{ type: 'notification', kind, sessionId, title, body }`; ignore unknown types.
- WebSocket URL: `<serverUrl>/api/browser-bridge/ws`; if that fails and the URL has no `/mobile`, try `<origin>/mobile/api/browser-bridge/ws` (the extension does the same, see `shared.js`).
- RPC payloads: see `docs/plans/usage-companion-10-2026-10-31.md` (UsageRow with `active`, `forecast`, `analyticsPath`; Approval items) and `rpc.ts` (`chat.send {sessionId, message, clientMessageId}`, `sessions.list` rows `{id, name, provider, status, busy, lastActivity}`).

## Phone app (packages/android/app) — agent "backend+phone"
- Data Layer path `/plum/watch-pairing`: urgent DataItem with `serverUrl` (the base URL the phone itself uses for the API, e.g. `https://plum.zwaetschge-webui.ch/mobile`), `token`, `tokenId`, `issuedAt` (ms). Removing the item (or `token` = "") means unpaired.
- Settings: section „Uhr“ listing connected Wear nodes (NodeClient) with „Uhr koppeln“ (POST watch-token with name „Uhr <node displayName>“, then put the DataItem) and „Entkoppeln“ (DELETE watch-token, delete DataItem). Show „Gekoppelt seit …“. Plus a one-time prompt on the dashboard when a watch with the Plum app (CapabilityClient capability `plum_wear`) is connected but not paired — dismissible.
- Keep `WearSync` snapshot pushing. Bump phone to 1.9.11 / versionCode 63.

## Watch app (packages/android/wear) — agent "wear"
- Capability `plum_wear` declared in `res/values/wear.xml`.
- `WearDataListenerService`: receive `/plum/watch-pairing`, store serverUrl/token (EncryptedSharedPreferences or a private-mode file; never log the token).
- `PlumBridge` (OkHttp WebSocket; OkHttp is already a phone dependency, add it to wear): connects while the app UI is visible, reconnects with backoff, exposes StateFlows for usage rows, approvals, sessions, connection state; one-shot `refreshOnce()` (connect, `usage.limits` + `approvals.list`, close) for tile/complication via a 15-min periodic WorkManager job and on `usage` push.
- UI in Compose for Wear OS (add `androidx.wear.compose` foundation + material 1.4.x or material3 if it resolves; Horologist optional): pages
  1. **Nutzung**: active provider as a big circular ring with percent, window label and forecast („voll ca. 18:20“ / „reicht bis Reset“); others as small rows with a mini ring; tap a row → detail with all windows.
  2. **Freigaben**: cards with tool + session, buttons „Erlauben“, „Immer“, „Ablehnen“; questions with option chips + „Ablehnen“ (multi-question → „Am Handy beantworten“).
  3. **Sessions**: last 5 with status dot (arbeitet / wartet / bereit); tap → reply screen with voice input (RemoteInput/`RecognizerIntent`) and 3 quick replies („Weiter“, „Ja, mach das“, „Stopp“ = chat.interrupt).
  4. Not paired: „Auf dem Handy unter Einstellungen → Uhr koppeln“. Offline: last data with „Stand vor …“.
- Tile: big ring of the active (else highest) provider + approvals count; tap opens app. Complication: RANGED_VALUE of the same percentage and SHORT_TEXT approvals count (keep the existing approvals complication working).
- Rotary input/scrolling must work (ScalingLazyColumn/TransformingLazyColumn). Round screens first.
- Bump wear to 1.3.0 / versionCode 4.

## Working rules
Other sessions edit this repo concurrently: targeted edits only, never revert foreign changes, no git checkout/stash/reset/commit. Work under /mnt/cache/appdata/claude-code-webui. Do not run Gradle or adb from Bash and do not call `android_build` — the coordinating session builds (one Gradle project, one builder). Do not deploy.
