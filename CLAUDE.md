# CLAUDE.md

This file guides coding agents working in this repository.

## Repository

Plum Code WebUI is a pnpm monorepo for Codex, OpenCode, Pi, Kimi Code, and Claude Code harnesses, deployed as a single Docker container on Unraid. **Codex is the default provider**; Claude remains a legacy option.

## Commands

```bash
pnpm install                # install workspace deps
pnpm dev                    # run backend + frontend in parallel (tsx watch + vite)
pnpm build                  # build all packages (tsc for backend/shared, vite for frontend)
pnpm typecheck              # tsc --noEmit across workspace
pnpm lint                   # eslint
pnpm format                 # prettier --write
pnpm format:check           # prettier --check (CI)

./scripts/install.sh        # interactive installer (prereq check, .env gen, build, up, codex login). Re-runnable; --reset wipes .env, --skip-login skips OAuth bootstrap, --non-interactive uses defaults.
./scripts/start-webui.sh    # dev helper: generates ephemeral SESSION_SECRET/JWT_SECRET, kills stale PIDs, logs to .logs/, writes PIDs to .pids/

# Backend-specific (run from packages/backend)
pnpm db:migrate             # apply pending Postgres migrations; connection from PG* / POSTGRES_PASSWORD
```

Dev ports: backend `3006`, frontend `5173`. Docker maps `4545:3001`; the container listens on `3001`.

Node `>=20`, pnpm `>=9`; the package manager is pinned to `pnpm@9.15.0`.

## Architecture

### Packages

| Package             | Purpose                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| `packages/backend`  | Express, Socket.IO, Postgres via `pg`, and provider CLI process management        |
| `packages/frontend` | React 18, Vite, Radix UI, Tailwind, Zustand, and Socket.IO client                  |
| `packages/shared`   | Shared TypeScript types, pricing, and provider-label logic                         |
| `packages/desktop`  | Desktop shell wrapper                                                              |
| `packages/android`  | Android client                                                                     |

### Backend

Entry: `packages/backend/src/index.ts`. Routes are in `src/routes/`; services are in `src/services/`. Despite its name, `src/services/claude/ClaudeProcessManager.ts` manages provider lifecycles and forwards streaming events over Socket.IO:

- **Codex**: runs `codex exec --json` once per turn. `translateCodexMessage` streams `item.delta`, `agent_message.delta`, `text.delta`, and `response.output_text.delta`, with `item.completed` fallback. `buildCodexContextPrefix()` prepends up to the last 40 stored turns, limited to 24k characters, as `[Prior conversation context]`; Codex has no native `--resume`.
- **OpenCode**: per-user HTTP/SSE server with native streaming and resume. Config, data, OAuth, and account state are isolated under `~/.opencode/users/<sha256-user-key>`. Legacy global OAuth state is not assigned to users; affected users reconnect through the WebUI. It routes 75+ models, including `z-ai/glm-*` and Kimi.
- **Pi**: persistent JSONL RPC using OpenCode connections and models, shared skills, converted agents, and the MCP bridge. Google Antigravity comes from the `pi-antigravity` extension (Pi dropped built-in support in 0.71.0); `resolvePiExtensionPaths()` provisions it and `PI_ANTIGRAVITY_MODELS` mirrors its catalog, because extension models never reach the provider registry. It needs a one-time `/login antigravity` per user and — per the package's own README — using it may violate Google's ToS.
- **Kimi Code**: persistent `kimi acp` stdio with native resume, cancellation, streaming, and queued follow-ups. Do not regress to `kimi -p`.
- **Claude Code**: legacy persistent stream-json transport.

Input may queue while a provider is active; interrupts cancel the current turn.

Key server-to-client Socket.IO events are `session:output`, `session:message`, `session:thinking`, `session:tool_use`, `session:agent`, and `session:status`.

**Auth:** Express sessions, JWT, Passport GitHub/Google OAuth, and a Basic Auth guard backed by the `app_config` table. Harness login routes are `/auth/codex`, `/auth/opencode`, `/auth/pi`, and `/auth/claude`; `/auth/providers` uses `isProviderAvailable()`.

**Admin/helper LLM:** `packages/backend/src/utils/adminLLM.ts` supplies one-shot internal completions, preferring Codex → OpenCode → Claude unless overridden by `ADMIN_LLM_PROVIDER`. `routes/git.ts` uses it at `/generate-commit-message`. Codex helper calls must retain `--ephemeral`.

