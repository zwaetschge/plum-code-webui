#!/usr/bin/env node
// Godot MCP bridge for Plum Code WebUI.
//
// The server is intentionally zero-dependency. It can scaffold and inspect
// Godot projects directly, and uses a Godot binary for validation, script runs,
// imports, and exports.
//
// The engine binary usually is not in this container: Godot ships glibc builds
// and the WebUI image is Alpine/musl, where the official binary dies during
// relocation. So when no local binary is found the bridge falls back to running
// `plum-godot:latest` (docker/godot/Dockerfile) as a one-shot `docker run`
// through the socket proxy -- which permits run and build, but not exec.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants as FS_CONSTANTS } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function readParentEnv() {
  if (process.platform !== 'linux' || !process.ppid) return {};
  try {
    const raw = readFileSync(`/proc/${process.ppid}/environ`, 'utf8');
    const entries = {};
    for (const item of raw.split('\0')) {
      if (!item) continue;
      const separator = item.indexOf('=');
      if (separator <= 0) continue;
      entries[item.slice(0, separator)] = item.slice(separator + 1);
    }
    return entries;
  } catch {
    return {};
  }
}

const RUNTIME_ENV = { ...readParentEnv(), ...process.env };
const WORKSPACE_ROOT = (
  RUNTIME_ENV.WORKSPACE_ROOT ||
  RUNTIME_ENV.WEBUI_WORKSPACE_ROOT ||
  '/workspace'
).replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = Number(RUNTIME_ENV.GODOT_TIMEOUT_MS || 120_000);
const MAX_OUTPUT_CHARS = Number(RUNTIME_ENV.GODOT_MCP_MAX_OUTPUT_CHARS || 120_000);
const DOCKER_BIN = RUNTIME_ENV.GODOT_DOCKER_BIN || 'docker';
const DOCKER_IMAGE = RUNTIME_ENV.GODOT_DOCKER_IMAGE || 'plum-godot:latest';
const DOCKER_DISABLED = /^(1|true|yes)$/i.test(String(RUNTIME_ENV.GODOT_DOCKER_DISABLED || ''));

