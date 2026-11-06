# Android build engines: Unraid + Geekom (2026-10-31)

Two sessions building at the same time on the single `android-app-creator` engine slowed each other down. Plum now has two engines of the same builder image, and the `android-builder` MCP (`scripts/mcp-servers/android-builder.mjs`) assigns them automatically.

## What runs where

| | Engine `unraid` (1, primary) | Engine `geekom` (2) |
|---|---|---|
| Host | Unraid | Geekom (Fedora 44, Ryzen 7 8745HS, KVM) |
| Container | `android-app-creator` | `android-engine-geekom` + sidecar `android-engine-geekom-gateway` |
| Compose | `/mnt/user/AI/plum-code/android-app-creator/docker-compose.yml` (project `android-app-creator`, unchanged) | `/srv/plum/deploy/android-engine/docker-compose.yml` (project `plum-android-engine`) |
| Image | `android-app-creator-app:latest` (99afa77856ce) | same image, exported from Unraid with `docker save` |
| URL used by Plum | `http://android-app-creator:4000` (extra_hosts → 192.168.1.126, nginx `plum-geekom-bridge`, Geekom IPs only) | `http://android-engine-geekom:4010` (Docker network `plum_default`) |
| Host ports | 127.0.0.1:4000/3150/6080 on Unraid | 127.0.0.1:4010 (gateway), 127.0.0.1:6081 (noVNC) on the Geekom; nothing on the LAN |
| Project workspace | canonical tree `/mnt/user/AI/plum-code/android-app-creator/projects` (= `/app/projects`) | engine-local copy `/srv/plum/android-engine/projects` (= `/app/projects`), synced per build |
| Gradle homes | `/app/data/gradle-homes/<projectId>` on the Unraid share | `/srv/plum/android-engine/data/gradle-homes/<projectId>` (NVMe) |
| SDK | volume `android-app-creator_android-sdk-cache` | `/srv/plum/android-engine/sdk` (copy of that volume, 18 GB) |
| adb identity / AVD | `data/adb/adbkey`, AVDs in the container FS | `/srv/plum/android-engine/android-home` = `~appuser/.android` (copy of the Unraid adbkey and debug.keystore, AVD `test_device`) |
| Devices | Wi-Fi tablets/phones (auto-reconnect registry), emergency emulator (NVIDIA) | own emulator only (`ADB_PREFERRED_HOST` empty, empty registry) |
| Limits | none | `cpus: 12`, `cpu_shares: 512`, `mem_limit: 24g` |

Both engines see the same project paths (`/app/projects/<id>`), and the MCP keeps exposing `workspacePath = /mnt/user/AI/plum-code/android-app-creator/projects/<id>` (`ANDROID_BUILDER_PROJECTS_HOST_PATH`) and `builderPath = /app/projects/<id>`. Sessions keep editing the canonical tree only.

### Geekom engine details

