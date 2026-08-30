# CLAUDE.md

This file guides coding agents working in this repository.

## Repository

Plum Code WebUI is a pnpm monorepo for Codex, OpenCode, Pi, Kimi Code, and legacy Claude Code harnesses, deployed as one Docker container on Unraid. **Codex is the default provider.**

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

| Package | Purpose |
| --- | --- |
| `packages/backend` | Express, Socket.IO, Postgres via `pg`, provider CLI management |
| `packages/frontend` | React 18, Vite, Radix UI, Tailwind, Zustand, Socket.IO client |
| `packages/shared` | Shared TypeScript types, pricing, provider-label logic |
| `packages/desktop` | Desktop shell wrapper |
| `packages/android` | Android client |

### Backend

Entry: `packages/backend/src/index.ts`. Routes are in `src/routes/`; services are in `src/services/`. `src/services/claude/ClaudeProcessManager.ts` manages provider lifecycles and streams Socket.IO events.

- **Codex:** one `codex exec --json` per turn. `translateCodexMessage` streams `item.delta`, `agent_message.delta`, `text.delta`, and `response.output_text.delta`, with `item.completed` fallback. `buildCodexContextPrefix()` prepends up to 40 stored turns, limited to 24k characters, as `[Prior conversation context]`; Codex has no native `--resume`.
- **OpenCode:** per-user HTTP/SSE server with native streaming and resume. Config, data, OAuth, and account state live under `~/.opencode/users/<sha256-user-key>`; never assign legacy global OAuth state to users. It routes models including `z-ai/glm-*` and Kimi.
- **Pi:** persistent JSONL RPC using OpenCode connections/models, shared skills, converted agents, and the MCP bridge. `pi-antigravity` supplies Google Antigravity because Pi dropped built-in support in `0.71.0`; `resolvePiExtensionPaths()` provisions it and `PI_ANTIGRAVITY_MODELS` mirrors its catalog. It needs one `/login antigravity` per user and may violate Google's ToS according to the package README.
- **Kimi Code:** persistent `kimi acp` stdio with native resume, cancellation, streaming, and queued follow-ups. **Do not regress to `kimi -p`.**
- **Claude Code:** legacy persistent stream-json transport.

Input may queue while a provider is active; interrupts cancel the current turn. Key events: `session:output`, `session:message`, `session:thinking`, `session:tool_use`, `session:agent`, and `session:status`.

**Auth:** Express sessions, JWT, Passport GitHub/Google OAuth, and a Basic Auth guard backed by `app_config`. Harness login routes are `/auth/codex`, `/auth/opencode`, `/auth/pi`, and `/auth/claude`; `/auth/providers` uses `isProviderAvailable()`.

**Admin/helper LLM:** `packages/backend/src/utils/adminLLM.ts` provides one-shot completions, preferring Codex → OpenCode → Claude unless `ADMIN_LLM_PROVIDER` overrides it. `routes/git.ts` uses it at `/generate-commit-message`. Codex helper calls must retain `--ephemeral`.

**Z.AI API:** Settings → General → Z.AI stores a per-user Anthropic-compatible endpoint, encrypted token, and optional Opus/Sonnet/Haiku mappings through `GET/PUT/DELETE /api/settings/zai-api`. Only Z.AI sessions receive the related `ANTHROPIC_*` variables. Default endpoint: `https://api.z.ai/api/anthropic`.

**Usage/analytics:** `ClaudeProcessManager.saveUsageToDatabase` is the sole analytics write path. It writes `usage_history` idempotently by session, explicit provider, and stable turn ID; keep Pi and OpenCode distinct. Codex usage comes from `turn.completed.usage` fields `input_tokens`, `cached_input_tokens`, `output_tokens`, and `reasoning_output_tokens`. Pricing is in `packages/shared/src/types/llm-pricing.ts`; migrations reprice `usage_history.cost_usd` when `LLM_PRICING_RATE_CARD_VERSION` changes. Unknown models remain unpriced. Always use `getProviderLabelForUsage(provider, model)` from `packages/shared/src/types/cli-providers.ts`.

