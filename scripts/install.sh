#!/usr/bin/env bash
# install.sh — interactive installer for Plum Code WebUI.
#
# Walks the operator through: prereq check → .env generation → docker build →
# container start → health check → optional `codex login` for first-time
# Codex auth so the wrapper has a working primary CLI on first launch.
# Other providers (OpenCode and Claude) can be logged in later from the UI.
#
# Re-runnable: existing .env values are kept unless --reset is passed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
ENV_EXAMPLE="${ROOT_DIR}/.env.example"

RESET=0
SKIP_LOGIN=0
NON_INTERACTIVE=0

usage() {
  cat <<USAGE
Usage: $0 [--reset] [--skip-login] [--non-interactive]

Options:
  --reset             Overwrite an existing .env from scratch instead of keeping current values
  --skip-login        Don't prompt for the interactive codex login at the end
  --non-interactive   Take all defaults; fail if a required value (FRONTEND_URL, allowlist email) isn't already set
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reset) RESET=1; shift ;;
    --skip-login) SKIP_LOGIN=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

c_reset=$'\033[0m'
c_bold=$'\033[1m'
c_green=$'\033[32m'
c_yellow=$'\033[33m'
c_red=$'\033[31m'
c_cyan=$'\033[36m'

step() { printf '\n%s==>%s %s%s\n' "$c_cyan" "$c_reset" "$c_bold" "$1$c_reset"; }
ok()   { printf '%s✓%s %s\n' "$c_green" "$c_reset" "$1"; }
warn() { printf '%s!%s %s\n' "$c_yellow" "$c_reset" "$1" >&2; }
die()  { printf '%s✗%s %s\n' "$c_red" "$c_reset" "$1" >&2; exit 1; }

prompt() {
  # prompt VAR PROMPT [DEFAULT]
  local __var="$1" __prompt="$2" __default="${3:-}" __answer=""
  if [[ "$NON_INTERACTIVE" == "1" ]]; then
    if [[ -z "$__default" ]]; then
      die "$__var has no value and --non-interactive is set"
    fi
    printf -v "$__var" '%s' "$__default"
    return
  fi
  if [[ -n "$__default" ]]; then
    printf '%s [%s]: ' "$__prompt" "$__default"
  else
    printf '%s: ' "$__prompt"
  fi
  IFS= read -r __answer || true
  if [[ -z "$__answer" ]]; then __answer="$__default"; fi
  printf -v "$__var" '%s' "$__answer"
}

# --- prereq check ---------------------------------------------------------
step "Checking prerequisites"

command -v docker >/dev/null 2>&1 || die "docker not found in PATH. Install Docker Engine first: https://docs.docker.com/engine/install/"
ok "docker $(docker --version | awk '{print $3}' | tr -d ',')"

if ! docker compose version >/dev/null 2>&1; then
  die "docker compose plugin not found. Install with: https://docs.docker.com/compose/install/"
fi
ok "docker compose $(docker compose version --short)"

if ! command -v openssl >/dev/null 2>&1; then
  die "openssl not found in PATH (needed to generate SESSION_SECRET / JWT_SECRET)"
fi
ok "openssl $(openssl version | awk '{print $2}')"

if ! docker info >/dev/null 2>&1; then
  die "docker daemon not reachable. Run \`docker ps\` and fix connectivity before continuing."
fi
ok "docker daemon reachable"

