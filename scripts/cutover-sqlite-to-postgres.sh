#!/usr/bin/env bash
# One-shot cutover: copy the SQLite database and load it into Postgres.
#
# Run this AFTER the WebUI container has been replaced with a Postgres build.
# By then nothing writes to the SQLite file any more, which is the only state in
# which a copy of it is provably consistent — a second process reading a live
# WAL database through a different mount view is what truncated it on
# 2026-08-26.
#
# It refuses to run while a writer is present, copies the database and its WAL
# sidecars, checkpoints the copy, imports it, and verifies row counts, the
# ordering column and the search index before reporting success.
#
#   bash scripts/cutover-sqlite-to-postgres.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${PROJECT_DIR}/data/claude-webui.db"
STAGE_DIR="${PROJECT_DIR}/data/cutover-$(date +%Y%m%d-%H%M%S)"
COPY="${STAGE_DIR}/claude-webui.db"

cd "$PROJECT_DIR"

[ -f "$SOURCE" ] || { echo "FEHLER: $SOURCE fehlt."; exit 1; }

# Loading from underneath a live writer is the exact mistake this whole exercise
# exists to avoid. A -shm file is NOT proof of one: SQLite removes it only on a
# clean close of the last connection, so it survives a killed container and an
# earlier version of this guard refused to run for twenty minutes because of a
# leftover. An open descriptor is the real evidence.
if ls -l /proc/*/fd/* 2>/dev/null | grep -q "$(basename "$SOURCE")"; then
  echo "FEHLER: ein Prozess hält $SOURCE offen."
  echo "        Erst den alten Container ersetzen lassen, dann erneut ausführen."
  exit 1
fi
if [ -e "${SOURCE}-shm" ]; then
  echo "Hinweis: ${SOURCE}-shm liegt noch da, aber niemand hat die Datei offen —"
  echo "         Überbleibsel eines harten Stopps. Der Checkpoint unten räumt es weg."
fi

mkdir -p "$STAGE_DIR"
cp "$SOURCE" "$COPY"
[ -e "${SOURCE}-wal" ] && cp "${SOURCE}-wal" "${COPY}-wal"
echo "Kopie: $COPY"

# Read-write open so the WAL is checkpointed into the copy before it is read.
node --input-type=module -e "
import Database from './packages/backend/node_modules/better-sqlite3/lib/index.js';
const db = new Database('${COPY}', { fileMustExist: true });
db.pragma('wal_checkpoint(TRUNCATE)');
const verdict = db.pragma('quick_check', { simple: true });
if (verdict !== 'ok') { console.error('quick_check:', verdict); process.exit(1); }
console.log('quick_check: ok,', db.prepare('SELECT COUNT(*) c FROM messages').get().c, 'Nachrichten');
db.close();
"

node scripts/sqlite-to-postgres.mjs --source "$COPY"
node scripts/verify-postgres-migration.mjs --source "$COPY"

echo
echo "Fertig. Die Kopie bleibt unter $STAGE_DIR als Beleg liegen."
