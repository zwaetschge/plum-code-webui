#!/bin/sh
#
# Rebuild Robot Sidecar - runs as a Docker Compose sidecar container
# Watches for rebuild triggers and rebuilds the main container from outside.
#
# This script is POSIX sh compatible (no bash required).
#

# -u as well as -e: this script runs unattended, and a typo'd variable name
# silently expanding to the empty string is how a rebuild ends up stopping the
# wrong service or writing a status file nobody can parse.
set -eu

WEBUI_DIR="/webui"
COMPOSE_FILE="${WEBUI_DIR}/docker-compose.yml"
OVERRIDE_FILE="${WEBUI_DIR}/docker-compose.override.yml"
TRIGGER_FILE="${WEBUI_DIR}/data/rebuild-trigger.json"
STATUS_FILE="${WEBUI_DIR}/data/rebuild-robot-status.json"
REPORT_FILE="${WEBUI_DIR}/REBUILD_ROBOT_REPORT.md"
LOG_FILE="${WEBUI_DIR}/data/rebuild-robot.log"
LOCK_FILE="/tmp/rebuild-robot.lock"

MAIN_SERVICE="claude-code-webui"
DOCKER_PROXY_SERVICE="${REBUILD_DOCKER_PROXY_SERVICE:-docker-socket-proxy}"
# Project name must match the original compose project (derived from the host directory name).
# Inside the repair-bot container, the compose file is at /webui/ which would derive project "webui",
# but the actual containers run under project "claude-code-webui".
COMPOSE_PROJECT="claude-code-webui"
POLL_INTERVAL=5
HEARTBEAT_INTERVAL=10
READINESS_ATTEMPTS="${REBUILD_READINESS_ATTEMPTS:-36}"
READINESS_INTERVAL="${REBUILD_READINESS_INTERVAL_SECONDS:-5}"
ROBOT_VERSION="2.3-sidecar"

PREVIOUS_CONTAINER_ID=""
PREVIOUS_IMAGE_ID=""
TARGET_IMAGE_REF=""
CANDIDATE_IMAGE_ID=""
ROLLBACK_IMAGE_REF=""
ROLLBACK_RESULT="not-required"
ROLLBACK_HEALTH_OVERRIDE="/tmp/rebuild-robot-rollback-health-$$.yml"

# Compose `-f` flag set. The override file is gitignored and site-specific
# (Traefik labels, Unraid absolute mounts, repair-bot sidecar, etc.). When
# you pass `-f` explicitly, Compose disables auto-discovery of override.yml
# — so we must list both files here, otherwise the rebuilt container comes
# up with portable defaults (relative ./data, ./config, no Traefik routes).
# Build the flag set lazily so a fresh self-host without an override still
# works.
compose_files_flags() {
  if [ -f "$OVERRIDE_FILE" ]; then
    printf -- '-f %s -f %s' "$COMPOSE_FILE" "$OVERRIDE_FILE"
  else
    printf -- '-f %s' "$COMPOSE_FILE"
  fi
}

# Timestamp helper
timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

iso_timestamp() {
  date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z'
}

log() {
  printf '%s [%s] %s\n' "$(timestamp)" "$1" "$2" | tee -a "$LOG_FILE"
}

log_info()    { log "INFO"    "$1"; }
log_warn()    { log "WARN"    "$1"; }
log_error()   { log "ERROR"   "$1"; }
log_success() { log "SUCCESS" "$1"; }

# Write JSON status file (also serves as heartbeat)
write_status() {
  _status="$1"
  _message="$2"
  _phase="$3"
  # plum-rebuild.sh polls this file every second. A plain redirect truncates it
  # first, so the poller can read an empty or half-written document and treat a
  # healthy rebuild as malformed. Write to a temp file in the same directory and
  # rename it into place, which is atomic on the same filesystem.
  _status_tmp="${STATUS_FILE}.tmp.$$"
  cat > "$_status_tmp" << EOF
{
  "status": "${_status}",
  "message": "${_message}",
  "phase": "${_phase}",
  "timestamp": "$(iso_timestamp)",
  "robot_version": "${ROBOT_VERSION}",
  "container": true
}
EOF
  mv -f "$_status_tmp" "$STATUS_FILE"
}

