#!/usr/bin/env sh
set -eu

real_chromium="${PLUM_REAL_CHROMIUM:-}"
if [ -z "$real_chromium" ]; then
  for candidate in \
    /usr/bin/chromium-browser \
    /usr/bin/chromium \
    /usr/lib/chromium/chromium \
    /usr/lib/chromium/chrome; do
    if [ -x "$candidate" ]; then
      real_chromium="$candidate"
      break
    fi
  done
fi

if [ -z "$real_chromium" ] || [ ! -x "$real_chromium" ]; then
  echo "chromium-webui: system Chromium is not installed or not executable" >&2
  exit 127
fi

has_user_data_dir=0
has_headless=0
has_no_sandbox=0
has_disable_dev_shm=0

for arg in "$@"; do
  case "$arg" in
    --user-data-dir | --user-data-dir=*) has_user_data_dir=1 ;;
    --headless | --headless=*) has_headless=1 ;;
    --no-sandbox) has_no_sandbox=1 ;;
    --disable-dev-shm-usage) has_disable_dev_shm=1 ;;
  esac
done

extra_args=""

if [ "$has_no_sandbox" -eq 0 ]; then
  extra_args="$extra_args --no-sandbox --disable-setuid-sandbox"
fi

if [ "$has_disable_dev_shm" -eq 0 ]; then
  extra_args="$extra_args --disable-dev-shm-usage"
fi

extra_args="$extra_args --no-first-run --no-default-browser-check"

case "${PLUM_CHROMIUM_DISABLE_BACKGROUND_NETWORKING:-}" in
  1|true|TRUE|yes|YES|on|ON)
    extra_args="$extra_args --disable-background-networking"
    ;;
esac

if [ "$has_user_data_dir" -eq 0 ]; then
  if [ -n "${CHROMIUM_USER_DATA_DIR:-}" ]; then
    user_data_dir="$CHROMIUM_USER_DATA_DIR"
    mkdir -p "$user_data_dir"
  else
    user_data_dir="$(mktemp -d /tmp/plum-chromium.XXXXXX)"
    # Only the generated profile is ours to delete; a caller-supplied
    # CHROMIUM_USER_DATA_DIR is expected to persist between runs.
    trap 'rm -rf "$user_data_dir"' EXIT INT TERM
  fi
  extra_args="$extra_args --user-data-dir=$user_data_dir"
fi

if [ "$has_headless" -eq 0 ] && [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  extra_args="$extra_args --headless=new"
fi

exec "$real_chromium" $extra_args "$@"