# --- existing .env handling -----------------------------------------------
declare -A EXISTING_ENV=()
load_existing_env() {
  if [[ -f "$ENV_FILE" && "$RESET" == "0" ]]; then
    while IFS='=' read -r k v; do
      [[ -z "$k" || "$k" =~ ^[[:space:]]*# ]] && continue
      [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
      v="${v%$'\r'}"
      v="${v#\"}"; v="${v%\"}"
      EXISTING_ENV["$k"]="$v"
    done < "$ENV_FILE"
    ok "Found existing .env — keeping current values (use --reset to wipe)"
  fi
}
load_existing_env

get_existing() { printf '%s' "${EXISTING_ENV[$1]:-}"; }

# --- env collection -------------------------------------------------------
step "Configuring .env"

WEBUI_PORT_DEFAULT="$(get_existing WEBUI_PORT)"
WEBUI_PORT_DEFAULT="${WEBUI_PORT_DEFAULT:-4545}"
prompt WEBUI_PORT "Host port to expose the WebUI on" "$WEBUI_PORT_DEFAULT"

FRONTEND_URL_DEFAULT="$(get_existing FRONTEND_URL)"
FRONTEND_URL_DEFAULT="${FRONTEND_URL_DEFAULT:-http://localhost:${WEBUI_PORT}}"
prompt FRONTEND_URL "Public URL the WebUI will be reached at" "$FRONTEND_URL_DEFAULT"

CORS_ORIGINS_DEFAULT="$(get_existing CORS_ALLOWED_ORIGINS)"
CORS_ORIGINS_DEFAULT="${CORS_ORIGINS_DEFAULT:-${FRONTEND_URL}}"
prompt CORS_ALLOWED_ORIGINS "Comma-separated CORS origins" "$CORS_ORIGINS_DEFAULT"

TZ_DEFAULT="$(get_existing TZ)"
TZ_DEFAULT="${TZ_DEFAULT:-$(cat /etc/timezone 2>/dev/null || true)}"
TZ_DEFAULT="${TZ_DEFAULT:-Europe/Zurich}"
prompt TZ "IANA timezone for backend/CLI jobs" "$TZ_DEFAULT"

WEBUI_SHM_SIZE="$(get_existing WEBUI_SHM_SIZE)"
WEBUI_SHM_SIZE="${WEBUI_SHM_SIZE:-1gb}"

# Match docker-compose.yml. A fresh install writing danger-full-access/never
# into .env silently overrode the safer compose defaults for everyone who never
# revisited the file.
CODEX_WEBUI_SANDBOX_MODE="$(get_existing CODEX_WEBUI_SANDBOX_MODE)"
CODEX_WEBUI_SANDBOX_MODE="${CODEX_WEBUI_SANDBOX_MODE:-workspace-write}"

CODEX_WEBUI_APPROVAL_POLICY="$(get_existing CODEX_WEBUI_APPROVAL_POLICY)"
CODEX_WEBUI_APPROVAL_POLICY="${CODEX_WEBUI_APPROVAL_POLICY:-on-request}"

CHROMIUM_WRAPPER_DEFAULT=/usr/local/bin/plum-chromium
CHROME_BIN="$(get_existing CHROME_BIN)"
CHROME_BIN="${CHROME_BIN:-$CHROMIUM_WRAPPER_DEFAULT}"
CHROMIUM_BIN="$(get_existing CHROMIUM_BIN)"
CHROMIUM_BIN="${CHROMIUM_BIN:-$CHROMIUM_WRAPPER_DEFAULT}"
CHROMIUM_PATH="$(get_existing CHROMIUM_PATH)"
CHROMIUM_PATH="${CHROMIUM_PATH:-$CHROMIUM_WRAPPER_DEFAULT}"
BROWSER="$(get_existing BROWSER)"
BROWSER="${BROWSER:-$CHROMIUM_WRAPPER_DEFAULT}"
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$(get_existing PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)"
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-$CHROMIUM_WRAPPER_DEFAULT}"
PUPPETEER_EXECUTABLE_PATH="$(get_existing PUPPETEER_EXECUTABLE_PATH)"
PUPPETEER_EXECUTABLE_PATH="${PUPPETEER_EXECUTABLE_PATH:-$CHROMIUM_WRAPPER_DEFAULT}"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD="$(get_existing PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD)"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD="${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-1}"
PUPPETEER_SKIP_DOWNLOAD="$(get_existing PUPPETEER_SKIP_DOWNLOAD)"
PUPPETEER_SKIP_DOWNLOAD="${PUPPETEER_SKIP_DOWNLOAD:-1}"
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="$(get_existing PUPPETEER_SKIP_CHROMIUM_DOWNLOAD)"
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="${PUPPETEER_SKIP_CHROMIUM_DOWNLOAD:-1}"

ALLOWED_EMAILS_DEFAULT="$(get_existing AUTH_ALLOWED_EMAILS)"
if [[ -z "$ALLOWED_EMAILS_DEFAULT" ]]; then
  warn "AUTH_ALLOWED_EMAILS is empty — leaving it that way means anyone with valid OAuth can sign in."
  warn "For a public deployment, list the operator email(s) here, comma-separated."
fi
prompt AUTH_ALLOWED_EMAILS "Allowed login emails (comma-separated, empty = no allowlist)" "$ALLOWED_EMAILS_DEFAULT"

SEED_ADMIN_DEFAULT="$(get_existing SEED_ADMIN_EMAIL)"
if [[ -z "$SEED_ADMIN_DEFAULT" && -n "$AUTH_ALLOWED_EMAILS" ]]; then
  SEED_ADMIN_DEFAULT="${AUTH_ALLOWED_EMAILS%%,*}"
fi
prompt SEED_ADMIN_EMAIL "Bootstrap admin email (gets role=admin on first login)" "$SEED_ADMIN_DEFAULT"

WORKSPACE_DEFAULT="$(get_existing WORKSPACE_DIR)"
WORKSPACE_DEFAULT="${WORKSPACE_DEFAULT:-./workspace}"
prompt WORKSPACE_DIR "Host path mounted to /workspace inside the container" "$WORKSPACE_DEFAULT"

DATA_DIR_DEFAULT="$(get_existing DATA_DIR)"
DATA_DIR_DEFAULT="${DATA_DIR_DEFAULT:-./data}"
prompt DATA_DIR "Host path for SQLite DB and generated files" "$DATA_DIR_DEFAULT"

CONFIG_DIR_DEFAULT="$(get_existing CONFIG_DIR)"
CONFIG_DIR_DEFAULT="${CONFIG_DIR_DEFAULT:-./config}"
prompt CONFIG_DIR "Host path for per-harness config (claude, codex, opencode, pi, kimi)" "$CONFIG_DIR_DEFAULT"

SESSION_SECRET="$(get_existing SESSION_SECRET)"
if [[ -z "$SESSION_SECRET" ]]; then
  SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  ok "Generated SESSION_SECRET"
else
  ok "Keeping existing SESSION_SECRET"
fi

JWT_SECRET="$(get_existing JWT_SECRET)"
if [[ -z "$JWT_SECRET" ]]; then
  JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  ok "Generated JWT_SECRET"
else
  ok "Keeping existing JWT_SECRET"
fi

# docker-compose.yml hard-requires this (PGPASSWORD=${POSTGRES_PASSWORD:?...}),
# so an .env without it makes every `docker compose up` fail before it starts.
POSTGRES_PASSWORD="$(get_existing POSTGRES_PASSWORD)"
if [[ -z "$POSTGRES_PASSWORD" ]]; then
  # No base64: the value is interpolated into compose and psql URLs, and "/" or
  # "+" in a password is a reliable source of confusing connection failures.
  POSTGRES_PASSWORD="$(openssl rand -hex 32)"
  ok "Generated POSTGRES_PASSWORD"
else
  ok "Keeping existing POSTGRES_PASSWORD"
fi

# Encrypts stored provider credentials. It must exist and must never change
# afterwards, or the Z.AI token and provider API keys become undecryptable.
ENCRYPTION_KEY="$(get_existing ENCRYPTION_KEY)"
if [[ -z "$ENCRYPTION_KEY" ]]; then
  ENCRYPTION_KEY="$(openssl rand -base64 48 | tr -d '\n')"
  ok "Generated ENCRYPTION_KEY"
else
  ok "Keeping existing ENCRYPTION_KEY"
fi

# --- write .env -----------------------------------------------------------
step "Writing $ENV_FILE"

umask 077
cat > "$ENV_FILE" <<ENV
# Generated by scripts/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Edit by hand or re-run: ./scripts/install.sh

WEBUI_PORT=${WEBUI_PORT}
FRONTEND_URL=${FRONTEND_URL}
CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS}
TZ=${TZ}
WEBUI_SHM_SIZE=${WEBUI_SHM_SIZE}
CODEX_WEBUI_SANDBOX_MODE=${CODEX_WEBUI_SANDBOX_MODE}
CODEX_WEBUI_APPROVAL_POLICY=${CODEX_WEBUI_APPROVAL_POLICY}
CHROME_BIN=${CHROME_BIN}
CHROMIUM_BIN=${CHROMIUM_BIN}
CHROMIUM_PATH=${CHROMIUM_PATH}
BROWSER=${BROWSER}
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}
PUPPETEER_EXECUTABLE_PATH=${PUPPETEER_EXECUTABLE_PATH}
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD}
PUPPETEER_SKIP_DOWNLOAD=${PUPPETEER_SKIP_DOWNLOAD}
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=${PUPPETEER_SKIP_CHROMIUM_DOWNLOAD}
AUTH_ALLOWED_EMAILS=${AUTH_ALLOWED_EMAILS}
SEED_ADMIN_EMAIL=${SEED_ADMIN_EMAIL}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