`/api/usage/limits?provider=codex` calls ChatGPT’s `backend-api/codex/usage` endpoint and requires `Authorization: Bearer <tokens.access_token>` plus `chatgpt-account-id`; see `routes/usage.ts`.

**Security:** `src/index.ts` uses strict Helmet CSP without `unsafe-inline` scripts. `TRUST_PROXY` configures `trust proxy`; `src/middleware/rateLimiter.ts` keys limits by `userId` or `req.ip`, never raw `X-Forwarded-For`. CORS uses `FRONTEND_URL` and `CORS_ALLOWED_ORIGINS`.

### Frontend

Entry: `packages/frontend/src/main.tsx`. Main chat: `src/pages/SessionPage.tsx`. `src/components/chat/ToolExecutionCard.tsx` renders tools and maps `Task`/`Agent` subagents through `agentTypeMap`.

`src/stores/useSessionStore.ts` holds per-session `toolExecutions`, `activity`, and `activeAgent`; the WebSocket client is `src/services/socket.ts`.

## Deployment

Compose files:

- `docker-compose.yml`: committed portable configuration. `claude-code-webui` maps `${WEBUI_PORT:-4545}:3001`, builds `plum-code-webui:latest`, and uses `${DATA_DIR:-./data}`, `${CONFIG_DIR:-./config}`, and `${WORKSPACE_DIR:-./workspace}`.
- `docker-compose.override.yml`: gitignored site configuration for Traefik labels at `code.zwaetschge-webui.ch` and `preview.code.zwaetschge-webui.ch`, `/mnt/cache/appdata/plum-code-webui/...` paths, Docker socket proxy, Rebuild Robot, and external `brian_traefik-public`.

Use `docker-compose.override.yml.example` for other operators.

```bash
./scripts/install.sh                # interactive: collects env, builds, starts, runs codex login (other providers from UI)
docker compose up -d --build        # if you already have .env + an override
```

**Never mount raw `docker.sock` into the main WebUI.** It receives filtered Docker API access through `docker-socket-proxy`; provider CLIs inherit the filtered `DOCKER_HOST`. Keep `CLI_RUNNER_ACCESS=admin-only` unless users are deliberately trusted. `EXEC` and `VOLUMES` remain disabled; Compose proxy access may require `BUILD`, `IMAGES`, `CONTAINERS`, `NETWORKS`, and `POST`.

### Rebuild / redeploy

**Never run `docker compose down`, `docker compose up -d --force-recreate`, or any container-recreate command inside the WebUI container.** It kills the calling session and can leave the replacement in `Created` state.

Use the Rebuild Robot:

```bash
bash scripts/plum-rebuild.sh
```

The script writes `data/rebuild-trigger.json`, polls `data/rebuild-robot-status.json`, and checks `http://localhost:${WEBUI_PORT:-4545}/`. Flags: `--no-cache`, `--no-wait`, and `--timeout=N` (default 600 seconds).

`scripts/rebuild-robot-sidecar.sh`, defined in `docker-compose.override.yml`, protects the old image, rebuilds and restarts externally, requires `/health/ready`, Docker health, and the candidate image ID, rolls back failures, and writes `REBUILD_ROBOT_REPORT.md` plus `data/rebuild-robot-status.json`. This is the only self-rebuild path. If `repair-bot` is not running, use `docker compose up -d repair-bot`.

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

Credentials are in Postgres `app_config`: `basic_auth_username`, `basic_auth_password` (bcrypt), and `basic_auth_enabled`.

```bash
docker exec -i plum-postgres psql -U plumcode -d plumcode <<'SQL'
update app_config set value='NEW_USERNAME' where key='basic_auth_username';
update app_config set value='BCRYPT_HASH'  where key='basic_auth_password';
update app_config set value='true'         where key='basic_auth_enabled';
SQL
```

