# Session handover 2026-10-17 — Gerätesteuerung über die App (kein adb)

## Idee (Nutzer)

Buddy (github.com/ghorbelhamdi/buddy-android, Apache-2.0) zeigt den Weg: ein
Accessibility-Service auf dem Gerät statt adb. Der Nutzer will das als Feature
in der Plum-Android-App aktivier-/koppelbar — wie Desktop-Companion und
Browser-Extension.

## Umgesetzt (Commit `6a08f5b`, main)

1. **Backend**: `services/deviceBridge/bridge.ts` — WS-Relay auf
   `/ws/device-bridge` (Hello-Frame mit App-JWT, Pending-Call-Map, Heartbeat),
   `routes/deviceBridge.ts` — `GET /api/device-bridge/status`,
   `POST /api/device-bridge/internal/call` (Hook-Secret + `x-webui-session-id`),
   Verdrahtung in `index.ts` (attach + 40mb-Body-Limit + Mount).
2. **Android-App** (`core/devicecontrol/`):
   - `DeviceControlAccessibilityService` — Tools: `read_screen`, `tap`,
     `long_press`, `swipe`, `scroll`, `type_text`, `press`, `open_app`,
     `list_apps`, `screenshot` (API 30+).
   - `DeviceControlService` — Foreground-Service, OkHttp-WS, Hello/Call/Result-
     Frames, Reconnect-Backoff; startet automatisch, wenn die
     Bedienungshilfe-Sitzung verbindet.
   - `DeviceControlPanel` in Einstellungen → Browser → neben Firefox/Desktop:
     Status (Verbunden/verbindet/pausiert/aus), Schalter „Sessionen dürfen
     bedienen", Button „Bedienungshilfen öffnen". Strings de/en.
   - Manifest: BIND_ACCESSIBILITY_SERVICE + dataSync-FGS + QUERY_ALL_PACKAGES.
3. **Frontend**: `DeviceBridgeStatus` im Verbindungen-Panel der Session
   (Sektion „Gerätesteuerung (App)", Poll 20s).
4. **MCP**: `scripts/mcp-servers/android-device.mjs` als `android-device`
   registriert (settings.json) — Tools: devices, device_status, read_screen,
   tap, long_press, swipe, scroll, type_text, press, open_app, list_apps,
   screenshot. Ruft `/api/device-bridge/internal/call` mit Hook-Secret.

**Kopplung**: kein Pairing-Code — App ist als Nutzer angemeldet; das
Aktivieren der Bedienungshilfe ist der Consent-Moment (Default: enabled-Pref
an, Pause über den App-Schalter).

## Verifikation / Offen

- Backend+Frontend `tsc` grün. WebUI-Rebuild getriggert (repair-bot).
- Android-Build läuft (android-builder, Projekt 796aa064…) — bei Erfolg APK
  nach `/mnt/user/Zwischenspeicher/` kopieren + SHA-256.
- Nach Rebuild prüfen: `GET /api/device-bridge/status`, MCP
  `node scripts/mcp-call.mjs tools android-device`.
- End-to-End auf dem Testgerät (192.168.1.131:35023): APK installieren,
  Accessibility-Service aktivieren, App paart sich → `device_status`/
  `read_screen`/`screenshot` über den MCP testen. Geräte-Install nur mit
  ausdrücklicher Freigabe des Nutzers.
- Buddy-Referenz: Tools.java (GestureDescription, findFocus/SET_TEXT,
  takeScreenshot); Guards/Reviewer von Buddy bewusst nicht übernommen
  (Phase 1; Plum-Sessions sind beaufsichtigt).