WORKSPACE_DIR=${WORKSPACE_DIR}
DATA_DIR=${DATA_DIR}
CONFIG_DIR=${CONFIG_DIR}
ALLOWED_BASE_PATHS=${EXISTING_ENV[ALLOWED_BASE_PATHS]:-/workspace}

SESSION_SECRET=${SESSION_SECRET}
JWT_SECRET=${JWT_SECRET}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# Optional: CLI providers and integrations
CLI_PROVIDER_CLAUDE_MODELS=$(get_existing CLI_PROVIDER_CLAUDE_MODELS)
CLI_PROVIDER_CLAUDE_DEFAULT_MODEL=${EXISTING_ENV[CLI_PROVIDER_CLAUDE_DEFAULT_MODEL]:-sonnet}
CLI_PROVIDER_CODEX_MODELS=$(get_existing CLI_PROVIDER_CODEX_MODELS)
CLI_PROVIDER_CODEX_DEFAULT_MODEL=${EXISTING_ENV[CLI_PROVIDER_CODEX_DEFAULT_MODEL]:-gpt-5.5}
CLI_PROVIDER_OPENCODE_MODELS=$(get_existing CLI_PROVIDER_OPENCODE_MODELS)
CLI_PROVIDER_OPENCODE_DEFAULT_MODEL=${EXISTING_ENV[CLI_PROVIDER_OPENCODE_DEFAULT_MODEL]:-z-ai/glm-5.1}
CLI_PROVIDER_PI_MODELS=$(get_existing CLI_PROVIDER_PI_MODELS)
CLI_PROVIDER_PI_DEFAULT_MODEL=${EXISTING_ENV[CLI_PROVIDER_PI_DEFAULT_MODEL]:-z-ai/glm-5.1}
OPENCODE_ZAI_VISION_MCP=${EXISTING_ENV[OPENCODE_ZAI_VISION_MCP]:-auto}
ADMIN_LLM_PROVIDER=$(get_existing ADMIN_LLM_PROVIDER)
OPENCODE_DEBUG_EVENTS=${EXISTING_ENV[OPENCODE_DEBUG_EVENTS]:-0}
CODEX_USAGE_URL=$(get_existing CODEX_USAGE_URL)
CODEX_USER_AGENT=$(get_existing CODEX_USER_AGENT)
COMFYUI_URL=$(get_existing COMFYUI_URL)
OPENAI_API_KEY=$(get_existing OPENAI_API_KEY)
GODOT_BIN=$(get_existing GODOT_BIN)
GODOT_TIMEOUT_MS=${EXISTING_ENV[GODOT_TIMEOUT_MS]:-120000}
BLENDER_BIN=${EXISTING_ENV[BLENDER_BIN]:-blender-headless}
BLENDER_TIMEOUT_MS=${EXISTING_ENV[BLENDER_TIMEOUT_MS]:-300000}
ORACLE_MCP_DEFAULT_ENGINE=${EXISTING_ENV[ORACLE_MCP_DEFAULT_ENGINE]:-browser}
ORACLE_BROWSER_MODEL=${EXISTING_ENV[ORACLE_BROWSER_MODEL]:-gpt-5.5-pro}
ORACLE_BROWSER_MODEL_STRATEGY=${EXISTING_ENV[ORACLE_BROWSER_MODEL_STRATEGY]:-current}
ORACLE_BROWSER_THINKING_TIME=${EXISTING_ENV[ORACLE_BROWSER_THINKING_TIME]:-}
ORACLE_MCP_BROWSER_TIMEOUT=${EXISTING_ENV[ORACLE_MCP_BROWSER_TIMEOUT]:-8m}
PREVIEW_HOSTNAME=$(get_existing PREVIEW_HOSTNAME)