Set `basic_auth_enabled` to `false` to disable it.

## Shared Agents / Skills / Plugins

- Active skills: `~/.claude/skills/<name>/SKILL.md`; on-demand workflows: `~/.claude/skill-catalog/<name>/SKILL.md`; presentation presets: `~/.claude/style-library/{design,writing}`.
- Agents: `~/.claude/agents/<name>.md`; aliases and retired names: `~/.claude/skill-aliases.json`.
- The catalog is available through Settings → Extensions → Skills, `GET /api/claude-config/skills?library=all`, and `node /app/scripts/capability-catalog.mjs search "<task>"`.
- External packs sync from `/mnt/user/AI/Skills`, `/mnt/unraid/AI/Skills`, then comma-separated `WEBUI_SKILLS_DIRS`. `.skill.zip` imports respect catalog state, aliases, and tombstones.
- Managed blocks in `AGENTS.md` and `CLAUDE.md` update per session; preserve custom text outside them.

The 37 design and 32 writing profiles are session presentation layers, not executable skills; legacy names remain searchable aliases.

## Environment Variables

Schema: `packages/backend/src/config.ts`; Zod validation fails fast at startup.

Required:

- `SESSION_SECRET` — minimum 32 characters
- `JWT_SECRET` — minimum 32 characters

Common:

- `PORT` (default `3001`), `HOST` (default `0.0.0.0`), `NODE_ENV`
- `FRONTEND_URL` (default `http://localhost:5173`), `CORS_ALLOWED_ORIGINS`
- `AUTH_ALLOWED_EMAILS` — OAuth and Basic Auth allowlist. Empty is unrestricted and safe only behind private networking or SSO. `src/auth/passport.ts` redirects `EmailNotAllowedError` to `/connect?error=email_not_allowed`; `src/routes/basic-auth.ts` returns `403 EMAIL_NOT_ALLOWED`.
- `TRUST_PROXY` (default `1`) — hop count, boolean, or CIDR list. `true` without a guarding proxy defeats IP rate limiting.
- `ALLOWED_BASE_PATHS` (default `/home,/Users`) — comma-separated workspace allowlist
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `CLAUDE_OAUTH_ENABLED` (default `true`; `false` disables legacy Claude)
- `ADMIN_LLM_PROVIDER`, `ENCRYPTION_KEY`, `WEBUI_HOOK_SECRET`, `PREVIEW_HOSTNAME`
- `CLI_PROVIDER_CODEX_MODELS`, `CLI_PROVIDER_OPENCODE_MODELS`, `CLI_PROVIDER_PI_MODELS`, `CLI_PROVIDER_CLAUDE_MODELS`
- `CLI_PROVIDER_<PROVIDER>_DEFAULT_MODEL`
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
  - `krea2-t2i` (**default T2I**): Krea2 Turbo FP8, qwen3vl_4b CLIP, 8 steps, `euler`/`simple`; prompt refinement and LoRA trigger slots are disabled, so prompts are verbatim.
  - `f2k-edit` (**default edit**): Flux.2 Klein 9B, Turbo LoRA, dual `ReferenceLatent`; requires uploaded `input_image`. Re-renders the whole frame.
  - `f2k-inpaint` (**masked edit**): same model stack plus `InpaintCropImproved`/`InpaintStitchImproved`; requires `input_image` **and** `mask` (white = repaint). Only the mask plus its feather changes, and the source resolution is preserved, so `megapixel`/`aspect_ratio` are ignored.
  - `z-image-turbo`: Z-Image Turbo, qwen3_4b CLIP, about 5 seconds, 9 steps, `dpmpp_2m_sde`.
  - `flux2-klein-t2i`: Flux.2 Klein 9B, Turbo LoRA, TeaCache, 8 steps, `euler`, `SamplerCustomAdvanced`.
  - `flux2-klein-edit`: older TeaCache/tiled-VAE edit variant retained for existing callers.

