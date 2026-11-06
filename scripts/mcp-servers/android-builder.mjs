#!/usr/bin/env node
// Minimal MCP stdio server for the Android App Creator backend.
// Lets Claude/Codex/Pi build APKs, manage ADB devices, and drive
// real-device tests (logcat / shell / screencap) without re-explaining
// the workflow every session.
//
// Several builder engines can be configured (ANDROID_BUILDER_ENGINES or the
// android-build-engines.json file in the WebUI data dir). Builds go to an idle
// engine (preferring the one with a warm Gradle cache for the project), with a
// cross-session per-project lock; device tools go to the engine whose adb
// server holds the device. See docs/plans/android-build-engines-2026-10-31.md.
//
// Speaks JSON-RPC 2.0 over stdin/stdout (line-delimited JSON). Zero deps.

import { createInterface } from 'node:readline';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm, rename, open, stat, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const normalizeUrl = (value) =>
  String(value || '')
    .trim()
    .replace(/\/$/, '');

const API = normalizeUrl(process.env.ANDROID_BUILDER_URL || 'http://host.docker.internal:4000');
const REQUEST_TIMEOUT_MS = Number(process.env.ANDROID_BUILDER_TIMEOUT_MS || 60_000);
const BUILDER_PROJECTS_ROOT = (
  process.env.ANDROID_BUILDER_PROJECTS_CONTAINER_PATH || '/app/projects'
).replace(/\/$/, '');
const HOST_PROJECTS_ROOT = (
  process.env.ANDROID_BUILDER_PROJECTS_HOST_PATH ||
  process.env.ANDROID_BUILDER_PROJECTS_PATH ||
  '/mnt/user/AI/plum-code/android-app-creator/projects'
).replace(/\/$/, '');
const WEBUI_SESSION_ID = process.env.WEBUI_SESSION_ID || '';
const WEBUI_ANDROID_DEVICE_SERIAL = (process.env.WEBUI_ANDROID_DEVICE_SERIAL || '').trim();
const CLAIM_TTL_MS = Number(
  process.env.ANDROID_BUILDER_PROJECT_CLAIM_TTL_MS || 12 * 60 * 60 * 1000
);
const CLAIM_FILE = '.plum-session-claim.json';
const DATA_DIR = (process.env.WEBUI_DATA_DIR || '/app/packages/backend/data').replace(/\/$/, '');
const CLAIMS_DIR = (
  process.env.ANDROID_BUILDER_PROJECT_CLAIMS_DIR || `${DATA_DIR}/android-project-claims`
).replace(/\/$/, '');

// ── Engine configuration ─────────────────────────────────────────────────
const ENGINES_FILE =
  process.env.ANDROID_BUILDER_ENGINES_FILE || `${DATA_DIR}/android-build-engines.json`;
const ENGINE_STATE_DIR = (
  process.env.ANDROID_BUILDER_ENGINE_STATE_DIR || `${DATA_DIR}/android-build-engines`
).replace(/\/$/, '');
// Builder data dir of the engine that works directly on HOST_PROJECTS_ROOT
// (per-project Gradle homes live in <data>/gradle-homes/<projectId>).
const BUILDER_DATA_HOST_ROOT = (
  process.env.ANDROID_BUILDER_DATA_HOST_PATH || `${dirname(HOST_PROJECTS_ROOT)}/data`
).replace(/\/$/, '');
// A project marked "building" longer than this is treated as a stale marker.
const BUILD_STALE_MS = Number(process.env.ANDROID_BUILDER_BUILD_STALE_MS || 90 * 60 * 1000);
const LOCK_GRACE_MS = 60_000;
const LOCK_MAX_MS = Number(process.env.ANDROID_BUILDER_LOCK_MAX_MS || 6 * 60 * 60 * 1000);
const PROBE_TIMEOUT_MS = Number(process.env.ANDROID_BUILDER_PROBE_TIMEOUT_MS || 8_000);
const DEVICE_CACHE_MS = 15_000;
const EMULATOR_SERIAL = 'emulator-5554'; // every engine boots its emulator on 5554

function engineNameFrom(raw, index) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .slice(0, 32);
  return cleaned || (index === 0 ? 'primary' : `engine${index + 1}`);
}

function parseEngineList(spec) {
  return String(spec || '')
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((item, index) => {
      const eq = item.indexOf('=');
      if (eq > 0 && !/^https?:/i.test(item)) {
        return {
          name: engineNameFrom(item.slice(0, eq), index),
          url: normalizeUrl(item.slice(eq + 1)),
        };
      }
      return { name: engineNameFrom('', index), url: normalizeUrl(item) };
    })
    .filter((engine) => engine.url);
}

function loadEngineConfig() {
  let engines = null;
  let source = 'ANDROID_BUILDER_URL';
  let emulatorPreference = null;
  const explicitUrl = normalizeUrl(process.env.ANDROID_BUILDER_URL || '');
  const envSpec = (process.env.ANDROID_BUILDER_ENGINES || '').trim();
  if (envSpec) {
    engines = parseEngineList(envSpec);
    source = 'ANDROID_BUILDER_ENGINES';
  } else {
    try {
      const file = JSON.parse(readFileSync(ENGINES_FILE, 'utf8'));
      const list = Array.isArray(file) ? file : file?.engines;
      const parsed = (Array.isArray(list) ? list : [])
        .map((entry, index) =>
          typeof entry === 'string'
            ? parseEngineList(entry)[0]
            : entry && { name: engineNameFrom(entry.name, index), url: normalizeUrl(entry.url) }
        )
        .filter((engine) => engine?.url);
      // The file only augments the configured builder: a session pointed at a
      // different ANDROID_BUILDER_URL (tests, other sites) stays single-engine.
      if (parsed.length && (!explicitUrl || parsed.some((engine) => engine.url === explicitUrl))) {
        engines = parsed;
        source = ENGINES_FILE;
        if (Array.isArray(file?.emulatorPreference)) emulatorPreference = file.emulatorPreference;
      }
    } catch {
      /* no engine file */
    }
  }
  if (!engines?.length) {
    engines = [
      { name: engineNameFrom(process.env.ANDROID_BUILDER_ENGINE_NAME || 'primary', 0), url: API },
    ];
  }
  // The engine behind ANDROID_BUILDER_URL is the primary (project registry).
  const primaryIndex = explicitUrl ? engines.findIndex((engine) => engine.url === explicitUrl) : -1;
  if (primaryIndex > 0) engines.unshift(...engines.splice(primaryIndex, 1));
  const seen = new Set();
  for (const engine of engines) {
    let name = engine.name;
    for (let n = 2; seen.has(name); n += 1) name = `${engine.name}${n}`;
    engine.name = name;
    engine.kind = 'unknown'; // 'gateway' (engine-local workspace) or 'plain'
    seen.add(name);
  }
  const envPreference = (process.env.ANDROID_BUILDER_EMULATOR_PREFERENCE || '').trim();
  if (envPreference) emulatorPreference = envPreference.split(/[,\s]+/).filter(Boolean);
  return { engines, source, emulatorPreference: emulatorPreference || engines.map((e) => e.name) };
}

const ENGINE_CONFIG = loadEngineConfig();
const ENGINES = ENGINE_CONFIG.engines;
const PRIMARY = ENGINES[0];
const MULTI = ENGINES.length > 1;
const engineByName = (name) => ENGINES.find((engine) => engine.name === name) || null;