# Write markdown report
write_report() {
  _status="$1"
  _start="$2"
  _end="$3"
  _build_output="$4"
  _error="$5"

  _duration=$(( _end - _start ))

  if [ "$_status" = "success" ]; then
    _emoji="✅"
    _text="ERFOLGREICH"
  else
    _emoji="❌"
    _text="FEHLGESCHLAGEN"
  fi

  cat > "$REPORT_FILE" << EOF
# Rebuild Robot Report

## Status: ${_emoji} ${_text}

| Feld | Wert |
|------|------|
| Gestartet | $(date -d "@${_start}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r "${_start}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "${_start}") |
| Beendet | $(date -d "@${_end}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r "${_end}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "${_end}") |
| Dauer | ${_duration} Sekunden |
| Robot Version | ${ROBOT_VERSION} |
| Modus | Docker Compose Sidecar |
| Vorheriges Image | ${PREVIOUS_IMAGE_ID:-nicht verfügbar} |
| Kandidaten-Image | ${CANDIDATE_IMAGE_ID:-nicht verfügbar} |
| Rollback | ${ROLLBACK_RESULT} |

## Phasen

### Phase 1: Build
\`\`\`
docker compose $(compose_files_flags) -p ${COMPOSE_PROJECT} build ${MAIN_SERVICE}
\`\`\`

### Phase 2: Container Stop
\`\`\`
docker compose $(compose_files_flags) -p ${COMPOSE_PROJECT} stop ${MAIN_SERVICE}
\`\`\`

### Phase 3: Container Start
\`\`\`
docker compose $(compose_files_flags) -p ${COMPOSE_PROJECT} up -d ${MAIN_SERVICE}
\`\`\`

### Phase 4: Candidate Readiness
\`\`\`
GET /health/ready + Docker-Healthstatus + Image-ID-Abgleich
\`\`\`

EOF

  if [ -n "$_error" ]; then
    cat >> "$REPORT_FILE" << EOF
## Fehler

\`\`\`
${_error}
\`\`\`

EOF
  fi

  # Trim build output to last 50 lines
  _trimmed_output=$(echo "$_build_output" | tail -50)
  cat >> "$REPORT_FILE" << EOF
## Build Output (letzte 50 Zeilen)

\`\`\`
${_trimmed_output}
\`\`\`

---
*Report generiert von Rebuild Robot Sidecar v${ROBOT_VERSION}*
EOF
}

service_container_id() {
  _compose_flags="$1"
  # shellcheck disable=SC2086
  docker compose ${_compose_flags} -p "$COMPOSE_PROJECT" ps --all -q "$MAIN_SERVICE" 2>/dev/null | head -1
}

compose_service_exists() {
  _compose_flags="$1"
  _service="$2"
  # shellcheck disable=SC2086
  docker compose ${_compose_flags} -p "$COMPOSE_PROJECT" config --services 2>/dev/null \
    | grep -Fxq "$_service"
}

ensure_optional_runtime_dependencies() {
  _compose_flags="$1"
  if ! compose_service_exists "$_compose_flags" "$DOCKER_PROXY_SERVICE"; then
    return 0
  fi

  log_info "Stelle optionale Runtime-Abhängigkeit ${DOCKER_PROXY_SERVICE} bereit..."
  # Start only the explicitly configured filtered proxy. Endpoint groups stay
  # fail-closed unless the operator enabled the trusted-admin release profile.
  # The main service is still recreated separately so the repair-bot never
  # kills its own caller.
  # shellcheck disable=SC2086
  if ! docker compose ${_compose_flags} -p "$COMPOSE_PROJECT" up -d --no-deps "$DOCKER_PROXY_SERVICE" >/dev/null 2>&1; then
    log_error "${DOCKER_PROXY_SERVICE} konnte nicht gestartet werden."
    return 1
  fi

  _attempt=1
  while [ "$_attempt" -le "$READINESS_ATTEMPTS" ]; do
    # shellcheck disable=SC2086
    _container_id=$(docker compose ${_compose_flags} -p "$COMPOSE_PROJECT" ps --all -q "$DOCKER_PROXY_SERVICE" 2>/dev/null | head -1)
    if [ -n "$_container_id" ]; then
      _state=$(docker inspect --format '{{.State.Status}}' "$_container_id" 2>/dev/null || true)
      _health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$_container_id" 2>/dev/null || true)
      if [ "$_state" = "running" ] && { [ "$_health" = "healthy" ] || [ "$_health" = "none" ]; }; then
        log_success "${DOCKER_PROXY_SERVICE} ist bereit."
        return 0
      fi
      if [ "$_state" = "exited" ] || [ "$_state" = "dead" ] || [ "$_health" = "unhealthy" ]; then
        log_error "${DOCKER_PROXY_SERVICE} ist fehlgeschlagen (state=${_state}, health=${_health})."
        return 1
      fi
    fi
    if [ "$_attempt" -lt "$READINESS_ATTEMPTS" ]; then sleep "$READINESS_INTERVAL"; fi
    _attempt=$(( _attempt + 1 ))
  done

  log_error "${DOCKER_PROXY_SERVICE} wurde nicht rechtzeitig bereit."
  return 1
}

configured_image_ref() {
  _compose_flags="$1"
  # Compose owns the target tag. Reading its normalized JSON avoids guessing
  # when a site override changes the image repository or tag.
  # shellcheck disable=SC2086
  docker compose ${_compose_flags} -p "$COMPOSE_PROJECT" config --format json 2>/dev/null \
    | jq -er --arg service "$MAIN_SERVICE" '.services[$service].image | select(type == "string" and length > 0)'
}

protect_previous_release() {
  _compose_flags="$1"
  PREVIOUS_CONTAINER_ID=$(service_container_id "$_compose_flags")
  TARGET_IMAGE_REF=$(configured_image_ref "$_compose_flags") || {
    log_error "Image-Referenz für ${MAIN_SERVICE} konnte nicht aus Compose gelesen werden."
    return 1
  }

  if [ -z "$PREVIOUS_CONTAINER_ID" ]; then
    log_warn "Kein bestehender ${MAIN_SERVICE}-Container gefunden; initialer Start ohne Rollback-Basis."
    return 0
  fi

  _previous_state=$(docker inspect --format '{{.State.Status}}' "$PREVIOUS_CONTAINER_ID" 2>/dev/null || true)
  if [ "$_previous_state" != "running" ]; then
    log_warn "Vorheriger ${MAIN_SERVICE}-Container ist nicht aktiv (state=${_previous_state:-missing}); keine Rollback-Basis."
    PREVIOUS_CONTAINER_ID=""
    return 0
  fi

  PREVIOUS_IMAGE_ID=$(docker inspect --format '{{.Image}}' "$PREVIOUS_CONTAINER_ID" 2>/dev/null) || {
    log_error "Image-ID des laufenden Containers konnte nicht gelesen werden."
    return 1
  }

  ROLLBACK_IMAGE_REF="${COMPOSE_PROJECT}-rollback:$(date '+%Y%m%d%H%M%S')-$$"
  if ! docker image tag "$PREVIOUS_IMAGE_ID" "$ROLLBACK_IMAGE_REF" >/dev/null 2>&1; then
    log_error "Vorheriges Image konnte nicht als ${ROLLBACK_IMAGE_REF} geschützt werden."
    return 1
  fi

  log_info "Rollback-Basis geschützt: ${PREVIOUS_IMAGE_ID} (${ROLLBACK_IMAGE_REF})"
}

cleanup_rollback_tag() {
  if [ -n "$ROLLBACK_IMAGE_REF" ]; then
    docker image rm "$ROLLBACK_IMAGE_REF" >/dev/null 2>&1 || true
    ROLLBACK_IMAGE_REF=""
  fi
}

wait_for_readiness() {
  _compose_flags="$1"
  _expected_image_id="$2"
  _release_label="$3"
  _readiness_mode="${4:-strict}"
  _attempt=1

  while [ "$_attempt" -le "$READINESS_ATTEMPTS" ]; do
    _container_id=$(service_container_id "$_compose_flags")
    if [ -n "$_container_id" ]; then
      _container_state=$(docker inspect --format '{{.State.Status}}' "$_container_id" 2>/dev/null || true)
      _actual_image_id=$(docker inspect --format '{{.Image}}' "$_container_id" 2>/dev/null || true)
      _health_state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$_container_id" 2>/dev/null || true)
      _http_ready=false
      if wget -qO- "http://${MAIN_SERVICE}:3001/health/ready" >/dev/null 2>&1; then
        _http_ready=true
      elif [ "$_readiness_mode" = "compat" ] \
        && wget -qO- "http://${MAIN_SERVICE}:3001/health" >/dev/null 2>&1; then
        # Compatibility path for rolling back to images built before the
        # dedicated readiness endpoint existed.
        _http_ready=true
      fi

      if [ "$_container_state" = "running" ] \
        && [ "$_actual_image_id" = "$_expected_image_id" ] \
        && { [ "$_health_state" = "healthy" ] || [ "$_health_state" = "none" ]; } \
        && [ "$_http_ready" = "true" ]; then
        log_success "${_release_label} ist bereit (Versuch ${_attempt}/${READINESS_ATTEMPTS})."
        return 0
      fi

      if [ "$_container_state" = "exited" ] || [ "$_container_state" = "dead" ] || [ "$_health_state" = "unhealthy" ]; then
        log_error "${_release_label} ist vor Readiness fehlgeschlagen (state=${_container_state}, health=${_health_state})."
        return 1
      fi

      log_info "${_release_label} Readiness ${_attempt}/${READINESS_ATTEMPTS} (state=${_container_state:-missing}, health=${_health_state:-missing})."
    else
      log_info "${_release_label} Readiness ${_attempt}/${READINESS_ATTEMPTS} (Container noch nicht vorhanden)."
    fi

    if [ "$_attempt" -lt "$READINESS_ATTEMPTS" ]; then
      sleep "$READINESS_INTERVAL"
    fi
    _attempt=$(( _attempt + 1 ))
  done

  return 1
}

create_rollback_health_override() {
  # The previous image can predate /health/ready. Keep Docker health usable
  # after rollback by accepting its legacy liveness endpoint only in the
  # rollback container. New candidates never receive this compatibility gate.
  cat > "$ROLLBACK_HEALTH_OVERRIDE" << EOF
services:
  ${MAIN_SERVICE}:
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3001/health/ready >/dev/null 2>&1 || wget -qO- http://127.0.0.1:3001/health >/dev/null 2>&1"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 20s
EOF
}

rollback_previous_release() {
  _compose_flags="$1"

  if [ -z "$PREVIOUS_IMAGE_ID" ] || [ -z "$TARGET_IMAGE_REF" ]; then
    ROLLBACK_RESULT="nicht möglich (keine vorherige Release-Basis)"
    log_error "$ROLLBACK_RESULT"
    return 1
  fi

  write_status "rolling-back" "Kandidat fehlgeschlagen; vorheriges Image wird wiederhergestellt..." "rollback"
  log_warn "Kandidat wird verworfen. Rollback auf ${PREVIOUS_IMAGE_ID} startet..."

  # shellcheck disable=SC2086
  docker compose ${_compose_flags} -p "$COMPOSE_PROJECT" stop "$MAIN_SERVICE" >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  docker compose ${_compose_flags} -p "$COMPOSE_PROJECT" rm -f "$MAIN_SERVICE" >/dev/null 2>&1 || true

  if ! docker image tag "$PREVIOUS_IMAGE_ID" "$TARGET_IMAGE_REF" >/dev/null 2>&1; then
    ROLLBACK_RESULT="fehlgeschlagen (Image-Tag konnte nicht wiederhergestellt werden; Sicherung: ${ROLLBACK_IMAGE_REF})"
    log_error "$ROLLBACK_RESULT"
    return 1
  fi

  if ! create_rollback_health_override; then
    ROLLBACK_RESULT="fehlgeschlagen (Health-Kompatibilitätsdatei konnte nicht erstellt werden; Sicherung: ${ROLLBACK_IMAGE_REF})"
    log_error "$ROLLBACK_RESULT"
    return 1
  fi
  _rollback_compose_flags="${_compose_flags} -f ${ROLLBACK_HEALTH_OVERRIDE}"

  # shellcheck disable=SC2086
  if ! docker compose ${_rollback_compose_flags} -p "$COMPOSE_PROJECT" up -d --no-deps "$MAIN_SERVICE" >/dev/null 2>&1; then
    ROLLBACK_RESULT="fehlgeschlagen (vorheriger Container konnte nicht gestartet werden; Sicherung: ${ROLLBACK_IMAGE_REF})"
    log_error "$ROLLBACK_RESULT"
    return 1
  fi

  if wait_for_readiness "$_rollback_compose_flags" "$PREVIOUS_IMAGE_ID" "Rollback-Release" "compat"; then
    ROLLBACK_RESULT="erfolgreich; vorheriges Image wieder aktiv"
    log_success "$ROLLBACK_RESULT"
    cleanup_rollback_tag
    rm -f "$ROLLBACK_HEALTH_OVERRIDE"
    return 0
  fi

  ROLLBACK_RESULT="fehlgeschlagen (vorheriges Image nicht bereit; Sicherung: ${ROLLBACK_IMAGE_REF})"
  log_error "$ROLLBACK_RESULT"
  return 1
}

reject_candidate() {
  _compose_flags="$1"
  _reason="$2"
  _start_time="$3"
  _build_output="$4"

  if rollback_previous_release "$_compose_flags"; then
    _error_message="Kandidat abgelehnt: ${_reason}. Rollback erfolgreich."
    write_status "error" "$_error_message" "rolled-back"
  else
    _error_message="Kandidat abgelehnt: ${_reason}. Rollback fehlgeschlagen; manuelle Wiederherstellung erforderlich."
    write_status "error" "$_error_message" "rollback-failed"
  fi

  write_report "error" "$_start_time" "$(date +%s)" "$_build_output" "$_error_message"
  return 1
}

# Execute rebuild - targets ONLY the main service
do_rebuild() {
  _no_cache="${1:-false}"
  _start_time=$(date +%s)
  _build_output=""
  _error_message=""

  log_info "Rebuild Robot startet..."
  write_status "building" "Docker Image wird gebaut..." "build"

  PREVIOUS_CONTAINER_ID=""
  PREVIOUS_IMAGE_ID=""
  TARGET_IMAGE_REF=""
  CANDIDATE_IMAGE_ID=""
  ROLLBACK_IMAGE_REF=""
  ROLLBACK_RESULT="not-required"

  _compose_flags=$(compose_files_flags)
  if ! protect_previous_release "$_compose_flags"; then
    _error_message="Rollback-Basis konnte nicht sicher erfasst werden; laufender Dienst bleibt unverändert."
    write_status "error" "$_error_message" "preflight"
    write_report "error" "$_start_time" "$(date +%s)" "" "$_error_message"
    return 1
  fi

  # Apply filtered-proxy configuration before the potentially long main image
  # build. This keeps newly enabled release endpoints from remaining stale for
  # the full build duration while the running main service stays untouched.
  if ! ensure_optional_runtime_dependencies "$_compose_flags"; then
    _error_message="Runtime-Abhängigkeiten konnten nicht bereitgestellt werden; der laufende Dienst blieb unverändert."
    cleanup_rollback_tag
    write_status "error" "$_error_message" "dependencies"
    write_report "error" "$_start_time" "$(date +%s)" "" "$_error_message"
    return 1
  fi

  # Phase 1: Build (only main service)
  log_info "Phase 1: Building Docker image for ${MAIN_SERVICE}..."

  _build_cmd="docker compose ${_compose_flags} -p ${COMPOSE_PROJECT} build ${MAIN_SERVICE}"
  if [ "$_no_cache" = "true" ]; then
    _build_cmd="docker compose ${_compose_flags} -p ${COMPOSE_PROJECT} build --no-cache ${MAIN_SERVICE}"
  fi

  if _build_output=$($_build_cmd 2>&1); then
    log_success "Build erfolgreich!"
  else
    log_error "Build fehlgeschlagen!"
    _error_message="Build fehlgeschlagen; der laufende Dienst blieb unverändert."
    cleanup_rollback_tag
    write_status "error" "$_error_message" "build"
    write_report "error" "$_start_time" "$(date +%s)" "$_build_output" "$_error_message"
    return 1
  fi

  CANDIDATE_IMAGE_ID=$(docker image inspect "$TARGET_IMAGE_REF" --format '{{.Id}}' 2>/dev/null) || {
    _error_message="Gebautes Kandidaten-Image ${TARGET_IMAGE_REF} konnte nicht gelesen werden."
    cleanup_rollback_tag
    write_status "error" "$_error_message" "build"
    write_report "error" "$_start_time" "$(date +%s)" "$_build_output" "$_error_message"
    return 1
  }
  log_info "Kandidaten-Image: ${CANDIDATE_IMAGE_ID}"

  # Phase 2: Stop main container
  log_info "Phase 2: Stop ${MAIN_SERVICE}..."

  write_status "stopping" "Container wird gestoppt..." "stop"
  # shellcheck disable=SC2086
  if docker compose ${_compose_flags} -p "$COMPOSE_PROJECT" stop "$MAIN_SERVICE" 2>&1; then
    log_success "Container gestoppt!"
  else
    log_warn "Container stoppen hatte Probleme, versuche fortzufahren..."
  fi

  # Remove stopped container to avoid name conflicts on recreate
  log_info "Phase 2b: Removing stopped container..."
  # shellcheck disable=SC2086
  docker compose ${_compose_flags} -p "$COMPOSE_PROJECT" rm -f "$MAIN_SERVICE" 2>&1 || true

  # Wait for the container name to actually be free instead of guessing with a
  # fixed sleep. Usually this returns immediately, which shortens the downtime
  # window; when removal is slow it waits longer than the old two seconds did.
  _free_attempt=1
  while [ "$_free_attempt" -le 10 ]; do
    if [ -z "$(service_container_id "$_compose_flags")" ]; then
      break
    fi
    sleep 1
    _free_attempt=$((_free_attempt + 1))
  done

  # Phase 3: Start main container with new image
  log_info "Phase 3: Starting ${MAIN_SERVICE} with new image..."
  write_status "starting" "Neuer Container wird gestartet..." "start"

  # shellcheck disable=SC2086
  if docker compose ${_compose_flags} -p "$COMPOSE_PROJECT" up -d --no-deps "$MAIN_SERVICE" 2>&1; then
    log_success "Container gestartet!"
  else
    log_error "Container Start fehlgeschlagen!"
    reject_candidate "$_compose_flags" "Container-Start fehlgeschlagen" "$_start_time" "$_build_output"
    return $?
  fi

  # Candidate gate: the new process must expose readiness, reach Docker's
  # healthy state, and actually run the image produced by this build.
  log_info "Phase 4: Kandidaten-Readiness wird geprüft..."
  write_status "verifying" "Kandidaten-Readiness wird geprüft..." "candidate-readiness"
  if wait_for_readiness "$_compose_flags" "$CANDIDATE_IMAGE_ID" "Kandidaten-Release"; then
    log_success "Rebuild erfolgreich abgeschlossen!"
    ROLLBACK_RESULT="nicht benötigt; Kandidat akzeptiert"
    cleanup_rollback_tag
    write_status "success" "Rebuild erfolgreich abgeschlossen" "complete"
    write_report "success" "$_start_time" "$(date +%s)" "$_build_output" ""

    # Remove trigger file
    rm -f "$TRIGGER_FILE"
    return 0
  else
    log_error "Kandidaten-Readiness fehlgeschlagen."
    reject_candidate "$_compose_flags" "Readiness-Gate fehlgeschlagen" "$_start_time" "$_build_output"
    return $?
  fi
}

# Background heartbeat - keeps status file fresh so WebUI detects us
start_heartbeat() {
  while true; do
    # Only write heartbeat if we're in watching state (not during rebuild)
    if [ ! -f "$LOCK_FILE" ]; then
      write_status "watching" "Warte auf Rebuild-Request..." "idle"
    fi
    sleep "$HEARTBEAT_INTERVAL"
  done &
  HEARTBEAT_PID=$!
}

# Main watch loop
watch() {
  log_info "========================================="
  log_info "  Rebuild Robot Sidecar v${ROBOT_VERSION}"
  log_info "  Watching: ${TRIGGER_FILE}"
  log_info "  Target:   ${MAIN_SERVICE}"
  log_info "  Poll:     ${POLL_INTERVAL}s"
  log_info "========================================="

  # Ensure data directory exists
  mkdir -p "${WEBUI_DIR}/data"

  # Start heartbeat
  start_heartbeat
  log_info "Heartbeat gestartet (PID: ${HEARTBEAT_PID})"

  # Initial status
  write_status "watching" "Warte auf Rebuild-Request..." "idle"

  # Trap for cleanup
  trap 'log_info "Shutting down..."; kill $HEARTBEAT_PID 2>/dev/null; exit 0' INT TERM

  while true; do
    if [ -f "$TRIGGER_FILE" ]; then
      log_info "Trigger-File erkannt!"

      # Check for noCache option
      _no_cache="false"
      if grep -q '"noCache".*true' "$TRIGGER_FILE" 2>/dev/null; then
        _no_cache="true"
        log_info "noCache option erkannt"
      fi

      # Set lock
      if [ -f "$LOCK_FILE" ]; then
        log_warn "Rebuild bereits in Progress, überspringe..."
        sleep "$POLL_INTERVAL"
        continue
      fi
      touch "$LOCK_FILE"

      # Execute rebuild
      if do_rebuild "$_no_cache"; then
        log_success "Rebuild erfolgreich!"
        # Keep success status for 30s so container can read it on startup
        log_info "Warte 30s damit Container den Status lesen kann..."
        sleep 30
      else
        log_error "Rebuild fehlgeschlagen!"
        # Remove trigger file on failure to prevent infinite retry loop
        rm -f "$TRIGGER_FILE"
        log_info "Trigger-File entfernt (verhindert Endlos-Loop)"
      fi

      # Remove lock
      rm -f "$LOCK_FILE"
    fi

    sleep "$POLL_INTERVAL"
  done
}

# Verify docker compose is available
check_prerequisites() {
  if ! docker compose version >/dev/null 2>&1; then
    # No self-install attempt here: the sidecar image runs as an unprivileged
    # user, so `apk add` can only ever fail, and pretending otherwise buried the
    # real cause under a second misleading error.
    log_error "docker compose nicht verfügbar!"
    log_error "Das Sidecar-Image muss das Compose-Plugin mitbringen. Abbruch."
    exit 1
  fi
  log_info "docker compose $(docker compose version --short 2>/dev/null || echo 'verfügbar')"

  if ! command -v jq >/dev/null 2>&1; then
    log_error "jq ist für die sichere Compose-Imageauflösung erforderlich."
    exit 1
  fi

  case "$READINESS_ATTEMPTS:$READINESS_INTERVAL" in
    *[!0-9:]*|0:*|*:0)
      log_error "REBUILD_READINESS_ATTEMPTS und REBUILD_READINESS_INTERVAL_SECONDS müssen positive Ganzzahlen sein."
      exit 1
      ;;
  esac

  if [ ! -f "$COMPOSE_FILE" ]; then
    log_error "Compose file nicht gefunden: ${COMPOSE_FILE}"
    exit 1
  fi
}

# Entry point
if [ "${REBUILD_ROBOT_SOURCE_ONLY:-false}" != "true" ]; then
  check_prerequisites
  watch
fi