**Z.AI API:** Settings → General → Z.AI stores a per-user Anthropic-compatible endpoint, encrypted token, and optional Opus/Sonnet/Haiku mappings through `GET/PUT/DELETE /api/settings/zai-api`. Only Z.AI sessions receive the corresponding `ANTHROPIC_*` variables. The default endpoint is `https://api.z.ai/api/anthropic`; compatible gateway URLs remain editable.

**Usage/analytics:** `ClaudeProcessManager.saveUsageToDatabase` is the sole analytics write path. It writes `usage_history` idempotently by session, explicit provider, and stable turn ID, keeping Pi and OpenCode distinct. For Codex, `translateCodexMessage` captures `turn.completed.usage` fields `input_tokens`, `cached_input_tokens`, `output_tokens`, and `reasoning_output_tokens`. Pricing is defined in `packages/shared/src/types/llm-pricing.ts`; migrations reprice `usage_history.cost_usd` when `LLM_PRICING_RATE_CARD_VERSION` changes. Unknown models remain unpriced. Provider grouping must use `getProviderLabelForUsage(provider, model)` from `packages/shared/src/types/cli-providers.ts`.

`/api/usage/limits?provider=codex` calls ChatGPT’s `backend-api/codex/usage` endpoint and requires `Authorization: Bearer <tokens.access_token>` plus `chatgpt-account-id`; see `routes/usage.ts`.

**Security:** `src/index.ts` uses strict Helmet CSP without `unsafe-inline` scripts. `TRUST_PROXY` configures `trust proxy`; `src/middleware/rateLimiter.ts` keys limits by `userId` or `req.ip`, never raw `X-Forwarded-For`. CORS uses `FRONTEND_URL` and `CORS_ALLOWED_ORIGINS`.

### Frontend

Entry: `packages/frontend/src/main.tsx`. The main chat view is `src/pages/SessionPage.tsx`; `src/components/chat/ToolExecutionCard.tsx` renders tools and maps `Task`/`Agent` subagents through `agentTypeMap`.

`src/stores/useSessionStore.ts` holds per-session `toolExecutions`, `activity`, and `activeAgent`. The WebSocket client is `src/services/socket.ts`.

## Deployment

Compose is split between:

- `docker-compose.yml`: portable, committed configuration. The `claude-code-webui` service maps `${WEBUI_PORT:-4545}:3001`, builds `plum-code-webui:latest`, and uses `${DATA_DIR:-./data}`, `${CONFIG_DIR:-./config}`, and `${WORKSPACE_DIR:-./workspace}`.
- `docker-compose.override.yml`: site-specific and gitignored. It contains Traefik labels for `code.zwaetschge-webui.ch` and `preview.code.zwaetschge-webui.ch`, absolute `/mnt/cache/appdata/plum-code-webui/...` paths, Docker socket proxy, Rebuild Robot, and the external `brian_traefik-public` network.

Other operators can use `docker-compose.override.yml.example`.

```bash
./scripts/install.sh                # interactive: collects env, builds, starts, runs codex login (other providers from UI)
docker compose up -d --build        # if you already have .env + an override
```

**Never mount raw `docker.sock` into the main WebUI.** It receives only filtered Docker API access through `docker-socket-proxy`; provider CLIs inherit the filtered `DOCKER_HOST`. Keep `CLI_RUNNER_ACCESS` at `admin-only` unless deployment users are deliberately trusted. `EXEC` and `VOLUMES` remain disabled; Compose proxy access may require `BUILD`, `IMAGES`, `CONTAINERS`, `NETWORKS`, and `POST`.

### Rebuild / redeploy

**Never run `docker compose down`, `docker compose up -d --force-recreate`, or another container-recreate command inside the WebUI container.** Doing so kills the calling session and can leave the replacement container in `Created` state.

Use the Rebuild Robot sidecar:

```bash
bash scripts/plum-rebuild.sh
```

The script writes `data/rebuild-trigger.json`, polls `data/rebuild-robot-status.json`, and checks `http://localhost:${WEBUI_PORT:-4545}/`. Flags are `--no-cache`, `--no-wait`, and `--timeout=N` (default 600 seconds).