const log = (...args) => console.error('[mcp-godot]', ...args);

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ok(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function fail(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

function asText(label, payload, isError = false) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  const structuredContent =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { value: payload };
  return {
    content: [{ type: 'text', text: `${label}\n${body}` }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function clampTimeout(value) {
  const parsed = Number(value || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(parsed, 15 * 60_000);
}

function appendCapped(current, chunk) {
  if (current.length >= MAX_OUTPUT_CHARS) return current;
  const next = current + chunk.toString();
  return next.length > MAX_OUTPUT_CHARS ? next.slice(0, MAX_OUTPUT_CHARS) : next;
}

function resolvePath(input, fallback = WORKSPACE_ROOT) {
  const raw = String(input || '').trim();
  if (!raw) return path.resolve(fallback);
  return path.resolve(path.isAbsolute(raw) ? raw : path.join(fallback, raw));
}

function safeProjectName(value) {
  const name = String(value || 'Godot Game').trim().replace(/"/g, '');
  return name || 'Godot Game';
}

async function executableExists(file) {
  if (!file.includes('/')) return true;
  try {
    await access(file, FS_CONSTANTS.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function runProcess(command, args, opts = {}) {
  const timeoutMs = clampTimeout(opts.timeoutMs);
  return await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: opts.cwd || WORKSPACE_ROOT,
      env: { ...RUNTIME_ENV, ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendCapped(stderr, chunk);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut, command, args });
    });
  });
}

/**
 * The bind mounts of this container, as the host daemon sees them.
 *
 * A sibling container started through the socket proxy gets its volumes
 * resolved by that daemon, so `-v /workspace:/workspace` would mount the
 * *host* /workspace -- not ours. Mapping our own mount table lets us mount
 * each host source at the very path we know it by, so every argument Godot
 * receives stays valid on both sides and no path rewriting is needed.
 */
let selfMountsCache = null;
async function getSelfMounts() {
  if (selfMountsCache) return selfMountsCache;
  const containerId = RUNTIME_ENV.HOSTNAME || os.hostname();
  const result = await runProcess(DOCKER_BIN, ['inspect', containerId, '--format', '{{json .Mounts}}'], {
    timeoutMs: 15_000,
  });
  if (result.code !== 0) {
    throw new Error(`could not inspect own container (${containerId}): ${result.stderr.trim() || result.stdout.trim()}`);
  }
  const mounts = JSON.parse(result.stdout.trim() || '[]')
    .filter((mount) => mount.Type === 'bind' && mount.Source && mount.Destination)
    .map((mount) => ({ source: mount.Source, destination: mount.Destination.replace(/\/$/, ''), rw: mount.RW !== false }))
    .sort((a, b) => b.destination.length - a.destination.length);
  selfMountsCache = mounts;
  return mounts;
}

function isUnder(child, parent) {
  return child === parent || child.startsWith(parent.endsWith('/') ? parent : `${parent}/`);
}

/** Find the bind mount that carries `target`, so it can be handed to a sibling container. */
async function mountFor(target) {
  const mounts = await getSelfMounts();
  const hit = mounts.find((mount) => isUnder(target, mount.destination));
  if (!hit) {
    throw new Error(
      `${target} is not on a host-visible bind mount, so the Godot container cannot see it. ` +
        `Use a path under one of: ${mounts.map((mount) => mount.destination).join(', ')}`
    );
  }
  return hit;
}

let dockerImageCache = null;
async function findGodotDocker() {
  if (DOCKER_DISABLED) return { available: false, reason: 'GODOT_DOCKER_DISABLED is set' };
  if (dockerImageCache) return dockerImageCache;
  try {
    const present = await runProcess(DOCKER_BIN, ['image', 'inspect', DOCKER_IMAGE, '--format', '{{.Id}}'], {
      timeoutMs: 20_000,
    });
    if (present.code !== 0) {
      return {
        available: false,
        image: DOCKER_IMAGE,
        reason: `image ${DOCKER_IMAGE} is not available; build it with: docker build -t ${DOCKER_IMAGE} -f docker/godot/Dockerfile docker/godot`,
      };
    }
    const probe = await runProcess(
      DOCKER_BIN,
      ['run', '--rm', DOCKER_IMAGE, 'godot', '--headless', '--version'],
      { timeoutMs: 60_000 }
    );
    if (probe.code !== 0) {
      return { available: false, image: DOCKER_IMAGE, reason: probe.stderr.trim() || probe.stdout.trim() };
    }
    const version = `${probe.stdout}${probe.stderr}`.trim().split('\n').pop() || 'unknown';
    dockerImageCache = {
      available: true,
      mode: 'docker',
      image: DOCKER_IMAGE,
      imageId: present.stdout.trim(),
      version,
    };
    return dockerImageCache;
  } catch (err) {
    return { available: false, image: DOCKER_IMAGE, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run Godot, locally or in the engine container, with identical arguments.
 *
 * `opts.paths` lists every path the invocation touches; each one's bind mount
 * is passed through so the sibling container resolves it the same way we do.
 */
async function runGodot(godot, godotArgs, opts = {}) {
  if (godot.mode !== 'docker') {
    return await runProcess(godot.binary, godotArgs, opts);
  }

  const wanted = [opts.cwd, ...(opts.paths || [])].filter(Boolean);
  const mounts = new Map();
  for (const target of wanted) {
    const mount = await mountFor(target);
    mounts.set(`${mount.source}:${mount.destination}`, mount);
  }

  const dockerArgs = ['run', '--rm', '--init'];
  if (typeof process.getuid === 'function') {
    dockerArgs.push('-u', `${process.getuid()}:${process.getgid()}`);
  }
  for (const mount of mounts.values()) {
    dockerArgs.push('-v', `${mount.source}:${mount.destination}${mount.rw ? '' : ':ro'}`);
  }
  if (opts.cwd) dockerArgs.push('-w', opts.cwd);
  dockerArgs.push(godot.image, 'godot', ...godotArgs);

  const result = await runProcess(DOCKER_BIN, dockerArgs, { timeoutMs: opts.timeoutMs });
  return {
    ...result,
    command: 'godot',
    args: godotArgs,
    runner: { mode: 'docker', image: godot.image, mounts: [...mounts.values()] },
  };
}

async function findGodot() {
  const configured = String(RUNTIME_ENV.GODOT_BIN || '').trim();
  const candidates = configured
    ? [configured]
    : ['godot', 'godot4', '/usr/local/bin/godot', '/usr/local/bin/godot4', '/usr/bin/godot', '/usr/bin/godot4'];

  const failures = [];
  for (const candidate of candidates) {
    if (!(await executableExists(candidate))) {
      failures.push({ candidate, error: 'not executable' });
      continue;
    }
    try {
      const result = await runProcess(candidate, ['--version'], { timeoutMs: 5_000 });
      const version = `${result.stdout}${result.stderr}`.trim().split('\n')[0] || 'unknown';
      return { available: true, mode: 'local', binary: candidate, version, probe: result };
    } catch (err) {
      failures.push({ candidate, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const docker = await findGodotDocker();
  if (docker.available) return { ...docker, binary: null, localFailures: failures };

  return {
    available: false,
    binary: configured || null,
    message:
      'No Godot engine available. The official binary is glibc-linked and cannot run in this musl image, ' +
      `so the bridge expects the ${DOCKER_IMAGE} container instead: ` +
      `docker build -t ${DOCKER_IMAGE} -f docker/godot/Dockerfile docker/godot. ` +
      'Alternatively set GODOT_BIN to a musl-compatible Godot 4 binary.',
    failures,
    docker,
  };
}

async function walkProject(root, limit = 500) {
  const result = {
    scenes: [],
    scripts: [],
    resources: [],
    addons: [],
    other: [],
    truncated: false,
  };
  const stack = [''];

  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = path.join(root, rel || '');
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === '.godot' || entry.name === '.import' || entry.name === '.git') continue;
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (childRel.startsWith('addons')) result.addons.push(childRel);
        stack.push(childRel);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const target =
        ext === '.tscn' || ext === '.scn'
          ? result.scenes
          : ext === '.gd' || ext === '.cs'
            ? result.scripts
            : ['.tres', '.res', '.json', '.toml', '.cfg', '.import'].includes(ext)
              ? result.resources
              : result.other;
      target.push(childRel);
      const count =
        result.scenes.length +
        result.scripts.length +
        result.resources.length +
        result.addons.length +
        result.other.length;
      if (count >= limit) {
        result.truncated = true;
        return result;
      }
    }
  }

  result.scenes.sort();
  result.scripts.sort();
  result.resources.sort();
  result.addons.sort();
  result.other.sort();
  return result;
}

async function readProjectConfig(projectPath) {
  const file = path.join(projectPath, 'project.godot');
  try {
    const raw = await readFile(file, 'utf8');
    const nameMatch = raw.match(/config\/name\s*=\s*"([^"]+)"/);
    const mainSceneMatch = raw.match(/run\/main_scene\s*=\s*"([^"]+)"/);
    return {
      exists: true,
      file,
      name: nameMatch?.[1] || null,
      mainScene: mainSceneMatch?.[1] || null,
      bytes: raw.length,
    };
  } catch {
    return { exists: false, file, name: null, mainScene: null, bytes: 0 };
  }
}

async function toolInfo(args = {}) {
  const projectPath = args.project_path ? resolvePath(args.project_path) : null;
  const godot = await findGodot();
  const project = projectPath
    ? {
        path: projectPath,
        config: await readProjectConfig(projectPath),
        files: existsSync(projectPath) ? await walkProject(projectPath) : null,
      }
    : null;
  return asText('Godot MCP info', { godot, project, workspaceRoot: WORKSPACE_ROOT });
}

async function toolCreateProject(args = {}) {
  const projectPath = resolvePath(args.project_path);
  const name = safeProjectName(args.name);
  const overwrite = args.overwrite === true;
  const projectFile = path.join(projectPath, 'project.godot');

  if (existsSync(projectFile) && !overwrite) {
    throw new Error(`project.godot already exists at ${projectFile}; pass overwrite=true to replace starter files`);
  }

  await mkdir(path.join(projectPath, 'scenes'), { recursive: true });
  await mkdir(path.join(projectPath, 'scripts'), { recursive: true });
  await mkdir(path.join(projectPath, 'assets'), { recursive: true });

  const projectConfig = [
    'config_version=5',
    '',
    '[application]',
    `config/name="${name}"`,
    'run/main_scene="res://scenes/Main.tscn"',
    'config/features=PackedStringArray("4.x")',
    '',
    '[display]',
    'window/size/viewport_width=1280',
    'window/size/viewport_height=720',
    'window/stretch/mode="canvas_items"',
    'window/stretch/aspect="expand"',
    '',
    '[rendering]',
    'renderer/rendering_method="gl_compatibility"',
    'renderer/rendering_method.mobile="gl_compatibility"',
    '',
  ].join('\n');

  const mainScene = [
    '[gd_scene load_steps=2 format=3]',
    '',
    '[ext_resource type="Script" path="res://scripts/main.gd" id="1"]',
    '',
    '[node name="Main" type="Node2D"]',
    'script = ExtResource("1")',
    '',
  ].join('\n');

  const mainScript = [
    'extends Node2D',
    '',
    'func _ready() -> void:',
    `\tprint("${name} ready")`,
    '',
  ].join('\n');

  await writeFile(projectFile, projectConfig, 'utf8');
  await writeFile(path.join(projectPath, 'scenes', 'Main.tscn'), mainScene, 'utf8');
  await writeFile(path.join(projectPath, 'scripts', 'main.gd'), mainScript, 'utf8');

  return asText('Godot project created', {
    projectPath,
    name,
    files: [
      path.join(projectPath, 'project.godot'),
      path.join(projectPath, 'scenes', 'Main.tscn'),
      path.join(projectPath, 'scripts', 'main.gd'),
    ],
  });
}

async function toolListProject(args = {}) {
  const projectPath = resolvePath(args.project_path);
  return asText('Godot project files', {
    projectPath,
    config: await readProjectConfig(projectPath),
    files: await walkProject(projectPath, Number(args.limit || 500)),
  });
}

async function requireGodotBinary() {
  const godot = await findGodot();
  if (!godot.available) {
    const err = new Error(godot.message);
    err.details = godot;
    throw err;
  }
  return godot;
}

function describeRunner(godot) {
  return godot.mode === 'docker'
    ? { mode: 'docker', image: godot.image, version: godot.version }
    : { mode: 'local', binary: godot.binary, version: godot.version };
}

async function toolValidateProject(args = {}) {
  const projectPath = resolvePath(args.project_path);
  const godot = await requireGodotBinary();
  const result = await runGodot(godot, ['--headless', '--path', projectPath, '--quit'], {
    cwd: projectPath,
    paths: [projectPath],
    timeoutMs: args.timeout_ms,
  });
  return asText(
    'Godot validation finished',
    { projectPath, godot: describeRunner(godot), result },
    result.code !== 0 || result.timedOut
  );
}

async function toolRunGdscript(args = {}) {
  const projectPath = resolvePath(args.project_path);
  const godot = await requireGodotBinary();
  let scriptPath = args.script_path ? resolvePath(args.script_path, projectPath) : '';
  let tempDir = '';

  if (!scriptPath) {
    const source = String(args.script || '').trim();
    if (!source) throw new Error('script or script_path is required');
    const scratchRoot = godot.mode === 'docker' ? projectPath : os.tmpdir();
    tempDir = await mkdtemp(path.join(scratchRoot, '.plum-godot-mcp-'));
    scriptPath = path.join(tempDir, 'run.gd');
    await writeFile(scriptPath, source, 'utf8');
  }

  try {
    const extraArgs = Array.isArray(args.extra_args)
      ? args.extra_args.filter((item) => typeof item === 'string')
      : [];
    const result = await runGodot(
      godot,
      ['--headless', '--path', projectPath, '--script', scriptPath, ...extraArgs],
      { cwd: projectPath, paths: [projectPath, scriptPath], timeoutMs: args.timeout_ms }
    );
    return asText(
      'Godot script finished',
      { projectPath, scriptPath, godot: describeRunner(godot), result },
      result.code !== 0 || result.timedOut
    );
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

async function toolExportProject(args = {}) {
  const projectPath = resolvePath(args.project_path);
  const preset = String(args.preset || '').trim();
  if (!preset) throw new Error('preset is required');
  const outputPath = resolvePath(args.output_path, projectPath);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const godot = await requireGodotBinary();
  const exportMode = args.debug === true ? '--export-debug' : '--export-release';
  const result = await runGodot(
    godot,
    ['--headless', '--path', projectPath, exportMode, preset, outputPath],
    {
      cwd: projectPath,
      paths: [projectPath, path.dirname(outputPath)],
      timeoutMs: args.timeout_ms || 10 * 60_000,
    }
  );
  return asText(
    'Godot export finished',
    { projectPath, preset, outputPath, mode: exportMode, godot: describeRunner(godot), result },
    result.code !== 0 || result.timedOut
  );
}


async function assertProject(projectPath) {
  const config = await readProjectConfig(projectPath);
  if (!config.exists) {
    throw new Error(`no project.godot at ${projectPath}; create one first with godot_create_project`);
  }
  return config;
}

// --- export_presets.cfg -----------------------------------------------------
//
// Godot only writes this file from the editor GUI, but the CLI exporter reads
// it, so an automated pipeline has to author it. Missing option keys fall back
// to the platform defaults when Godot loads the preset, so a minimal block is
// enough and stays forward-compatible across engine versions.

function parsePresetSections(text) {
  const sections = [];
  let current = null;
  for (const line of text.split('\n')) {
    const header = line.match(/^\[([^\]]+)\]\s*$/);
    if (header) {
      current = { name: header[1], lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else if (line.trim()) sections.push({ name: null, lines: [line] });
  }
  return sections;
}

function serializePresetSections(sections) {
  return (
    sections
      .map((section) => {
        const body = section.lines.join('\n').replace(/^\n+|\n+$/g, '');
        return section.name ? `[${section.name}]\n\n${body}\n` : `${body}\n`;
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimStart() + ''
  );
}

function androidPresetBlocks(options) {
  const {
    name,
    packageName,
    displayName,
    exportPath,
    versionCode,
    versionName,
    architectures,
    internet,
    orientation,
    immersive,
  } = options;

  const head = [
    `name="${name}"`,
    'platform="Android"',
    'runnable=true',
    'advanced_options=false',
    'dedicated_server=false',
    'custom_features=""',
    'export_filter="all_resources"',
    'include_filter=""',
    'exclude_filter=""',
    `export_path="${exportPath}"`,
    'encryption_include_filters=""',
    'encryption_exclude_filters=""',
    'seed=0',
    'encrypt_pck=false',
    'encrypt_directory=false',
    'script_export_mode=2',
  ];

  const opts = [
    'custom_template/debug=""',
    'custom_template/release=""',
    'gradle_build/use_gradle_build=false',
    'gradle_build/export_format=0',
    ...['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'].map(
      (arch) => `architectures/${arch}=${architectures.includes(arch) ? 'true' : 'false'}`
    ),
    `version/code=${versionCode}`,
    `version/name="${versionName}"`,
    `package/unique_name="${packageName}"`,
    `package/name="${displayName}"`,
    'package/signed=true',
    'package/app_category=2',
    `screen/immersive_mode=${immersive ? 'true' : 'false'}`,
    'screen/support_small=true',
    'screen/support_normal=true',
    'screen/support_large=true',
    'screen/support_xlarge=true',
    'user_data_backup/allow=false',
    'command_line/extra_args=""',
    'apk_expansion/enable=false',
    `permissions/internet=${internet ? 'true' : 'false'}`,
  ];
  if (orientation) opts.push(`screen/orientation=${orientation}`);
  return { head, opts };
}

// Android export is hard-refused by the exporter unless the project imports
// ETC2/ASTC textures. There is no CLI flag and no preset option for it -- it is
// a project setting -- so the preset tool sets it, otherwise every new project
// would fail its first export on a setting the caller cannot see.
async function ensureAndroidProjectSettings(projectPath) {
  const file = path.join(projectPath, 'project.godot');
  const raw = await readFile(file, 'utf8');
  const key = 'textures/vram_compression/import_etc2_astc';
  const existing = raw.match(new RegExp(`^${key}\\s*=\\s*(\\S+)`, 'm'));
  if (existing) {
    if (existing[1] === 'true') return { changed: false, key, value: true };
    const patched = raw.replace(new RegExp(`^${key}\\s*=\\s*\\S+`, 'm'), `${key}=true`);
    await writeFile(file, patched, 'utf8');
    return { changed: true, key, value: true };
  }

  const lines = raw.split('\n');
  const header = lines.findIndex((line) => line.trim() === '[rendering]');
  if (header === -1) {
    const body = raw.endsWith('\n') ? raw : `${raw}\n`;
    await writeFile(file, `${body}\n[rendering]\n${key}=true\n`, 'utf8');
  } else {
    let end = header + 1;
    while (end < lines.length && !/^\[[^\]]+\]\s*$/.test(lines[end])) end += 1;
    while (end > header + 1 && !lines[end - 1].trim()) end -= 1;
    lines.splice(end, 0, `${key}=true`);
    await writeFile(file, lines.join('\n'), 'utf8');
  }
  return { changed: true, key, value: true };
}

async function writeAndroidPreset(projectPath, options) {
  const presetsPath = path.join(projectPath, 'export_presets.cfg');
  let sections = [];
  try {
    sections = parsePresetSections(await readFile(presetsPath, 'utf8'));
  } catch {
    sections = [];
  }

  const indexes = sections
    .map((section) => Number(section.name?.match(/^preset\.(\d+)$/)?.[1]))
    .filter((value) => Number.isFinite(value));
  let index = sections.find(
    (section) => /^preset\.\d+$/.test(section.name || '') && section.lines.some((line) => line.trim() === `name="${options.name}"`)
  );
  index = index ? Number(index.name.match(/^preset\.(\d+)$/)[1]) : (indexes.length ? Math.max(...indexes) + 1 : 0);

  const { head, opts } = androidPresetBlocks(options);
  const replaced = new Set([`preset.${index}`, `preset.${index}.options`]);
  const kept = sections.filter((section) => !replaced.has(section.name));
  kept.push({ name: `preset.${index}`, lines: head });
  kept.push({ name: `preset.${index}.options`, lines: opts });
  kept.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { numeric: true }));

  await writeFile(presetsPath, serializePresetSections(kept), 'utf8');
  return { presetsPath, presetIndex: index, preset: options.name };
}

async function toolAddAndroidPreset(args = {}) {
  const projectPath = resolvePath(args.project_path);
  await assertProject(projectPath);
  const packageName = String(args.package_name || '').trim();
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(packageName)) {
    throw new Error('package_name must be a valid Android application id, e.g. com.example.mygame');
  }
  const config = await readProjectConfig(projectPath);
  const projectSettings = await ensureAndroidProjectSettings(projectPath);
  const result = await writeAndroidPreset(projectPath, {
    name: String(args.preset || 'Android'),
    packageName,
    displayName: String(args.display_name || config?.name || path.basename(projectPath)),
    exportPath: String(args.export_path || 'build/android/game.apk'),
    versionCode: Number(args.version_code || 1),
    versionName: String(args.version_name || '1.0'),
    architectures: Array.isArray(args.architectures) && args.architectures.length
      ? args.architectures.map(String)
      : ['arm64-v8a'],
    internet: args.internet !== false,
    orientation: args.orientation ? Number(args.orientation) : null,
    immersive: args.immersive !== false,
  });
  return asText('Android export preset written', { projectPath, packageName, ...result, projectSettings });
}

async function importAssets(godot, projectPath, timeoutMs) {
  // --import exists on modern Godot 4; older builds only reimport as a side
  // effect of opening the editor, so fall back to that rather than fail.
  const direct = await runGodot(godot, ['--headless', '--path', projectPath, '--import'], {
    cwd: projectPath,
    paths: [projectPath],
    timeoutMs: timeoutMs || 10 * 60_000,
  });
  if (direct.code === 0) return { strategy: '--import', result: direct };

  const fallback = await runGodot(godot, ['--headless', '--editor', '--quit', '--path', projectPath], {
    cwd: projectPath,
    paths: [projectPath],
    timeoutMs: timeoutMs || 10 * 60_000,
  });
  return { strategy: '--editor --quit', result: fallback, importAttempt: direct };
}

async function toolImportAssets(args = {}) {
  const projectPath = resolvePath(args.project_path);
  await assertProject(projectPath);
  const godot = await requireGodotBinary();
  const imported = await importAssets(godot, projectPath, args.timeout_ms);
  const files = await walkProject(projectPath, Number(args.limit || 500));
  return asText(
    'Godot asset import finished',
    { projectPath, godot: describeRunner(godot), ...imported, resources: files.resources, other: files.other },
    imported.result.code !== 0 || imported.result.timedOut
  );
}

async function toolExportAndroid(args = {}) {
  const projectPath = resolvePath(args.project_path);
  await assertProject(projectPath);
  const preset = String(args.preset || 'Android');
  const outputPath = resolvePath(args.output_path || 'build/android/game.apk', projectPath);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const godot = await requireGodotBinary();
  let presetWrite = null;
  const presetsPath = path.join(projectPath, 'export_presets.cfg');
  const hasPreset = existsSync(presetsPath) && (await readFile(presetsPath, 'utf8')).includes(`name="${preset}"`);
  if (args.package_name || !hasPreset) {
    if (!args.package_name) {
      throw new Error(
        `no "${preset}" preset in export_presets.cfg; pass package_name (e.g. com.example.mygame) so one can be created`
      );
    }
    presetWrite = (await toolAddAndroidPreset({ ...args, preset })).structuredContent;
  }

  const imported = await importAssets(godot, projectPath, args.import_timeout_ms);
  const mode = args.release === true ? '--export-release' : '--export-debug';
  const result = await runGodot(godot, ['--headless', '--path', projectPath, mode, preset, outputPath], {
    cwd: projectPath,
    paths: [projectPath, path.dirname(outputPath)],
    timeoutMs: args.timeout_ms || 15 * 60_000,
  });

  let apk = null;
  try {
    const info = await stat(outputPath);
    apk = { path: outputPath, bytes: info.size, modified: info.mtime.toISOString() };
  } catch {
    apk = null;
  }

  return asText(
    apk ? 'Android APK exported' : 'Android export produced no APK',
    {
      projectPath,
      preset,
      mode,
      apk,
      presetWrite,
      import: { strategy: imported.strategy, code: imported.result.code },
      godot: describeRunner(godot),
      result,
      // The APK still has to reach a device, and adb lives in the
      // android-builder MCP -- hand the path to android_install from there.
      nextStep: apk
        ? `install with the android-builder MCP: android_install({ apkPath: "${outputPath}" })`
        : null,
    },
    !apk || result.code !== 0 || result.timedOut
  );
}

const TOOLS = [
  {
    name: 'godot_info',
    description:
      'Report Godot binary availability/version and optionally summarize a Godot project. Set GODOT_BIN when no godot/godot4 binary is on PATH.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Optional project directory. Relative paths resolve under /workspace.' },
      },
    },
  },
  {
    name: 'godot_create_project',
    description:
      'Create a minimal Godot 4 project with project.godot, scenes/Main.tscn, scripts/main.gd, and assets/. Does not require a Godot binary.',
    inputSchema: {
      type: 'object',
      required: ['project_path'],
      properties: {
        project_path: { type: 'string', description: 'Project directory. Relative paths resolve under /workspace.' },
        name: { type: 'string', description: 'Godot application name.' },
        overwrite: { type: 'boolean', description: 'Replace starter files if project.godot already exists.' },
      },
    },
  },
  {
    name: 'godot_list_project',
    description: 'List scenes, scripts, resources, addons, and project.godot metadata for a Godot project.',
    inputSchema: {
      type: 'object',
      required: ['project_path'],
      properties: {
        project_path: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 2000 },
      },
    },
  },
  {
    name: 'godot_validate_project',
    description: 'Run Godot headless against a project to catch parse/import/startup errors. Requires GODOT_BIN or godot/godot4 on PATH.',
    inputSchema: {
      type: 'object',
      required: ['project_path'],
      properties: {
        project_path: { type: 'string' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 900000 },
      },
    },
  },
  {
    name: 'godot_run_gdscript',
    description:
      'Run a GDScript file or inline GDScript with Godot headless. Useful for editor automation, import checks, and scripted project edits.',
    inputSchema: {
      type: 'object',
      required: ['project_path'],
      properties: {
        project_path: { type: 'string' },
        script_path: { type: 'string', description: 'Existing .gd script path.' },
        script: { type: 'string', description: 'Inline GDScript source. Use extends SceneTree for one-shot scripts.' },
        extra_args: { type: 'array', items: { type: 'string' } },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 900000 },
      },
    },
  },
  {
    name: 'godot_export_project',
    description: 'Run a Godot export preset in headless mode. Requires export_presets.cfg and a Godot binary.',
    inputSchema: {
      type: 'object',
      required: ['project_path', 'preset', 'output_path'],
      properties: {
        project_path: { type: 'string' },
        preset: { type: 'string' },
        output_path: { type: 'string' },
        debug: { type: 'boolean', description: 'Use --export-debug instead of --export-release.' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 900000 },
      },
    },
  },

  {
    name: 'godot_import_assets',
    description:
      'Reimport project resources so files dropped in from outside the editor -- glTF/.glb models exported by the Blender MCP, textures, audio -- become usable Godot resources. Run this after adding assets and before exporting.',
    inputSchema: {
      type: 'object',
      required: ['project_path'],
      properties: {
        project_path: { type: 'string' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 900000 },
        limit: { type: 'integer', minimum: 1, maximum: 2000 },
      },
    },
  },
  {
    name: 'godot_add_android_preset',
    description:
      'Write or update an Android export preset in export_presets.cfg. Godot normally authors this file from the editor GUI, so an automated pipeline needs this before a CLI Android export.',
    inputSchema: {
      type: 'object',
      required: ['project_path', 'package_name'],
      properties: {
        project_path: { type: 'string' },
        package_name: { type: 'string', description: 'Android application id, e.g. com.example.mygame' },
        preset: { type: 'string', description: 'Preset name. Defaults to "Android".' },
        display_name: { type: 'string', description: 'Launcher label. Defaults to the project name.' },
        export_path: { type: 'string', description: 'Default APK path, relative to the project.' },
        version_code: { type: 'integer', minimum: 1 },
        version_name: { type: 'string' },
        architectures: {
          type: 'array',
          items: { enum: ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'] },
          description: 'Defaults to ["arm64-v8a"], which covers current phones and tablets.',
        },
        internet: { type: 'boolean', description: 'Request the INTERNET permission. Default true.' },
        immersive: { type: 'boolean', description: 'Immersive fullscreen. Default true.' },
        orientation: {
          type: 'integer',
          description: '0 landscape, 1 portrait, 2 reverse landscape, 3 reverse portrait, 4 sensor landscape, 5 sensor portrait, 6 sensor.',
        },
      },
    },
  },
  {
    name: 'godot_export_android',
    description:
      'Build a signed debug APK: create the preset if needed, reimport assets, then export. Hand the returned apk.path to the android-builder MCP (android_install) to put it on a device.',
    inputSchema: {
      type: 'object',
      required: ['project_path'],
      properties: {
        project_path: { type: 'string' },
        package_name: { type: 'string', description: 'Required the first time, or to rewrite the preset.' },
        preset: { type: 'string' },
        output_path: { type: 'string', description: 'APK path. Defaults to build/android/game.apk in the project.' },
        release: { type: 'boolean', description: 'Export release instead of debug. Needs a release keystore.' },
        display_name: { type: 'string' },
        version_code: { type: 'integer', minimum: 1 },
        version_name: { type: 'string' },
        architectures: { type: 'array', items: { type: 'string' } },
        orientation: { type: 'integer' },
        immersive: { type: 'boolean' },
        internet: { type: 'boolean' },
        import_timeout_ms: { type: 'integer', minimum: 1000, maximum: 900000 },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 900000 },
      },
    },
  },
];

async function runTool(name, args) {
  switch (name) {
    case 'godot_info':
      return await toolInfo(args);
    case 'godot_create_project':
      return await toolCreateProject(args);
    case 'godot_list_project':
      return await toolListProject(args);
    case 'godot_validate_project':
      return await toolValidateProject(args);
    case 'godot_run_gdscript':
      return await toolRunGdscript(args);
    case 'godot_export_project':
      return await toolExportProject(args);
    case 'godot_import_assets':
      return await toolImportAssets(args);
    case 'godot_add_android_preset':
      return await toolAddAndroidPreset(args);
    case 'godot_export_android':
      return await toolExportAndroid(args);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pendingRequests = 0;
let inputClosed = false;

function maybeExit() {
  if (inputClosed && pendingRequests === 0) process.exit(0);
}

rl.on('line', async (line) => {
  if (!line.trim()) return;
  pendingRequests += 1;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    pendingRequests -= 1;
    maybeExit();
    return;
  }

  const id = msg.id;
  try {
    if (msg.method === 'initialize') {
      ok(id, {
        protocolVersion: msg.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-godot-webui', version: '0.1.0' },
      });
      return;
    }
    if (msg.method === 'tools/list') {
      ok(id, { tools: TOOLS });
      return;
    }
    if (msg.method === 'tools/call') {
      const { name, arguments: args = {} } = msg.params || {};
      const value = await runTool(name, args);
      ok(id, value);
      return;
    }
    if (msg.method === 'ping') {
      ok(id, {});
      return;
    }
    if (!msg.method?.startsWith('notifications/')) {
      fail(id, -32601, `Unknown method: ${msg.method}`);
    }
  } catch (err) {
    log('tool failed', err);
    const details = err?.details;
    ok(id, asText('Godot MCP error', { message: err instanceof Error ? err.message : String(err), details }, true));
  } finally {
    pendingRequests -= 1;
    maybeExit();
  }
});

rl.on('close', () => {
  inputClosed = true;
  maybeExit();
});