- `/dev/kvm` is passed through (mode 0666 on the Geekom; `group_add: 36` for completeness). Not privileged; `security_opt: label=disable` because SELinux is enforcing.
- The backend starts the emulator with `-gpu swiftshader_indirect` when no NVIDIA GPU exists. SwiftShader segfaults on this host (exit 139 for `swiftshader`, `swiftshader_indirect`, `guest`), so `emulator-wrapper.sh` is mounted as `/opt/plum-bin/emulator` (first in `PATH`) and rewrites the value after `-gpu` to `PLUM_EMULATOR_GPU` (default `host` = Mesa llvmpipe through the container's Xvfb). Boot takes ~25-30 s.
- `debug.keystore` is the Unraid engine's copy, so debug APKs are signed identically on both engines and `adb install -r` works across engines. Projects with a project-local keystore (e.g. `796aa064…/.android/debug.keystore`) are unaffected.

## Gateway (engine-local workspace)

`/srv/plum/deploy/android-engine/gateway.mjs` runs in the engine's network namespace (same image, `node`, root so it can chown to uid 1100 on NFS with `no_root_squash`). It forwards every HTTP request and WebSocket upgrade (Socket.IO included) to `127.0.0.1:4000` and adds:

- `POST /api/build/:id` → answers immediately (`status: building, phase: syncing, engine: geekom`), then
  1. marks the canonical `.appcreator.json` `status: building`, `buildEngine: geekom`;
  2. mirrors canonical → local, skipping Gradle module build dirs (`build/` next to a `build.gradle(.kts)`/`settings.gradle(.kts)`/`pubspec.yaml`) and `.gradle .kotlin .cxx .externalNativeBuild .dart_tool .plum-engine`, deleting files that vanished canonically (size+mtime comparison, atomic copies, mtimes preserved);
  3. joins the engine's Socket.IO room, starts the engine build (`{buildType}`), captures `build:log` and waits for `build:done` (fallback: local metadata poll; timeout 3 h);
  4. copies each module's `build/outputs`, `build/test-results`, `build/reports` (and Flutter `build/app/outputs`) back to the canonical project — `outputs` only on success, so a failed build keeps the last good canonical APK;
  5. writes `status: built|error`, `lastBuildEngine`, `lastBuild` (timings) into the canonical `.appcreator.json`, removes `buildEngine`, and stores the log at `<workspacePath>/.plum-engine/last-build.log` (+ `last-build.json`).
- `POST /api/devices/:serial/install/:id` and `POST /api/emulator/install/:id` → before forwarding, copy the APK (default `app/build/outputs/apk/debug/app-debug.apk` or the `apkPath` inside `/app/projects/<id>`) from the canonical project when that copy is newer. The response adds `apkSource` (`local`, `canonical-refreshed`, …).
- `GET /api/engine/status[?projectId=]` (busy count, active builds, emulator, health, Gradle-home warmth and last build of the project), `GET /api/engine/builds/:id[?tail=N]`, `GET /api/engine/builds/:id/log`.
- Build records live in `/srv/plum/android-engine/gateway-state/{builds,logs}`. A gateway restart marks unfinished builds `interrupted` and sets the canonical status to `error`.

## MCP routing (`android-builder.mjs`)

### Configuration (read at MCP spawn)

1. `ANDROID_BUILDER_ENGINES="unraid=http://android-app-creator:4000,geekom=http://android-engine-geekom:4010"`, else
2. `<WEBUI_DATA_DIR>/android-build-engines.json` (override with `ANDROID_BUILDER_ENGINES_FILE`) — **this is what Plum uses now**, file `/app/packages/backend/data/android-build-engines.json` = Geekom `/srv/plum/appdata/plum-code-webui/data/android-build-engines.json`:
   ```json
   { "engines": [ { "name": "unraid", "url": "http://android-app-creator:4000" },
                  { "name": "geekom", "url": "http://android-engine-geekom:4010" } ],
     "emulatorPreference": ["geekom", "unraid"] }
   ```
   The file is only used when it contains the configured `ANDROID_BUILDER_URL` (tests or other sites with a different URL stay single-engine).
3. otherwise the single `ANDROID_BUILDER_URL` (old behaviour, engine name `primary`, no extra requests).

The engine behind `ANDROID_BUILDER_URL` is the primary: project list/get/create, artifacts and Wi-Fi pairing go there. Other knobs: `ANDROID_BUILDER_EMULATOR_PREFERENCE`, `ANDROID_BUILDER_BUILD_STALE_MS` (90 min), `ANDROID_BUILDER_LOCK_MAX_MS` (6 h), `ANDROID_BUILDER_PROBE_TIMEOUT_MS` (8 s), `ANDROID_BUILDER_ENGINE_STATE_DIR`, `ANDROID_BUILDER_DATA_HOST_PATH`.

Shared state for all sessions: `<WEBUI_DATA_DIR>/android-build-engines/` with `locks/<projectId>.json` (created with `O_EXCL`), `last-engine.json`, `sessions/<sessionId>.json` (emulator engine, serial → engine).

### Builds (`android_build`)

1. Probe all engines: gateway engines via `/api/engine/status`; plain engines via `/api/health`, `/api/projects` (fresh `status: building` within 90 min, excluding canonical projects whose `buildEngine` names another engine) and `/api/emulator/status`. Warmth: gateway reports the Gradle home; for the primary the MCP checks `<builder data>/gradle-homes/<id>/caches` on the share.
2. Already building anywhere (live lock, canonical `building` marker, or a gateway active build) → `status: already_building` with the engine; nothing is started. Locks of finished builds are released immediately (gateway record/canonical status newer than the lock), unknown states after a 60 s grace.
3. Choice: the engine that last built the project if it is idle (`warm-cache-idle`); else an idle engine, warm first, then config order (`idle-warm`/`idle`); else the least busy (`least-busy`). An undocumented `engine` argument forces one (`explicit`).
4. `variant` is now also sent as `buildType` (the builder reads `buildType`; `release` previously built debug).
5. The result names `engine`, `engineUrl`, `routing.reason`, all `candidates` (busy/warm/ok) and a `progress` hint (gateway status/log URL or Socket.IO room).

### Devices and emulators

- Every device tool resolves the engine that holds the serial (`/api/devices` per engine, 15 s cache). `serial@engine` (e.g. `emulator-5554@unraid`) pins an engine; `adb_devices` lists `engine` and `qualifiedSerial` per device. Results carry `engine` and `engineResolution`.
- Both engines call their emulator `emulator-5554`. Ambiguity is resolved by: the session's remembered serial → the session's own emulator engine → (install) the project's last build engine → emulator preference. Offline serials fall back to the session memory, then the engine whose known-device registry has them, then the primary — Wi-Fi pairings on Unraid keep working unchanged.
- `emulator_start`: the session's running emulator, else the first engine in `emulatorPreference` whose emulator is stopped, else the preferred running one (shared). The session then owns `emulator-5554` on that engine. `emulator_stop` only stops the session's emulator (or the only running one); `emulator_status` lists all engines.
- `android_install`: refused while the project still builds on any engine. Cross-engine installs work through the canonical project: Unraid installs from the canonical APK (the gateway synced it back), the Geekom gateway refreshes its local APK from canonical first. The result shows `builtOnEngine`.
- `adb_pair_wifi` / `adb_connect_wifi` go to the primary unless `engine` is given; registry tools go to the engine whose registry knows the serial; `adb_known_devices`/`adb_reconnect_all` aggregate.
- `android_health` reports every engine (ok, kind, busy, active projects, emulator, latency); `android_get_project` adds `buildRouting` (engines, last engine, active build, gateway timings).

## Operating

```bash
# Status (from the Plum container)
curl -s http://android-engine-geekom:4010/api/engine/status | jq
curl -s http://android-engine-geekom:4010/api/engine/builds/<projectId>?tail=40 | jq
curl -s http://android-engine-geekom:4010/api/engine/builds/<projectId>/log

# Geekom engine (ssh zwaetschge@192.168.1.124)
cd /srv/plum/deploy/android-engine
docker compose -p plum-android-engine ps
docker compose -p plum-android-engine up -d                         # start / apply compose changes
docker compose -p plum-android-engine restart engine                 # restart builder (kills a running build/emulator)
docker compose -p plum-android-engine up -d --force-recreate gateway # after editing gateway.mjs
docker logs -f android-engine-geekom-gateway
docker exec android-engine-geekom tail -f /var/log/backend.log
ssh -L 6081:127.0.0.1:6081 zwaetschge@192.168.1.124                  # noVNC: http://localhost:6081/vnc.html

# Unraid engine (ssh root@10.10.10.2) - unchanged
cd /mnt/user/AI/plum-code/android-app-creator && docker compose up -d
```

- Take engine 2 out of rotation: remove it from `android-build-engines.json` (new sessions) or stop the compose project — unreachable engines are skipped automatically.
- Add an engine: run another engine + gateway, add `{name,url}` to the file.
- Logs for builds started via the gateway are also in the canonical `.plum-engine/last-build.log`. `scripts/android-build-log.cjs` still talks to Unraid directly; `ANDROID_BUILDER_URL=http://android-engine-geekom:4010 node scripts/android-build-log.cjs <id>` works through the gateway (Socket.IO is proxied; `build:done` arrives before the copy-back, which takes < 1 s).
- Plum container: the MCP change takes effect for new sessions once the image with the new script is built; the engine file needs no container recreate. To use env instead, add `ANDROID_BUILDER_ENGINES` to the MCP server env (Plum MCP settings) or to `geekom.env` + compose.

## Tests (2026-10-31)

Throwaway project `3c40cff5-b4af-4270-9ab6-25732fc282bc` ("Plum Engine Routing Test", Compose, AGP 8.7.3, Kotlin 2.0.21, created via `POST /api/projects`).

| Build | Engine | Time | Notes |
|---|---|---|---|
| cold (Gradle dist + deps) | geekom | 94.9 s (sync 0.11 s, Gradle 94.6 s, copy-back 0.19 s) | engine idle |
| cold | unraid | 315 s | 2 other builds (Plum app, Plum Drive) running on Unraid |
| warm (`clean assembleDebug`) | geekom | 14.3 s (sync 0.02 s, Gradle 13.9 s, copy-back 0.26 s) | routed automatically (`warm-cache-idle`) |
| warm | geekom | 14.8 s | routed automatically (`idle-warm`, Unraid busy) |
| warm | unraid (forced) | 90 s | 1 other build running |

Also verified: duplicate `android_build` → `already_building` (lock); install refused during a build; Unraid-built APK installed on the Geekom emulator (`apkSource: canonical-refreshed`), launched and screenshotted (marker `v3-unraid` visible); Geekom-built APK installed on `emulator-5554@unraid` (SHA-256 identical to the Geekom output) and uninstalled again; `emulator_start` placed the emulator on geekom (`free-emulator-slot`), boot 30 s; Socket.IO (websocket + polling) through the gateway. Regression tests: `node scripts/android-builder-mcp-regression-tests.mjs` (single-engine case plus a two-engine case with fake engines).

## Known limits

- The builder API has no authentication and its Socket.IO `terminal:start` opens a shell; engine 2 is therefore only on `plum_default` and the Geekom loopback, never on the LAN.
- Builds started outside the MCP (direct `POST /api/build`) skip the lock; they are still detected through the canonical `building` status, but only for 90 min (a stale marker older than that is ignored).
- The first build of a project on the other engine is cold (per-project Gradle homes are not shared); after that the warm engine is preferred while idle.
- Unraid's `status: building` markers survive engine crashes (several from July/August exist); only markers younger than 90 min count.
- The Geekom emulator renders in software (llvmpipe); fine for UI tests, slow for heavy GPU apps. Only AVD `test_device` exists there.
- Engine 2 shares CPU/RAM with Plum itself (bounded by `cpus: 12`, half CPU weight, 24 GB).
- Joining `plum_default` means a `docker compose down` of the Plum stack reports the network as still in use (harmless; the engine keeps it alive).
- The throwaway project `3c40cff5…` can be deleted with `curl -X DELETE http://android-app-creator:4000/api/projects/3c40cff5-b4af-4270-9ab6-25732fc282bc` plus `rm -rf /srv/plum/android-engine/projects/3c40cff5-b4af-4270-9ab6-25732fc282bc /srv/plum/android-engine/data/gradle-homes/3c40cff5-b4af-4270-9ab6-25732fc282bc` (via a root container) and the Unraid gradle home.
