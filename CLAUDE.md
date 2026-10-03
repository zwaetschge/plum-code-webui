# CLAUDE.md

This file guides coding agents working in this repository.

## Repository

Plum Code WebUI is a pnpm monorepo for Codex, OpenCode, Pi, Kimi Code, Mistral Vibe, and legacy Claude Code harnesses, deployed as one Docker container on Unraid. **Codex is the default provider.**

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

Entry: `packages/backend/src/index.ts`. Routes are in `src/routes/`; services are in `src/services/`. `src/services/claude/ClaudeProcessManager.ts` manages provider lifecycles, streaming, interrupts, queued input, analytics writes, and Socket.IO events.

- **Codex:** one `codex exec --json` per turn. `translateCodexMessage` streams `item.delta`, `agent_message.delta`, `text.delta`, and `response.output_text.delta`, with `item.completed` fallback. `buildCodexContextPrefix()` prepends up to 40 stored turns, limited to 24k characters, as `[Prior conversation context]`; Codex has no native `--resume`.
- **OpenCode:** per-user HTTP/SSE server with native streaming/resume. Config, data, OAuth, and account state live under `~/.opencode/users/<sha256-user-key>`; never assign legacy global OAuth state. It routes models including `z-ai/glm-*` and Kimi.
- **Pi:** persistent JSONL RPC using OpenCode connections/models, shared skills, converted agents, and the MCP bridge. `pi-antigravity` supplies Google Antigravity because Pi dropped built-in support in `0.71.0`; `resolvePiExtensionPaths()` provisions it and `PI_ANTIGRAVITY_MODELS` mirrors its catalog. It needs one `/login antigravity` per user (Settings → Provider logins drives Pi's TUI; Google redirects to `localhost:51121`, so the user pastes that URL and `routes/cli-login.ts` replays it against Pi's callback server in the container; success is read from `auth.json`) and may violate Google's ToS according to the package README. `syncPiConfig()` writes `contextWindow` per model into `models.json` and sets `compaction.reserveTokens` to 40k unless user-set. `refreshOpenCodeModelsCache()` fetches `https://models.dev/api.json` into `~/.cache/opencode/models.json` at startup and before each Pi sync (daily, 20 s timeout). **Ultracode for Pi:** `scripts/pi-ultracode-extension.ts` (loaded by `resolvePiExtensionPaths()`) adds the `workflow` tool: the model writes a JS script (`export const meta`, `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `args`) and every `agent()` runs as its own `pi --mode json -p` child (4 concurrent, 40 per run; `PI_ULTRACODE_CONCURRENCY`, `PI_ULTRACODE_MAX_AGENTS`), with JSON-schema outputs, runs under `<agent dir>/ultracode/runs/<wf_id>/` and `resumeFromRunId`. It is active when the session effort is `ultracode` (spawn sets `PI_ULTRACODE=1`, thinking `xhigh`) or the prompt contains "ultracode"; `applyPiWorkflowAgents()` turns its progress into subagent cards. Pi's `turn_end` fires per LLM round; threshold compaction runs only after `agent_end`; `handlePiCompactionEnd()` nudges automatic compaction, while `compaction_end` without `result` is failed compaction.
- **Kimi Code:** persistent `kimi acp` stdio with native resume, cancellation, streaming, and queued follow-ups. **Do not regress to `kimi -p`.**
- **Mistral Vibe:** persistent `vibe-acp` stdio on the same ACP path as Kimi (`isAcpProvider()`), so streaming, approvals, cancellation, queueing and recovery are shared. Python CLI installed with pipx (`mistral-vibe`); models come from `$VIBE_HOME/config.toml` (`discoverVibe`), thinking levels are off/low/medium/high/max, modes map planning→plan, danger→auto-approve, manual→ask, auto-accept→accept-edits, and session start sends the `_trust/decision` ACP extension so tools run in repos with `AGENTS.md`. `buildVibeEnv()` pins `VIBE_HOME`, disables the desktop keyring, and blanks an inherited `MISTRAL_API_KEY` only when Vibe's own `.env` has one, so a browser sign-in (Vibe Code allowance, €255/month) is never shadowed by the container's API key (€25.50). Vibe reports **running session totals**, so turn usage is the difference to the last turn, read from `$VIBE_HOME/logs/session/session_*_<id8>/meta.json` (cached share included; ACP `PromptResponse.usage` is the fallback), baseline seeded on spawn/resume. `services/vibe/vibeAcp.ts` translates the ACP stream: canonical tool names (`bash`→Bash, `read_file`→Read, `edit`→Edit, `todo`→TodoWrite, `task`→Task subagent …) and Claude-style input keys (input and prose title arrive in the first `tool_call_update`, so the card is re-emitted), readable results/diffs, `plan` → `session:todos`, compaction → `session:compact`, assistant text saved before each tool. Plum's MCP servers (Claude `settings.json`) are passed as ACP `mcpServers` with `WEBUI_SESSION_ID`/hook secret. Manual mode shows real approval cards (`respondAcpPermission`, via `/api/permissions/respond`); `elicitation.form` is declared so Vibe's `ask_user_question`/`exit_plan_mode` work, answered through `/api/opencode/questions/respond` (`respondAcpQuestion`). Images go as ACP image blocks; `/…` commands and skills are forwarded untouched; the composer queues follow-ups. Sign-in lives in `services/vibe/vibeAuth.ts` behind `/api/cli-login/vibe/*`. **Ultracode for Vibe** (effort `ultracode`, thinking `high`): `scripts/mcp-servers/vibe-ultracode.mjs` adds the `ultracode_workflow` tool with Pi's script API; every `agent()` is a `vibe -p --output streaming --auto-approve` child (`VIBE_ACTIVE_MODEL`, `--agent plan` in planning mode, Plum agents as prompt briefs), runs under `$VIBE_HOME/ultracode/runs/`. It is registered through `VIBE_MCP_SERVERS` (`buildVibeUltracodeEnv`), not ACP, because only config entries lift Vibe's 60 s MCP tool timeout; children never inherit it. The server reports agents and their tokens to `POST /api/ultracode/internal/progress` (hook secret) → `applyVibeWorkflowProgress()` → subagent cards and the turn's usage. Its result is text only: Vibe gives the model `structuredContent` instead of text when both exist.
- **Claude Code:** legacy persistent stream-json transport. Efforts `ultrathink` (`--effort max` plus the keyword appended to each prompt, `withUltrathink`) and `ultracode` (`--effort xhigh` plus `{ultracode, enableWorkflows}` in `--settings`, Claude Code's native Workflow tool) apply to Claude and Z.AI alike (`claudeEffortLaunch`).

Key events: `session:output`, `session:message`, `session:thinking`, `session:tool_use`, `session:agent`, and `session:status`. `session:subscribe-all` joins an account-wide room; its `session:lifecycle` beat carries `status`, `busy`, `queueDepth`, `activitySummary`, `pendingApprovals`, and `pendingQuestions`.

**Auth:** Express sessions, JWT, Passport GitHub/Google OAuth, and Basic Auth guard backed by `app_config`. Harness login routes are `/auth/codex`, `/auth/opencode`, `/auth/pi`, `/auth/kimi`, `/auth/vibe`, and `/auth/claude`; `/auth/providers` uses `isProviderAvailable()`. `POST /api/auth/refresh` trades a valid JWT for a fresh one. `GET /api/permissions/pending` returns every approval blocking the caller's sessions.

**Admin/helper LLM:** `packages/backend/src/utils/adminLLM.ts` provides one-shot completions, preferring Codex → OpenCode → Claude unless `ADMIN_LLM_PROVIDER` overrides it. `routes/git.ts` uses it at `/generate-commit-message`. Codex helper calls must retain `--ephemeral`.

**Z.AI API:** Settings → General → Z.AI stores a per-user Anthropic-compatible endpoint, encrypted token, and optional Opus/Sonnet/Haiku mappings through `GET/PUT/DELETE /api/settings/zai-api`. Only Z.AI sessions receive the related `ANTHROPIC_*` variables. Default endpoint: `https://api.z.ai/api/anthropic`.

**Usage/analytics:** `ClaudeProcessManager.saveUsageToDatabase` is the sole analytics write path. It writes `usage_history` idempotently by session, explicit provider, and stable turn ID; keep Pi and OpenCode distinct. Codex usage comes from `turn.completed.usage` fields `input_tokens`, `cached_input_tokens`, `output_tokens`, and `reasoning_output_tokens`. Pricing is in `packages/shared/src/types/llm-pricing.ts`; migrations reprice `usage_history.cost_usd` when `LLM_PRICING_RATE_CARD_VERSION` changes. Unknown models remain unpriced. Always use `getProviderLabelForUsage(provider, model)` from `packages/shared/src/types/cli-providers.ts`.

`GET /api/analytics/summary` (periods `24h`, `7d` calendar week, `30d` calendar month, `90d` rolling, `all`) also returns `comparison` — the previous window cut to the same elapsed time, with totals and `byProvider` — and `bySession[].provider`/`last_active`. The WebUI dashboard lives in `packages/frontend/src/components/analytics/` (KPI deltas, provider filter, opt-in quota overlay); the Android screen mirrors its order and deltas.

`/api/usage/limits?provider=mistral` is a local estimate (`services/mistralPlanUsage.ts`): Mistral has no quota API for Pro plans (the Admin API is Enterprise-only, rate-limit headers are per minute), so it sums `usage_history` rows with `model LIKE 'mistral/%'` in the billing month (priced from tokens) against the budget and billing day from `GET/PUT /api/usage/plan/mistral`. Pi runs Mistral through its native provider with a curated list (`PI_NATIVE_PROVIDERS` in `utils/piConfig.ts`: Medium 3.5, Large, Devstral, Codestral, Magistral, Small, GLM-5.3), not a `models.json` override; the key arrives as `MISTRAL_API_KEY`.

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
- `/mnt/cache/appdata/plum-code-webui/config/vibe` → `/home/node/.vibe` (`VIBE_HOME`)
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
- Catalog access: Settings → Extensions → Skills, `GET /api/claude-config/skills?library=all`, and `node /app/scripts/capability-catalog.mjs search "<task>"`.
- External packs sync from `/mnt/user/AI/Skills`, `/mnt/unraid/AI/Skills`, then comma-separated `WEBUI_SKILLS_DIRS`. `.skill.zip` imports respect catalog state, aliases, and tombstones.
- Managed blocks in `AGENTS.md` and `CLAUDE.md` update per session; preserve custom text outside them.
- The 37 design and 32 writing profiles are session presentation layers, not executable skills; legacy names remain searchable aliases.

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

URL resolution: `app_config.comfyui_url` → `$COMFYUI_URL` → `http://192.168.1.23:8188`; settings are re-read for every job. `scripts/mcp-servers/comfyui.mjs` exposes `generate_image`, `generate_image_quality`, `edit_image`, and `inpaint_image`, calling `POST /api/comfyui/internal/generate` with inherited `WEBUI_HOOK_SECRET`. `/generated/*.png` requires Passport session authentication.

MCP tools bind at CLI spawn; start a new session after registration changes. URL changes apply to new jobs immediately.

**Gemini images (Nano Banana) via Antigravity:** the same MCP server exposes `generate_image_gemini` (prompt, `aspect_ratio`, up to 6 owned `input_images` to edit/combine). It calls `POST /api/comfyui/internal/gemini-image` → `services/comfyui/antigravityImage.ts`, which uses the user's Pi Antigravity OAuth (`piAuthFile()`, refreshed in memory only, never written back), picks the account's model from `fetchAvailableModels().imageGenerationModelIds` (currently `gemini-3.1-flash-image`), and calls `streamGenerateContent` on the daily Cloud Code host first. Output is saved like ComfyUI results (`saveGeneratedImage`, `/generated/<uuid>.jpg` with owner file); inputs pass `readOwnedImage`. 409 when Antigravity is not connected, 429 when the image quota is used up. This is Antigravity's internal IDE API (ToS risk, see pi-antigravity README).

## Android App Creator Integration (MCP)

The **android-builder** MCP builds, installs, launches, and tests Android applications through `android-app-creator`.

- Script: `scripts/mcp-servers/android-builder.mjs`; registration: `mcpServers.android-builder` in `config/claude/settings.json`.
- Backend: `http://host.docker.internal:4000`; Compose uses `extra_hosts: ["host.docker.internal:host-gateway"]`. Override with `ANDROID_BUILDER_URL`.
- Registry: `/app/data/known-devices.json`. Pair with `adb_pair_wifi` and `adb_connect_wifi`; `autoReconnect=true` survives restarts. Management tools: `adb_known_devices`, `adb_forget_device`, `adb_set_friendly_name`, `adb_set_auto_reconnect`, and `adb_reconnect_all`.
- `adb_shell` denies `rm -rf /`, `dd if=`, `mkfs`, fork bombs, and `su root`. `adb_screenshot` requires an absolute `.png` path inside the builder container.
- Skill: `~/.claude/skills/android-build/SKILL.md`.
- Separate container: `/mnt/user/AI/plum-code/android-app-creator/`.

**Always use this MCP; never call `adb` or `gradle` from Bash.** Start a new session after MCP registration changes.

## Browser Control (MCP, Firefox & Chrome)

The **firefox** MCP (`scripts/mcp-servers/firefox.mjs`, a default registration) lets agents drive the user's Firefox or Chrome/Edge through the Plum Browser extension, much like Claude in Chrome. `packages/firefox-extension/` builds the Firefox MV2 `.xpi` and the Chrome MV3 `.zip` from one source tree.

- The extension connects out to `/api/browser-bridge/ws`, or to `/mobile/api/browser-bridge/ws` behind Authelia. It authenticates with a `plum_ff_` pairing token (`browser_tokens`); the token grants no REST access.
- Pairing is under WebUI Settings → Firefox browser and in the Android settings. The `.xpi` is served at `/api/browser-bridge/extension.xpi`; a signed copy in `data/firefox/` wins.
- Each session works in its own Firefox tab group `Plum · <session name>` and can only address tabs in it.
- Several paired browsers: a session keeps its browser, but moves to the one the user focused last once its own has been idle for 10 min (the extension reports user focus as `state {active:true}`; agent actions in session windows do not count). MCP tools `browsers` and `select_browser` (`"chrome"`, `"auto"`) list and pin.
- Panel (`src/panel.html` = Chrome side panel and Firefox sidebar; session windows open it with `?session=`): a chat for one session (`chat.js`) plus a sessions view (`picker.js`: pick, switch provider/model, hand over the current tab, start a new session). The token has no REST access, so the panel sends `rpc` frames over the bridge socket; `services/browserBridge/rpc.ts` allowlists session, provider, chat, permission and question methods and calls the matching routes with a 2-minute owner JWT. Chat goes through `chatRelay.ts`: one loopback Socket.IO client per bridge connection, signed in as the owner, so `session:send`/`session:interrupt` hit the WebUI's own handlers; events of watched sessions come back as `event` frames. The Plum web chat is only opened on request ("In Plum öffnen").
- Tutorial modes (panel mode bar): **Vorführen** records a demonstration in the user's own window (`content.js` capture listeners → `plumRecordStep`; clicks, typed values with passwords/card fields masked, Enter/shortcuts, navigation, tab switches, final scroll) with up to 12 click screenshots circled in red, reviewed in the panel and sent to the session via `chat.send` with `images` (max 12, ≤ 4 MB each, `rpc.ts`). **Anleiten** (guide mode, `entry.guideWindowId`) points the session at the user's active tab: `status` reports `mode: 'guide'`, `GUIDE_BLOCKED` rejects click/type/keys/scroll/navigation/JS, and the agent shows with the MCP tools `point`, `annotate` (circle/box/arrow/underline + label), `draw` (pen stroke) and `clear_annotations`; marks live in document coordinates in the overlay's shadow DOM and stay visible in agent screenshots. Browser pages only; desktop apps are out of reach.
- Parallel sessions: each session has its own window and tab group; calls run concurrently (verified with three same-named sessions). A group already held by another session is never re-adopted by title, demonstrations are recorded per window (`state.recordings`, keyed by window id), guide mode is per session and window, and Chrome cascades new session windows so they do not stack exactly.
- Extension 0.7 additions: **guide_step** (one tutorial step with a card; a real click on the mark or "Erledigt" sends "✓ Schritt n erledigt" to the session via `plumGuideDone`), **macros** (a recording saved by name in extension storage; `macros`/`macro_run` replay it with `locate` by id → role+name → CSS, params by field name or step number, protected-site checks per step), **upload_file**/**download_file** (bytes travel through the bridge; the MCP reads/writes files in its working directory, `downloads/`; internal route body limit 40 MB), `click` with `trusted: true` (Chrome debugger input for canvas apps and cross-origin frames), same-origin iframes and open shadow roots in read_page/find/click, **protected sites** (options list, default banks/payment/mail; write tools ask on the page, "Für diese Session" remembers the host), context menu **An Plum senden** (selection, link, image, page, visible area → the panel's session; queued as `pendingShare` if none), panel dictation (`transcribe` RPC → `/api/transcribe`) and read-aloud (speechSynthesis), update hint (welcome frame carries `latestVersion`), **live view** (`GET /api/browser-bridge/live/:sessionId` via the `peek` tool, `POST /api/browser-bridge/pause`; WebUI `BrowserLivePanel` above the session's Browser panel, Android `BrowserLiveCard` in Dev tools → Browser).
- **Desktop companion** (`packages/desktop-companion/plum_desktop.py`, PySide6 + websockets, spectacle/grim): connects to the bridge as client kind `desktop` with its own `plum_ff_` token (`~/.config/plum-desktop/config.json`); `desktop_screenshot`, `desktop_point`, `desktop_annotate`, `desktop_draw`, `desktop_clear` route to it (`kind: 'desktop'` in `bridge.call`) and draw on a transparent click-through overlay over native apps (XWayland `xcb`); show-only, never input. On the Geekom it runs as the user unit `plum-desktop` plus KDE autostart; it needs the session's `DISPLAY`/`XAUTHORITY` (systemd user environment).
- The MCP calls `POST /api/browser-bridge/internal/call` (hook secret and session id), and `services/browserBridge/bridge.ts` relays it to the extension.
- Release Firefox needs a signed build: `packages/firefox-extension/scripts/sign-firefox.sh` signs unlisted on AMO with `data/firefox/amo.env` and drops the result in `data/firefox/` (served first). Bump both manifest versions first.

## Godot + Blender MCP

Zero-dependency bridges are registered in `~/.claude/settings.json` and mirrored to other providers for new sessions:

- **godot** (`scripts/mcp-servers/godot.mjs`): `godot_info`, `godot_create_project`, `godot_list_project`, `godot_validate_project`, `godot_run_gdscript`, `godot_export_project`, `godot_import_assets`, `godot_add_android_preset`, `godot_export_android`.
- **blender** (`scripts/mcp-servers/blender.mjs`): `blender_info`, `blender_run_python`, `blender_create_asset`, `blender_inspect_file`, `blender_render_preview`. The image installs `blender-headless` and defaults `BLENDER_BIN=blender-headless`; outputs include `.blend`, `.glb`, `.gltf`, `.obj`, `.stl`, and `.fbx`.

### The Godot engine container

The WebUI image is Alpine/musl and the official Godot build is glibc-linked, so the engine cannot run in this container. `docker/godot/Dockerfile` builds `plum-godot:latest` (Godot 4.7.2 on `eclipse-temurin:17-jdk-noble`) with export templates, the Android SDK, build-tools, `apksigner`, a debug keystore, and pre-patched editor settings:

```bash
docker build -t plum-godot:latest docker/godot     # no --progress flag: legacy builder, no buildx
```

`godot.mjs` runs engine commands as one-shot `docker run` through `docker-socket-proxy`; `docker exec` is blocked by design. It reads its mount table with `docker inspect $(hostname)` and re-mounts each host source at the same destination path.

- **Project paths must live under a shared bind mount** (`/mnt/user`, `/mnt/cache`, `/workspace`). `/tmp` is invisible to the engine, so `godot_run_gdscript` puts its scratch script inside the project in docker mode.
- `GODOT_BIN` is intentionally empty; a local binary would be preferred if one existed. `GODOT_DOCKER_IMAGE` and `GODOT_DOCKER_DISABLED` override the fallback.
- `godot_add_android_preset` writes `export_presets.cfg` and sets `rendering/textures/vram_compression/import_etc2_astc=true`, which the exporter hard-requires and which has no CLI flag.
- `godot_export_android` returns the APK path. The engine container has no adb, so install through android-builder. That container mounts different host paths, so **stage the APK somewhere both see** (for example `/mnt/user/Zwischenspeicher/`). The Godot 4 launcher activity is `com.godot.game.GodotAppLauncher`.

### Blender to Godot

`py3-numpy` is installed in the WebUI image because Blender's `io_scene_gltf2` addon imports numpy at registration; without it `bpy.ops.export_scene.gltf` does not exist and the handoff silently has no exporter. `hasattr(bpy.ops.export_scene, "gltf")` cannot detect this; probe with `"gltf" in dir(bpy.ops.export_scene)`.

Export `.glb` from Blender into the Godot project (`.blend` import would need Blender reachable from the engine container, and it is not), then `godot_import_assets`. Blender is Z-up and Godot Y-up; the glTF exporter converts, so do not add a compensating rotation.

Godot projects should use the `game-engines` skill and android-builder for phone verification.

## Control Gateway

An external supervisor uses the same API as the user.

- Issue a token in Settings → General → Control gateway. The `plum_gw_…` secret is shown once.
- Send `Authorization: Bearer plum_gw_…`. `resolveAuthenticatedUserId()` resolves it to the owner, so every `requireAuth` route works: sessions, messages, approvals, git, analytics, and settings.
- `GET /api/gateway/overview` returns sessions with `busy`, `queueDepth`, `activitySummary`, `pendingApprovals`, `pendingQuestions`, and `needsAttention`. A session blocked on an agent question counts as needing attention.
- `GET /api/gateway/events` is an SSE stream: `assistant_message`, `user_message`, `turn_complete`. `GATEWAY_SSE_MAX_PER_USER` (default `4`) caps concurrent streams per user; beyond it the request gets `429`.
- Socket.IO accepts the same token as `auth.token`, so `session:send`, `session:input`, `session:interrupt` and the approval events work headless. Read-scope tokens may only emit `session:subscribe`, `session:subscribe-all`, `session:unsubscribe` and `session:reconnect`; other events get `session:error` (and a rejected ack for `session:send`). A revoked token closes its open sockets at the next event after at most 5 s.
- Gateway tokens cannot manage gateway tokens (`403 GATEWAY_FORBIDDEN`); revocation is immediate and the next request returns 401.
- Admin-only routes still require an admin owner; the token inherits, but does not exceed, that role.

`container_watchdogs` is a Docker health probe; session supervision belongs to the gateway.

## Multi-Provider Notes

`CLI_PROVIDERS` insertion order controls the UI. Persistent homes are `~/.codex`, `~/.local/share/opencode`, `~/.pi`, `~/.kimi-code`, `~/.vibe`, and `~/.claude`.

Default-provider selection is encoded in:

- `routes/sessions.ts`: `cliProvider` defaults to `'codex'`
- `db/index.ts`: `sessions.cli_provider` defaults to `'codex'`
- `packages/frontend/src/lib/providers.ts`: neutral `plum` maps to `codex`
- SQL `custom_agents.model` default and `/model` fallback: `gpt-5.5`

## Pitfalls

- Removed functionality must not return: Gemini provider/image service (the old API-key one; `generate_image_gemini` over the Antigravity login is separate), top-level GLM provider, orchestration manager, task router, worker pool, Ralph loop, watchdog/Telegram alerts, main-container self-rebuild API, handover protocol, or Superpowers integration (obra/Superpowers sync, managed skills, bootstrap injection, `SUPERPOWERS_*` env).
- GLM belongs to OpenCode routing; `repair-bot` is the only rebuild mechanism.
- Source-of-truth order is code → this file → README/AGENTS.
- Provider and MCP configuration binds at process spawn; use a new session after changing it.