# Optional: OAuth providers — fill in to enable
GITHUB_CLIENT_ID=$(get_existing GITHUB_CLIENT_ID)
GITHUB_CLIENT_SECRET=$(get_existing GITHUB_CLIENT_SECRET)
GITHUB_CALLBACK_URL=$(get_existing GITHUB_CALLBACK_URL)
GOOGLE_CLIENT_ID=$(get_existing GOOGLE_CLIENT_ID)
GOOGLE_CLIENT_SECRET=$(get_existing GOOGLE_CLIENT_SECRET)
GOOGLE_CALLBACK_URL=$(get_existing GOOGLE_CALLBACK_URL)
ENV

# Carry over anything this script does not know about. Re-running the installer
# used to silently drop keys added by hand or by a newer compose file
# (DOCKER_PROXY_*, REPAIR_BOT_*, WEBUI_SKILLS_DIRS, ...), which turned a routine
# re-run into a broken deployment.
preserved=0
for key in "${!EXISTING_ENV[@]}"; do
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    if [[ $preserved -eq 0 ]]; then
      printf '\n# Preserved from the previous .env (not managed by install.sh)\n' >> "$ENV_FILE"
      preserved=1
    fi
    printf '%s=%s\n' "$key" "${EXISTING_ENV[$key]}" >> "$ENV_FILE"
  fi
