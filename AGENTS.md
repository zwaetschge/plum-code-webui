# AGENTS.md

Notes on the multi-provider integration in Plum Code WebUI.

## Language and Unicode

- In German user-visible text, use real UTF-8 umlauts (`ä`, `ö`, `ü`, including uppercase), not `ae`, `oe`, or `ue`, unless an external format requires ASCII.
- Preserve established ASCII technical identifiers, slugs, environment variables, and filenames.
- In Swiss Standard German, use `ss` instead of `ß`; otherwise follow the requested orthography.

## Goals implemented

- **Codex is the default provider**; Claude remains legacy.
- Sessions support Codex, OpenCode, Pi, Kimi Code, and Claude Code, restarting the CLI cleanly when switching.
- Codex supports chunk-delta streaming and transcript-prefix resume.
- Admin/helper calls use `utils/adminLLM.ts` with Codex-first preference.
- Per-CLI auth/state persists across rebuilds.
- Login routes: `/auth/codex`, `/auth/opencode`, `/auth/pi`, `/auth/claude`.
- Plum branding puts Codex first and Claude under "Legacy".
- Built-ins include ComfyUI inline images, Android-builder workflows, and optional per-session Home Assistant `light.*` status.

## Provider summary

| Provider           | CLI        | Process model                                                                            | Config home               | Default?    |
| ------------------ | ---------- | ---------------------------------------------------------------------------------------- | ------------------------- | ----------- |
| **Codex** (OpenAI) | `codex`    | per-turn respawn; `*.delta` streaming; transcript-prefix resume                          | `~/.codex`                | **yes**     |
| OpenCode           | `opencode` | per-user HTTP/SSE server; native streaming/resume; routes GLM `z-ai/glm-*`, Kimi, others | `~/.local/share/opencode` | no          |
| Pi                 | `pi`       | persistent JSONL RPC; OpenCode connections/models; shared skills, agents, MCP bridge     | `~/.pi`                   | no          |
| Kimi Code          | `kimi`     | persistent ACP stdio; streaming, cancel, queued follow-ups, native resume                | `~/.kimi-code`            | no          |
| Claude Code        | `claude`   | persistent stream-json; legacy                                                           | `~/.claude`               | no (legacy) |

Harnesses ship in the container. `${CONFIG_DIR}` (default `./config`) bind-mounts config homes, preserving OAuth/provider state across `docker compose up --build`.

## Provider switching and permission approvals

- Switching providers restarts the CLI with fresh context; never restore the removed handover-summary/handoff protocol.
- Provider badges appear in the dashboard and sidebar.
- Permission approvals send only a short resume hint, never the full prompt, to prevent duplicate responses.

## Codex notes (primary)

- Default model: `gpt-5.5`, overridden by `CLI_PROVIDER_CODEX_DEFAULT_MODEL`.
- The model menu has a hardcoded fallback. Runtime entries come from `~/.codex/models_cache.json`, filtered to `visibility=list` and priority-sorted. The CLI refreshes it; expired auth freezes the last-fetched menu. Codex CLI 0.144.0 lists `gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-terra`, then `gpt-5.6-luna`.
- UI/backend efforts: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`. Codex 0.144.0 supports `ultra` natively for delegation-capable models including `gpt-5.6-sol` and `gpt-5.6-terra`; never normalize it to `max`.
- Regular-effort GPT-5.6 sessions default to `agents.max_depth=1` and `agents.max_threads=1`; Codex CLI 0.144.0+ rejects `max_depth=0`. `ultra` and `CODEX_WEBUI_AGENT_MODE=parallel` retain parallel behavior. `CODEX_WEBUI_AGENT_MAX_DEPTH` and `CODEX_WEBUI_AGENT_MAX_THREADS` override both policies.
- `translateCodexMessage` in `ClaudeProcessManager` maps `item.delta`, `agent_message.delta`, `text.delta`, and `response.output_text.delta` to `session:output`; older CLIs fall back to full `item.completed` output.
- `buildCodexContextPrefix()` prepends up to 40 SQLite turns (≤24k characters) as `[Prior conversation context]`; Codex has no native `--resume`.
- `codex exec` is single-shot. `respawnCodexProcess` must create a child per user message and reattach stdout/stderr handlers.

## OpenCode notes

- OpenCode routes GLM, Kimi, and other LLMs; there is no separate GLM WebUI provider.
- Plum runs one server, SSE stream, config/data directory, and OAuth/account state per WebUI user under `~/.opencode/users/<sha256-user-key>`. Never assign legacy global OAuth state to users; affected users reconnect once.
- Default model: `z-ai/glm-5.1`, overridden by `CLI_PROVIDER_OPENCODE_DEFAULT_MODEL`. An empty menu discovers from the CLI; override with `CLI_PROVIDER_OPENCODE_MODELS=…`.
- Sessions default to native `build` via `CLI_PROVIDER_OPENCODE_DEFAULT_AGENT`, with a Codex-like contract in managed `build.prompt`. Override with `CLI_PROVIDER_OPENCODE_STYLE_PROMPT`; `0`/`false` disables it.
- `OPENCODE_NO_PROGRESS_TIMEOUT_MS` covers initial output and later silent stalls after output/tool activity (default `600000`; `0` disables). Timeout aborts the remote turn and marks it idle; a separate 30-minute safety cap remains.
- `OPENCODE_ZAI_VISION_MCP=auto|always|off` manages Z.AI Vision MCP (default `auto`). `auto` requires an enabled `z-ai`/`zai` key; `always` uses inherited `Z_AI_API_KEY`; `off` removes the managed entry. Keep the key in env—never write it to `opencode.json`.
- `OPENCODE_DEBUG_EVENTS=1` logs raw events.

## Pi notes

- Pi runs `@earendil-works/pi-coding-agent --mode rpc` persistently. Its default `z-ai/glm-5.1` is overridden by `CLI_PROVIDER_PI_DEFAULT_MODEL`.
- Pi shares the OpenCode provider store. `syncPiConfig()` writes secret-free per-user `models.json`; decrypted keys exist only in process env.
- Skills come from `~/.agents/skills`; Claude agent definitions are converted into the official Pi subagent extension’s per-user directory.
- Pi lacks a native MCP client. The image pins `pi-mcp-adapter`, and the backend mirrors the Claude-backed MCP registry into each user config.
- Pi requires Node 22.19+; both Docker stages use Node 22.

## Kimi Code notes

- Run one persistent `kimi acp` per active session. **Do not regress to `kimi -p`**: prompt mode buffers whole model steps and breaks interactive streaming.
- `session/prompt` maps `agent_message_chunk` and tool lifecycle updates to existing socket events. Follow-ups queue during active turns; ACP `session/cancel` interrupts without killing the process.
- Native IDs remain in `sessions.claude_session_id` for restart resume. ACP `model` and `mode` apply the selected model and Plum permission mode.

## Claude Code and Z.AI

- `claude` and `zai` are distinct providers sharing the Claude Code CLI transport.
- Claude uses the user’s Anthropic OAuth/subscription. Before spawn, remove inherited `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, and model overrides.
- Discover models from the installed CLI: native releases expose canonical ID/display-name pairs; parse older JavaScript releases from `cli.js`. Show the newest Fable/Opus/Sonnet/Haiku entry. `sonnet` is the stable default alias.
- Settings → General → Z.AI stores a per-user endpoint, encrypted token, and Opus/Sonnet/Haiku mappings. Routes: `GET/PUT/DELETE /api/settings/zai-api`. Encryption uses `ENCRYPTION_KEY`; never return plaintext tokens.
- Only Z.AI sessions receive `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, optional `ANTHROPIC_DEFAULT_*_MODEL`, `API_TIMEOUT_MS`, and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.
- Default endpoint: `https://api.z.ai/api/anthropic`; compatible gateway URLs remain editable.
- Per-user `enabledCliProviders` controls new-session/switch menus; existing sessions remain visible.
- Startup migrates `claudeApi` to `zaiApi`, reattributes those users’ legacy Claude/GLM sessions to `zai`, and reattributes GLM usage without changing genuine OpenCode usage.

