#!/bin/bash
# Geekom is the working tier; Unraid's array stores the durable project mirror.
# This never writes to the original Unraid development/deployment directories.
set -Eeuo pipefail
export LC_ALL=C
umask 077
exec 9>/srv/plum/project-writeback.lock
flock -n 9 || exit 0
test -f /srv/plum/local-projects-complete
test -f /srv/plum/projects/geekom-server/README.md
[[ $(stat -f -c %T /srv/plum/projects) != nfs ]]
findmnt -rn -t nfs4 -T /mnt/user >/dev/null
ssh -i /srv/plum/appdata/plum-code-webui/config/ssh/id_ed25519 \
  -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
  root@10.10.10.2 \
  'grep -q '\''^shareUseCache="no"'\'' /boot/config/shares/Backup.cfg && test ! -e /mnt/cache/Backup/Geekom-Plum/projects'
B=/mnt/user/Backup/Geekom-Plum
mkdir -p "$B/projects"
rules=$(mktemp /srv/plum/migration/writeback-excludes.XXXXXX)
trap 'rm -f "$rules"' EXIT
cat /srv/plum/deploy/local-projects-excludes.txt >"$rules"
printf '\n.venv*/\n.pnpm-store/\n' >>"$rules"
while IFS= read -r path; do
  [[ -n "$path" && "$path" != \#* ]] || continue
  printf '/%s\n' "$path" >>"$rules"
done </srv/plum/deploy/local-projects-nas-paths.txt
# Units the mover already placed on the array are symlinks here; the array copy
# is authoritative and must not be replaced by that symlink.
python3 -c 'import json,sys
p="/srv/plum/projects/"
for k in json.load(open(sys.argv[1])):
    if k.startswith(p): print("/"+k[len(p):])' /srv/plum/tiered.json >>"$rules" 2>/dev/null || true
stamp=$(date -u +%Y%m%dT%H%M%SZ)
# Keep the preceding array version of overwritten/deleted files. Never remove
# local working files: existing sessions must retain access after a writeback.
rsync -aH --sparse --delay-updates --delete-delay --backup \
  --backup-dir="$B/project-history/$stamp" --exclude-from="$rules" \
  --stats /srv/plum/projects/ "$B/projects/"
date -Is > /srv/plum/project-writeback-last-success
install -m 600 /srv/plum/project-writeback-last-success "$B/project-writeback-last-success"
echo "Project writeback complete: $B/projects"
# Mover: once a day, move idle units from the Geekom SSD to the array copy.
if [[ ! -e /srv/plum/plum-mover-last-run || -n $(find /srv/plum/plum-mover-last-run -mmin +1380) ]]; then
  touch /srv/plum/plum-mover-last-run
  python3 /srv/plum/deploy/plum-mover.py run || echo "plum-mover failed" >&2
fi
