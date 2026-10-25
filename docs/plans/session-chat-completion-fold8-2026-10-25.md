# Chat completion and Fold8 handoff — 2026-10-25

## User outcome

Replace Open WebUI with Plum; retain all original data. Main Android device is the user's Fold8 (SM-F971B), Wi-Fi host192.168.1.106, currently connected at port40781. The previous selected tablet192.168.1.131 is superseded for this task. Debugging connection ports change; do not retain pairing codes.

Latest instruction: Claude API has no credit. Use configured `z-ai / glm-5.3-flash` as the default for new API chats in both clients. Do not make Claude API calls. Existing manual chat selections remain explicit.

## Completed before Fold work

Commits8435805,8ed91eb,888466b,4303d50 implement chat workbench, native Android workbench/code/realtime sheets, citations and original documents, Python/HTML isolation, web/MCP tools, comparisons/merge, export/import/share/revoke, and authenticated full-duplex realtime audio.

Public Geekom rollout of4303d50 was ready, image96a638a356634b07d8105106ad11066518f8b8f84f91fc1f81e7d1d55e6d8437. Android1.9.1 vc53 published; APK `/mnt/user/Zwischenspeicher/plum-1.9.1.apk`, SHA25649aa639b6454e4a6728262adeae7627c9081ac863355bd6d5df90242f75b73bb. Installed successfully on Fold8 via MCP during this task.

Migration:149 original Open WebUI chats became294 branch chats across2 exactly matched account owners. All114 original files retained. SourcechatJSON and filebyte hashes verified without failures. Private archive `data/private-migrations/openwebui-20261025` contains SQLite snapshot, raw chats, files, manifests and verification. Protect directory700/files600; do not print contents. Open WebUI remains untouched.

Realtime actual OpenAI audio needs the user's OpenAI connection in provider settings. Public namespace/auth and explicit missing-provider result were verified; controlled audio tests passed. No key was supplied, and none should be pasted in chat.

## Fold8 changes in progress

Android1.9.2 vc54: workspace column width from actual constraints; saveable API chat draft and model selections with restoration-aware chat reload; code editor and result adapt to short windows; scrollable realtime transcripts with accessible actions. Real-device1.9.1 inspection found own WebView bootstrap blocked; corrected by loading the local synthetic HTTPS asset through the same restrictive interceptor. No credentials or native bridge enter the code WebView.

GLM default is shared catalog ordering used by backend, WebUI and Plum Desk; Android receives the same sorted catalog. Exact configured model was verified via authenticated production catalog. No invented model or key changes.

## Verification and delivery

GLM default unit regressions, shared/backend/frontend builds and backend typecheck pass. Real Fold8 baseline opened/closed transitions and keyboard were inspected; device-state override reset to physical state3 after test. A synthetic `Fold8 Gerätetest` imported chat is used for code-screen tests; ID0e6bfc73-7991-42a8-a925-633aad238fd3, archive after tests. A separate temporary GLM probe is tracked in `.logs/glm-live-test.log`.

GLM default rollout is live: authenticated public catalog starts with `z-ai / glm-5.3-flash`; desktop1440 and mobile390 rendered defaults passed, including manual selection and no API model requests. Native Fold8 1.9.1 also shows `glm-5.3-flash` on New Chat after restart. A real GLM turn completed with `OK`. Android attempt1 built and installed1.9.2; all91 unit tests passed. Actual Fold8 checks passed: GLM default, Python42, editor with Samsung split keyboard, cover/open transition preserving chat/draft, true process kill/restart preserving same chat/draft. Device state restored to physicalOPENED3. HTML iframe preview was blank: do not publish attempt1 APK (SHAf2c93f2728c0b68e7748b53ead1e68aad9e3ddb71f0349cf591dc35baec9039e). Logs: `.logs/glm-default-*`, `.logs/fold8-*`. Long Android build is owned by subagentfold8_final_build, MCP project796aa064-f0bb-4031-bbf2-2da83a4bca94; do not start concurrent builds. First1.9.2 build completed17:56UTC before bootstrap fix. Final source copied and verified704 files with digest045324836dec43c5839460e347d754cd5b5f9aa4c17900f03c74af57312d7c21, then final build started18:01UTC. Monitor `.logs/fold8-final-compiler.log`; final artifact must be newer than `.logs/fold8-final-source.json` copiedAt. New packaged indexSHA3d1692e6da2b4ee57544529a0f29f2a97c95b5c92fe9748fef02443e9284397d.

Public rollout via official external repair-bot is complete and idle as of18:01UTC. Source backup `/srv/plum/deploy/backups/glm-flash-default-20261025`; release Dockerfile adds shared compiled module at actual runtime pnpm path and Plum Desk. Check public authenticated catalog and browser new-chat choice after restart. SSH knownhosts `.logs/plum-geekom-known-hosts`.

Preserve unrelated local AGENTS.md and backendutils/piConfig.ts edits. Do not commit private archives, test screenshots of real chats, or logs/tokens. All device actions use MCP; launch tool mishandles fully qualified activities, so use MCPadb_shell `am start -n com.claudewebui.app.debug/com.claudewebui.app.MainActivity`.

## Final HTML correction pending verification

Native HTML now renders directly in its isolated no-bridge/no-auth WebView, using the same strict HTML CSP as the browser iframe as a response header; Python keeps the worker bootstrap. HTML runtime asset requests are blocked too. Final attempt2 source copied18:12:54UTC, digest6cc471795ff49039980a422035b4772c5cc96662fca8298ee594d3467b2bedf0; build started18:12:55. Source verification `.logs/fold8-final-source.json`, event `.logs/fold8-final-build-done.json`, compiler `.logs/fold8-final-compiler.log`. Reuse `.logs/verify-fold8-apk.py` only after new artifactmtime>copiedAt. Agentfold8_device_finish owns next phoneQA. No more full fold/process testing needed unless new failure.

Public Android channel still1.9.1. Pending file on Geekomdata/android/plum-1.9.2.pending.apk is the OLD attempt1 APK: overwrite with final verified APK before publishing. Publication helper `.logs/fold8-publish-release.py` verifies expectedSHA, backs up existing release, atomically replacesAPK thenmetadata. Public verifier `.logs/fold8-public-release-check.mjs` authenticates in memory, downloads through/mobile, hashesAPK and checksGLM default. Root must wait for final HTML/device pass before publication and cleanup of two exact synthetic chat IDs (fixture above; GLM temporaryprobe3b0d6847-47e6-4c75-832f-44033621cd6c).
