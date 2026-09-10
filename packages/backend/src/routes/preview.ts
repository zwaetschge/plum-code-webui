import { get as pgGet } from '../db/pg.js';
import { Router } from 'express';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { config } from '../config.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { AppError } from '../middleware/errorHandler.js';
import { redactSensitiveText } from '../utils/sanitize.js';
import { buildRestrictedChildEnv } from '../utils/childProcessEnv.js';
import {
  STATIC_INIT_PATH,
  encodePreviewRoot,
  isAllowedPreviewPath,
  isPreviewStaticFile,
} from '../utils/previewStatic.js';

const router = Router();

type PreviewIcon = 'globe' | 'server' | 'zap' | 'database' | 'settings';
type PreviewSource = 'project' | 'saved' | 'common';

interface PreviewCandidate {
  port: number;
  name: string;
  icon: PreviewIcon;
  source: PreviewSource;
}

interface PreviewStartCommand {
  name: string;
  command: string;
  raw: string;
  running: boolean;
  pid: number | null;
  status: PreviewStartStatus;
  startedAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  outputTail: string;
}

interface PreviewProbeResult extends PreviewCandidate {
  reachable: boolean;
  status: number | null;
  title: string | null;
  contentType: string | null;
  error: string | null;
}

type PreviewStartStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error';

interface ResolvedStartScript {
  name: string;
  command: string;
  raw: string;
  manager: string;
  args: string[];
}

interface PreviewProcessRecord {
  userId: string;
  projectPath: string;
  scriptName: string;
  command: string;
  raw: string;
  child: ChildProcess;
  pid: number | null;
  status: Exclude<PreviewStartStatus, 'idle'>;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  outputTail: string;
}

const COMMON_PORTS: PreviewCandidate[] = [
  { port: 3000, name: 'Dev Server', icon: 'server', source: 'common' },
  { port: 5173, name: 'Vite', icon: 'zap', source: 'common' },
  { port: 5174, name: 'Vite Alt', icon: 'zap', source: 'common' },
  { port: 4173, name: 'Vite Preview', icon: 'zap', source: 'common' },
  { port: 8080, name: 'App', icon: 'globe', source: 'common' },
  { port: 8000, name: 'Static Server', icon: 'server', source: 'common' },
  { port: 4000, name: 'API', icon: 'database', source: 'common' },
  { port: 5000, name: 'App', icon: 'globe', source: 'common' },
  { port: 4321, name: 'Astro', icon: 'zap', source: 'common' },
  { port: 4200, name: 'Angular', icon: 'zap', source: 'common' },
  { port: 3333, name: 'Dev Server', icon: 'server', source: 'common' },
];

const ALLOWED_PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const MAX_PROCESS_OUTPUT_TAIL = 12_000;
const previewProcesses = new Map<string, PreviewProcessRecord>();

function previewProcessPath(): string {
  const parts = [
    '/home/node/.npm-global/bin',
    '/opt/plum-cli/bin',
    path.join(process.cwd(), 'node_modules', '.bin'),
    process.env.PATH || '',
  ].filter(Boolean);
  return parts.join(path.delimiter);
}

function isPortAllowed(port: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== config.port;
}

function isPathAllowed(dir: string): boolean {
  return isAllowedPreviewPath(dir);
}

function isSubpath(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function assertProjectOwnedByUser(projectPath: string, userId: string): Promise<void> {
  const owned = await pgGet(
    'SELECT id FROM sessions WHERE user_id = ? AND working_directory = ? LIMIT 1',
    userId,
    path.resolve(projectPath)
  );
  if (!owned) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
}

function isHtmlPreviewFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return (ext === '.html' || ext === '.htm') && isPreviewStaticFile(filePath);
}

function parseSavedPorts(value: unknown): number[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((part) => parseInt(part.trim(), 10))
    .filter(isPortAllowed)
    .slice(0, 40);
}

function processKey(projectPath: string, scriptName: string): string {
  return `${projectPath}\u0000${scriptName}`;
}

function isStartScriptName(scriptName: string): boolean {
  return /^(dev|start|serve|preview)$/i.test(scriptName);
}

