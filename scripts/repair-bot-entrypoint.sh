#!/bin/bash
#
# Repair Bot Entrypoint
# Syncs auth from main WebUI, runs rebuild watcher + WebUI.
#

set -e

echo "========================================"
echo "  Repair Bot - WebUI + Rebuild Watcher"
echo "========================================"

WATCHER_PID=""
WEBUI_PID=""

# The repair WebUI shares the main provider config for emergency access, but
# the main WebUI must remain the single owner of external skill imports.
export WEBUI_EXTERNAL_SKILL_SYNC="${WEBUI_EXTERNAL_SKILL_SYNC:-false}"

cleanup() {
    echo "[repair-bot] Shutting down..."
    if [ -n "$WATCHER_PID" ] && kill -0 "$WATCHER_PID" 2>/dev/null; then
        kill "$WATCHER_PID" 2>/dev/null
        wait "$WATCHER_PID" 2>/dev/null || true
    fi
    if [ -n "$WEBUI_PID" ] && kill -0 "$WEBUI_PID" 2>/dev/null; then
        kill "$WEBUI_PID" 2>/dev/null
        wait "$WEBUI_PID" 2>/dev/null || true
    fi
    exit 0
}
trap cleanup SIGTERM SIGINT

# Sync auth credentials and sessions from main WebUI database
echo "[repair-bot] Syncing from main WebUI..."
cd /app && node /webui/scripts/sync-auth-from-main.mjs || echo "[repair-bot] Sync skipped"
cd /app

# Start rebuild-robot watcher in background
if [ -f "/webui/scripts/rebuild-robot-sidecar.sh" ]; then
    echo "[repair-bot] Starting rebuild watcher..."
    # Restart the watcher if it ever exits: without it the repair-bot keeps
    # answering health checks while silently ignoring every rebuild trigger,
    # which looks exactly like a healthy robot from the outside.
    (
        while true; do
            sh /webui/scripts/rebuild-robot-sidecar.sh || true
            echo "[repair-bot] WARNING: rebuild watcher exited, restarting in 10s" >&2
            sleep 10
        done
    ) &
    WATCHER_PID=$!
    echo "[repair-bot] Watcher started (PID: $WATCHER_PID)"
else
    echo "[repair-bot] WARNING: Sidecar script not found at /webui/scripts/rebuild-robot-sidecar.sh"
fi

# Start WebUI
echo "[repair-bot] Starting WebUI..."
if [ -f /app/packages/backend/dist/index.js ]; then
    node /app/packages/backend/dist/index.js &
elif [ -x /app/packages/backend/node_modules/.bin/tsx ] && [ -f /app/packages/backend/src/index.ts ]; then
    # One-release compatibility path: lets the existing sidecar reload the new
    # watcher before the first slim/compiled image has been built.
    /app/packages/backend/node_modules/.bin/tsx /app/packages/backend/src/index.ts &
else
    echo "[repair-bot] ERROR: no compiled backend or legacy tsx source runtime found" >&2
    exit 1
fi
WEBUI_PID=$!

wait "$WEBUI_PID"