const log = (...args) => console.error('[mcp-android]', ...args);

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
function ok(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}
function fail(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

const engineTag = (engine, message) => (MULTI ? `[engine ${engine.name}] ${message}` : message);

async function engineHttp(engine, method, path, body, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let resp;
    try {
      resp = await fetch(`${engine.url}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      const wrapped = new Error(engineTag(engine, err?.cause?.message || err.message));
      wrapped.engine = engine.name;
      wrapped.unreachable = true;
      throw wrapped;
    }
    const text = await resp.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }
    if (!resp.ok) {
      const message = parsed?.error || parsed?.message || `HTTP ${resp.status}`;
      const err = new Error(engineTag(engine, message));
      err.status = resp.status;
      err.body = parsed;
      err.engine = engine.name;
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

// Project registry calls always go to the primary engine (canonical tree).
async function http(method, path, body) {
  return engineHttp(PRIMARY, method, path, body);
}

// Fetch a binary blob (e.g. PNG screenshot) and return it as a Buffer.
async function httpBinary(method, path, engine = PRIMARY) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(`${engine.url}${path}`, { method, signal: ctrl.signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(engineTag(engine, `HTTP ${resp.status}: ${text.slice(0, 300)}`));
    }
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(timer);
  }
}

function asText(label, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  // structuredContent must be a record (object), not an array or primitive —
  // the harness validates this against the MCP spec. Wrap arrays so list
  // endpoints (adb_devices, adb_known_devices, …) don't blow up the client.
  let structured;
  if (Array.isArray(payload)) {
    structured = { items: payload };
  } else if (typeof payload === 'object' && payload !== null) {
    structured = payload;
  } else {
    structured = { value: payload };
  }
  return {
    content: [{ type: 'text', text: `${label}\n${body}` }],
    structuredContent: structured,
  };
}

function errorResult(message) {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

function projectPaths(projectId) {
  return {
    builderPath: `${BUILDER_PROJECTS_ROOT}/${projectId}`,
    workspacePath: `${HOST_PROJECTS_ROOT}/${projectId}`,
  };
}

function safeProjectId(projectId) {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(projectId)) {
    throw new Error('invalid projectId');
  }
  return projectId;
}

function getSessionId(args = {}) {
  return (
    String(args.webui_session_id || WEBUI_SESSION_ID || 'unknown-session').trim() ||
    'unknown-session'
  );
}

async function withSelectedSerial(args = {}) {
  const input = args && typeof args === 'object' ? args : {};
  const serial = String(input.serial || WEBUI_ANDROID_DEVICE_SERIAL || '').trim();
  if (serial) return { ...input, serial };

  const payload = await http('GET', '/api/devices');
  const devices = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.devices)
        ? payload.devices
        : [];
  const live = devices.filter((device) => {
    const candidate = String(device?.serial || device?.id || '').trim();
    const state = String(device?.status || device?.state || 'device').toLowerCase();
    return candidate && state !== 'offline' && state !== 'unauthorized';
  });

  if (live.length === 1) {
    return { ...input, serial: String(live[0].serial || live[0].id).trim() };
  }
  if (live.length === 0) {
    throw new Error('no live Android device; start the emulator or connect a device');
  }
  throw new Error(
    'multiple live Android devices; select one in Plum WebUI or pass serial explicitly'
  );
}

// ── Multi-engine routing ─────────────────────────────────────────────────

function normalizeDeviceList(payload) {
  return Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.devices)
        ? payload.devices
        : [];
}
const deviceSerialOf = (device) => String(device?.serial || device?.id || '').trim();
const isLiveDevice = (device) => {
  const state = String(device?.status || device?.state || 'device').toLowerCase();
  return !!deviceSerialOf(device) && state !== 'offline' && state !== 'unauthorized';
};

// "serial@engine" pins a device to one engine (e.g. emulator-5554@geekom).
function splitQualifiedSerial(raw) {
  const value = String(raw || '').trim();
  const at = value.lastIndexOf('@');
  if (at > 0) {
    const engine = engineByName(value.slice(at + 1));
    if (engine) return { serial: value.slice(0, at), engine };
  }
  return { serial: value, engine: null };
}

function annotate(result, engine, extra = {}) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...result, engine: engine.name, ...extra };
  }
  return result;
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, path);
}

const isFreshBuilding = (meta) =>
  meta?.status === 'building' &&
  Date.now() - (Date.parse(meta.updatedAt || '') || 0) < BUILD_STALE_MS;

async function readCanonicalMeta(projectId) {
  const id = safeProjectId(projectId);
  const fromFile = await readJsonFile(`${HOST_PROJECTS_ROOT}/${id}/.appcreator.json`, null);
  if (fromFile) return fromFile;
  try {
    return await http('GET', `/api/projects/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

// Engine probe: build load, emulator state and Gradle-cache warmth.
const probeCache = new Map();
async function probeEngine(engine, { projectId = null, fresh = false } = {}) {
  const key = `${engine.name}|${projectId || ''}`;
  const cached = probeCache.get(key);
  if (!fresh && cached && Date.now() - cached.at < 4_000) return cached.value;
  const started = Date.now();
  const result = {
    engine: engine.name,
    url: engine.url,
    ok: false,
    kind: engine.kind,
    busy: 0,
    activeProjects: [],
    emulator: null,
    warm: false,
  };
  const opts = { timeoutMs: PROBE_TIMEOUT_MS };
  try {
    let gateway = null;
    if (engine.kind !== 'plain') {
      try {
        const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
        gateway = await engineHttp(engine, 'GET', `/api/engine/status${qs}`, undefined, opts);
        if (!gateway || !Array.isArray(gateway.activeBuilds)) gateway = null;
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      engine.kind = gateway ? 'gateway' : 'plain';
    }
    if (gateway) {
      result.ok = gateway.health?.status === 'ok';
      if (!result.ok) result.error = gateway.health?.error || 'engine behind gateway unhealthy';
      result.activeProjects = gateway.activeBuilds.map((build) => build.projectId);
      result.activeBuilds = gateway.activeBuilds.map((build) => ({
        projectId: build.projectId,
        phase: build.phase,
        requestedAt: build.requestedAt,
      }));
      result.emulator = gateway.emulator || null;
      result.warm = !!gateway.project?.warm;
      result.lastBuild = gateway.project?.lastBuild || null;
    } else {
      const [health, projects, emulator] = await Promise.all([
        engineHttp(engine, 'GET', '/api/health', undefined, opts),
        engineHttp(engine, 'GET', '/api/projects', undefined, {
          timeoutMs: Math.max(PROBE_TIMEOUT_MS, 20_000),
        }).catch(() => null),
        engineHttp(engine, 'GET', '/api/emulator/status', undefined, opts).catch(() => null),
      ]);
      result.ok = health?.status === 'ok';
      const list = Array.isArray(projects) ? projects : projects?.projects || [];
      // Canonical builds owned by a gateway engine carry buildEngine=<name>.
      result.activeProjects = list
        .filter(
          (project) =>
            isFreshBuilding(project) &&
            !(
              project.buildEngine &&
              project.buildEngine !== engine.name &&
              engineByName(project.buildEngine)
            )
        )
        .map((project) => project.id);
      result.emulator = emulator;
      result.warm =
        !!projectId &&
        engine === PRIMARY &&
        existsSync(`${BUILDER_DATA_HOST_ROOT}/gradle-homes/${safeProjectId(projectId)}/caches`);
    }
  } catch (err) {
    result.ok = false;
    result.error = err.message;
  }
  result.kind = engine.kind;
  result.busy = result.activeProjects.length;
  result.latencyMs = Date.now() - started;
  probeCache.set(key, { at: Date.now(), value: result });
  return result;
}

function makeProber(projectId, { fresh = false } = {}) {
  const pending = new Map();
  return (engine) => {
    if (!engine) return Promise.resolve(null);
    if (!pending.has(engine.name))
      pending.set(engine.name, probeEngine(engine, { projectId, fresh }));
    return pending.get(engine.name);
  };
}

const lockPath = (projectId) => `${ENGINE_STATE_DIR}/locks/${safeProjectId(projectId)}.json`;
const LAST_ENGINE_FILE = `${ENGINE_STATE_DIR}/last-engine.json`;

async function readLock(projectId) {
  const path = lockPath(projectId);
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    // Created but not yet written by a concurrent session.
    const info = await stat(path).catch(() => null);
    return info
      ? { engine: null, startedAt: new Date(info.mtimeMs).toISOString(), unreadable: true }
      : null;
  }
}

async function tryCreateLock(projectId, data) {
  await mkdir(dirname(lockPath(projectId)), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath(projectId), 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
  try {
    await handle.writeFile(JSON.stringify(data, null, 2), 'utf8');
  } finally {
    await handle.close();
  }
  return true;
}

const removeLock = (projectId) => rm(lockPath(projectId), { force: true }).catch(() => {});

// Is projectId currently building on any engine? Stale locks are cleaned up.
async function findActiveBuild(projectId, probe = makeProber(projectId, { fresh: true })) {
  const lock = await readLock(projectId);
  if (lock) {
    const startedMs = Date.parse(lock.startedAt || '') || 0;
    const age = Date.now() - startedMs;
    const engine = engineByName(lock.engine);
    let active;
    if (lock.unreadable) active = age < LOCK_GRACE_MS;
    else if (age > LOCK_MAX_MS || !engine) active = false;
    else {
      // The grace window only covers the moment before the engine reports
      // the build; a build that already finished releases the lock at once.
      const state = await probe(engine);
      if (!state?.ok) active = age < BUILD_STALE_MS;
      else if (state.kind === 'gateway') {
        const last = state.lastBuild;
        const finished =
          last && !last.active && (Date.parse(last.requestedAt || '') || 0) >= startedMs - 5_000;
        active = state.activeProjects.includes(projectId) || (!finished && age < LOCK_GRACE_MS);
      } else {
        const meta = await readCanonicalMeta(projectId);
        const finished =
          !!meta && !isFreshBuilding(meta) && (Date.parse(meta.updatedAt || '') || 0) > startedMs;
        active = isFreshBuilding(meta) || (!finished && age < LOCK_GRACE_MS);
      }
    }
    if (active) {
      return {
        engine: lock.engine || 'unknown',
        since: lock.startedAt,
        source: 'lock',
        sessionId: lock.sessionId || null,
      };
    }
    await removeLock(projectId);
  }
  const meta = await readCanonicalMeta(projectId);
  if (!isFreshBuilding(meta)) return null;
  const owner = meta.buildEngine ? engineByName(meta.buildEngine) : null;
  if (owner) {
    const state = await probe(owner);
    if (state?.ok && state.kind === 'gateway' && !state.activeProjects.includes(projectId))
      return null;
    return {
      engine: owner.name,
      since: meta.buildEngineStartedAt || meta.updatedAt,
      source: 'metadata',
    };
  }
  return { engine: PRIMARY.name, since: meta.updatedAt, source: 'metadata' };
}

async function lastEngineFor(projectId, meta) {
  const state = await readJsonFile(LAST_ENGINE_FILE, {});
  const fromState = state?.projects?.[projectId] || null;
  const fromMeta = meta?.lastBuildEngine
    ? { engine: meta.lastBuildEngine, at: meta.lastBuild?.requestedAt || meta.updatedAt }
    : null;
  const candidates = [fromState, fromMeta].filter((entry) => entry && engineByName(entry.engine));
  candidates.sort((a, b) => (Date.parse(b.at || '') || 0) - (Date.parse(a.at || '') || 0));
  return candidates[0] || null;
}

async function rememberLastEngine(projectId, engineName) {
  try {
    const state = await readJsonFile(LAST_ENGINE_FILE, {});
    state.projects = state.projects || {};
    state.projects[projectId] = { engine: engineName, at: new Date().toISOString() };
    await writeJsonAtomic(LAST_ENGINE_FILE, state);
  } catch (err) {
    log('could not record last engine:', err.message);
  }
}

// Per-session routing memory (MCP processes respawn per turn for some CLIs).
const sessionStatePath = () =>
  `${ENGINE_STATE_DIR}/sessions/${getSessionId().replace(/[^A-Za-z0-9._-]/g, '_')}.json`;

async function readSessionState() {
  const state = (await readJsonFile(sessionStatePath(), null)) || {};
  return {
    ...state,
    emulatorEngine: state.emulatorEngine || null,
    serials: { ...(state.serials || {}) },
  };
}

async function updateSessionState(mutate) {
  try {
    const state = await readSessionState();
    const before = JSON.stringify(state);
    mutate(state);
    if (JSON.stringify(state) === before) return;
    state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(sessionStatePath(), state);
  } catch (err) {
    log('could not persist session routing state:', err.message);
  }
}

const deviceCache = new Map();
async function listEngineDevices(engine, { fresh = false } = {}) {
  const cached = deviceCache.get(engine.name);
  if (!fresh && cached && Date.now() - cached.at < DEVICE_CACHE_MS) return cached;
  let entry;
  try {
    const payload = await engineHttp(engine, 'GET', '/api/devices', undefined, {
      timeoutMs: Math.min(REQUEST_TIMEOUT_MS, 30_000),
    });
    entry = { at: Date.now(), devices: normalizeDeviceList(payload), error: null };
  } catch (err) {
    entry = { at: Date.now(), devices: [], error: err.message };
  }
  deviceCache.set(engine.name, entry);
  return entry;
}

const listAllDevices = (opts) =>
  Promise.all(
    ENGINES.map(async (engine) => ({ engine, ...(await listEngineDevices(engine, opts)) }))
  );

async function findKnownDeviceEngine(serial) {
  const lists = await Promise.all(
    ENGINES.map((engine) =>
      engineHttp(engine, 'GET', '/api/devices/known', undefined, { timeoutMs: PROBE_TIMEOUT_MS })
        .then((payload) => ({ engine, devices: normalizeDeviceList(payload) }))
        .catch(() => ({ engine, devices: [] }))
    )
  );
  return (
    lists.find((list) => list.devices.some((device) => deviceSerialOf(device) === serial))
      ?.engine || null
  );
}

function orderByPreference(engines) {
  const rank = (engine) => {
    const index = ENGINE_CONFIG.emulatorPreference.indexOf(engine.name);
    return index === -1 ? 1000 + ENGINES.indexOf(engine) : index;
  };
  return [...engines].sort((a, b) => rank(a) - rank(b));
}

// Resolve which engine holds the target device. Returns args with the plain
// serial plus the engine and how it was chosen.
async function resolveDevice(input = {}, { projectId = null } = {}) {
  const args = input && typeof input === 'object' ? { ...input } : {};
  delete args.engine;
  if (!MULTI) {
    return { args: await withSelectedSerial(args), engine: PRIMARY, resolution: 'single-engine' };
  }
  const explicit = engineByName(input?.engine);
  const raw = String(args.serial || WEBUI_ANDROID_DEVICE_SERIAL || '').trim();
  const finish = async (serial, engine, resolution, candidates = []) => {
    await updateSessionState((state) => {
      state.serials[serial] = engine.name;
    });
    return {
      args: { ...args, serial },
      engine,
      resolution,
      candidates: candidates.map((candidate) => candidate.name),
    };
  };

  if (!raw) {
    const lists = await listAllDevices();
    const live = lists.flatMap((list) =>
      (explicit && list.engine !== explicit ? [] : list.devices)
        .filter(isLiveDevice)
        .map((device) => ({ engine: list.engine, serial: deviceSerialOf(device) }))
    );
    if (live.length === 1) return finish(live[0].serial, live[0].engine, 'sole-live-device');
    if (live.length === 0) {
      throw new Error('no live Android device; start the emulator or connect a device');
    }
    throw new Error(
      `multiple live Android devices (${live.map((d) => `${d.serial}@${d.engine.name}`).join(', ')}); select one in Plum WebUI or pass serial explicitly (serial@engine pins the engine)`
    );
  }

  const { serial, engine: qualified } = splitQualifiedSerial(raw);
  if (qualified || explicit) return finish(serial, qualified || explicit, 'qualified');

  const lists = await listAllDevices();
  const holders = lists
    .filter((list) =>
      list.devices.some((device) => deviceSerialOf(device) === serial && isLiveDevice(device))
    )
    .map((list) => list.engine);
  if (holders.length === 1) return finish(serial, holders[0], 'device-holder');

  const session = await readSessionState();
  if (holders.length > 1) {
    const sticky = holders.find((engine) => engine.name === session.serials[serial]);
    if (sticky) return finish(serial, sticky, 'session-sticky', holders);
    if (serial.startsWith('emulator-')) {
      const own = holders.find((engine) => engine.name === session.emulatorEngine);
      if (own) return finish(serial, own, 'session-emulator', holders);
    }
    if (projectId) {
      const last = await lastEngineFor(projectId, await readCanonicalMeta(projectId));
      const builder = holders.find((engine) => engine.name === last?.engine);
      if (builder) return finish(serial, builder, 'project-build-engine', holders);
    }
    const ordered = serial.startsWith('emulator-') ? orderByPreference(holders) : holders;
    return finish(serial, ordered[0], 'ambiguous-first', holders);
  }

  // Nobody holds it live (offline Wi-Fi device, emulator still booting, ...).
  const sticky = engineByName(session.serials[serial]);
  if (sticky) return finish(serial, sticky, 'session-sticky-offline');
  const known = await findKnownDeviceEngine(serial);
  return finish(serial, known || PRIMARY, known ? 'known-registry' : 'primary-default');
}

async function deviceCall(input, fn, opts) {
  const target = await resolveDevice(input, opts);
  const result = await fn(target.args, target.engine);
  if (!MULTI) return annotate(result, target.engine);
  return annotate(result, target.engine, {
    engineResolution: target.resolution,
    ...(target.candidates.length > 1 ? { ambiguousEngines: target.candidates } : {}),
  });
}

async function registryEngine(rawSerial) {
  const { serial, engine } = splitQualifiedSerial(rawSerial);
  if (engine || !MULTI) return { serial, engine: engine || PRIMARY };
  return { serial, engine: (await findKnownDeviceEngine(serial)) || PRIMARY };
}

async function emulatorStatuses() {
  return Promise.all(
    ENGINES.map(async (engine) => {
      try {
        const status = await engineHttp(engine, 'GET', '/api/emulator/status', undefined, {
          timeoutMs: PROBE_TIMEOUT_MS,
        });
        return {
          engine,
          ok: true,
          status: status?.status || 'unknown',
          vncUrl: status?.vncUrl ?? null,
        };
      } catch (err) {
        return { engine, ok: false, status: 'unreachable', vncUrl: null, error: err.message };
      }
    })
  );
}

const emulatorRunning = (entry) => entry.status === 'running' || entry.status === 'starting';

function summarizeEmulators(statuses) {
  return statuses.map((entry) => ({
    engine: entry.engine.name,
    status: entry.status,
    vncUrl: entry.vncUrl,
    serial: EMULATOR_SERIAL,
    qualifiedSerial: `${EMULATOR_SERIAL}@${entry.engine.name}`,
    ...(entry.error ? { error: entry.error } : {}),
  }));
}

// Choose the engine for a build: the warm engine when idle, else an idle
// engine (warm first), else the least busy one.
async function chooseBuildEngine(projectId, probes, meta, explicitName) {
  const usable = probes.filter((probe) => probe.ok);
  if (explicitName) {
    const explicit = usable.find((probe) => probe.engine === explicitName);
    if (!explicit) throw new Error(`engine ${explicitName} is not configured or not reachable`);
    return { probe: explicit, reason: 'explicit', last: null };
  }
  if (!usable.length) {
    throw new Error(
      `no reachable Android build engine (${probes.map((p) => `${p.engine}: ${p.error || 'unhealthy'}`).join('; ')})`
    );
  }
  const last = await lastEngineFor(projectId, meta);
  const lastProbe = usable.find((probe) => probe.engine === last?.engine);
  if (lastProbe && lastProbe.busy === 0)
    return { probe: lastProbe, reason: 'warm-cache-idle', last };
  const order = (probe) => ENGINES.findIndex((engine) => engine.name === probe.engine);
  const ranked = [...usable].sort(
    (a, b) =>
      a.busy - b.busy ||
      Number(b.warm || b.engine === last?.engine) - Number(a.warm || a.engine === last?.engine) ||
      order(a) - order(b)
  );
  const pick = ranked[0];
  const reason =
    pick.busy === 0
      ? pick.warm || pick.engine === last?.engine
        ? 'idle-warm'
        : 'idle'
      : 'least-busy';
  return { probe: pick, reason, last };
}

// Builds another session started a moment ago may not show up in an engine's
// status yet; count their fresh locks so simultaneous starts spread out.
async function countJustStartedBuilds(probes, projectId) {
  let names = [];
  try {
    names = await readdir(`${ENGINE_STATE_DIR}/locks`);
  } catch {
    return;
  }
  for (const name of names.filter((entry) => entry.endsWith('.json'))) {
    const otherId = name.slice(0, -5);
    if (otherId === projectId) continue;
    const lock = await readJsonFile(`${ENGINE_STATE_DIR}/locks/${name}`, null);
    const age = Date.now() - (Date.parse(lock?.startedAt || '') || 0);
    const state = probes.find((entry) => entry.engine === lock?.engine);
    if (!state || age > LOCK_GRACE_MS || state.activeProjects.includes(otherId)) continue;
    state.activeProjects = [...state.activeProjects, otherId];
    state.busy = state.activeProjects.length;
  }
}

function buildRequestBody(args) {
  const buildType = args.variant === 'release' ? 'release' : 'debug';
  return { buildType, ...(args.variant ? { variant: args.variant } : {}) };
}

async function routedBuild(args) {
  const projectId = safeProjectId(args.projectId);
  const sessionId = getSessionId(args);
  const probes = await Promise.all(
    ENGINES.map((engine) => probeEngine(engine, { projectId, fresh: true }))
  );
  const probe = makeProber(projectId);
  for (const state of probes)
    probeCache.set(`${state.engine}|${projectId}`, { at: Date.now(), value: state });
  await countJustStartedBuilds(probes, projectId);
  const candidates = probes.map((state) => ({
    engine: state.engine,
    ok: state.ok,
    busy: state.busy,
    warm: state.warm,
    kind: state.kind,
    ...(state.error ? { error: state.error } : {}),
  }));

  const running = await findActiveBuild(projectId, probe);
  if (running) {
    return {
      status: 'already_building',
      projectId,
      engine: running.engine,
      since: running.since,
      detectedBy: running.source,
      message: `A build of this project is already running on engine ${running.engine}; wait for it to finish (android_get_project shows status) instead of starting a second one.`,
      candidates,
      ...projectPaths(projectId),
    };
  }

  const meta = await readCanonicalMeta(projectId);
  const choice = await chooseBuildEngine(projectId, probes, meta, args.engine || null);
  const engine = engineByName(choice.probe.engine);
  const locked = await tryCreateLock(projectId, {
    projectId,
    engine: engine.name,
    sessionId,
    startedAt: new Date().toISOString(),
    pid: process.pid,
  });
  if (!locked) {
    const other = (await readLock(projectId)) || {};
    return {
      status: 'already_building',
      projectId,
      engine: other.engine || 'unknown',
      since: other.startedAt || null,
      detectedBy: 'lock-race',
      message: 'Another Plum session started a build of this project a moment ago.',
      candidates,
      ...projectPaths(projectId),
    };
  }
  let response;
  try {
    response = await engineHttp(engine, 'POST', `/api/build/${encodeURIComponent(projectId)}`, {
      ...buildRequestBody(args),
      requestedBy: sessionId,
    });
  } catch (err) {
    await removeLock(projectId);
    if (err.status === 409 && err.body?.status === 'already_building') {
      return { ...err.body, projectId, candidates, ...projectPaths(projectId) };
    }
    throw err;
  }
  await rememberLastEngine(projectId, engine.name);
  probeCache.clear();
  const gateway = engine.kind === 'gateway';
  return {
    ...(response && typeof response === 'object' ? response : { response }),
    projectId,
    engine: engine.name,
    engineUrl: engine.url,
    routing: {
      reason: choice.reason,
      lastEngine: choice.last?.engine || null,
      candidates,
    },
    workspace: gateway
      ? 'engine-local copy, outputs synced back to workspacePath'
      : 'workspacePath',
    progress: gateway
      ? `GET ${engine.url}/api/engine/builds/${projectId} (log: ${engine.url}/api/engine/builds/${projectId}/log; after the build also ${HOST_PROJECTS_ROOT}/${projectId}/.plum-engine/last-build.log)`
      : `Socket.IO room project:${projectId} on ${engine.url} (build:log / build:done); android_get_project shows status`,
    ...projectPaths(projectId),
  };
}

function claimPath(projectId) {
  return `${CLAIMS_DIR}/${safeProjectId(projectId)}.json`;
}

function legacyClaimPath(projectId) {
  return `${projectPaths(safeProjectId(projectId)).workspacePath}/${CLAIM_FILE}`;
}

async function readClaimFile(path) {
  try {
    const claim = JSON.parse(await readFile(path, 'utf8'));
    if (!claim || typeof claim !== 'object') return null;
    const expiresAt = Date.parse(claim.expiresAt || '');
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
      await rm(path, { force: true }).catch(() => {});
      return null;
    }
    return claim;
  } catch {
    return null;
  }
}

async function readProjectClaim(projectId) {
  return (
    (await readClaimFile(claimPath(projectId))) || (await readClaimFile(legacyClaimPath(projectId)))
  );
}

async function writeProjectClaim(projectId, sessionId, reason = 'claimed') {
  const now = Date.now();
  const claim = {
    projectId,
    sessionId,
    reason,
    claimedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CLAIM_TTL_MS).toISOString(),
  };
  await mkdir(CLAIMS_DIR, { recursive: true });
  await writeFile(claimPath(projectId), JSON.stringify(claim, null, 2), 'utf8');
  return claim;
}

async function claimProject(args, reason = 'claimed') {
  const projectId = safeProjectId(args?.projectId);
  const sessionId = getSessionId(args);
  const existing = await readProjectClaim(projectId);
  if (existing && existing.sessionId !== sessionId && !args?.force) {
    return {
      status: 'conflict',
      projectId,
      sessionId,
      existingClaim: existing,
      message:
        'Project is claimed by another Plum session. Pass force=true only if you intentionally take over this app.',
      ...projectPaths(projectId),
    };
  }
  const claim = await writeProjectClaim(projectId, sessionId, reason);
  return {
    status: existing?.sessionId === sessionId ? 'refreshed' : 'claimed',
    projectId,
    sessionId,
    claim,
    ...projectPaths(projectId),
  };
}

async function releaseProject(args) {
  const projectId = safeProjectId(args?.projectId);
  const sessionId = getSessionId(args);
  const existing = await readProjectClaim(projectId);
  if (!existing) {
    return { status: 'not_claimed', projectId, sessionId, ...projectPaths(projectId) };
  }
  if (existing.sessionId !== sessionId && !args?.force) {
    return {
      status: 'conflict',
      projectId,
      sessionId,
      existingClaim: existing,
      message:
        'Project is claimed by another Plum session. Pass force=true only if you intentionally release that claim.',
      ...projectPaths(projectId),
    };
  }
  await rm(claimPath(projectId), { force: true });
  await rm(legacyClaimPath(projectId), { force: true }).catch(() => {});
  return {
    status: 'released',
    projectId,
    sessionId,
    releasedClaim: existing,
    ...projectPaths(projectId),
  };
}

function claimSummary(claim, currentSessionId = getSessionId()) {
  if (!claim) {
    return {
      status: 'unclaimed',
      sessionId: null,
      isCurrentSession: false,
    };
  }
  return {
    status:
      claim.sessionId === currentSessionId
        ? 'claimed_by_current_session'
        : 'claimed_by_other_session',
    sessionId: claim.sessionId,
    isCurrentSession: claim.sessionId === currentSessionId,
    claimedAt: claim.claimedAt,
    expiresAt: claim.expiresAt,
    reason: claim.reason,
  };
}

function enrichProject(project) {
  if (!project || typeof project !== 'object' || !project.id) return project;
  return {
    ...project,
    ...projectPaths(project.id),
    controlMode: 'session-authored',
    generationNote: [
      'Plum Code WebUI sessions own code generation.',
      'Edit files directly at workspacePath, then call android_build/android_install/adb_* tools.',
      'The builder-internal Claude generator is intentionally bypassed.',
    ].join(' '),
  };
}

async function enrichProjectAsync(project) {
  const enriched = enrichProject(project);
  if (!enriched || typeof enriched !== 'object' || !enriched.id) return enriched;
  const claim = await readProjectClaim(enriched.id);
  return {
    ...enriched,
    sessionClaim: claimSummary(claim),
  };
}

async function enrichProjectPayload(payload) {
  if (Array.isArray(payload)) return Promise.all(payload.map(enrichProjectAsync));
  if (payload && typeof payload === 'object' && Array.isArray(payload.projects)) {
    return { ...payload, projects: await Promise.all(payload.projects.map(enrichProjectAsync)) };
  }
  return enrichProjectAsync(payload);
}

async function sessionAuthoredGeneration(args, mode) {
  const projectId = args?.projectId;
  if (!projectId) throw new Error('projectId required');

  let project = null;
  try {
    project = await enrichProjectPayload(
      await http('GET', `/api/projects/${encodeURIComponent(projectId)}`)
    );
  } catch {
    project = {
      id: projectId,
      ...projectPaths(projectId),
      sessionClaim: claimSummary(await readProjectClaim(projectId)),
    };
  }

  return {
    status: 'session_authored',
    mode,
    projectId,
    prompt: args?.prompt || null,
    project,
    message: [
      'No builder-internal Claude session was started.',
      'Use the current Plum Code WebUI session to edit the Android project files directly.',
      'After editing, call android_build, android_build_artifacts, android_install, android_launch, and adb_* verification tools as needed.',
    ].join(' '),
    nextSteps: [
      `Open/edit ${project.workspacePath}`,
      'Implement the requested app changes in the current session',
      `Run android_build with projectId=${projectId}`,
      'Install, launch, and verify with logcat plus screenshots',
    ],
  };
}

const TOOLS = [
  // ── Project lifecycle ────────────────────────────────────────────────
  {
    name: 'android_list_projects',
    description:
      'List all Android projects known to the builder, including the host workspacePath the current Plum session can edit directly.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'android_get_project',
    description:
      'Get a single Android project by id (status, package, workspacePath, last build, etc).',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: { type: 'string' } },
    },
  },
  {
    name: 'android_create_project',
    description: [
      'Create a new Android project.',
      'Provide name, packageName (e.g. com.example.foo), and a natural-language description.',
      'The builder scaffolds the Gradle project and returns workspacePath.',
      'The current Plum Code WebUI session must edit files directly at workspacePath, then call android_build.',
      'New projects are automatically claimed by the calling Plum session so multiple apps can be worked on in parallel.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['name', 'packageName', 'description'],
      properties: {
        name: { type: 'string', minLength: 1 },
        packageName: { type: 'string', pattern: '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$' },
        description: { type: 'string', minLength: 1 },
        template: { type: 'string', description: 'Optional template id.' },
        webui_session_id: {
          type: 'string',
          description: 'Optional explicit Plum session id; usually provided by the environment.',
        },
      },
    },
  },
  {
    name: 'android_claim_project',
    description: [
      'Claim an existing Android project for the current Plum session before editing it.',
      'Use this when multiple WebUI sessions are working on different Android apps in parallel.',
      'If another session owns the claim, the tool returns conflict unless force=true.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
        force: {
          type: 'boolean',
          description: 'Take over a stale or intentional cross-session claim.',
        },
        webui_session_id: {
          type: 'string',
          description: 'Optional explicit Plum session id; usually provided by the environment.',
        },
      },
    },
  },
  {
    name: 'android_release_project',
    description:
      'Release a project claim when the current Plum session is done with that Android app.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
        force: {
          type: 'boolean',
          description: 'Release another session claim only when intentionally cleaning up.',
        },
        webui_session_id: {
          type: 'string',
          description: 'Optional explicit Plum session id; usually provided by the environment.',
        },
      },
    },
  },
  {
    name: 'android_generate',
    description: [
      'Compatibility helper for older prompts.',
      'Does NOT start the legacy builder-internal Claude generator or require an Anthropic key.',
      'Returns workspacePath and instructions for the current Plum session to write the code directly.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
        prompt: { type: 'string', description: 'Optional custom generation prompt.' },
      },
    },
  },
  {
    name: 'android_iterate',
    description: [
      'Compatibility helper for older prompts.',
      'Does NOT continue a legacy builder-internal Claude session.',
      'Returns workspacePath and instructions for the current Plum session to make the requested edits directly.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['projectId', 'prompt'],
      properties: {
        projectId: { type: 'string' },
        prompt: { type: 'string', minLength: 1 },
      },
    },
  },

  // ── Build / install / launch ────────────────────────────────────────
  {
    name: 'android_build',
    description:
      'Build the APK for a project (Gradle assembleDebug). Streams progress via the backend socket; returns initial accept response. With several build engines configured the build goes to an idle engine (preferring the one with a warm Gradle cache for this project) and the result names the engine.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
        variant: { type: 'string', enum: ['debug', 'release'] },
      },
    },
  },
  {
    name: 'android_build_artifacts',
    description: 'List build artifacts (APKs/AABs) for a project.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: { type: 'string' } },
    },
  },
  {
    name: 'android_install',
    description: 'Install the freshly-built APK from a project onto a connected device.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
        apkPath: {
          type: 'string',
          description:
            'Optional override path; defaults to app/build/outputs/apk/debug/app-debug.apk',
        },
      },
    },
  },
  {
    name: 'android_uninstall',
    description: 'Uninstall an app from a device by package name.',
    inputSchema: {
      type: 'object',
      required: ['packageName'],
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
        packageName: { type: 'string', pattern: '^[\\w.]+$' },
      },
    },
  },
  {
    name: 'android_launch',
    description: 'Launch an installed app on a device.',
    inputSchema: {
      type: 'object',
      required: ['packageName'],
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
        packageName: { type: 'string', pattern: '^[\\w.]+$' },
        mainActivity: { type: 'string', description: 'Default ".MainActivity"' },
      },
    },
  },

  // ── ADB device management ──────────────────────────────────────────
  {
    name: 'adb_devices',
    description:
      'List currently connected ADB devices (live). With several build engines each device names its engine and a qualifiedSerial (serial@engine) that pins device tools to that engine.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'adb_known_devices',
    description:
      'List remembered devices from the persistent registry (survives container restarts).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'adb_pair_wifi',
    description:
      'Pair a wireless device using a pairing code from Developer Options → Wireless debugging → Pair device with pairing code.',
    inputSchema: {
      type: 'object',
      required: ['host', 'port', 'pairingCode'],
      properties: {
        host: { type: 'string' },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
        pairingCode: { type: 'string', pattern: '^\\d{4,8}$' },
        friendlyName: { type: 'string', maxLength: 80 },
      },
    },
  },
  {
    name: 'adb_connect_wifi',
    description:
      'Connect to a wireless device on host:port (after pairing). The device is added to the auto-reconnect registry on success.',
    inputSchema: {
      type: 'object',
      required: ['host'],
      properties: {
        host: { type: 'string' },
        port: { type: 'integer', minimum: 1, maximum: 65535, description: 'Default 5555' },
        friendlyName: { type: 'string', maxLength: 80 },
      },
    },
  },
  {
    name: 'adb_disconnect',
    description: 'Disconnect a wireless device (does not forget it from the registry).',
    inputSchema: {
      type: 'object',
      required: ['serial'],
      properties: { serial: { type: 'string' } },
    },
  },
  {
    name: 'adb_forget_device',
    description:
      'Remove a device from the persistent registry (it will not auto-reconnect on next startup).',
    inputSchema: {
      type: 'object',
      required: ['serial'],
      properties: { serial: { type: 'string' } },
    },
  },
  {
    name: 'adb_set_friendly_name',
    description: 'Assign a human-friendly label to a remembered device.',
    inputSchema: {
      type: 'object',
      required: ['serial', 'friendlyName'],
      properties: {
        serial: { type: 'string' },
        friendlyName: { type: 'string', maxLength: 80 },
      },
    },
  },
  {
    name: 'adb_set_auto_reconnect',
    description: 'Toggle auto-reconnect for a remembered wifi device.',
    inputSchema: {
      type: 'object',
      required: ['serial', 'autoReconnect'],
      properties: {
        serial: { type: 'string' },
        autoReconnect: { type: 'boolean' },
      },
    },
  },
  {
    name: 'adb_reconnect_all',
    description:
      'Re-attempt reconnect for every remembered wifi device that has autoReconnect=true.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Emulator ───────────────────────────────────────────────────────
  {
    name: 'emulator_status',
    description: 'Get current emulator status (running / avd / port).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'emulator_start',
    description: 'Start an Android emulator (specify avd name, or default).',
    inputSchema: {
      type: 'object',
      properties: {
        avd: { type: 'string' },
        port: { type: 'integer', minimum: 5554, maximum: 5680 },
      },
    },
  },
  {
    name: 'emulator_stop',
    description: 'Stop the running emulator.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Runtime testing on device ──────────────────────────────────────
  {
    name: 'adb_logcat',
    description: 'Read recent logcat lines from a device. Default: last 60s, 500 lines, no filter.',
    inputSchema: {
      type: 'object',
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
        lines: { type: 'integer', minimum: 10, maximum: 5000 },
        sinceMs: { type: 'integer', description: 'Only logs since this epoch ms.' },
        filter: { type: 'string', description: 'logcat filter spec, e.g. "MyApp:V *:S" or "*:E"' },
      },
    },
  },
  {
    name: 'adb_logcat_clear',
    description: 'Clear the logcat buffer on a device.',
    inputSchema: {
      type: 'object',
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
      },
    },
  },
  {
    name: 'adb_shell',
    description:
      'Run an arbitrary adb shell command on a device. Destructive ops (rm -rf /, dd, mkfs, fork bomb, su root) are denied by the backend.',
    inputSchema: {
      type: 'object',
      required: ['command'],
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
        command: { type: 'string', minLength: 1, maxLength: 4000 },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 120_000 },
      },
    },
  },
  {
    name: 'adb_screenshot',
    description:
      'Capture a PNG screenshot from a device and save it to a file inside the builder container. Use adb_screenshot_view if you want to actually SEE the screen content.',
    inputSchema: {
      type: 'object',
      required: ['outputPath'],
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
        outputPath: { type: 'string', pattern: '^/[\\w./-]+\\.png$' },
      },
    },
  },
  {
    name: 'adb_screenshot_view',
    description: [
      'Capture the live screen of a device and return it as an inline image so the agent can SEE what is on screen.',
      'Use this BEFORE every interaction (tap/swipe/keyevent) to know what is actually displayed,',
      'and AFTER to verify the action took effect. This is the primary visual feedback channel for autonomous testing.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
      },
    },
  },
  {
    name: 'adb_tap',
    description:
      'Tap at screen coordinates (x, y in pixels). Pair with adb_screenshot_view + adb_ui_dump to know where to tap.',
    inputSchema: {
      type: 'object',
      required: ['x', 'y'],
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
        x: { type: 'number', minimum: 0, maximum: 10000 },
        y: { type: 'number', minimum: 0, maximum: 10000 },
      },
    },
  },
  {
    name: 'adb_swipe',
    description:
      'Swipe from (x1,y1) to (x2,y2). durationMs default 300 (use ~600 for slow scroll, 100-200 for fling).',
    inputSchema: {
      type: 'object',
      required: ['x1', 'y1', 'x2', 'y2'],
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
        x1: { type: 'number', minimum: 0, maximum: 10000 },
        y1: { type: 'number', minimum: 0, maximum: 10000 },
        x2: { type: 'number', minimum: 0, maximum: 10000 },
        y2: { type: 'number', minimum: 0, maximum: 10000 },
        durationMs: { type: 'integer', minimum: 50, maximum: 10000 },
      },
    },
  },
  {
    name: 'adb_input_text',
    description:
      'Type text into the currently-focused input field (printable ASCII only; for special keys use adb_keyevent).',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
        text: { type: 'string', minLength: 1, maxLength: 1000 },
      },
    },
  },
  {
    name: 'adb_keyevent',
    description: [
      'Virtually press a key — including the physical hardware buttons of the device.',
      'Pass a symbolic name (preferred) or numeric keycode.',
      'Common hardware/system buttons: HOME, BACK, APP_SWITCH (recents), POWER, MENU, CAMERA,',
      'VOLUME_UP, VOLUME_DOWN, VOLUME_MUTE, MEDIA_PLAY_PAUSE, MEDIA_NEXT, MEDIA_PREVIOUS.',
      'Common navigation/typing: ENTER, TAB, ESCAPE, DEL (backspace), FORWARD_DEL, DPAD_UP/DOWN/LEFT/RIGHT/CENTER, PAGE_UP, PAGE_DOWN, MOVE_HOME, MOVE_END.',
      'For Xbox/gamepad-style controller buttons (BUTTON_A, BUTTON_L1, etc.) prefer adb_gamepad — many games filter by SOURCE_GAMEPAD and ignore default keyboard events.',
      'Examples: "HOME" returns to launcher, "BACK" goes back, "APP_SWITCH" opens recents, "POWER" toggles screen.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['keyCode'],
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
        keyCode: {
          oneOf: [
            {
              type: 'string',
              description:
                'Symbolic name like "HOME", "BACK", "VOLUME_UP" (KEYCODE_ prefix optional).',
            },
            { type: 'integer', minimum: 0, maximum: 1000 },
          ],
        },
        source: {
          type: 'string',
          enum: [
            'keyboard',
            'gamepad',
            'joystick',
            'dpad',
            'touchscreen',
            'touchnavigation',
            'mouse',
            'stylus',
            'trackball',
          ],
          description:
            'Input source. Defaults to "keyboard". Use "gamepad" for controller buttons that games/emulators filter by SOURCE_GAMEPAD (or just call adb_gamepad).',
        },
      },
    },
  },
  {
    name: 'adb_gamepad',
    description: [
      'Press a gamepad/controller button using input source SOURCE_GAMEPAD — required for the Anbernic RG Mini V2 and any',
      'Xbox-style controller, retro handheld, or emulator that ignores plain keyboard keyevents.',
      'Xbox-style buttons: BUTTON_A, BUTTON_B, BUTTON_X, BUTTON_Y, BUTTON_L1, BUTTON_R1, BUTTON_L2, BUTTON_R2,',
      'BUTTON_THUMBL (left stick click), BUTTON_THUMBR (right stick click), BUTTON_START, BUTTON_SELECT, BUTTON_MODE.',
      'D-pad: DPAD_UP, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_CENTER. The KEYCODE_ prefix is optional.',
      'Set longpress=true for a held press (useful in fighting games or to trigger long-press menus).',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['button'],
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
        button: {
          type: 'string',
          description:
            'Symbolic gamepad keycode like "BUTTON_A", "BUTTON_L2", "DPAD_UP" (KEYCODE_ prefix optional).',
        },
        longpress: {
          type: 'boolean',
          description: 'Default false. True sends --longpress for a held button.',
        },
      },
    },
  },
  {
    name: 'adb_ui_dump',
    description: [
      'Dump the on-screen UI hierarchy as XML so the agent can locate elements by text/resource-id/content-desc/bounds',
      'instead of guessing pixel coordinates from a screenshot. Each <node> has a `bounds` attribute like "[x1,y1][x2,y2]"',
      'that tells you exactly where to tap. Combine with adb_screenshot_view for fast, reliable autonomous interaction.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
        compressed: {
          type: 'boolean',
          description: 'Default true — strips redundant nodes for shorter output.',
        },
      },
    },
  },
  {
    name: 'adb_current_activity',
    description:
      'Identify the foreground activity (package + activity class) — useful right after adb_launch to confirm the app is actually showing.',
    inputSchema: {
      type: 'object',
      properties: {
        serial: {
          type: 'string',
          description: 'Optional when a WebUI session test device is selected.',
        },
      },
    },
  },

  // ── Health ─────────────────────────────────────────────────────────
  {
    name: 'android_health',
    description: 'Health check: confirm the Android builder backend is reachable.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const enc = encodeURIComponent;

// Device tools: resolve the engine that holds the device, then call it.
const onDevice = (fn, opts) => (a) => deviceCall(a, fn, opts);

async function aggregateArrays({ method, url }) {
  const results = await Promise.all(
    ENGINES.map(async (engine) => {
      try {
        const payload = await engineHttp(engine, method, url);
        return normalizeDeviceList(payload).map((item) => ({ ...item, engine: engine.name }));
      } catch (err) {
        return [{ engine: engine.name, status: 'engine_unreachable', error: err.message }];
      }
    })
  );
  return results.flat();
}

const HANDLERS = {
  android_list_projects: async () => enrichProjectPayload(await http('GET', '/api/projects')),
  android_get_project: async (a) => {
    const project = await enrichProjectPayload(
      await http('GET', `/api/projects/${encodeURIComponent(a.projectId)}`)
    );
    if (!MULTI || !project || typeof project !== 'object' || !project.id) return project;
    const activeBuild = await findActiveBuild(project.id);
    const last = await lastEngineFor(project.id, project);
    return {
      ...project,
      buildRouting: {
        engines: ENGINES.map((engine) => engine.name),
        lastEngine: last?.engine || null,
        activeBuild,
        // Gateway engines record sync/build timings of their latest build.
        ...(project.lastBuild && project.lastBuild.engine === last?.engine
          ? { lastBuildDetails: project.lastBuild }
          : {}),
      },
    };
  },
  android_create_project: async (a) => {
    const project = await enrichProjectPayload(await http('POST', '/api/projects', a));
    if (project?.id) {
      const claim = await claimProject(
        { projectId: project.id, webui_session_id: a?.webui_session_id },
        'created-by-session'
      );
      const currentSessionId = getSessionId(a);
      return {
        ...project,
        sessionClaim: claimSummary(claim.claim, currentSessionId),
        claim,
      };
    }
    return project;
  },
  android_claim_project: (a) => claimProject(a, 'claimed-by-session'),
  android_release_project: (a) => releaseProject(a),
  android_generate: (a) => sessionAuthoredGeneration(a, 'generate'),
  android_iterate: (a) => sessionAuthoredGeneration(a, 'iterate'),

  android_build: async (a) => {
    if (MULTI) return routedBuild(a);
    return annotate(
      await http('POST', `/api/build/${encodeURIComponent(a.projectId)}`, buildRequestBody(a)),
      PRIMARY
    );
  },
  android_build_artifacts: (a) =>
    http('GET', `/api/build/${encodeURIComponent(a.projectId)}/artifacts`),
  android_install: async (a) => {
    const projectId = safeProjectId(a.projectId);
    if (MULTI) {
      const running = await findActiveBuild(projectId);
      if (running) {
        throw new Error(
          `the build of ${projectId} is still running on engine ${running.engine} (since ${running.since}); install after it has finished — android_get_project shows the status`
        );
      }
    }
    const last = MULTI ? await lastEngineFor(projectId, await readCanonicalMeta(projectId)) : null;
    const result = await deviceCall(
      a,
      (args, engine) =>
        engineHttp(
          engine,
          'POST',
          `/api/devices/${enc(args.serial)}/install/${enc(projectId)}`,
          args.apkPath ? { apkPath: args.apkPath } : {}
        ),
      { projectId }
    );
    if (!MULTI || !result || typeof result !== 'object') return result;
    return {
      ...result,
      builtOnEngine: last?.engine || null,
      apkTransfer:
        last?.engine && last.engine !== result.engine
          ? 'APK built on another engine; installed from the canonical project copy'
          : 'same engine',
    };
  },
  android_uninstall: onDevice((args, engine) =>
    engineHttp(engine, 'POST', `/api/devices/${enc(args.serial)}/uninstall`, {
      packageName: args.packageName,
    })
  ),
  android_launch: onDevice((args, engine) =>
    engineHttp(engine, 'POST', `/api/devices/${enc(args.serial)}/launch`, {
      packageName: args.packageName,
      mainActivity: args.mainActivity,
    })
  ),

  adb_devices: async () => {
    if (!MULTI) return http('GET', '/api/devices');
    const lists = await listAllDevices({ fresh: true });
    return lists.flatMap((list) =>
      list.error
        ? [{ engine: list.engine.name, status: 'engine_unreachable', error: list.error }]
        : list.devices.map((device) => ({
            ...device,
            engine: list.engine.name,
            qualifiedSerial: `${deviceSerialOf(device)}@${list.engine.name}`,
          }))
    );
  },
  adb_known_devices: () =>
    MULTI
      ? aggregateArrays({ method: 'GET', url: '/api/devices/known' })
      : http('GET', '/api/devices/known'),
  adb_pair_wifi: async (a) => {
    const engine = engineByName(a.engine) || PRIMARY;
    const body = { ...a };
    delete body.engine;
    return annotate(await engineHttp(engine, 'POST', '/api/devices/pair', body), engine);
  },
  adb_connect_wifi: async (a) => {
    const engine = engineByName(a.engine) || PRIMARY;
    const body = { ...a };
    delete body.engine;
    const result = await engineHttp(engine, 'POST', '/api/devices/connect', body);
    deviceCache.delete(engine.name);
    if (MULTI && result?.serial) {
      await updateSessionState((state) => {
        state.serials[result.serial] = engine.name;
      });
    }
    return annotate(result, engine);
  },
  adb_disconnect: async (a) => {
    const target = await resolveDevice({ serial: a.serial, engine: a.engine });
    deviceCache.delete(target.engine.name);
    return annotate(
      await engineHttp(target.engine, 'POST', '/api/devices/disconnect', {
        serial: target.args.serial,
      }),
      target.engine
    );
  },
  adb_forget_device: async (a) => {
    const { serial, engine } = await registryEngine(a.serial);
    return annotate(
      await engineHttp(engine, 'DELETE', `/api/devices/known/${enc(serial)}`),
      engine
    );
  },
  adb_set_friendly_name: async (a) => {
    const { serial, engine } = await registryEngine(a.serial);
    return annotate(
      await engineHttp(engine, 'POST', `/api/devices/${enc(serial)}/friendly-name`, {
        friendlyName: a.friendlyName,
      }),
      engine
    );
  },
  adb_set_auto_reconnect: async (a) => {
    const { serial, engine } = await registryEngine(a.serial);
    return annotate(
      await engineHttp(engine, 'POST', `/api/devices/${enc(serial)}/auto-reconnect`, {
        autoReconnect: a.autoReconnect,
      }),
      engine
    );
  },
  adb_reconnect_all: async () => {
    if (!MULTI) return http('POST', '/api/devices/reconnect-all');
    deviceCache.clear();
    return aggregateArrays({ method: 'POST', url: '/api/devices/reconnect-all' });
  },

  emulator_status: async () => {
    if (!MULTI) return http('GET', '/api/emulator/status');
    const statuses = await emulatorStatuses();
    const session = await readSessionState();
    const pick =
      statuses.find((entry) => entry.ok && entry.engine.name === session.emulatorEngine) ||
      statuses.find(emulatorRunning) ||
      statuses.find((entry) => entry.ok) ||
      statuses[0];
    return {
      status: pick.status,
      vncUrl: pick.vncUrl,
      engine: pick.engine.name,
      sessionEmulatorEngine: session.emulatorEngine || null,
      engines: summarizeEmulators(statuses),
    };
  },
  emulator_start: async (a) => {
    if (!MULTI) return http('POST', '/api/emulator/start', { avdName: a.avd });
    const statuses = await emulatorStatuses();
    const session = await readSessionState();
    let target = null;
    let reason;
    const explicit = engineByName(a.engine);
    const own = statuses.find(
      (entry) => entry.ok && entry.engine.name === session.emulatorEngine && emulatorRunning(entry)
    );
    if (explicit) {
      target = explicit;
      reason = 'explicit';
    } else if (own) {
      target = own.engine;
      reason = 'session-emulator';
    } else {
      const reachable = statuses.filter((entry) => entry.ok);
      const ordered = orderByPreference(reachable.map((entry) => entry.engine)).map((engine) =>
        reachable.find((entry) => entry.engine === engine)
      );
      const free = ordered.find((entry) => !emulatorRunning(entry));
      if (free) {
        target = free.engine;
        reason = 'free-emulator-slot';
      } else if (ordered.length) {
        target = ordered[0].engine;
        reason = 'shared-running-emulator';
      }
    }
    if (!target) throw new Error('no reachable Android build engine for the emulator');
    const result = await engineHttp(target, 'POST', '/api/emulator/start', { avdName: a.avd });
    await updateSessionState((state) => {
      state.emulatorEngine = target.name;
      state.serials[EMULATOR_SERIAL] = target.name;
    });
    deviceCache.delete(target.name);
    return {
      ...(result && typeof result === 'object' ? result : { result }),
      engine: target.name,
      reason,
      serial: EMULATOR_SERIAL,
      qualifiedSerial: `${EMULATOR_SERIAL}@${target.name}`,
      note: `Boot takes 1-3 minutes; device tools route ${EMULATOR_SERIAL} of this session to engine ${target.name} (use ${EMULATOR_SERIAL}@<engine> for another engine's emulator).`,
      engines: summarizeEmulators(statuses),
    };
  },
  emulator_stop: async (a) => {
    if (!MULTI) return http('POST', '/api/emulator/stop');
    const statuses = await emulatorStatuses();
    const session = await readSessionState();
    const running = statuses.filter(emulatorRunning);
    const target =
      engineByName(a.engine) ||
      engineByName(session.emulatorEngine) ||
      (running.length === 1 ? running[0].engine : null);
    if (!target) {
      throw new Error(
        running.length
          ? `emulators are running on ${running.map((entry) => entry.engine.name).join(', ')} but none was started by this session; pass engine=<name> to stop one deliberately`
          : 'no emulator is running on any engine'
      );
    }
    const result = await engineHttp(target, 'POST', '/api/emulator/stop');
    await updateSessionState((state) => {
      if (state.emulatorEngine === target.name) state.emulatorEngine = null;
    });
    deviceCache.delete(target.name);
    return annotate(result, target);
  },

  adb_logcat: onDevice((args, engine) => {
    const params = new URLSearchParams();
    if (args.lines) params.set('lines', String(args.lines));
    if (args.sinceMs) params.set('sinceMs', String(args.sinceMs));
    if (args.filter) params.set('filter', args.filter);
    const qs = params.toString();
    return engineHttp(
      engine,
      'GET',
      `/api/devices/${enc(args.serial)}/logcat${qs ? `?${qs}` : ''}`
    );
  }),
  adb_logcat_clear: onDevice((args, engine) =>
    engineHttp(engine, 'POST', `/api/devices/${enc(args.serial)}/logcat/clear`)
  ),
  adb_shell: onDevice((args, engine) =>
    engineHttp(engine, 'POST', `/api/devices/${enc(args.serial)}/shell`, {
      command: args.command,
      timeoutMs: args.timeoutMs,
    })
  ),
  adb_screenshot: onDevice((args, engine) =>
    engineHttp(engine, 'POST', `/api/devices/${enc(args.serial)}/screenshot`, {
      outputPath: args.outputPath,
    })
  ),
  adb_tap: onDevice((args, engine) =>
    engineHttp(engine, 'POST', `/api/devices/${enc(args.serial)}/tap`, { x: args.x, y: args.y })
  ),
  adb_swipe: onDevice((args, engine) =>
    engineHttp(engine, 'POST', `/api/devices/${enc(args.serial)}/swipe`, {
      x1: args.x1,
      y1: args.y1,
      x2: args.x2,
      y2: args.y2,
      durationMs: args.durationMs,
    })
  ),
  adb_input_text: onDevice((args, engine) =>
    engineHttp(engine, 'POST', `/api/devices/${enc(args.serial)}/input-text`, { text: args.text })
  ),
  adb_keyevent: onDevice((args, engine) =>
    engineHttp(engine, 'POST', `/api/devices/${enc(args.serial)}/keyevent`, {
      keyCode: args.keyCode,
      ...(args.source ? { source: args.source } : {}),
    })
  ),
  adb_gamepad: onDevice((args, engine) =>
    engineHttp(engine, 'POST', `/api/devices/${enc(args.serial)}/gamepad-button`, {
      button: args.button,
      ...(args.longpress ? { longpress: true } : {}),
    })
  ),
  adb_ui_dump: onDevice((args, engine) => {
    const qs = args.compressed === false ? '?compressed=false' : '';
    return engineHttp(engine, 'GET', `/api/devices/${enc(args.serial)}/ui-dump${qs}`);
  }),
  adb_current_activity: onDevice((args, engine) =>
    engineHttp(engine, 'GET', `/api/devices/${enc(args.serial)}/current-activity`)
  ),

  android_health: async () => {
    if (!MULTI) return http('GET', '/api/health');
    const probes = await Promise.all(ENGINES.map((engine) => probeEngine(engine, { fresh: true })));
    const primary = probes[0];
    return {
      status: primary.ok ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      engineConfig: ENGINE_CONFIG.source,
      engines: probes.map((probe) => ({
        engine: probe.engine,
        url: probe.url,
        ok: probe.ok,
        kind: probe.kind,
        busy: probe.busy,
        activeProjects: probe.activeProjects,
        emulator: probe.emulator?.status || null,
        latencyMs: probe.latencyMs,
        ...(probe.error ? { error: probe.error } : {}),
      })),
    };
  },
};

// Pipe a buffer through `magick` (ImageMagick 7) to resize + recompress.
// Resolves to the converted buffer, or rejects with stderr on non-zero exit.
function magickPipe(input, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('magick', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    const errChunks = [];
    proc.stdout.on('data', (c) => chunks.push(c));
    proc.stderr.on('data', (c) => errChunks.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve(Buffer.concat(chunks));
      reject(
        new Error(`magick exit ${code}: ${Buffer.concat(errChunks).toString().slice(0, 400)}`)
      );
    });
    proc.stdin.on('error', reject);
    proc.stdin.end(input);
  });
}