done
if [[ $preserved -eq 1 ]]; then
  ok "Preserved additional keys from the previous .env"
fi

ok "Wrote .env (mode 600)"

# --- create host dirs the compose volumes will need -----------------------
step "Creating host directories"
mkdir -p \
  "${DATA_DIR}" \
  "${CONFIG_DIR}/claude" \
  "${CONFIG_DIR}/codex" \
  "${CONFIG_DIR}/opencode" \
  "${CONFIG_DIR}/pi" \
  "${CONFIG_DIR}/kimi" \
  "${CONFIG_DIR}/npm-global" \
  "${WORKSPACE_DIR}"
# In-container node user is uid 1000 — ensure it can write to the config dirs.
# Best-effort chown; fails harmlessly on hosts where the current user can't sudo.
chown -R 1000:1000 "${CONFIG_DIR}" "${DATA_DIR}" 2>/dev/null || \
  sudo chown -R 1000:1000 "${CONFIG_DIR}" "${DATA_DIR}" 2>/dev/null || \
  true
ok "Directories ready"

# --- build & start --------------------------------------------------------
step "Building image (this can take several minutes on first run)"
( cd "$ROOT_DIR" && docker compose build claude-code-webui )
ok "Build complete"

step "Starting container"
( cd "$ROOT_DIR" && docker compose up -d claude-code-webui )

# --- health wait ----------------------------------------------------------
step "Waiting for /health"
container_id="$(cd "$ROOT_DIR" && docker compose ps -q claude-code-webui)"
if [[ -z "$container_id" ]]; then die "claude-code-webui container did not start"; fi

healthy=0
for _ in $(seq 1 60); do
  status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo none)"
  if [[ "$status" == "healthy" ]]; then healthy=1; break; fi
  if [[ "$status" == "none" ]]; then
    # No healthcheck configured — fall back to plain HTTP check
    if curl -fsS "http://127.0.0.1:${WEBUI_PORT}/health" >/dev/null 2>&1; then healthy=1; break; fi
  fi
  sleep 2
done

if [[ "$healthy" != "1" ]]; then
  warn "Container didn't report healthy within 120s. Check logs: docker compose logs -f claude-code-webui"
else
  ok "WebUI is healthy at ${FRONTEND_URL}"
fi

# --- codex login (primary provider) ---------------------------------------
if [[ "$SKIP_LOGIN" == "0" && "$NON_INTERACTIVE" == "0" ]]; then
  step "Codex CLI first-time login (primary provider)"
  cat <<NOTE
Codex is the default provider in the WebUI. The CLI inside the container needs
to be linked to your OpenAI account once. This will run \`codex login\` in your
terminal — follow the OAuth prompts.

Other providers (OpenCode and Claude) can be authenticated later
from the WebUI Settings page, or from the container shell:
  docker exec -it claude-code-webui opencode auth login
  docker exec -it claude-code-webui pi /login
  docker exec -it claude-code-webui claude   # then type /login

NOTE
  printf 'Run codex login now? [Y/n]: '
  IFS= read -r run_login || run_login=""
  case "${run_login,,}" in
    n|no) warn "Skipped — run \`docker exec -it claude-code-webui codex login\` later" ;;
    *)
      if ! docker exec -it claude-code-webui codex login 2>/dev/null; then
        warn "Couldn't attach to codex CLI. Try manually: docker exec -it claude-code-webui codex login"
      fi
      ;;
  esac
fi

# --- summary --------------------------------------------------------------
step "Done"
cat <<SUMMARY
${c_bold}Plum Code WebUI is up.${c_reset}

  URL:            ${c_green}${FRONTEND_URL}${c_reset}
  Container:      claude-code-webui (port ${WEBUI_PORT})
  Allowed emails: ${AUTH_ALLOWED_EMAILS:-<none — open signup>}
  Admin seed:     ${SEED_ADMIN_EMAIL:-<unset>}

Default CLI provider: ${c_bold}codex${c_reset} (Anthropic restricting claude -p; codex is the new primary)

Useful commands:
  docker compose logs -f claude-code-webui
  docker compose restart claude-code-webui
  docker exec -it claude-code-webui codex           # primary: Codex CLI
  docker exec -it claude-code-webui opencode        # OpenCode CLI (75+ LLMs)
  docker exec -it claude-code-webui pi              # Pi harness (shares OpenCode connections in WebUI)
  docker exec -it claude-code-webui claude          # legacy: Claude CLI

To re-run the installer (preserves existing .env): ./scripts/install.sh
To start over from scratch:                       ./scripts/install.sh --reset
SUMMARY