## Admin / helper LLM

`packages/backend/src/utils/adminLLM.ts` provides one-shot internal completions, not interactive sessions.

- Preference: `codex` → `opencode` → `claude`; override with `ADMIN_LLM_PROVIDER=codex|opencode|claude`.
- `routes/git.ts` uses it at `/generate-commit-message`.
- Commands: `codex exec --skip-git-repo-check --ephemeral <prompt>`, `opencode run <prompt>`, and `claude --print -p <prompt>`.
- Keep Codex `--ephemeral`; otherwise admin calls pollute `~/.codex/sessions/` and break the resume picker.

## Cross-provider usage & analytics

### Token capture into `usage_history`

`ClaudeProcessManager.saveUsageToDatabase` is the sole analytics write path. Rows carry explicit CLI `provider` and stable WebUI `turn_id`; `UNIQUE(session_id, provider, turn_id)` with `insertUsageHistoryTurn()` makes retries idempotent. It reads `proc.turnInputTokens`, `turnOutputTokens`, `turnCacheReadTokens`, and `turnCacheCreationTokens`, skipping zero-total rows.

- **Claude:** `message_start` and `message_delta` populate per-turn fields in `ClaudeProcessManager.ts` near lines 3263 and 3284.
- **Codex:** `turn.completed.usage` supplies `{input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens}`. `translateCodexMessage` must populate per-turn fields directly and fold reasoning into output. The downstream `result` handler changes only cumulative totals, causing Codex analytics to disappear.
- `codex exec resume` usage may be cumulative. Track `proc.codexLastReportedTokens`: without a prior snapshot, or after counters decrease, use raw values; otherwise store deltas. Cap every field at 1M tokens per turn. Because Codex `input_tokens` includes cached tokens, calculate deltas first, then split disjoint input/cache values; analytics adds `turnInputTokens + turnCacheReadTokens`.
- **OpenCode:** consume HTTP/SSE `usage_summary`.
- **Pi:** store RPC usage with `provider='pi'`, even if its model ID exists in OpenCode. Never infer Pi from the model string.

### Per-model pricing (`llm-pricing`)

Rates are USD per 1M tokens in `packages/shared/src/types/llm-pricing.ts`; `ClaudeProcessManager` and analytics must share this card. `usage_history.cost_usd` is API-equivalent spend. Startup reprices rows when `LLM_PRICING_RATE_CARD_VERSION` changes. Unknown models remain unpriced—never use a fallback.