`scripts/rebuild-robot-sidecar.sh`, defined by `docker-compose.override.yml`, protects the old image, rebuilds and restarts the main service externally, requires `/health/ready`, Docker health, and the candidate image ID, and rolls back failures. It writes `REBUILD_ROBOT_REPORT.md` and `data/rebuild-robot-status.json`. This is the only self-rebuild path.

If `repair-bot` is not running, the manual fallback is `docker compose up -d repair-bot`.

### Unraid persistence

The override pins:

- `/mnt/cache/appdata/plum-code-webui/data` → `/app/packages/backend/data`
- `/mnt/cache/appdata/plum-code-webui/config/codex` → `/home/node/.codex`
- `/mnt/cache/appdata/plum-code-webui/config/opencode` → `/home/node/.opencode`
- `/mnt/cache/appdata/plum-code-webui/config/pi` → `/home/node/.pi`
- `/mnt/cache/appdata/plum-code-webui/config/kimi-code` → `/home/node/.kimi-code`
- `/mnt/cache/appdata/plum-code-webui/config/claude` → `/home/node/.claude`
- `/mnt/cache/appdata/plum-code-webui/config/npm-global` → `/home/node/.npm-global`
- `/mnt/cache/appdata/plum-code-webui/config/gh` → `/home/node/.config/gh` (GitHub CLI token; see AGENTS.md)
- `/mnt/cache/appdata/plum-code-webui/config/ssh` → `/home/node/.ssh` (ro)
- `/mnt/cache` → `/mnt/cache`

Portable defaults `./data`, `./config`, and `./workspace` live beside the project.

### Basic Auth recovery

Credentials are in Postgres, table `app_config`, under `basic_auth_username`, `basic_auth_password` (bcrypt), and `basic_auth_enabled`.

```bash
docker exec -i plum-postgres psql -U plumcode -d plumcode <<'SQL'
update app_config set value='NEW_USERNAME' where key='basic_auth_username';
update app_config set value='BCRYPT_HASH'  where key='basic_auth_password';
update app_config set value='true'         where key='basic_auth_enabled';
SQL
```

Set `basic_auth_enabled` to `false` to disable it.

## Shared Agents / Skills / Plugins

- Active skills: `~/.claude/skills/<name>/SKILL.md`; on-demand workflows: `~/.claude/skill-catalog/<name>/SKILL.md`; optional presets: `~/.claude/style-library/{design,writing}`.
- Agents: `~/.claude/agents/<name>.md`.
- Settings → Extensions → Skills, `GET /api/claude-config/skills?library=all`, and `node /app/scripts/capability-catalog.mjs search "<task>"` expose the catalog.
- Aliases and retired names are stored in `~/.claude/skill-aliases.json`.
- External packs sync in order from `/mnt/user/AI/Skills`, `/mnt/unraid/AI/Skills`, then comma-separated `WEBUI_SKILLS_DIRS`. `.skill.zip` imports respect catalog state, aliases, and tombstones.
- Managed blocks in `AGENTS.md` and `CLAUDE.md` update per session; preserve custom text outside them.

The 37 design and 32 writing profiles are session presentation layers, not executable skills. Legacy names remain searchable aliases.

## Environment Variables

Schema: `packages/backend/src/config.ts`; Zod validation fails fast at startup.

Required:

- `SESSION_SECRET` — minimum 32 characters
- `JWT_SECRET` — minimum 32 characters

Common:

