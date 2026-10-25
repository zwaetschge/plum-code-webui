# Workspace visual consistency — 2026-10-25

The user reported that the assistant/project views did not visually belong to Plum. Real Fold8 screenshots confirmed an opaque charcoal screen over the shared backdrop, duplicate section headings and text tabs, centred full-width outlined name buttons, and ungrouped standard Material fields.

## Changes

- Android ChatWorkspaceScreen now inherits the existing backdrop and uses PlumContentWidth (840 dp maximum), PlumGlassCard, PlumIconButton, palette colours, shared spacing/radius/touch tokens and a single contextual heading. Projects/assistants remain in the left sidebar; the duplicate in-page tabs are removed.
- Resource cards use a tinted icon, left-aligned title, actual content preview and chevron. The header plus action has a localised accessibility label. Editors and details are grouped in glass panels, fields/selectors share Plum surfaces and shape, selected memory options use the accent, and secondary actions use neutral foreground. Existing API, resource bindings and CRUD actions remain intact.
- Web ChatWorkspacePage follows the same hierarchy, width, cards, pill actions and grouped editor. New CSS uses the assistant shell's existing glass/background/theme variables. Redundant intros, navigation tabs and generic helper paragraphs were removed; memory-choice descriptions that explain functional consequences remain.
- Android 1.9.4 / versionCode 56 includes the rebuilt Web bundle. No new dependencies or motion were introduced. Existing component press feedback remains; avoiding additional screen animations preserves the established navigation and reduced-motion behaviour.

## Verification

- Before/after rendered Web screenshots: `.screenshots/workspace-style-web-{before,after}-*`.
- Typecheck, production build and targeted lint pass. Rendered 1440/390 px checks cover assistant/project lists, editor, detail, no horizontal overflow, one heading, navigation and no page errors. Evidence `.logs/workspace-style-web-after.json`.
- Existing complete workspace browser regression passed at 1440 and 390 px: profile/project create/edit, memory options, sources lifecycle, model selection, existing/new chat, filter, Back and legacy routes. Isolated mock API only; no live model calls or user-data changes. Evidence `.logs/workspace-style-regression.log`. Existing heading selectors updated in the Python and Node test variants.
- Real device before screenshots: `.screenshots/workspace-style-before-{assistants,projects,editor}.png`.

## Delivery

Android-builder project `796aa064-f0bb-4031-bbf2-2da83a4bca94`; selected Fold8 `192.168.1.106:40781`. Build started 19:38:24 UTC. Source digest `269433bac2fdb2374990f9dbe710615c614c0df0cf9f70f50bd4fc9f7a81fdad`, copiedAt 1792957102.8696415, bundled Web index SHA-256 `259439fa5d5c72e1fd3b6586452ca00e79c7224511598ea280012104859dccc8`. Evidence `.logs/workspace-style-source.json`. The build monitor and verifier use workspace-style filenames; no second build while test/build tasks remain active. Build/device work is delegated to workspace_visual_device per AGENTS.md; progress `.logs/workspace-style-device-progress.json` and `.logs/workspace-style-device-handoff.md`.

The production Web target was verified through Traefik's file service and readiness at Geekom `192.168.1.124:4545`. Only the two Web page/style sources were staged. Official repair-bot rollout submitted using `.logs/workspace-style-rollout.sh` (`plum-rebuild.sh --no-wait`). Backup `/srv/plum/deploy/backups/workspace-style-20261025`. Check persistent repair-bot status after restart, not the caller's lifetime.

Android 1.9.4 / versionCode 56 is installed on the selected Fold8 and published. Artifact verification passed manifest/version, source freshness, bundled Web assets, ZIP CRC and SHA-256 of the Zwischenspeicher copy. SHA-256 `f7644f229b9fe317c85bdbc0213dbb8047cd079459d305f86a426a368831c0c1`, 51,951,630 bytes. All 91 fresh unit tests passed (37 suites). Evidence `.logs/workspace-style-android.json` and `.logs/workspace-style-device.json`.

Actual Fold8 checks passed for open and cover layouts: assistant/project lists, assistant detail, new editors, selectors, scroll to actions, sidebar navigation and Back. The full-screen opaque panel and duplicate title/tab bar are gone; shared glass cards, backdrop and fields render correctly. No resources were saved and no LLM calls were made. The device-state override was reset and verified OPENED (3); font scale was not changed. During the final cleanup the foreground switched externally to the file picker again, so further device input stopped. Returning to an empty chat and taking a final idle-list screenshot were intentionally left out; the completed layout/form/navigation checks remain valid. Screenshots `.screenshots/workspace-style-after-*`.

Production repair-bot returned to idle/ready, verified at 20:08 UTC. Authenticated rendered checks against the actual Geekom production host passed for assistant list, project list and assistant editor at 1440/390 px (six screens, one heading and no horizontal overflow); `.logs/workspace-style-public-web.json`. The first attempted browser test used the API-only `/mobile` gateway, which does not provide the browser root asset/navigation paths; the corrected render uses production LAN origin. This does not change public routing or authentication. Light-theme mobile editor at 150% base text also passed overflow/action reachability checks; `.logs/workspace-style-light-large.log`.

Published at 20:12 UTC. The signed public APK download through `/mobile` returns version 1.9.4/code 56, HTTP 200 and the exact installed APK SHA/byte count. GLM 5.3 Flash remains the default. Evidence `.logs/workspace-style-publication.json`, `.logs/workspace-style-public-check.log`. The previous APK/metadata are backed up under `/srv/plum/appdata/plum-code-webui/data/android/backup-fold8-20261025-201233`. No raw adb/Gradle, user-data reset or Claude API calls were used. Implementation commit `b5b88d1`.


Preserve unrelated AGENTS.md, piConfig.ts and swarm coordinatorGate/audit changes.