function normalizePackageManager(manager: string): string {
  const normalized = manager.trim().split('@')[0]?.toLowerCase() || '';
  return ALLOWED_PACKAGE_MANAGERS.has(normalized) ? normalized : 'npm';
}

function displayStartCommand(manager: string, scriptName: string): string {
  if (manager === 'bun') return `bun run ${scriptName}`;
  return scriptName === 'start' ? `${manager} start` : `${manager} run ${scriptName}`;
}

function packageManagerArgs(manager: string, scriptName: string): string[] {
  if (manager === 'bun') return ['run', scriptName];
  return scriptName === 'start' ? ['start'] : ['run', scriptName];
}

function idleStartCommand(
  command: Omit<
    PreviewStartCommand,
    | 'running'
    | 'pid'
    | 'status'
    | 'startedAt'
    | 'completedAt'
    | 'exitCode'
    | 'signal'
    | 'error'
    | 'outputTail'
  >
): PreviewStartCommand {
  return {
    ...command,
    running: false,
    pid: null,
    status: 'idle',
    startedAt: null,
    completedAt: null,
    exitCode: null,
    signal: null,
    error: null,
    outputTail: '',
  };
}

function appendProcessOutput(record: PreviewProcessRecord, chunk: Buffer | string): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : chunk;
  record.outputTail = redactSensitiveText(record.outputTail + text).slice(-MAX_PROCESS_OUTPUT_TAIL);
}

function processState(record: PreviewProcessRecord): PreviewStartCommand {
  return {
    name: record.scriptName,
    command: record.command,
    raw: record.raw,
    running: record.status === 'starting' || record.status === 'running',
    pid: record.pid,
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    exitCode: record.exitCode,
    signal: record.signal,
    error: record.error,
    outputTail: record.outputTail,
  };
}

function attachStartCommandState(
  projectPath: string | null,
  userId: string,
  commands: PreviewStartCommand[]
): PreviewStartCommand[] {
  if (!projectPath) return commands;
  return commands.map((command) => {
    const record = previewProcesses.get(processKey(projectPath, command.name));
    return record?.userId === userId ? processState(record) : command;
  });
}

function addCandidate(
  candidates: Map<number, PreviewCandidate>,
  candidate: PreviewCandidate
): void {
  if (!isPortAllowed(candidate.port)) return;
  const existing = candidates.get(candidate.port);
  if (!existing || candidate.source === 'saved' || existing.source === 'common') {
    candidates.set(candidate.port, candidate);
  }
}

function extractPortsFromText(text: string): number[] {
  const ports = new Set<number>();
  const patterns = [
    /(?:^|\s)(?:--port|-p)\s+(\d{2,5})(?=\s|$)/g,
    /\bPORT\s*=\s*(\d{2,5})\b/g,
    /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/g,
    /\bport\s*[:=]\s*(\d{2,5})\b/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const port = parseInt(match[1] || '', 10);
      if (isPortAllowed(port)) ports.add(port);
    }
  }

  return Array.from(ports);
}

function frameworkCandidates(pkg: Record<string, unknown>): PreviewCandidate[] {
  const deps = {
    ...(typeof pkg.dependencies === 'object' && pkg.dependencies ? pkg.dependencies : {}),
    ...(typeof pkg.devDependencies === 'object' && pkg.devDependencies ? pkg.devDependencies : {}),
  } as Record<string, unknown>;

  const candidates: PreviewCandidate[] = [];
  if (deps.vite || deps['@vitejs/plugin-react']) {
    candidates.push({ port: 5173, name: 'Vite', icon: 'zap', source: 'project' });
  }
  if (deps.next) {
    candidates.push({ port: 3000, name: 'Next.js', icon: 'server', source: 'project' });
  }
  if (deps.astro) {
    candidates.push({ port: 4321, name: 'Astro', icon: 'zap', source: 'project' });
  }
  if (deps['@sveltejs/kit'] || deps.svelte) {
    candidates.push({ port: 5173, name: 'SvelteKit', icon: 'zap', source: 'project' });
  }
  if (deps.nuxt) {
    candidates.push({ port: 3000, name: 'Nuxt', icon: 'server', source: 'project' });
  }
  if (deps['@angular/cli'] || deps['@angular/core']) {
    candidates.push({ port: 4200, name: 'Angular', icon: 'zap', source: 'project' });
  }
  if (deps['react-scripts']) {
    candidates.push({ port: 3000, name: 'React Scripts', icon: 'server', source: 'project' });
  }

  return candidates;
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function staticPreviewUrlPath(rootPath: string, fileName: string): string {
  const params = new URLSearchParams({
    root: encodePreviewRoot(rootPath),
    file: fileName,
  });
  return `${STATIC_INIT_PATH}?${params.toString()}`;
}

async function detectPackageManager(
  projectPath: string,
  pkg: Record<string, unknown>
): Promise<string> {
  if (typeof pkg.packageManager === 'string') {
    const [name] = pkg.packageManager.split('@');
    if (name) return normalizePackageManager(name);
  }

  const lockFiles: Array<[string, string]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['package-lock.json', 'npm'],
  ];

  for (const [file, manager] of lockFiles) {
    try {
      await fs.access(path.join(projectPath, file));
      return normalizePackageManager(manager);
    } catch {
      // keep checking
    }
  }

  return normalizePackageManager('npm');
}