| Model family              | Input | Output | Cache read | Cache write |
| ------------------------- | ----- | ------ | ---------- | ----------- |
| Claude Fable 5            | 10    | 50     | 1          | 12.5        |
| Claude Opus 4.5+/5        | 5     | 25     | 0.5        | 6.25        |
| Claude Sonnet 5 (to 8/31) | 2     | 10     | 0.2        | 2.5         |
| Claude Sonnet 4           | 3     | 15     | 0.3        | 3.75        |
| Claude Haiku 4.5          | 1     | 5      | 0.1        | 1.25        |
| gpt-5.6 Sol               | 5     | 30     | 0.5        | 6.25        |
| gpt-5.6 Terra             | 2.5   | 15     | 0.25       | 3.125       |
| gpt-5.6 Luna              | 1     | 6      | 0.1        | 1.25        |
| gpt-5.5                   | 5     | 30     | 0.5        | 0           |
| gpt-5.4                   | 2.5   | 15     | 0.25       | 0           |
| gpt-5.4-mini              | 0.75  | 4.5    | 0.075      | 0           |
| gpt-5.3-codex / 5.2-codex | 1.75  | 14     | 0.175      | 0           |
| opencode-go/qwen3.7-max   | 2.5   | 7.5    | 0.5        | 3.125       |
| opencode-go/mimo-v2.5-pro | 1.74  | 3.48   | 0.0145     | 0           |
| opencode-go/minimax-m3    | 0.3   | 1.2    | 0.06       | 0           |
| Kimi K3                   | 3     | 15     | 0.3        | 0           |
| Kimi K2.7 Code            | 0.95  | 4      | 0.19       | 0           |
| z-ai/glm-5.2              | 1.4   | 4.4    | 0.26       | 0           |
| z-ai/glm-5.1              | 1.4   | 4.4    | 0.26       | 0           |
| z-ai/glm-5                | 1     | 3.2    | 0.2        | 0           |
| z-ai/glm-4.7/4.6/4.5      | 0.6   | 2.2    | 0.11       | 0           |
| Gemini 3.1 Pro Preview    | 2     | 12     | 0.2        | 0           |
| Mistral Medium 3.5        | 1.5   | 7.5    | 1.5        | 1.5         |
| Devstral Small 2          | 0.1   | 0.3    | 0.1        | 0.1         |

Price Codex subscription use at OpenAI’s rate card as equivalent API spend for comparison with Claude API metering.

### Provider grouping in the chart

Backend analytics and frontend charts must both call `getProviderLabelForUsage(provider, model)` from `packages/shared/src/types/cli-providers.ts`. Explicit provider wins; model detection is only a legacy fallback:

- `startsWith('gpt-')` or contains `codex` → Codex
- `startsWith('claude')` or exact `opus / sonnet / haiku` → Claude
- `startsWith('mistral-')` or `startsWith('devstral-')` → Vibe, historical rows only
- `startsWith('glm-')`, `startsWith('z-ai/')`, or `startsWith('zai/')` → OpenCode
- Contains `/`, e.g. `z-ai/glm-5.1` or `anthropic/claude-sonnet-4-5` → OpenCode
- Otherwise → Other

Never duplicate this logic in routes/pages; divergence makes breakdown and timeline disagree.

## Codex usage limits (`/api/usage/limits?provider=codex`)

`routes/usage.ts` calls `https://chatgpt.com/backend-api/codex/usage` with `~/.codex/auth.json`. Required headers:

- `Authorization: Bearer <tokens.access_token>`
- `chatgpt-account-id: <id>`; omission returns 401. Resolve from:
  1. `tokens.account_id`
  2. `id_token` claim `https://api.openai.com/auth.chatgpt_account_id`
- `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 ... Safari/605.1.15`; Cloudflare may challenge Linux/Firefox user agents instead of returning JSON. Override with `CODEX_USER_AGENT`.

Token refresh uses hardcoded client ID `app_EMoamEEZ73f0CkXaXp7hrann`, **not** the JWT `aud` claim.

Response shape:

```jsonc
{
  "plan_type": "prolite",
  "rate_limit": {
    "primary_window":   { "used_percent": 12, "reset_at": 1778958045, "limit_window_seconds": 18000 },
    "secondary_window": { "used_percent":  8, "reset_at": 1779486595, "limit_window_seconds": 604800 }
  },
  "additional_rate_limits": [{ "limit_name": "code_review", "rate_limit": { ... } }]
}
```

`mapCodexUsage` maps `primary_window` to `fiveHour`, `secondary_window` to `sevenDay`, exposes `plan_type` as `subscriptionType`/`rateLimitTier`, and forwards `additional_rate_limits` as `additional`.

## Shared agents / skills / plugins

- Active skills: `~/.claude/skills/<name>/SKILL.md`; on-demand packs: `~/.claude/skill-catalog/<name>/SKILL.md`; presets: `~/.claude/style-library/{design,writing}`; agents: `~/.claude/agents/<name>.md`.
- Default core: `api-design`, `capability-catalog`, `debugging-playbook`, `devops-deploy`, `documentation-writer`, `frontend-design`, `performance-tuning`, `refactor-guide`, `security-review`, `testing-playbook`. State: `~/.claude/integrations/skill-catalog-state.json`.
- Search with `node /app/scripts/capability-catalog.mjs search "<task>"`; load with `node /app/scripts/capability-catalog.mjs show <name>`. `GET /api/claude-config/skills?library=all` and Settings → Extensions → Skills expose the same catalog.
- Enabling moves skills into the runtime tree; disabling returns them to the catalog. Styles are session-selectable.
- `~/.claude/skill-aliases.json` records canonical aliases and retired names that external folders or `.skill.zip` files must not re-import.
- Initial reconciliation migrates legacy `~/.codex/skills` and `~/.codex/agents`, preserving Codex `.system` skills. Do not restore provider-specific duplicates.
- External packs sync in order from `/mnt/user/AI/Skills`, `/mnt/unraid/AI/Skills`, then comma-separated `WEBUI_SKILLS_DIRS`. `.skill.zip` files enter active or on-demand trees according to catalog state and aliases/tombstones.
- Only the main WebUI imports external skills. Set `WEBUI_EXTERNAL_SKILL_SYNC=false` on auxiliary processes such as `repair-bot`; shared config mounts must not race reconciliation.
- Managed blocks in `AGENTS.md` and `CLAUDE.md` update per session; preserve custom text outside them.
- The silent “What would Vale do?” proxy (part of the session execution contract in `sessionExecutionContext.ts`) resolves routine/reversible decisions internally; it must never become a skill, checklist, review, or approval gate.

### Style preset library

The former 67 design-system skills and writing/persona packs are 37 design and 32 writing profiles: searchable/session-selectable, not executable workflows.

