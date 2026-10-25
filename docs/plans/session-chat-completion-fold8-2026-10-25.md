# Chat completion and Fold8 handoff — 2026-10-25

## Delivered

GLM-5.3 Flash (`z-ai / glm-5.3-flash`) is the default for new API chats in WebUI, Android and Plum Desk. The user explicitly prohibited Claude API calls because that account has no credits. Existing selected chats retain their chosen model; no automatic model fallback runs. A real public GLM chat returned `OK` with correctly attributed usage.

Android1.9.2 vc54 is installed on the user's Fold8 (SM-F971B), and published through the existing public update channel. Main device192.168.1.106:40781 is selected for this Plum session. Wi-Fi debugging ports can change; never retain pairing codes. The former tablet192.168.1.131 is superseded for this task.

APK `/mnt/user/Zwischenspeicher/plum-1.9.2.apk`, 52,451,281bytes, SHA256`cae00842fe9e0a108e3cbf4f9d330d931866a8fa2918f9dad81fdf76d9e0d2b8`. Package`com.claudewebui.app.debug`, manifest1.9.2-debug vc54. Public authenticated download returned exactly the same bytes/hash. Release backup `/srv/plum/appdata/plum-code-webui/data/android/backup-fold8-20261025-182323`. No main-container restart was needed to publish the APK.

## Changes and verification

Workspace columns use actual window constraints. Chat draft/model selections survive Activity recreation, and selected-chat reload preserves the unsent draft. Code output adapts to available height, controls wrap, realtime transcripts scroll while actions remain accessible.

Native code runs in a separate WebView without credentials or a native bridge. Python uses the local allowlisted worker runtime. HTML renders directly in that isolated WebView with a strict CSP response header; the additional nested iframe was blank on the real device. Arbitrary network, API, file and content access remain blocked.

Actual Fold8 checks passed: native GLM New Chat default; Python42; HTML heading/button changing toOK; editor with Samsung split keyboard; HTML isolation showing NETWORK=BLOCKED/API=BLOCKED/BRIDGE=ABSENT; softwarecover0(1248x1972)↔OPENED3 preserving chat/draft; true process kill/restart preserving same chat/draft; scrolling and reachable actions on cover. Device override reset to physicalOPENED3, app left at empty New Chat with GLM. AndroidRuntime error log was empty. A transient greeting plus Claude label during startup belonged to restoration of the existing Claude fixture, not the new-chat default.

All91 Android unit tests passed. Shared/backend/frontend builds, backend typecheck, GLM catalog unit regressions and existing API-chat regression suite passed. Desktop1440/mobile390 rendered default selection and manual selection passed with zero model calls. Authenticated production catalog starts with GLM Flash; public APK metadata/download verified.

Evidence `.logs/fold8-final-android.json`, `.logs/fold8-device-final.json`, `.logs/fold8-final-unit-tests.json`, `.logs/fold8-publication.json`, `.logs/fold8-public-release-check.log`, `.logs/glm-default-*`. Device screenshots `.screenshots/fold8-final-*` may contain private chat titles: do not publish them casually. Final source digest`6cc471795ff49039980a422035b4772c5cc96662fca8298ee594d3467b2bedf0`; packaged web indexSHA`3d1692e6da2b4ee57544529a0f29f2a97c95b5c92fe9748fef02443e9284397d`.

## Open WebUI replacement and data

Commits8435805,8ed91eb,888466b,4303d50 added workbench, native Android workbench/code/realtime sheets, citations/original documents, Python/HTML execution, web/MCP tools, comparisons/merge, export/import/share/revoke and authenticated full-duplex realtime audio. Follow-up commitsb3426f7 and45355e2 cover GLM default, Fold8 layouts and native HTML rendering.

Migration completed:149 original Open WebUI chats became294 branch chats across2 exactly matched account owners; all114 original files retained. Source chat JSON and file-byte hashes verified without failures. Private archive `data/private-migrations/openwebui-20261025` contains the SQLite snapshot, raw chats/files and verification. Protect directory700/files600; do not print its contents. Open WebUI was not removed or stopped.

Actual OpenAI realtime audio remains unverified because the user's OpenAI connection is absent. Namespace/auth and explicit missing-provider result were verified; controlled realtime audio tests passed. Existing voice chat uses the configured Vocarium path. No key should be pasted into chat.

Two exact synthetic test chats were archived after testing; cleanup evidence `.logs/fold8-clean-fixtures.log`. The GLM test was temporary and used no Claude API request. User conversations were not changed during Fold8 checks.

## Operations

Public target Geekom192.168.1.124:4545, source `/srv/plum/appdata/plum-code-webui`, URL`https://plum.zwaetschge-webui.ch/mobile`. Use official external repair-bot via scripts/plum-rebuild.sh for future server deploys. GLM source backup `/srv/plum/deploy/backups/glm-flash-default-20261025`; release Dockerfile copies shared default helper at the runtime pnpm shared-package path and Plum Desk parity. SSH knownhosts `.logs/plum-geekom-known-hosts`.

Android only through MCP, project796aa064-f0bb-4031-bbf2-2da83a4bca94. MCP launch helper mangles fully qualified activities; use MCPadb_shell `am start -n com.claudewebui.app.debug/com.claudewebui.app.MainActivity`. Never raw adb/Gradle, uninstall/reset user data, or start simultaneous builds. Always stage via cp-a and verify new APK mtime/source/assets/SHA.

Preserve unrelated AGENTS.md, backendutils/piConfig.ts and packages/swarm/src/coordinatorGate.ts changes. Do not commit private archives, screenshots of user chats, or logs/tokens.
