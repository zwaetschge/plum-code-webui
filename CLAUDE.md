# CLAUDE.md

Guidance for coding agents. Rules live in `AGENTS.md`; the full former text of both files is in `docs/history/` (`CLAUDE-full-2026-10-12.md`, `AGENTS-full-2026-10-12.md`) — open a section only when needed.

## Repository

Plum Code WebUI: pnpm monorepo (Express + Socket.IO + Postgres backend, React 18 + Vite frontend, shared types, Android app), deployed as one Docker container on Unraid. Codex is the default provider. Node ≥ 20, pnpm ≥ 9 (`pnpm@9.15.0`).

## Commands

```bash
pnpm install          # workspace deps
pnpm dev              # backend :3006 + frontend :5173
pnpm build            # tsc (backend/shared) + vite (frontend)
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
pnpm format           # prettier --write (format:check in CI)
bash scripts/plum-rebuild.sh   # the ONLY redeploy path (see AGENTS.md)
```

Docker maps `4545:3001`. Backend DB migrations: `pnpm db:migrate` (from `packages/backend`).

## Architecture in short

- **Backend** `packages/backend/src`: `routes/`, `services/`. `services/claude/ClaudeProcessManager.ts` runs provider lifecycles, streaming, interrupts, queued input and is the sole usage write path.
- **Providers:** Codex per-turn respawn; Pi JSONL RPC (model provider registry „Modellanbieter“, `/api/model-providers`); Kimi Code / Mistral Vibe persistent ACP; Claude Code legacy stream-json.
- **Model chat** (`/chat`): `services/assistant/apiChats.ts`, `apiTransport.ts`; `reasoningEffort` per turn (low/medium/high/max/ultra).
- **Frontend** `packages/frontend/src`: `pages/SessionPage.tsx` (chat), `components/assistant/ModelEffortPicker.tsx` (model + animated effort rail), Zustand stores, `services/socket.ts`.
- **Android** `packages/android`: areas Chat/Task/Code/Schwarm are hoisted in `ui/screens/dashboard/DashboardScreen.kt`; effort rail in `ModelEffortSheet.kt`.
- **Auth:** Express sessions + JWT + Passport OAuth + Basic Auth guard (`app_config`); security headers via Helmet CSP, rate limits keyed by `userId`/`req.ip`.

## Deployment

`docker-compose.yml` is portable; `docker-compose.override.yml` (gitignored) holds site config (Traefik, Unraid paths, docker-socket-proxy, `repair-bot`). **Never** `docker compose down|up --force-recreate` inside the WebUI container; **never** mount raw `docker.sock` into it. Unraid persistence maps provider homes (`~/.codex`, `~/.pi`, `~/.kimi-code`, `~/.vibe`, `~/.claude`) under `/mnt/cache/appdata/plum-code-webui/config/`.

Basic Auth recovery: Postgres `app_config` keys `basic_auth_username`, `basic_auth_password` (bcrypt), `basic_auth_enabled` (set `false` to disable).

## Environment

Schema in `packages/backend/src/config.ts` (Zod, fails fast). Required: `SESSION_SECRET`, `JWT_SECRET` (≥ 32 chars). Common: `PORT`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, `AUTH_ALLOWED_EMAILS`, `TRUST_PROXY`, `ALLOWED_BASE_PATHS`, `CLI_RUNNER_ACCESS`, `COMFYUI_URL`, `ANDROID_BUILDER_URL`.

## MCP bridges (details in history)

`android-builder` (on demand via `scripts/mcp-call.mjs`, skill `mcp-on-demand`; never `adb`/`gradle` in Bash), `comfyui-images` (Krea2 text-to-image, Qwen edit/inpaint, Gemini via Antigravity), `firefox` (Plum Browser extension), `godot` / `blender` (Godot engine runs in the `plum-godot` container). They bind at spawn.

## Pitfalls

- Removed features must not return (see AGENTS.md "Removed").
- Provider and MCP config binds at process spawn; use a new session after changes.
- Source of truth order: code → AGENTS.md/CLAUDE.md → history files.
