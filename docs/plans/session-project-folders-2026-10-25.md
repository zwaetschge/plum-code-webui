# Android project navigation — 2026-10-25

The user wants functional Open WebUI parity, without importing old data. Projects and assistants belong in the left sidebar in both clients. Project chats belong inside expandable project folders, separate from ordinary history.

## Implementation

- Android history now renders expandable project folders before the normal date groups. Search finds all chats; the selected project's folder opens automatically. Expanded state survives UI recreation, and existing rename/archive/delete actions remain available.
- Folder contents use project-scoped pagination, independently of the globally recent 100 chats. Android AssistantApi sends `projectId`; the backend generic resource query now accepts the existing scoped filter. Native code checks each result's project binding.
- Assistenten and Projekte are full-width navigation entries in the same history component used by the permanent left column and compact left drawer. The extra controls above the chat were removed. Each entry opens its own workspace list, including when switching between the two lists. The compact drawer closes after navigation. Selecting a chat (including the same chat or a fresh empty chat) explicitly leaves the workspace through the shared chat selection path. This fixes the device-observed case where the project list stayed on screen after selecting a conversation.
- WebUI already has matching sidebar navigation and expandable folders. Rendered desktop (1440 px) and mobile (390 px) checks passed: collapsed/expanded folders, no duplicate project chat in ordinary history, search, standalone history, and both workspace routes. Evidence: `.logs/project-folders-web.json`, `.screenshots/project-folders-web-*`.

## Deployment and verification

The additive backend query change is deployed on production Geekom through the official repair-bot. Backend typecheck/build passed. The authenticated public API returns only the expected project chat; a later empty page and an unknown project return no chats. Evidence: `.logs/project-folders-public-api-check.log`.

Android 1.9.3, versionCode 55, was built through android-builder MCP project `796aa064-f0bb-4031-bbf2-2da83a4bca94`. The corrected sidebar source digest is `f79803753be3f7321ec3fb0053040e817b202dadecb7af3442e7c73e05fc2d17`, staged at 19:07:05 UTC. Source/freshness evidence: `.logs/project-folders-source.json`. The final build started at 19:08:50 UTC after the preceding build had completed all test tasks. Earlier APKs with header controls or the sticky workspace navigation are obsolete. Verify the final artifact using `.logs/verify-project-folders-apk.py`; it verifies manifest, ZIP CRC, bundled Web assets, fresh mtime and the SHA-256 of the copy at `/mnt/user/Zwischenspeicher/plum-1.9.3.apk`.

The final APK passes manifest/CRC/Web bundle/source-freshness verification and has been installed on the selected Fold8 `192.168.1.106:40781`. SHA-256: `5a74623c94d6439c51acdd1f4a89628f58c8a7ef10d8f77becd40bfb5c2c763a` (52,482,346 bytes). Final wide-layout checks passed: selecting the same conversation leaves Projects, selecting New Chat with an already empty selection leaves Projects, and switching Assistants → Projects → nested project chat works. The stale previous-chat error is cleared after the fresh install.

Final build completed at 19:17:26 UTC; all 91 unit tests passed with no failures, errors or skips. Final compact left-drawer navigation also passed, and the selected project folder stayed expanded across the fold change. The device override was reset to physical OPENED state, and the device was left on an empty GLM chat without an error or test draft. Evidence: `.logs/project-folders-device.json`, `.screenshots/sidebar-final-wide.png`, `.screenshots/sidebar-final-cover-drawer.png`, `.screenshots/sidebar-final-clean.png`.

Published the exact verified APK at 19:18 UTC through `.logs/project-folders-publish.py`. The authenticated public download returns version 1.9.3/code 55 and the identical SHA-256/byte count; GLM 5.3 Flash remains the first/default model. Evidence: `.logs/project-folders-publication.json`, `.logs/project-folders-public-check.log`. The previous release is backed up under `/srv/plum/appdata/plum-code-webui/data/android/backup-fold8-20261025-191813`. No raw adb/Gradle, uninstall/data reset or Claude API calls were used.

## Temporary fixtures

Created through the authenticated API with no chat turns/model calls:

- Project `29987910-3357-4ceb-ac83-320bd28a6e7b`: Plum Ordnertest.
- Project chat `1ef98dd3-9031-43f1-af58-5a9988ed1788`: Projektgespräch Test.
- Ordinary chat `6d013867-443c-4bb0-a626-7ccf92e912bb`: Normaler Verlauf Test.

All three exact fixtures were archived at 19:18 UTC after ID/title/revision checks. Evidence: `.logs/project-folders-cleanup.log`. The user's Image Gen project and unrelated AGENTS.md, piConfig.ts and coordinatorGate.ts changes were preserved. Implementation commits: `e3e4963` (project folders/API) and `3ab995a` (left sidebar and chat navigation).