`krea2-t2i` `ResolutionSelector` labels aspect ratios differently from Flux (`1:1 (Square)` versus `1:1 (Perfect Square)`). `workflows.ts` translates input values: an unknown combo value is **not** rejected by ComfyUI, and can report success without an image.

- URL resolution: `app_config.comfyui_url` → `$COMFYUI_URL` → `http://192.168.1.23:8188`; settings are re-read for every job.
- `scripts/mcp-servers/comfyui.mjs` exposes `generate_image`, `generate_image_quality`, `edit_image`, and `inpaint_image`, calling `POST /api/comfyui/internal/generate` with inherited `WEBUI_HOOK_SECRET`.
- `/generated/*.png` requires Passport session authentication.

MCP tools bind at CLI spawn; start a new session after registration changes. URL changes apply to new jobs immediately.

## Android App Creator Integration (MCP)

The **android-builder** MCP builds, installs, launches, and tests Android applications through `android-app-creator`.

- Script: `scripts/mcp-servers/android-builder.mjs`; registration: `mcpServers.android-builder` in `config/claude/settings.json`.
- Backend: `http://host.docker.internal:4000`; Compose uses `extra_hosts: ["host.docker.internal:host-gateway"]`. Override with `ANDROID_BUILDER_URL`.
- Registry: `/app/data/known-devices.json`. Pair with `adb_pair_wifi` and `adb_connect_wifi`; `autoReconnect=true` survives restarts. Management tools: `adb_known_devices`, `adb_forget_device`, `adb_set_friendly_name`, `adb_set_auto_reconnect`, and `adb_reconnect_all`.
- `adb_shell` denies `rm -rf /`, `dd if=`, `mkfs`, fork bombs, and `su root`. `adb_screenshot` requires an absolute `.png` path inside the builder container.
- Skill: `~/.claude/skills/android-build/SKILL.md`.
- Separate container: `/mnt/user/AI/plum-code/android-app-creator/`.

**Always use this MCP; never call `adb` or `gradle` from Bash.** Start a new session after MCP registration changes.

## Godot + Blender MCP

Zero-dependency bridges are registered in `~/.claude/settings.json` and mirrored to other providers for new sessions:

- **godot** (`scripts/mcp-servers/godot.mjs`): `godot_info`, `godot_create_project`, `godot_list_project`, `godot_validate_project`, `godot_run_gdscript`, `godot_export_project`, `godot_import_assets`, `godot_add_android_preset`, `godot_export_android`.
- **blender** (`scripts/mcp-servers/blender.mjs`): `blender_info`, `blender_run_python`, `blender_create_asset`, `blender_inspect_file`, `blender_render_preview`. The image installs `blender-headless` and defaults `BLENDER_BIN=blender-headless`; supported outputs include `.blend`, `.glb`, `.gltf`, `.obj`, `.stl`, and `.fbx`.

### The Godot engine container

The WebUI image is Alpine/musl and the official Godot build is glibc-linked, so the engine cannot run in this container — `gcompat` is not enough. `docker/godot/Dockerfile` builds `plum-godot:latest` (Godot 4.7.2 on `eclipse-temurin:17-jdk-noble`) with export templates, the Android SDK, build-tools, `apksigner`, a debug keystore, and pre-patched editor settings for the SDK/JDK paths:

```bash
docker build -t plum-godot:latest docker/godot     # no --progress flag: legacy builder, no buildx
```

`godot.mjs` runs every engine command as a one-shot `docker run` through `docker-socket-proxy` (`docker exec` is blocked there by design). Because the sibling container's volumes are resolved by the **host** daemon, the bridge reads its own mount table with `docker inspect $(hostname)` and re-mounts each host source at the destination path we know it by, so paths are identical on both sides.