async function readPackageJson(projectPath: string): Promise<Record<string, unknown> | null> {
  const packageJsonText = await readTextIfExists(path.join(projectPath, 'package.json'));
  if (!packageJsonText) return null;
  try {
    return JSON.parse(packageJsonText) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function resolveStartScript(
  projectPath: string,
  scriptName: string
): Promise<ResolvedStartScript> {
  if (!isPathAllowed(projectPath)) {
    throw new AppError('Project path is not allowed', 403, 'PROJECT_PATH_FORBIDDEN');
  }
  if (!isStartScriptName(scriptName)) {
    throw new AppError('Script is not available for preview start', 400, 'SCRIPT_NOT_ALLOWED');
  }

  const pkg = await readPackageJson(projectPath);
  const scripts = typeof pkg?.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  const raw = (scripts as Record<string, unknown>)[scriptName];
  if (typeof raw !== 'string') {
    throw new AppError('Package script not found', 404, 'SCRIPT_NOT_FOUND');
  }

  const manager = await detectPackageManager(projectPath, pkg ?? {});
  return {
    name: scriptName,
    command: displayStartCommand(manager, scriptName),
    raw,
    manager,
    args: packageManagerArgs(manager, scriptName),
  };
}

async function projectHints(projectPath: string | null): Promise<{
  candidates: PreviewCandidate[];
  startCommands: PreviewStartCommand[];
}> {
  if (!projectPath || !isPathAllowed(projectPath)) {
    return { candidates: [], startCommands: [] };
  }

  const candidates = new Map<number, PreviewCandidate>();
  const startCommands: PreviewStartCommand[] = [];
  const pkg = await readPackageJson(projectPath);

  if (pkg) {
    for (const candidate of frameworkCandidates(pkg)) addCandidate(candidates, candidate);

    const scripts = typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
    const manager = await detectPackageManager(projectPath, pkg);

    for (const [scriptName, rawValue] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof rawValue !== 'string') continue;
      for (const port of extractPortsFromText(rawValue)) {
        addCandidate(candidates, {
          port,
          name: `${scriptName} script`,
          icon: rawValue.includes('vite') ? 'zap' : 'server',
          source: 'project',
        });
      }

      if (isStartScriptName(scriptName) && startCommands.length < 6) {
        startCommands.push(
          idleStartCommand({
            name: scriptName,
            command: displayStartCommand(manager, scriptName),
            raw: rawValue,
          })
        );
      }
    }
  }

  const configFiles = [
    'vite.config.ts',
    'vite.config.js',
    'vite.config.mjs',
    'next.config.ts',
    'next.config.js',
    'next.config.mjs',
    'astro.config.ts',
    'astro.config.mjs',
    'svelte.config.js',
    '.env',
    '.env.local',
    '.env.development',
  ];

  for (const file of configFiles) {
    const text = await readTextIfExists(path.join(projectPath, file));
    if (!text) continue;
    for (const port of extractPortsFromText(text)) {
      addCandidate(candidates, {
        port,
        name: file.startsWith('.env') ? '.env port' : `${file} port`,
        icon: 'settings',
        source: 'project',
      });
    }
  }

  return {
    candidates: Array.from(candidates.values()),
    startCommands,
  };
}

function stripTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return null;
  return match[1]
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
    .slice(0, 120);
}