- `PORT` (default `3001`), `HOST` (default `0.0.0.0`), `NODE_ENV`
- `FRONTEND_URL` (default `http://localhost:5173`)
- `CORS_ALLOWED_ORIGINS` — comma-separated additional origins
- `AUTH_ALLOWED_EMAILS` — OAuth and Basic Auth allowlist. Empty is unrestricted and safe only behind private networking or SSO. `src/auth/passport.ts` redirects `EmailNotAllowedError` to `/connect?error=email_not_allowed`; `src/routes/basic-auth.ts` returns `403 EMAIL_NOT_ALLOWED`.
- `TRUST_PROXY` (default `1`) — hop count, boolean, or CIDR list. `true` without a guarding proxy defeats IP rate limiting.
- `ALLOWED_BASE_PATHS` (default `/home,/Users`) — comma-separated workspace allowlist
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `CLAUDE_OAUTH_ENABLED` (default `true`; `false` disables legacy Claude)
- `ADMIN_LLM_PROVIDER` — helper override; default order `codex` → `opencode` → `claude`
- `ENCRYPTION_KEY` — encrypts stored credentials
- `WEBUI_HOOK_SECRET` — authenticates permission hooks; generated per process if unset
- `PREVIEW_HOSTNAME` — preview hostname for in-container development servers
- `CLI_PROVIDER_CODEX_MODELS`, `CLI_PROVIDER_OPENCODE_MODELS`, `CLI_PROVIDER_PI_MODELS`, `CLI_PROVIDER_CLAUDE_MODELS`
- `CLI_PROVIDER_<PROVIDER>_DEFAULT_MODEL` — provider default-model overrides
- `CLI_PROVIDER_OPENCODE_DEFAULT_AGENT`, `CLI_PROVIDER_OPENCODE_STYLE_PROMPT`
- `CLI_RUNNER_ACCESS`, `CLI_RUNNER_ALLOWED_EMAILS`
- `WEBUI_CONFIG_HOME`, legacy `CLAUDE_CONFIG_HOME`
- `WEBUI_SKILLS_DIRS`, legacy `CLAUDE_SKILLS_DIRS`
- `CODEX_USAGE_TIMEOUT_MS`, `CODEX_USAGE_CACHE_TTL_MS`, `CODEX_USER_AGENT`
- `OPENCODE_NO_PROGRESS_TIMEOUT_MS`, `OPENCODE_ZAI_VISION_MCP`, `OPENCODE_DEBUG_EVENTS`
- `COMFYUI_URL`, `ANDROID_BUILDER_URL`, `GODOT_BIN`, `BLENDER_BIN`

## ComfyUI Image Generation (built-in)

The WebUI connects directly to ComfyUI; there is no LoRA Tester sidecar.

- Backend: `packages/backend/src/services/comfyui/`; routes: `packages/backend/src/routes/comfyui.ts`.
- REST: `GET /api/comfyui/workflows`, `GET/PUT /api/comfyui/settings`, `GET /api/comfyui/test`, `POST /api/comfyui/upload-image`, `POST /api/comfyui/generate`, `GET /api/comfyui/generation/:id`, and `POST /api/comfyui/internal/generate`.
- Workflows:
  - `krea2-t2i` (**default T2I**): Krea2 Turbo FP8, qwen3vl_4b CLIP, 8 steps, `euler`/`simple`. Prompt refinement and LoRA trigger slots ship disabled, so the prompt is used verbatim.
  - `f2k-edit` (**default edit**): Flux.2 Klein 9B, Turbo LoRA, dual `ReferenceLatent`; requires uploaded `input_image`
  - `z-image-turbo`: Z-Image Turbo, qwen3_4b CLIP, about 5 seconds, 9 steps, `dpmpp_2m_sde`
  - `flux2-klein-t2i`: Flux.2 Klein 9B, Turbo LoRA, TeaCache, 8 steps, `euler`, `SamplerCustomAdvanced`
  - `flux2-klein-edit`: older edit variant with TeaCache and tiled VAE decode; kept for existing callers

`krea2-t2i` uses `ResolutionSelector`, which labels aspect ratios differently from the Flux node (`1:1 (Square)` versus `1:1 (Perfect Square)`). `workflows.ts` translates on the way in — an unknown combo value is **not** rejected by ComfyUI: the prompt is accepted, the image branch never runs, and the job reports success with no image.

- URL resolution: `app_config.comfyui_url` → `$COMFYUI_URL` → `http://192.168.1.23:8188`; settings are re-read for every job.
- `scripts/mcp-servers/comfyui.mjs` exposes `generate_image`, `generate_image_quality`, and `edit_image`, calling `POST /api/comfyui/internal/generate` with inherited `WEBUI_HOOK_SECRET`.
- `/generated/*.png` is served behind Passport session authentication.

MCP tools bind at CLI spawn; start a new session to see newly registered tools. URL changes affect new jobs immediately.

## Android App Creator Integration (MCP)

The **android-builder** MCP lets provider sessions build, install, launch, and test Android applications through `android-app-creator`.