- Paths: `~/.claude/style-library/design/<name>` and `~/.claude/style-library/writing/<name>`.
- Consolidated families retain legacy aliases and optional `variants/*.md`; canonical `DESIGN.md` defines contrast-safe surface/text tokens.
- Voice guidance never overrides truth, authority, consent, safety, or requested outcomes.
- After importing, run `node scripts/optimize-style-library.mjs <config-home>`, then `node scripts/validate-skill-catalog.mjs <config-home>`.
- Never copy presets into `~/.claude/skills`.

## Built-in MCP servers

Claude-backed MCP servers are registered under `mcpServers` in `config/claude/settings.json` and mirrored into Codex, OpenCode, and Pi at startup. Codex adds local `oracle` config to `~/.codex/config.toml`. MCPs bind at CLI spawn and appear only in **new** sessions.

## Image generation paths

| Path              | Trigger                                      | Model                  | Counts against    | Best for                                 |
| ----------------- | -------------------------------------------- | ---------------------- | ----------------- | ---------------------------------------- |
| Codex `$imagegen` | `$imagegen ...` or natural image hint        | gpt-image-2            | Codex plan limits | ad-hoc single images                     |
| `openai-image.sh` | `bash /app/scripts/openai-image.sh ...`      | gpt-image-2/1          | OpenAI API        | reproducible batches and fixed filenames |
| ComfyUI MCP tools | `generate_image` / `_quality` / `edit_image` | Z-Image / Flux.2 Klein | local GPU         | offline batches and style control        |

- `/app/scripts/openai-image.sh` uses `curl + jq + base64`; subcommands `generate` and `edit` accept `--prompt`, `--output`, `--model`, `--size`, `--quality`, `--n`, and `--background`.
- `buildIntegrationEnv()` exports `OPENAI_API_KEY` from `app_config.openai_api_key`, then process env. The script refuses to run without it.
- On-demand skill `image-asset-generation` contains exact patterns; legacy `openai-image-gen` aliases to it.

### `comfyui-images`

The WebUI talks directly to ComfyUI without a LoRA Tester sidecar. Backend workflows/settings/rate limits live in `packages/backend/src/services/comfyui/`; MCP bridges to `POST /api/comfyui/internal/generate`.

- Script: `scripts/mcp-servers/comfyui.mjs` (zero-dependency Node stdio).
- `generate_image`: Z-Image Turbo, about 5s/image, 9 steps, `dpmpp_2m_sde`, qwen3_4b CLIP.
- `generate_image_quality`: Flux.2 Klein 9B, Turbo LoRA, TeaCache, 8 steps, `euler`, `SamplerCustomAdvanced`.
- `edit_image`: Flux.2 Klein with ReferenceLatent. Accept only a current-user session attachment such as `.claude-webui-attachments/` or owned generated image. `materializeInputImage()` validates ownership, real path, image type, and 25 MB limit. Bare ComfyUI filenames work only for that user’s Plum upload during the current process lifetime; arbitrary host paths fail closed.
- Common overrides: `prompt`, `negative_prompt`, `seed`, `steps`, `cfg`, `sampler_name`, `aspect_ratio`, `megapixel`; edit-only: `input_image`. REST-only: `unet`, `clip`, `vae`, `lora_name`, `lora_strength`, `teacache_threshold`, `filename_prefix`.
- MCP inherits `WEBUI_HOOK_SECRET` and `WEBUI_SESSION_ID`, sending `X-Webui-Hook-Secret` and `X-Webui-Session-Id`; the session ID identifies the analytics user.
- URL: `app_config.comfyui_url` → `$COMFYUI_URL` → `http://192.168.1.23:8188`. Settings → Integrations tests `/system_stats`; the orchestrator rereads settings per job.
- PNG output: `data/generated/<uuid>.png`, served as `/generated/<uuid>.png` behind passport auth. MCP returns `display_markdown` as `![alt](/generated/<uuid>.png)`.

### Home Assistant status lights

- Settings → Integrations stores one app-wide URL and encrypted long-lived token; `HOME_ASSISTANT_URL` and `HOME_ASSISTANT_TOKEN` are fallbacks.
- Sessions may select one `light.*`. Color lights use green/red/blue; others pulse by power or brightness.
- Green means completion, red means blocked/session/watchdog error, blue heartbeat means permission/input request.
- Snapshot and restore prior state after animation. Newer events supersede active animation without losing the original state.
- Route: `/api/home-assistant`; service: `packages/backend/src/services/home-assistant/`.

### `android-builder`