function normalizeProbeError(error: Error): string {
  if ('code' in error && typeof error.code === 'string') {
    if (error.code === 'ECONNREFUSED') return 'closed';
    if (error.code === 'ETIMEDOUT') return 'timed out';
    return error.code.toLowerCase();
  }
  return error.message || 'unreachable';
}

async function probeCandidate(candidate: PreviewCandidate): Promise<PreviewProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    let body = '';
    const req = http.request(
      {
        host: '127.0.0.1',
        port: candidate.port,
        path: '/',
        method: 'GET',
        timeout: 1000,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.8,*/*;q=0.5',
        },
      },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (body.length < 64_000) body += chunk.slice(0, 64_000 - body.length);
        });
        res.on('end', () => {
          finish({
            reachable: true,
            status: res.statusCode ?? null,
            title: stripTitle(body),
            contentType: String(res.headers['content-type'] || '') || null,
            error: null,
          });
        });
        res.on('error', (err: Error) => {
          finish({
            reachable: true,
            status: res.statusCode ?? null,
            title: stripTitle(body),
            contentType: String(res.headers['content-type'] || '') || null,
            error: normalizeProbeError(err),
          });
        });
      }
    );

    const finish = (result: Omit<PreviewProbeResult, keyof PreviewCandidate>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...candidate, ...result });
    };

    const timer = setTimeout(() => {
      req?.destroy();
      finish({
        reachable: false,
        status: null,
        title: null,
        contentType: null,
        error: 'timed out',
      });
    }, 1200);

    req.on('timeout', () => {
      req.destroy(new Error('timed out'));
    });
    req.on('error', (err: Error) => {
      finish({
        reachable: false,
        status: null,
        title: null,
        contentType: null,
        error: normalizeProbeError(err),
      });
    });
    req.end();
  });
}

router.get('/config', requireAuth, (_req, res) => {
  res.json({
    enabled: Boolean(config.previewHostname),
    hostname: config.previewHostname ?? null,
  });
});

router.get('/static-file', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const rawProjectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : '';
  const rawFilePath = typeof req.query.filePath === 'string' ? req.query.filePath : '';
  const projectPath = rawProjectPath.trim() ? path.resolve(rawProjectPath) : '';
  const filePath = rawFilePath.trim() ? path.resolve(rawFilePath) : '';

  if (!projectPath || !filePath) {
    throw new AppError('Project path and file path are required', 400, 'VALIDATION_ERROR');
  }
  if (!isPathAllowed(projectPath)) {
    throw new AppError('Project path is not allowed', 403, 'PROJECT_PATH_FORBIDDEN');
  }
  await assertProjectOwnedByUser(projectPath, userId);
  if (!isSubpath(projectPath, filePath)) {
    throw new AppError('File is outside the project path', 403, 'FILE_PATH_FORBIDDEN');
  }
  if (!isPathAllowed(filePath)) {
    throw new AppError('File path is not allowed', 403, 'FILE_PATH_FORBIDDEN');
  }
  if (!isHtmlPreviewFile(filePath)) {
    throw new AppError('Only HTML files can be opened in preview', 400, 'NOT_HTML_FILE');
  }

  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('File not found', 404, 'NOT_FOUND');
    }
    throw err;
  }

  if (!stats.isFile()) {
    throw new AppError('Path is not a file', 400, 'NOT_FILE');
  }

  const relativePath = path.relative(projectPath, filePath).replace(/\\/g, '/');
  res.json({
    projectPath,
    filePath,
    relativePath,
    name: path.basename(filePath),
    urlPath: staticPreviewUrlPath(projectPath, relativePath),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  });
});

router.get('/ports', requireAuth, rateLimiters.portProbe, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const projectPath =
    typeof req.query.projectPath === 'string' && req.query.projectPath.trim()
      ? path.resolve(req.query.projectPath)
      : null;
  const savedPorts = parseSavedPorts(req.query.ports);
  const candidateMap = new Map<number, PreviewCandidate>();

  if (projectPath) await assertProjectOwnedByUser(projectPath, userId);
  const hints = await projectHints(projectPath);
  for (const candidate of hints.candidates) addCandidate(candidateMap, candidate);
  for (const port of savedPorts) {
    addCandidate(candidateMap, {
      port,
      name: `Port ${port}`,
      icon: 'globe',
      source: 'saved',
    });
  }
  for (const candidate of COMMON_PORTS) addCandidate(candidateMap, candidate);

  const candidates = Array.from(candidateMap.values()).slice(0, 48);
  const ports = await Promise.all(candidates.map(probeCandidate));
  ports.sort((a, b) => {
    if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
    const sourceRank: Record<PreviewSource, number> = { project: 0, saved: 1, common: 2 };
    if (sourceRank[a.source] !== sourceRank[b.source]) {
      return sourceRank[a.source] - sourceRank[b.source];
    }
    return a.port - b.port;
  });

  res.json({
    projectPath,
    scannedAt: new Date().toISOString(),
    ports,
    startCommands: attachStartCommandState(projectPath, userId, hints.startCommands),
    artifacts: [],
  });
});

router.post('/start', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const rawProjectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath : '';
  const rawScript = typeof req.body?.script === 'string' ? req.body.script : '';
  const projectPath = rawProjectPath.trim() ? path.resolve(rawProjectPath) : '';
  const scriptName = rawScript.trim();

  if (!projectPath || !scriptName) {
    throw new AppError('Project path and script are required', 400, 'VALIDATION_ERROR');
  }
  await assertProjectOwnedByUser(projectPath, userId);

  const script = await resolveStartScript(projectPath, scriptName);
  const key = processKey(projectPath, script.name);
  const existing = previewProcesses.get(key);
  if (existing?.status === 'starting' || existing?.status === 'running') {
    if (existing.userId !== userId) {
      throw new AppError('Preview process is unavailable', 409, 'PROCESS_UNAVAILABLE');
    }
    res.status(202).json(processState(existing));
    return;
  }

  const child = spawn(script.manager, script.args, {
    cwd: projectPath,
    env: {
      ...buildRestrictedChildEnv(),
      BROWSER: 'none',
      FORCE_COLOR: '1',
      PATH: previewProcessPath(),
      TERM: 'xterm-256color',
    },
    shell: false,
  });

  const record: PreviewProcessRecord = {
    userId,
    projectPath,
    scriptName: script.name,
    command: script.command,
    raw: script.raw,
    child,
    pid: child.pid ?? null,
    status: 'starting',
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    signal: null,
    error: null,
    outputTail: '',
  };
  previewProcesses.set(key, record);

  child.stdout?.on('data', (chunk: Buffer) => appendProcessOutput(record, chunk));
  child.stderr?.on('data', (chunk: Buffer) => appendProcessOutput(record, chunk));
  child.on('spawn', () => {
    record.pid = child.pid ?? null;
    record.status = 'running';
  });
  child.on('error', (err) => {
    record.status = 'error';
    record.completedAt = new Date().toISOString();
    record.error = err.message;
  });
  child.on('exit', (exitCode, signal) => {
    record.status = exitCode === 0 ? 'exited' : 'error';
    record.completedAt = new Date().toISOString();
    record.exitCode = exitCode;
    record.signal = signal;
    if (exitCode && !record.error) record.error = `Process exited with code ${exitCode}`;
  });

  res.status(202).json(processState(record));
});

router.post('/stop', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const rawProjectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath : '';
  const rawScript = typeof req.body?.script === 'string' ? req.body.script : '';
  const projectPath = rawProjectPath.trim() ? path.resolve(rawProjectPath) : '';
  const scriptName = rawScript.trim();

  if (!projectPath || !scriptName) {
    throw new AppError('Project path and script are required', 400, 'VALIDATION_ERROR');
  }
  if (!isPathAllowed(projectPath)) {
    throw new AppError('Project path is not allowed', 403, 'PROJECT_PATH_FORBIDDEN');
  }
  await assertProjectOwnedByUser(projectPath, userId);

  const record = previewProcesses.get(processKey(projectPath, scriptName));
  if (!record || record.userId !== userId) {
    throw new AppError('Preview process not found', 404, 'PROCESS_NOT_FOUND');
  }

  if (record.status === 'starting' || record.status === 'running') {
    record.child.kill('SIGTERM');
  }

  res.json(processState(record));
});

export default router;
