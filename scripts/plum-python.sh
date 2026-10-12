#!/bin/sh
# Python with Plum's media/document toolkit (pymupdf, edge-tts, Pillow,
# Playwright) for skills such as Papermorph. Playwright has no musl wheel, so
# the image installs the manylinux one and points it at the system Node and at
# Plum's Chromium (see the plum-python block in the Dockerfile). Scoped to this
# wrapper so Node Playwright in user projects keeps its own browser cache.
export PLAYWRIGHT_NODEJS_PATH="${PLAYWRIGHT_NODEJS_PATH:-/usr/local/bin/node}"
export PLAYWRIGHT_BROWSERS_PATH=/opt/plum-python/playwright-browsers
exec /opt/plum-python/bin/python "$@"