- Script: `scripts/mcp-servers/android-builder.mjs`; registration: `mcpServers.android-builder` in `config/claude/settings.json`.
- Backend: `http://host.docker.internal:4000`; Compose uses `extra_hosts: ["host.docker.internal:host-gateway"]`. Override with `ANDROID_BUILDER_URL`.
- Registry: `/app/data/known-devices.json`. Pair with `adb_pair_wifi` and `adb_connect_wifi`; `autoReconnect=true` survives restarts. Management tools are `adb_known_devices`, `adb_forget_device`, `adb_set_friendly_name`, `adb_set_auto_reconnect`, and `adb_reconnect_all`.
- `adb_shell` denies `rm -rf /`, `dd if=`, `mkfs`, fork bombs, and `su root`. `adb_screenshot` requires an absolute `.png` path inside the builder container.
- Skill: `~/.claude/skills/android-build/SKILL.md`.
- Separate container: `/mnt/user/AI/plum-code/android-app-creator/`.

**Always use this MCP; never call `adb` or `gradle` from Bash.** Start a new session after MCP registration changes.

## Godot + Blender MCP

Zero-dependency bridges are registered in `~/.claude/settings.json` and mirrored to other providers for new sessions:

- **godot** (`scripts/mcp-servers/godot.mjs`): `godot_info`, `godot_create_project`, `godot_list_project`, `godot_validate_project`, `godot_run_gdscript`, `godot_export_project`. Scaffolding and inspection work without an editor; validation, scripts, and exports require `GODOT_BIN` or `godot`/`godot4` on `PATH`.
- **blender** (`scripts/mcp-servers/blender.mjs`): `blender_info`, `blender_run_python`, `blender_create_asset`, `blender_inspect_file`, `blender_render_preview`. The image installs `blender-headless` and defaults `BLENDER_BIN=blender-headless`; supported outputs include `.blend`, `.glb`, `.gltf`, `.obj`, `.stl`, and `.fbx`.

Godot projects should use the `game-engines` skill and android-builder for phone verification.

## Control Gateway

An external supervisor — Hermes, an OpenCode or Codex CLI, a script — drives this instance through the same API the user drives.

- Issue a token in Settings → General → Control gateway. The secret (`plum_gw_…`) is shown once.
- Send it as `Authorization: Bearer plum_gw_…`. `resolveAuthenticatedUserId()` resolves it to the owning user, so **every** `requireAuth` route works — sessions, messages, approvals, git, analytics, settings. There is no second, weaker API to keep in sync.
- `GET /api/gateway/overview` returns one snapshot: all sessions with `busy`, `queueDepth`, `activitySummary`, per-session `pendingApprovals`, plus `needsAttention` (blocked or errored).
- `GET /api/gateway/events` is an SSE stream (`assistant_message`, `user_message`, `turn_complete`) so a CLI does not need Socket.IO.
- A gateway token **cannot** manage gateway tokens (`403 GATEWAY_FORBIDDEN`); minting credentials stays with a real session. Revoking is immediate — the next request gets 401.
- Admin-only routes still require the owner to be an admin; the token inherits the user's role, nothing more.

`container_watchdogs` remains what it always was: a Docker health probe. Session supervision belongs to the gateway.

## Multi-Provider Notes

`CLI_PROVIDERS` insertion order controls the UI. Persistent homes are `~/.codex`, `~/.local/share/opencode`, `~/.pi`, `~/.kimi-code`, and `~/.claude`.

Default-provider selection is encoded in:

- `routes/sessions.ts`: `cliProvider` defaults to `'codex'`
- `db/index.ts`: `sessions.cli_provider` defaults to `'codex'`
- `packages/frontend/src/lib/providers.ts`: neutral `plum` maps to `codex`
- SQL `custom_agents.model` default and `/model` fallback: `gpt-5.5`

## Pitfalls

- Removed functionality must not return: Gemini provider/image service, top-level GLM provider, orchestration manager, task router, worker pool, Ralph loop, watchdog/Telegram alerts, main-container self-rebuild API, handover protocol, or the Superpowers integration (obra/Superpowers sync, managed skills, bootstrap injection, `SUPERPOWERS_*` env).
- GLM belongs to OpenCode routing; `repair-bot` is the only rebuild mechanism.
- Source-of-truth order is code → this file → README/AGENTS.
- Provider and MCP configuration binds at process spawn; use a new session after changing it.