// adb_screenshot_view returns the PNG inline as MCP image content so the
// agent literally sees the screen. Full-resolution screenshots (~1–2 MB
// base64) get silently dropped by some CLI MCP image plumbing, so
// we downscale + JPEG-recompress to stay well under the size cap. The
// builder backend still serves the original PNG for adb_screenshot.
async function callScreenshotView(args) {
  const target = await resolveDevice(args);
  const { serial } = target.args;
  const engine = target.engine;
  const png = await httpBinary(
    'GET',
    `/api/devices/${encodeURIComponent(serial)}/screenshot.png`,
    engine
  );

  // Longest-edge 1024px, quality 78. Phone screens are pixel-dense; the agent
  // doesn't need 1:1 pixels to read UI labels. JPEG halves bytes vs PNG for
  // photographic/anti-aliased game content.
  let outBuf;
  let mime = 'image/jpeg';
  try {
    outBuf = await magickPipe(png, [
      '-',
      '-resize',
      '1024x1024>',
      '-strip',
      '-quality',
      '78',
      'jpg:-',
    ]);
  } catch (err) {
    log('magick downscale failed, sending raw PNG:', err.message);
    outBuf = png;
    mime = 'image/png';
  }

  return {
    content: [
      { type: 'image', data: outBuf.toString('base64'), mimeType: mime },
      {
        type: 'text',
        text: `Screenshot of ${serial}${MULTI ? ` (engine ${engine.name})` : ''}: ${png.length} B raw → ${outBuf.length} B ${mime}. Use adb_ui_dump for element coordinates.`,
      },
    ],
    structuredContent: {
      serial,
      engine: engine.name,
      size_bytes_raw: png.length,
      size_bytes_sent: outBuf.length,
      mime_type: mime,
      captured_at: new Date().toISOString(),
    },
  };
}