- Script: `scripts/mcp-servers/android-builder.mjs`; it provides about 25 project, build, install/launch, ADB, emulator, and device-testing tools.
- Backend: `http://host.docker.internal:4000` (`android-app-creator-backend` on the host).
- Pair once with `adb_pair_wifi` and `adb_connect_wifi`; `/app/data/known-devices.json` persists the registry and startup auto-reconnects.
- Load `android-build` for the full workflow. **Never call `adb` or `gradle` from `Bash` when this MCP is available.**
- The WebUI Android client builds from builder project `796aa064-f0bb-4031-bbf2-2da83a4bca94`; sync sources from `packages/android` into its `workspacePath` with `cp` (no rsync in the container; `app/src` itself is owned by the builder UID — copy directory _contents_, don't delete the tree).

### Android app: home-screen widgets & Wear OS

- `packages/android/.../widget/` hosts ten RemoteViews widgets sharing one REST-fetched snapshot (`WidgetDataFetcher` → `WidgetStore` SharedPreferences cache → `WidgetRenderer`). Kinds: sessions/agents, approvals, quick glance, tokens today, cost, provider usage, model usage, provider limits, 7-day chart (bitmap), top sessions.
- `WidgetRefreshWorker` (WorkManager) refreshes every 15 min while widgets exist, plus on demand (widget ↻, app start) and in realtime from socket events via `LocalNotificationManager`. Sections fail independently and fall back to the cached values; signed-out state renders a hint instead of blank.
- `SessionWidgetReceiver` keeps its historical class name so widgets placed before the rewrite keep updating.
- The Approvals widget answers requests inline (✓/✕ → `WidgetActionReceiver` → `POST /api/permissions/respond`). `WidgetConfigActivity` (per-instance: 24h/7d, provider filter, translucent bg) runs on placement; Android 12+ gets compact SizeF variants and the system accent on titles.
- `UsageAlerts` notifies when a provider quota passes 80% or today's cost passes the budget (default $5, toggle in Settings → Notifications), deduped per day; the Limits widget colors hot quotas amber/red.
- Analytics widgets deep-link via `claudewebui://analytics?range=…`; `AppNavigation` handles warm-start deep links through `LaunchedEffect(deepLinkUri)` (onNewIntent alone navigates nowhere).
- Wear OS, two tiers: (1) bridged notifications — permission prompts carry Approve/Deny/Dismiss + `WearableExtender`, agent questions expose their options (max 3) plus a RemoteInput reply; (2) a companion watch app in `packages/android/wear` (activity with approve list, tile, approvals-count complication). The phone mirrors data via `WearSync` (DataItem `/plum/snapshot`) and executes watch responses in `WearBridgeService` (message `/plum/approval-response`); the watch never talks to the server. Both APKs must share applicationId (incl. `.debug` suffix) and signing cert or the data layer stays silent.
- In-app updates: `GET /api/app/version` + `GET /api/app/download` (`routes/app.ts`) serve `<data>/android/claude-webui.apk` with metadata from `version.json` (`{version, versionCode, releaseNotes}`); the download URL carries a 15-min HMAC token because DownloadManager sends no auth header. Publish a release by dropping both files into the data dir.
- The keep-alive notification (`AgentWatchService`) shows the current tool/subagent streamed from `session:tool_use` / `session:agent` events, throttled to one update per 3 s.

### Workspace features (`/api/workspace`, `/api/transcribe`)

One route file, `routes/workspace.ts`, backs the newer cross-cutting features; all tables are created in `db/index.ts`.

- **Turn diffs** — `services/git/turnDiff.ts` captures the working-tree diff when a turn ends (hooked from `recordTurnOutcome` in `ClaudeProcessManager`); sessions outside a git repo record nothing. Read via `GET /api/workspace/sessions/:id/turn-diffs` and `/turn-diffs/:diffId`.
- **Notification centre** — every notable event is persisted by `services/notifications/notificationCenter.ts`, fanned out on the `user:<id>` socket room as `notification:new`, and optionally delivered as Web Push. `web-push` is an optional dependency, imported by a computed specifier; without it or without `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` delivery degrades to sockets only.
- **Session templates**, **cross-device drafts** (`session_drafts`, keyed by session + user + chat) and **push subscriptions** live in the same router.
- **Transcription** — `POST /api/transcribe` proxies a multipart clip to `TRANSCRIBE_URL` (Whisper-compatible; optional `TRANSCRIBE_TOKEN`, `TRANSCRIBE_MODEL`). Both clients probe `/api/transcribe/status` and hide the mic when it is unset.
- **Archive and bulk** — sessions carry an `archived` flag; `GET /api/sessions?archived=1` swaps the list, `POST /api/sessions/bulk` applies archive/unarchive/star/unstar/category/delete to many ids, always scoped by `user_id`.
- **Usage alerts** are account-wide in `user_settings.settings_json.usageAlerts` (enabled, quotaPercent, dailyCostUsd) so WebUI and app share one threshold.
- **Git checkout** — `POST /api/git/checkout` refuses a dirty working tree (409 `DIRTY_WORKTREE`) rather than dragging uncommitted agent work onto another branch.

New Android env: none required; the app degrades gracefully when a feature's server side is unconfigured.

### WebUI ↔ Android feature parity

**New features ship in both clients in the same pass.** Building one side first and backfilling later is what produced the parity gaps closed on 2026-08-11; treat a feature as unfinished until it is reachable in `packages/frontend` _and_ `packages/android`.

**WebUI side-menu split:** the left menu holds main navigation (sessions, analytics, settings, operations); the right menu holds chat and session functions (chat threads, Git, Checkpoints, Notes, Preview, Tool Log, Styles, Runtime, Android devices). Session-scoped controls belong in the right menu, not in the chat header. The right dock is `hidden md:flex`, so anything added there needs a slot in the mobile session sheet as well.

Both clients speak the same REST/socket API; keep new session features reachable from both.

- **Dockable panels** are the WebUI's extension point: add the key to `DockablePanel` in `stores/panelDockStore.ts` (plus both default maps), then a `panelMeta` entry and a `renderDockedPanel` branch in `SessionPage.tsx`. Git, Checkpoints, Notes, Preview and Tool Log live there; Categories and Discovered Projects sit in a secondary row on the dashboard. Components that exist but are mounted nowhere are invisible to users — check `grep -rl "<ComponentName"` before assuming a feature ships.
- **Android equivalents**: slash commands in `ChatInput` (`/` picker fed by `/api/commands`), `TaskWorkbenchStrip` (todos/queue/context), `CompactBoundaryCard` (messages whose id starts with `compact-`), per-session presets via `PATCH /api/sessions/:id/styles`, and the Devices tab in DevTools (`/api/android/*` pair/connect/emulator). Closed later: the Tool Log (a sheet behind the chat's Tools tab), control-gateway tokens and the Codex plugin catalogue (`ParityPanels.kt`, mounted in `SettingsScreen`), and discovered projects (a collapsible row on the dashboard).
- **Reconnecting a wireless device**: Android hands out a new debug port on every wireless-debugging restart, so each remembered device row carries a port field prefilled with the last one. `POST /api/android/devices/connect` takes `replaceSerial` and drops the stale entry only after the new port answers, so a failed reconnect never loses the entry you need to retry.
- Reasoning levels are provider-specific and must match `reasoningOptions` in `SessionPage.tsx`: Codex offers none/minimal/low/medium/high/xhigh/max/ultra, Claude and Z.AI low/medium/high/max, OpenCode and Pi minimal/low/medium/high/max. Codex's `fast` is a service tier, not a level — the backend moves it to `cli_service_tier` and clears `cli_reasoning`.
- Integration secrets are write-only in both clients: the server returns `*Configured` flags only, an empty field means "keep", and removing one needs the explicit `clear*` flag.

### `godot`

- Script: `scripts/mcp-servers/godot.mjs`.
- Tools: `godot_info`, `godot_create_project`, `godot_list_project`, `godot_validate_project`, `godot_run_gdscript`, `godot_export_project`.
- Scaffolding/inspection need no binary; validation, editor scripts, and export require `GODOT_BIN` or `godot`/`godot4` on `PATH`.
- Use `game-engines` (legacy `game-engine-godot`) for scene/resource/input/export architecture and `android-builder` for Android verification.

### `blender`

- Script: `scripts/mcp-servers/blender.mjs`.
- Tools: `blender_info`, `blender_run_python`, `blender_create_asset`, `blender_inspect_file`, `blender_render_preview`.
- Runtime installs `blender-headless` and defaults `BLENDER_BIN=blender-headless`.
- Supports procedural `.blend`, `.glb`, `.gltf`, `.obj`, `.stl`, `.fbx`, and background PNG previews.

## Auth allowlist

`AUTH_ALLOWED_EMAILS` is the sole login allowlist:

- OAuth uses `findOrCreateUser` in `src/auth/passport.ts`; `EmailNotAllowedError` redirects to `/connect?error=email_not_allowed`.
- Basic auth in `src/routes/basic-auth.ts` returns `403 EMAIL_NOT_ALLOWED`.
- Empty means unrestricted login and is safe only behind private networking or SSO.
- On first login, the `SEED_ADMIN_EMAIL` user—or first allowlist entry if unset—gets `role=admin`.

## Paths and mounts (container)

- Logos: `LOGOS_DIR=/app/logos`; override mount `/mnt/cache/appdata/plum-code-webui/logos`.
- CLI homes mounted from `${CONFIG_DIR}/<cli>`:
  - Codex: `/home/node/.codex`
  - OpenCode: `/home/node/.opencode`, symlinked to `~/.config/opencode` and `~/.local/share/opencode`
  - Pi: `/home/node/.pi`
  - Kimi Code: `/home/node/.kimi-code`
  - Claude Code: `/home/node/.claude`
  - npm-global: `/home/node/.npm-global`
  - GitHub CLI: `/home/node/.config/gh` (token + config; would be ephemeral otherwise)
- Workspace: `${WORKSPACE_DIR}` → `/workspace`; constrain with `ALLOWED_BASE_PATHS`.

## Environment overrides

- `WEBUI_CONFIG_HOME` or legacy `CLAUDE_CONFIG_HOME`: shared Claude config home.
- `WEBUI_SKILLS_DIRS` or legacy `CLAUDE_SKILLS_DIRS`: additional skill packs.
- `CLI_PROVIDER_CODEX_MODELS`, `CLI_PROVIDER_OPENCODE_MODELS`, `CLI_PROVIDER_PI_MODELS`, `CLI_PROVIDER_CLAUDE_MODELS`: model-menu overrides. Empty selects Codex cache, OpenCode CLI, OpenCode-backed Pi, or Claude CLI discovery.
- Defaults: `CLI_PROVIDER_CODEX_DEFAULT_MODEL=gpt-5.5`; `CLI_PROVIDER_OPENCODE_DEFAULT_MODEL=z-ai/glm-5.1`; `CLI_PROVIDER_PI_DEFAULT_MODEL=z-ai/glm-5.1`; `CLI_PROVIDER_CLAUDE_DEFAULT_MODEL=sonnet`.
- `CLI_PROVIDER_OPENCODE_DEFAULT_AGENT=build`; empty `CLI_PROVIDER_OPENCODE_STYLE_PROMPT` uses the Codex-like default; `0`/`false` disables it.
- `ADMIN_LLM_PROVIDER`: pin helper calls; default `codex` → `opencode` → `claude`.
- `CODEX_USAGE_TIMEOUT_MS`, `CODEX_USAGE_CACHE_TTL_MS`: quota timeout/cache, default 10/60 seconds.
- `OPENCODE_NO_PROGRESS_TIMEOUT_MS`: default `600000`; `0` disables the soft cap.
- `OPENCODE_ZAI_VISION_MCP=auto|always|off`: default `auto`.
- `OPENCODE_DEBUG_EVENTS=1`: log raw backend events.
- `CLI_RUNNER_ACCESS=admin-only|trusted-users`: default `admin-only` while CLIs share Unix/provider homes. Use `trusted-users` only in a deliberately trusted private deployment.
- `CLI_RUNNER_ALLOWED_EMAILS`: permit selected non-admins without enabling all active users.
- `PLUM_BACKUP_RETENTION_DAYS`, `PLUM_LOG_RETENTION_DAYS`, `PLUM_SESSION_RETENTION_DAYS`: retention for `node scripts/plum-maintenance.mjs`; preview with `--dry-run`.

## GitHub CLI (`gh`)

`gh` is the supported way to talk to GitHub from a session: pull requests, issues, releases, CI runs, and the raw API. Prefer it over hand-rolled `curl` against `api.github.com`, and over asking the user to click through the web UI.

- Installed from Alpine `github-cli` in the runtime image (`Dockerfile`, the `apk add` layer).
- Authenticated once per deployment as `zwaetschge` via OAuth device flow; scopes `repo`, `read:org`, `gist`, `workflow`.
- Credentials live in `~/.config/gh/hosts.yml`, mounted from `${CONFIG_DIR}/gh` for both the main WebUI and `repair-bot`, so the login survives rebuilds.
- `git_protocol` is `ssh`, matching the read-only `~/.ssh` mount that already authenticates `git@github.com`.
- Re-auth after a token revoke: `gh auth login --hostname github.com --git-protocol ssh --web`. It prints a one-time code the user enters at <https://github.com/login/device>; there is no headless path, since the WebUI's own GitHub OAuth is login-only and stores no repo-scoped token.
- The token is stored in plain text inside the mounted config, exactly like the other provider credentials. Treat `${CONFIG_DIR}/gh` as secret material: never commit it, never echo `gh auth token`, and redact it in Discord or logs.

`services/githubCli.ts` wraps it for the API: `/api/github/pulls` (list, create, `:number/merge`), `/api/github/runs` (list, `:id/rerun`, `:id/failure-log`), `/api/github/issues` (list, create) and `/api/github/releases`. Every call is `execFile` with an argument array — never a shell string — so branch names and PR titles cannot inject commands. The repo comes from the session's `workingDirectory`, validated through `isAllowedBasePath`.

The older Octokit path in `services/github.ts` (repos, clone, push, remote) stays, but it needs a per-user token from Settings that most users never create. Prefer the gh-backed routes for anything new. Both clients surface the same four tabs: `components/github/GitHubPanel.tsx` as a dockable panel, and `GitHubCollabPanel.kt` in the Android DevTools GitHub tab.

## Rebuild / redeploy protocol (MANDATORY for agents)

For Docker/backend redeploys, trigger `repair-bot`. **Never run `docker compose build` followed by `docker compose up -d --force-recreate` inside the WebUI container**; recreation kills the caller and has repeatedly broken deployments.

### The right way

```bash
bash scripts/plum-rebuild.sh
```

It writes `data/rebuild-trigger.json` with `{reason, timestamp, noCache}`, polls `data/rebuild-robot-status.json` for `idle/watching` or `error`, then checks `http://localhost:${WEBUI_PORT:-4545}/`. Flags: `--no-cache`, `--no-wait`, `--timeout=N` (default 600s).

### Why the sidecar architecture is mandatory

`repair-bot` in `docker-compose.override.yml` mounts `/mnt/cache/appdata/plum-code-webui` at `/webui`. `scripts/rebuild-robot-sidecar.sh` polls every 5s, protects the running image, runs `build → stop → rm -f → up -d --no-deps` externally, then requires `/health/ready`, Docker health, and the candidate image ID. Failure restores the protected image.

The main WebUI must never mount the raw Docker socket. Through `docker-socket-proxy` it receives only filtered `BUILD`, `IMAGES`, `CONTAINERS`, and `NETWORKS`, enabled by local `DOCKER_PROXY_CONTAINERS`, `DOCKER_PROXY_IMAGES`, `DOCKER_PROXY_NETWORKS`, `DOCKER_PROXY_BUILD`, and `DOCKER_PROXY_POST`. Compose needs `NETWORKS` for external-network inspection. Portable defaults are `0`; `EXEC` and `VOLUMES` stay disabled. Only `repair-bot` and the proxy receive the raw socket.

Provider CLIs inherit filtered `DOCKER_HOST`; keep `CLI_RUNNER_ACCESS` admin-only or restrict it to trusted release operators. Plum rebuilds must use `bash scripts/plum-rebuild.sh`. Direct inner-container recreation can leave the new image in `Created`, requiring `docker start <id>`.

### Manual fallback (only if `repair-bot` is dead)

If `docker ps --filter name=repair-bot` is empty, `plum-rebuild.sh` exits 3. Start it with `docker compose up -d repair-bot`.

## Database safety

The database is owned by exactly one process. On 2026-08-26 it was truncated by
1278 pages — `messages`, `session_events` and the search index were gone — because
a second connection reached the live file. `scripts/plum-maintenance.mjs` did that
on every run, and an agent shell can do it at any time: the same file is reachable
both directly under `/mnt/cache` and through the `/mnt/user` FUSE layer, and SQLite's
locks do not carry across those two views.

- **Never open `data/claude-webui.db` from a second process**, not even read-only.
  Query it through the running server, or through a backup copy.
- Backups run in-process (`services/backup.ts`, `VACUUM INTO` every 6h, verified
  with `integrity_check` plus a row count). `POST /api/admin/backup` triggers one;
  `plum-maintenance.mjs` asks for it over that route instead of opening the file.
- Litestream (`plum-litestream`) replicates continuously to
  `/mnt/user/backups/plum-code-litestream`, 10s sync, daily snapshot, 14 days of
  point-in-time recovery. Its source mount **must** stay the direct
  `/mnt/cache/...` path; pointing it at `/mnt/user` would recreate the exact
  failure above. Restore: `litestream restore -config /etc/litestream.yml -o <out>
/data/claude-webui.db` in a throwaway container.
- `/health/ready` reads real rows from `sessions` and `messages` and runs
  `quick_check` every 15 minutes. The previous `SELECT 1` touched no table and
  reported healthy throughout the corruption.

## Removed paths (do not reintroduce)

- `/api/automation`, `/api/tasks`, `/api/devices`, `/api/claude-settings`: four routers (~1,900 lines) with no caller in either client. `automation` was the control gateway's predecessor; `tasks` plus `services/tasks/` was the last of the removed orchestration/task-router stack. `addPatternToSettings` survived the claude-settings removal as `services/claudeSettings.ts` — the permission approval flow still writes through it. Their tables (`automation_tokens`, `session_goals`, `trusted_devices`, `orchestration_*`) are dropped by a migration in `db/index.ts`; all were empty. `session_delegations` stays: it has live callers.

- Gemini provider, `~/.gemini`, and Gemini image service
- Top-level GLM provider; GLM belongs to OpenCode
- Orchestration manager, task router, worker pool
- Ralph autonomous loop
- Superpowers integration (obra/Superpowers sync, managed skills, bootstrap injection, `SUPERPOWERS_*` env)
- Watchdog monitoring and Telegram alerts
- Main-container self-rebuild HTTP API and handover protocol

`repair-bot` remains the only rebuild mechanism. `scripts/rebuild-robot-sidecar.sh`, enabled through `docker-compose.override.yml`, is the sole self-rebuild path.

## Known gaps / follow-ups

- Codex quota requires a valid OAuth token and ChatGPT account ID in `~/.codex/auth.json`; defaults are 60-second caching and 10-second timeout.
- MCPs bind at spawn; start a fresh chat for newly added tools.
- Old custom agents may use `model='claude-sonnet-4-20250514'`; new agents default to `gpt-5.5`. Edit Claude-flavored model fields before using them in Codex sessions.
- CLI sessions share a Unix UID and provider homes. `CLI_RUNNER_ACCESS=admin-only` is the containment boundary until per-user/container runners exist; never silently change it.
- Preview vhost cookies are not cryptographically bound to WebUI users. Ownership is checked, but preview hosts must remain behind the same authenticated proxy.

## Implemented optimisation baseline

- Production uses compiled `node dist`, Node 22.22.3, pnpm 9.15.0, production-only backend dependencies, `COPY --chown`, and an init process.
- `/health/live` is liveness; `/health/ready` checks SQLite, persistent data, config mounts, and frontend bundle.
- Browser sessions use SQLite `http_sessions`; suspending, deleting, or password-resetting users revokes browser and WebSocket state.
- OpenCode is isolated per user across process, SSE, config, data, and OAuth. Global OAuth state is not migrated; affected users reconnect once.
- Startup reconciles stale `running` sessions. Child CLIs use process groups; shutdown escalates `SIGTERM` to `SIGKILL` for the process tree.
- Codex reads only the final 16 MiB of large rollout JSONL files. OpenCode polls the current turn serially with abort/request timeouts.
- Settings capability queries are tab-lazy; lists initially show 6 agents or 9 skills while search covers the full catalog.
- `node scripts/plum-maintenance.mjs` creates an online SQLite backup, runs `quick_check`, uses mode `0600`, and prunes only managed artifacts under configured retention.

## Memory-Optimizer (selbstwartendes Gedächtnis)

Jedes `session:compact`-Event startet serverseitig `packages/backend/src/services/memoryOptimizer.ts`; Debounce: 6 h pro Workspace, abschaltbar mit `MEMORY_OPTIMIZER_ENABLED=false`.

- Unter `~/.claude/projects/<slug>/memory/` wandern `session-*.md` nach 14 Tagen in `memory/archive/`. Der Admin-LLM destilliert Kernerkenntnisse in `learnings.md`; `MEMORY.md` wird gestrafft und verweist auf `learnings.md`/`archive/`.
- Ab 12 kB strafft und dedupliziert der Admin-LLM Workspace-`CLAUDE.md`/`AGENTS.md` auf 60–85 %, maximal 64 kB. Alle `<!-- webui-managed: … -->`-Blöcke werden entfernt und byte-identisch wieder eingesetzt.
- Vor jedem Write entsteht ein Backup unter `data/memory-optimizer/backups/<ts>/`; Retention: 20 Läufe. Writes sind atomar und werden auf Struktur, Längenband und Platzhalter validiert; bei Ablehnung bleibt das Original unverändert.

## Durable Chat-Zustellung und geräteübergreifender Sync

- Neue Web-/Android-Sends tragen eine stabile `clientMessageId` und die beim Verfassen aktive `chatId`. `message_deliveries` macht Retries über Socket- und Backend-Neustarts idempotent; eine ID darf nie für einen anderen Payload wiederverwendet werden. Legacy-Clients ohne `chatId` erben den aktiven Chat.
- Provider-Turns bleiben an ihre aufgelöste `chatId` gebunden. Chat-Wechsel dürfen weder alte Outbox-Nachrichten noch Antworten laufender Turns in andere Threads schreiben.
- Replaybare Events erhalten eine monotone `eventSequence`. Der Server sendet zuerst das Live-Event, dann `session:cursor`; Clients persistieren den Cursor erst nach erfolgreicher Anwendung. Bei `needsFullResync` wird der Ziel-Cursor erst nach einem erfolgreichen, chat-gepinnten REST-Snapshot übernommen.
- `GET /api/sessions/:id/messages` unterstützt chat-gepinnte Fenster mit genau einem von `before`, `after` oder `around`. Ein `around`-Sprung muss `hasMoreAfter`/`newestId` bewahren und einen Rückweg zur neuesten Unterhaltung anbieten.
- Resumierbare Uploads nutzen `chat_uploads`, SHA-256 pro Datei/Chunk und `Content-Range`. Grenzen: 10 Dateien, 25 MiB pro Datei, 32 MiB insgesamt. Retrybare Sendefehler behalten fertige Uploads für die Outbox.
- Read-State ist pro Benutzer, Session und Chat persistent. Presence ist nur flüchtige Anzeige und darf den autoritativen Lesemarker nicht überschreiben.

<!-- webui-managed: project-context:start -->

# Project: plum-code-webui

Web UI for Codex, OpenCode, Pi, and Claude Code agent harnesses

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
