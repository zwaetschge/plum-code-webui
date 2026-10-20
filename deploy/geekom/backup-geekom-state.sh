#!/bin/bash
# Essential Plum state to the existing array-only Unraid Backup share.
set -Eeuo pipefail
umask 077
exec 9>/srv/plum/backup-state.lock
flock -n 9 || exit 0
findmnt -rn -t nfs4 -T /mnt/user >/dev/null
B=/mnt/user/Backup/Geekom-Plum
mkdir -p "$B/database" "$B/state"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
tmp=/srv/plum/migration/backup-$stamp.dump
trap 'rm -f "$tmp"' EXIT
docker exec plum-postgres pg_dump -U plumcode -d plumcode -n public -Fc >"$tmp"
docker exec -i plum-postgres pg_restore --list <"$tmp" >/dev/null
install -m 600 "$tmp" "$B/database/$stamp.dump"
rsync -a --exclude=backups/ --exclude=node_modules/ --exclude=.cache/ --exclude=.npm/ /srv/plum/appdata/plum-code-webui/data/ "$B/state/data/"
# Codex sessions/images moved by plum-mover already live on the array.
moved=$(mktemp /srv/plum/migration/state-moved.XXXXXX)
trap 'rm -f "$tmp" "$moved"' EXIT
python3 -c 'import json,sys
p="/srv/plum/appdata/plum-code-webui/config/"
for k in json.load(open(sys.argv[1])):
    if k.startswith(p): print("/"+k[len(p):])' /srv/plum/tiered.json >"$moved" 2>/dev/null || true
rsync -a --exclude=node_modules/ --exclude=.cache/ --exclude=.npm/ --exclude-from="$moved" /srv/plum/appdata/plum-code-webui/config/ "$B/state/config/"
rsync -a /srv/plum/deploy/ "$B/state/deploy/"
install -m 600 /srv/plum/appdata/plum-code-webui/.env "$B/state/plum.env"
echo "Backup complete: $B, database $stamp"
