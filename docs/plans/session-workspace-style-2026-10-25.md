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

## Delivery in progress

Android-builder project `796aa064-f0bb-4031-bbf2-2da83a4bca94`; selected Fold8 `192.168.1.106:40781`. Build started 19:38:24 UTC. Source digest `269433bac2fdb2374990f9dbe710615c614c0df0cf9f70f50bd4fc9f7a81fdad`, copiedAt 1792957102.8696415, bundled Web index SHA-256 `259439fa5d5c72e1fd3b6586452ca00e79c7224511598ea280012104859dccc8`. Evidence `.logs/workspace-style-source.json`. The build monitor and verifier use workspace-style filenames; no second build while test/build tasks remain active. Build/device work is delegated to workspace_visual_device per AGENTS.md; progress `.logs/workspace-style-device-progress.json` and `.logs/workspace-style-device-handoff.md`.

The production Web target was verified through Traefik's file service and readiness at Geekom `192.168.1.124:4545`. Only the two Web page/style sources were staged. Official repair-bot rollout submitted using `.logs/workspace-style-rollout.sh` (`plum-rebuild.sh --no-wait`). Backup `/srv/plum/deploy/backups/workspace-style-20261025`. Check persistent repair-bot status after restart, not the caller's lifetime.

Remaining: full Android build/test completion, artifact freshness/manifest/bundle/SHA verification, copy to `/mnt/user/Zwischenspeicher/plum-1.9.4.apk`, install and inspect assistant/project list/detail/editor on open/cover Fold8, reset any device-state/font overrides, publish exact verified APK via `.logs/workspace-style-publish.py`, verify public hash/version/GLM default via `.logs/workspace-style-public-check.mjs`, and verify the deployed Web styling. No raw adb/Gradle, user-data reset, LLM calls or Claude API. Public Android remains 1.9.3 until final QA passes.

Preserve unrelated AGENTS.md, piConfig.ts and swarm coordinatorGate/audit changes.
