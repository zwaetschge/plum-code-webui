#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env file if present (supports KEY=value format)
load_env() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    echo "Loading $env_file..."
    while IFS= read -r line || [[ -n "$line" ]]; do
      # Skip comments and empty lines
      [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
      # Export valid KEY=value pairs
      if [[ "$line" =~ ^[a-zA-Z_][a-zA-Z0-9_]*= ]]; then
        export "$line"
      fi
    done < "$env_file"
  fi
}

# Load root .env files (later files override earlier)
load_env "${ROOT_DIR}/.env"
load_env "${ROOT_DIR}/.env.local"

# Parse arguments (env vars override defaults, CLI args override env vars)
HOST="${HOST:-localhost}"
UI_PORT="${UI_PORT:-5173}"
PORT="${PORT:-3006}"
while [[ $# -gt 0 ]]; do
  case $1 in
    --host)
      HOST="$2"
      shift 2
      ;;
    --host=*)
      HOST="${1#*=}"
      shift
      ;;
    --ui-port)
      UI_PORT="$2"
      shift 2
      ;;
    --ui-port=*)
      UI_PORT="${1#*=}"
      shift
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --port=*)
      PORT="${1#*=}"
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--host <host>] [--ui-port <port>] [--port <port>]" >&2
      exit 1
      ;;
  esac
done

LOG_DIR="${ROOT_DIR}/.logs"
PID_DIR="${ROOT_DIR}/.pids"

mkdir -p "$LOG_DIR" "$PID_DIR"

# Kill existing processes if running
kill_if_running() {
  local pid_file="$1"
  local name="$2"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping existing $name (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1
      # Force kill if still running
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
    rm -f "$pid_file"
  fi
}

kill_if_running "${PID_DIR}/backend.pid" "backend"
kill_if_running "${PID_DIR}/frontend.pid" "frontend"

PNPM_BIN="$(command -v pnpm || true)"
if [[ -z "$PNPM_BIN" && -x "${ROOT_DIR}/node_modules/.bin/pnpm" ]]; then
  PNPM_BIN="${ROOT_DIR}/node_modules/.bin/pnpm"
fi

if [[ -z "$PNPM_BIN" ]]; then
  echo "pnpm not found. Install it or run: npm install -D pnpm" >&2
  exit 1
fi

if [[ ! -d "${ROOT_DIR}/node_modules" ]]; then
  echo "Installing workspace dependencies..."
  "$PNPM_BIN" install
fi

generate_secret() {
  # The container image ships python3 and openssl but no `python` alias, and
  # this script runs under `set -euo pipefail`, so calling `python` aborted the
  # start before the backend was ever launched.
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PYSECRET'
import secrets
print(secrets.token_hex(16))
PYSECRET
  elif command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 16
  else
    echo "Neither python3 nor openssl is available to generate a secret." >&2
    return 1
  fi
}

if [[ -z "${SESSION_SECRET:-}" ]]; then
  SESSION_SECRET="$(generate_secret)"
  export SESSION_SECRET
  echo "SESSION_SECRET not set; generated a temporary one for this session."
fi

if [[ -z "${JWT_SECRET:-}" ]]; then
  JWT_SECRET="$(generate_secret)"
  export JWT_SECRET
  echo "JWT_SECRET not set; generated a temporary one for this session."
fi

export FRONTEND_URL="${FRONTEND_URL:-http://${HOST}:${UI_PORT}}"

echo "Starting backend on port ${PORT}..."
PORT="$PORT" "$PNPM_BIN" -C packages/backend run dev > "${LOG_DIR}/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "${PID_DIR}/backend.pid"

echo "Starting frontend on ${HOST}:${UI_PORT}..."
BACKEND_PORT="$PORT" VITE_PORT="$UI_PORT" VITE_HOST="$HOST" "$PNPM_BIN" -C packages/frontend run dev > "${LOG_DIR}/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "${PID_DIR}/frontend.pid"

cat <<EOF
WebUI started.
- Backend:  http://localhost:${PORT} (PID $BACKEND_PID)
- Frontend: http://${HOST}:${UI_PORT} (PID $FRONTEND_PID)

Open: http://${HOST}:${UI_PORT}

Tailing logs (Ctrl+C to stop)...
EOF

# Tail both logs, exit when either process dies
tail -f "${LOG_DIR}/backend.log" "${LOG_DIR}/frontend.log" &
TAIL_PID=$!

# Cleanup on exit
cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$TAIL_PID" 2>/dev/null || true
  kill "$BACKEND_PID" 2>/dev/null || true
  kill "$FRONTEND_PID" 2>/dev/null || true
  rm -f "${PID_DIR}/backend.pid" "${PID_DIR}/frontend.pid"
  exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for processes, exit if either dies
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done

cleanup
