# Android project navigation — 2026-10-25

The user wants functional Open WebUI parity, without importing old data. Projects and assistants belong in the left sidebar in both clients. Project chats belong inside expandable project folders, separate from ordinary history.

## Implementation

- Android history now renders expandable project folders before the normal date groups. Search finds all chats; the selected project's folder opens automatically. Expanded state survives UI recreation, and existing rename/archive/delete actions remain available.
- Folder contents use project-scoped pagination, independently of the globally recent 100 chats. Android AssistantApi sends `projectId`; the backend generic resource query now accepts the existing scoped filter. Native code checks each result's project binding.
- Assistenten and Projekte are full-width navigation entries in the same history component used by the permanent left column and compact left drawer. The extra controls above the chat were removed. Each entry opens its own workspace list, including when switching between the two lists. The compact drawer closes after navigation. Selecting a chat (including the same chat or a fresh empty chat) explicitly leaves the workspace through the shared chat selection path. This fixes the device-observed case where the project list stayed on screen after selecting a conversation.
- WebUI already has matching sidebar navigation and expandable folders. Rendered desktop (1440 px) and mobile (390 px) checks passed: collapsed/expanded folders, no duplicate project chat in ordinary history, search, standalone history, and both workspace routes. Evidence: `.logs/project-folders-web.json`, `.screenshots/project-folders-web-*`.

## Deployment and verification

The additive backend query change is deployed on production Geekom through the official repair-bot. Backend typecheck/build passed. The authenticated public API returns only the expected project chat; a later empty page and an unknown project return no chats. Evidence: `.logs/project-folders-public-api-check.log`.

Android 1.9.3, versionCode 55, is being built through android-builder MCP project `796aa064-f0bb-4031-bbf2-2da83a4bca94`. The corrected sidebar source digest is `f79803753be3f7321ec3fb0053040e817b202dadecb7af3442e7c73e05fc2d17`, staged at 19:07:05 UTC. Source/freshness evidence: `.logs/project-folders-source.json`. The earlier APK with header controls is obsolete. Verify the final artifact using `.logs/verify-project-folders-apk.py`; it verifies manifest, ZIP CRC, bundled Web assets, fresh mtime and the SHA-256 of the copy at `/mnt/user/Zwischenspeicher/plum-1.9.3.apk`.

Pending: verify the final build and unit results, install on the selected Fold8 `192.168.1.106:40781`, inspect real open/cover layouts and navigation, publish the exact verified APK with `.logs/project-folders-publish.py`, verify the public download using `.logs/project-folders-public-check.mjs`, and archive the temporary fixtures. Device-state override must always be reset. No raw adb/Gradle, uninstall/data reset or Claude API calls. GLM 5.3 Flash remains the default.

## Temporary fixtures

Created through the authenticated API with no chat turns/model calls:

- Project `29987910-3357-4ceb-ac83-320bd28a6e7b`: Plum Ordnertest.
- Project chat `1ef98dd3-9031-43f1-af58-5a9988ed1788`: Projektgespräch Test.
- Ordinary chat `6d013867-443c-4bb0-a626-7ccf92e912bb`: Normaler Verlauf Test.

Read exact IDs from `.logs/project-folders-fixtures.log` before cleanup; archive only those fixtures. Preserve the user's Image Gen project and unrelated AGENTS.md, piConfig.ts and coordinatorGate.ts changes.
