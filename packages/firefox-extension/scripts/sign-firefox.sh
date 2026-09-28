#!/usr/bin/env bash
# Build the Firefox extension, sign it on AMO (unlisted, not published) and
# put the signed .xpi where Plum serves it from. Credentials come from
# packages/backend/data/firefox/amo.env (AMO_JWT_ISSUER / AMO_JWT_SECRET).
# Bump "version" in both manifests first: AMO signs each version only once.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
data="${PLUM_DATA_DIR:-$here/../backend/data}/firefox"
set -a; . "$data/amo.env"; set +a

node "$here/scripts/build.mjs"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/src" "$work/out"
(cd "$work/src" && unzip -q "$here/dist/plum-browser-firefox.xpi")
npx --yes web-ext@latest sign --channel=unlisted --source-dir "$work/src" \
  --artifacts-dir "$work/out" --api-key="$AMO_JWT_ISSUER" --api-secret="$AMO_JWT_SECRET" \
  --approval-timeout 840000
cp "$work"/out/*.xpi "$data/plum-browser-firefox.xpi"
echo "Signed: $data/plum-browser-firefox.xpi"
