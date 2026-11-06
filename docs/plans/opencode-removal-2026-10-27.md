# OpenCode removal (2026-10-27)

Decision by the user: OpenCode leaves Plum completely; Pi is the harness for GLM, DeepSeek, Mistral, Anthropic-API and custom OpenAI-compatible endpoints from now on.

## What goes

- CLI provider `opencode` everywhere: `CLIProvider` unions, zod enums, provider pickers, login panels, provider themes/colors/logos/animations, slash-command forwarding, permission/question replies, subagent provider `opencode`, admin-LLM fallback, CLI update entry, Docker install of `opencode-ai`, `~/.opencode` XDG symlinks, compose env `CLI_PROVIDER_OPENCODE_*`/`OPENCODE_*`, regression tests that only cover OpenCode.
- Backend: `services/opencode/OpencodeServer.ts`, `services/opencode/sessionContext.ts`, `routes/opencode.ts` (questions endpoints and `/available-providers-debug` disappear), OpenCode branches in `ClaudeProcessManager`, `usage.ts`, `cli-providers.ts`, `providerLinks.ts` (no more writing an `opencode.json`/agents dir), `commands.ts`, `permissions.ts`, `browserBridge/rpc.ts`.
- Pi stops reading the OpenCode tenant `opencode.json` (model lists were merged into the registry on 2026-10-27; backup `/mnt/cache/appdata/plum-migration/user-settings-before-opencode-removal-20261027.json`).

## What stays (renamed, provider-neutral)

The per-user **model provider registry** (API keys + base URL + model list for z-ai, mistral, deepseek, anthropic, custom endpoints). Pi, model chat (`apiTransport`), voice, realtime voice and Mistral plan usage read it. Only names change:

| Old | New |
|---|---|
| `utils/opencodeProviderKeys.ts` | `utils/modelProviderKeys.ts` |
| `OpenCodeProvider`, `OpenCodeProviderPublic` | `ModelProvider`, `ModelProviderPublic` |
| `readOpenCodeProvidersForUser` | `readModelProvidersForUser` (other exports: replace `OpenCode` with `ModelProvider`, e.g. `getModelProviderCredentialEnvVars`, `buildModelProviderCredentialEnv`) |
| `utils/opencodeCatalog.ts` | `utils/modelCatalog.ts` |
| `getOpenCodeProviderCatalog`, `refreshOpenCodeModelsCache`, `OpenCodeProviderCatalog` | `getModelProviderCatalog`, `refreshModelsCache`, `ModelProviderCatalog` |
| models.dev cache under OpenCode paths | Plum-owned cache path (`~/.cache/plum/models-dev.json`, env `PLUM_MODELS_CACHE_PATH`); no OpenCode CLI/config sources |
| settings JSON key `opencodeProviders` | `modelProviders` (read falls back to `opencodeProviders`, write only `modelProviders`) |
| env `OPENCODE_ZAI_VISION_MCP` | `PLUM_ZAI_VISION_MCP` (old name still read as fallback) |

### HTTP contract (both clients)

Base path moves from `/api/opencode` to `/api/model-providers`; sub-paths and payloads stay byte-identical:

- `GET /api/model-providers/providers`
- `PUT /api/model-providers/providers`
- `DELETE /api/model-providers/providers/:id`
- `POST /api/model-providers/providers/:id/test`
- `GET /api/model-providers/available-providers`

No alias under `/api/opencode`.

Question replies stay (they also answer Vibe ACP elicitations via `respondAcpQuestion`): `/api/opencode/questions/respond|reject` move to `/api/permissions/questions/respond` and `/api/permissions/questions/reject` with unchanged payloads (`{requestId, answers, providerSessionId?}` / `{requestId, providerSessionId?}`); only the OpenCode fallback branch inside them goes. Callers: WebUI `socket.ts`, `browserBridge/rpc.ts`, Android `PermissionsApi`.

UI name of the registry: **„Modellanbieter“** (settings section that used to sit under OpenCode). Visible German uses umlauts.

### Provider values after removal

`claude`, `zai`, `codex`, `pi`, `vibe` (plus `plum` where it already exists). Default CLI provider stays `codex`.

### Data migration (inline in `initDatabase()`, idempotent)

- `sessions.cli_provider = 'opencode'` → `'pi'`.
- `user_settings.settings_json`: rename `opencodeProviders` → `modelProviders`; `defaultCliProvider`/`uiProvider` `'opencode'` → `'pi'`; drop `'opencode'` from `enabledCliProviders`; drop the `opencode` key from `cliProviderModels`, `cliProviderModelLists`, `cliProviderReasoning`, `usagePlans` and similar per-provider maps; drop `cliSubagents` entries with `provider = 'opencode'`.

### History stays readable

Historical usage rows with provider `opencode` keep the label „OpenCode“ in analytics only (like Kimi Code). It is never offered as a choice.

## Working rules for this change

- Other sessions edit this repo concurrently. Never revert, overwrite or reformat changes you did not make; use targeted edits; no `git checkout/stash/reset`, no commits.
- Work under `/mnt/cache/appdata/claude-code-webui` (NFS, fast) not `/mnt/user/...`.
- Parity: WebUI and Android ship the same behaviour in this pass.
