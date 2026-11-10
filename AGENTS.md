# AGENTS.md

Plum Code WebUI: pnpm monorepo (`packages/backend|frontend|shared|android|desktop`), one Docker container; production runs on the Geekom server. **Claude Code is the main provider** (Codex stays supported). Full former text (provider notes, usage/pricing, MCP servers, parity details): `docs/history/AGENTS-full-2026-10-12.md` — read a section there only when you need it.

## Rules

- **Language:** visible German uses umlauts (ä ö ü), Swiss spelling `ss`; keep ASCII for identifiers, slugs, env vars, filenames.
- **Parity:** every feature ships in WebUI (`packages/frontend`) **and** Android (`packages/android`) in the same pass; check it is mounted/reachable (`grep -rl "<Component"`).
- **No crutch copy:** cut taglines, helper text and secondary labels. If a screen needs them to make sense, fix the layout.
- **UX, DX, AX:** make the decision that elevates user, developer and agent experience together, without breaking anything.
- **Chat / Task / Code:** model and thinking depth are settable in all three, in both clients. Chat = API model chat (`reasoningEffort` per turn), Task/Code = CLI sessions. Reasoning levels must match `reasoningOptions` (SessionPage) and Android `ReasoningLevel.forProvider`.
- **Short sessions:** every prompt rereads the whole context. One topic per session; hand over via `session-*.md` in memory; run long builds/polling and screenshot checks in subagents or background tasks, not in the main context. Do not poll in loops.
- **Secrets** are write-only in both clients (`*Configured` flags, `clear*` to remove).
- **MCPs bind at spawn:** start a new session after registration changes.
- **Tests and the database:** a session's `PG*` environment is a test role that can create its own `test_*` schemas and cannot read application data. Never look for the application's database password to run tests.

## Providers (one line each)

Codex (`~/.codex`, per-turn `codex exec --json`), Pi (JSONL RPC, Antigravity extension; GLM/DeepSeek/Mistral/Anthropic-API/custom endpoints from the model provider registry), Mistral Vibe (persistent ACP stdio), Claude Code (legacy, stream-json; `ultrathink`/`ultracode` via `claudeEffortLaunch`). Usage is written only by `ClaudeProcessManager.saveUsageToDatabase`; label with `getProviderLabelForUsage`. Details: history file.

## Rebuild / redeploy (MANDATORY)

Never run `docker compose down|build|up --force-recreate` inside the WebUI container (kills the caller). Use:

```bash
bash scripts/plum-rebuild.sh        # flags: --no-cache --no-wait --timeout=N
```

It triggers `repair-bot` (sidecar in `docker-compose.override.yml`), which builds, restarts externally, checks `/health/ready`, and rolls back on failure. It builds this repository's `Dockerfile` from the deploy tree, so a change is live only after its files are in that tree; check what actually runs (`/app/...`) after a rebuild. If `repair-bot` is dead: `docker compose up -d repair-bot`. Main container never mounts raw `docker.sock`; keep `CLI_RUNNER_ACCESS=admin-only`.

**Public routing (verified 2026-10-19):** public Plum currently targets Geekom `192.168.1.124:4545` through Traefik file `plum-geekom-prod.yml`; an older CLI session may still run against Unraid localhost. Verify the actual public target before deploying or pairing. Create production browser tokens through its authenticated public API. Geekom file-router priorities exceed legacy Docker routers to prevent split routing. Handover: `docs/plans/session-new-desktop-2026-10-19.md`.

## Android

- `android-builder` (and godot, blender, meshy, rea; vocarium is live again) are **not** loaded per session: load the `mcp-on-demand` skill (`node /app/scripts/capability-catalog.mjs show mcp-on-demand`) and call them via `node scripts/mcp-call.mjs call <server> <tool> '<json>'`. **Never** `adb`/`gradle` directly. Project `796aa064-f0bb-4031-bbf2-2da83a4bca94`.
- Builds run from a second copy: `cp -a packages/android/app/src/main/. $WORKSPACE/app/src/main/` (no `rsync`, never delete `app/src`). A build takes 8–10 min; a second `android_build` while one runs is dropped. Success = new APK mtime; failure = `android_get_project` → `status: error` (no logs). Typical causes: missing imports (`rememberSaveable`, `InfiniteTransition.animateFloat`), `AnimatedContent`+`togetherWith`.
- Always copy the finished APK to `/mnt/user/Zwischenspeicher/` and verify with SHA-256. Building does not authorize installing on a device.
- Debug deep links render screens without login: `claudewebui://preview`, `preview-chat`, `preview-analytics`, `preview-monitor`.

## Removed — do not reintroduce

Kimi Code as a standalone CLI provider (historical usage and general Kimi models remain), OpenCode CLI provider (2026-10-27; historical usage keeps its label; the per-user model provider registry stays as „Modellanbieter“ under `/api/model-providers`), Gemini provider and image service (old API-key one), top-level GLM provider, orchestration manager / task router / worker pool, Ralph loop, Superpowers integration, watchdog/Telegram alerts, main-container self-rebuild API, `/api/automation|tasks|devices|claude-settings`. `repair-bot` is the only rebuild path.

## Where things are

Backend entry `packages/backend/src/index.ts` (routes, services); frontend `packages/frontend/src/main.tsx`, chat `pages/SessionPage.tsx`; env schema `packages/backend/src/config.ts`; migrations `db/migrations.ts`. Skills `~/.claude/skills`, agents `~/.claude/agents`, catalog `node /app/scripts/capability-catalog.mjs search "<task>"`.

<!-- webui-managed: project-context:start -->
# Project: plum-code-webui

Web UI for Codex, Pi, Mistral Vibe, and Claude Code agent harnesses

## Tech Stack
Docker, Docker Compose

**Monorepo** (pnpm)

## Commands
- `pnpm dev` — dev
- `pnpm run build` — build
- `pnpm test` — test
- `pnpm run lint` — lint
- `pnpm run typecheck` — typecheck
- `pnpm start` — start
- `pnpm run format` — format

## Key Directories
packages/, scripts/
<!-- webui-managed: project-context:end -->