- **Project paths must live under a shared bind mount** (`/mnt/user`, `/mnt/cache`, `/workspace`). `/tmp` is invisible to the engine, so `godot_run_gdscript` puts its scratch script inside the project when running in docker mode.
- `GODOT_BIN` is intentionally empty; a local binary would be preferred if one existed. `GODOT_DOCKER_IMAGE` and `GODOT_DOCKER_DISABLED` override the fallback.
- `godot_add_android_preset` writes `export_presets.cfg` (GUI-authored but CLI-read) **and** sets `rendering/textures/vram_compression/import_etc2_astc=true`, which the exporter hard-requires and which has no CLI flag.
- `godot_export_android` returns the APK path. The engine container has no adb, so install through android-builder. That container mounts different host paths, so **stage the APK somewhere both see** (for example `/mnt/user/Zwischenspeicher/`). The Godot 4 launcher activity is `com.godot.game.GodotAppLauncher`.

### Blender to Godot

`py3-numpy` is installed in the WebUI image because Blender's `io_scene_gltf2` addon imports numpy at registration; without it `bpy.ops.export_scene.gltf` does not exist and the handoff silently has no exporter. Note that `hasattr(bpy.ops.export_scene, "gltf")` cannot detect this — `bpy.ops` namespaces resolve lazily. Probe with `"gltf" in dir(bpy.ops.export_scene)`.

Export `.glb` from Blender into the Godot project (`.blend` import would need Blender reachable from the engine container, and it is not), then `godot_import_assets`. Blender is Z-up and Godot Y-up; the glTF exporter converts, so do not add a compensating rotation.

Godot projects should use the `game-engines` skill and android-builder for phone verification.

## Control Gateway

An external supervisor—Hermes, an OpenCode or Codex CLI, or a script—uses the same API as the user.

- Issue a token in Settings → General → Control gateway. The `plum_gw_…` secret is shown once.
- Send `Authorization: Bearer plum_gw_…`. `resolveAuthenticatedUserId()` resolves it to the owner, so every `requireAuth` route works: sessions, messages, approvals, git, analytics, and settings.
- `GET /api/gateway/overview` returns sessions with `busy`, `queueDepth`, `activitySummary`, `pendingApprovals`, and `needsAttention`.
- `GET /api/gateway/events` is an SSE stream: `assistant_message`, `user_message`, `turn_complete`.
- Gateway tokens cannot manage gateway tokens (`403 GATEWAY_FORBIDDEN`); revocation is immediate and the next request returns 401.
- Admin-only routes still require an admin owner; the token inherits, but does not exceed, that role.

`container_watchdogs` is a Docker health probe; session supervision belongs to the gateway.

## Multi-Provider Notes

`CLI_PROVIDERS` insertion order controls the UI. Persistent homes are `~/.codex`, `~/.local/share/opencode`, `~/.pi`, `~/.kimi-code`, and `~/.claude`.

Default-provider selection is encoded in:

- `routes/sessions.ts`: `cliProvider` defaults to `'codex'`
- `db/index.ts`: `sessions.cli_provider` defaults to `'codex'`
- `packages/frontend/src/lib/providers.ts`: neutral `plum` maps to `codex`
- SQL `custom_agents.model` default and `/model` fallback: `gpt-5.5`

## Pitfalls

- Removed functionality must not return: Gemini provider/image service, top-level GLM provider, orchestration manager, task router, worker pool, Ralph loop, watchdog/Telegram alerts, main-container self-rebuild API, handover protocol, or Superpowers integration (obra/Superpowers sync, managed skills, bootstrap injection, `SUPERPOWERS_*` env).
- GLM belongs to OpenCode routing; `repair-bot` is the only rebuild mechanism.
- Source-of-truth order is code → this file → README/AGENTS.
- Provider and MCP configuration binds at process spawn; use a new session after changing it.