async function callTool(name, args) {
  if (name === 'adb_screenshot_view') {
    return callScreenshotView(args || {});
  }
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`unknown tool: ${name}`);
  return handler(args || {});
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      return ok(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'mcp-android-builder', version: '0.1.0' },
      });
    }
    if (method === 'notifications/initialized' || method === 'initialized') return;
    if (method === 'tools/list') return ok(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments || {};
      try {
        const result = await callTool(name, args);
        // Tools like adb_screenshot_view already return MCP-shaped
        // { content: [...] } payloads (with image blocks). Pass those
        // through; only wrap raw JSON results from plain HTTP handlers.
        const isMcpShaped = result && typeof result === 'object' && Array.isArray(result.content);
        return ok(id, isMcpShaped ? result : asText(name, result));
      } catch (e) {
        log('tool error', name, e.message);
        return ok(id, errorResult(e.message));
      }
    }
    if (method === 'ping') return ok(id, {});
    return fail(id, -32601, `method not found: ${method}`);
  } catch (e) {
    log('handler error', e.stack || e.message);
    return fail(id, -32603, 'internal error', { message: e.message });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (e) {
    log('parse error', e.message, trimmed.slice(0, 200));
    return;
  }
  await handleRequest(msg);
});
rl.on('close', () => process.exit(0));
log(
  'ready (stdio) →',
  ENGINES.map((engine) => `${engine.name}=${engine.url}`).join(', '),
  `(${ENGINE_CONFIG.source})`
);
