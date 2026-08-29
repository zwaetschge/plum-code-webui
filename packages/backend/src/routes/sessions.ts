import {
  get as pgGet,
  all as pgAll,
  run as pgRun,
  transaction as pgTransaction,
} from '../db/pg.js';
import { Router, raw, type NextFunction, type Request, type Response } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import os from 'os';
import multer from 'multer';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config.js';
import { safeJsonParse } from '../utils/json.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { getProcessManager } from '../websocket/index.js';
import { isAllowedBasePath } from '../utils/allowedPaths.js';
import { sanitizeFilename, ALLOWED_UPLOAD_MIME_TYPES } from '../utils/sanitize.js';
import { resolveConfigHome } from '../utils/configPaths.js';
import { readSkillLibraryItem } from '../utils/skillLibrary.js';
import { resolveContextWindow as contextWindowFor } from '../utils/contextWindow.js';
import { CLI_PROVIDERS, type CLIProvider } from '../services/cli-providers.js';
import { readLatestCodexContextSnapshot } from '../services/claude/ClaudeProcessManager.js';
import { scanProject } from '../utils/projectScanner.js';
import {
  buildSessionIconImagePrompt,
  generateSessionIconImage,
} from '../services/sessionIconGenerator.js';
import {
  ensureSessionIconThumbnail,
  parseSessionIconThumbnailSize,
  sessionIconCacheControl,
} from '../services/sessionIconThumbnail.js';
import { applyUntrustedFileHeaders } from '../utils/untrustedFile.js';
import { loadMessageMedia, resolveOwnedChatMedia } from '../services/chatMedia.js';
import {
  cancelChatUpload,
  ChatUploadError,
  createChatUpload,
  getChatUpload,
  putChatUploadChunk,
} from '../services/chatUploads.js';
import {
  getMessageHistorySnapshot,
  getSessionReadState,
  setSessionReadState,
} from '../services/sessionSync.js';
import { getEnabledCliProvidersForUser, getZaiApiConfigForUser } from './settings.js';

const router = Router();

const PROJECT_DESCRIPTION_CACHE_TTL_MS = 5 * 60 * 1000;
const projectDescriptionCache = new Map<
  string,
  {
    expiresAt: number;
    description: string | null;
  }
>();

// Validation schemas
export const createSessionSchema = z.object({
  name: z.string().min(1).max(100),
  workingDirectory: z.string().optional(), // Optional - will be auto-generated from name
  cliProvider: z
    .enum(['claude', 'zai', 'codex', 'opencode', 'pi', 'kimi'])
    .optional()
    .default('codex'),
  cliModel: z.string().trim().min(1).max(200).nullable().optional(),
  cliReasoning: z.string().trim().min(1).max(50).nullable().optional(),
  cliServiceTier: z.enum(['fast']).nullable().optional(),
  mode: z.enum(['planning', 'auto-accept', 'manual', 'danger']).optional().default('auto-accept'),
  surface: z.enum(['code', 'task']).optional().default('code'),
  initialMessage: z.string().trim().min(1).max(40000).optional(),
});

const updateSessionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  workingDirectory: z.string().min(1).optional(),
});

export const updateProviderSchema = z.object({
  cliProvider: z.enum(['claude', 'zai', 'codex', 'opencode', 'pi', 'kimi']),
});

const updateSessionModelSchema = z.object({
  model: z.string().trim().min(1).max(200).nullable().optional(),
});

const updateSessionReasoningSchema = z.object({
  reasoning: z.string().trim().min(1).max(50).nullable().optional(),
});

const updateSessionSubagentModelSchema = z.object({
  model: z.string().trim().min(1).max(200).nullable().optional(),
});

const updateSessionServiceTierSchema = z.object({
  serviceTier: z.enum(['fast']).nullable().optional(),
});

const updateModeSchema = z.object({
  mode: z.enum(['planning', 'auto-accept', 'manual', 'danger']),
});

const updateSurfaceSchema = z.object({
  surface: z.enum(['code', 'task']),
});

const updateSessionStylesSchema = z.object({
  designStyleSkill: z.string().min(1).max(100).nullable().optional(),
  writingStyleSkill: z.string().min(1).max(100).nullable().optional(),
});

const generateSessionIconSchema = z.object({
  prompt: z.string().trim().min(3).max(800).optional(),
});

function compactProjectDescription(value: string | null | undefined): string | null {
  const compact = value?.replace(/\s+/g, ' ').trim();
  if (!compact) return null;

  const firstSentence = compact.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? compact;
  if (firstSentence.length <= 180) return firstSentence;
  return `${firstSentence.slice(0, 177).trim()}...`;
}

async function getCachedProjectDescription(workingDirectory: unknown): Promise<string | null> {
  if (typeof workingDirectory !== 'string' || !workingDirectory.trim()) return null;

  const projectPath = path.resolve(workingDirectory);
  const cached = projectDescriptionCache.get(projectPath);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.description;

  const scanned = await scanProject(projectPath).catch(() => null);
  const detectedProjectShape = scanned
    ? [
        scanned.framework ? `${scanned.framework} project` : null,
        scanned.techStack.length > 0 ? `using ${scanned.techStack.slice(0, 3).join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' ')
    : '';
  const description =
    compactProjectDescription(scanned?.description) ||
    compactProjectDescription(
      detectedProjectShape
        ? `${scanned?.name || path.basename(projectPath)} is a ${detectedProjectShape}.`
        : null
    );
  projectDescriptionCache.set(projectPath, {
    expiresAt: now + PROJECT_DESCRIPTION_CACHE_TTL_MS,
    description,
  });
  return description;
}

async function attachProjectDescription<T extends Record<string, unknown>>(session: T): Promise<T> {
  return {
    ...session,
    projectDescription: await getCachedProjectDescription(session.workingDirectory),
  };
}

const SESSION_ICON_DIR =
  process.env.SESSION_ICON_DIR ||
  path.resolve(process.cwd(), 'packages/backend/data/session-icons');
const MAX_ICON_BYTES = 6 * 1024 * 1024;

const ICON_EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/svg+xml': '.svg',
};

const ICON_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const ALLOWED_ICON_EXTENSIONS = new Set(Object.keys(ICON_MIME_BY_EXT));
const AUTO_GOAL_MIN_CHARS = 220;
const AUTO_GOAL_MAX_CHARS = 3200;
const AUTO_GOAL_ACTION_HINT =
  /\b(add|build|connect|create|debug|design|finish|fix|implement|integrate|migrate|polish|refactor|rewrite|ship|test|update|wire)\b/i;

const iconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ICON_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ICON_EXT_BY_MIME[file.mimetype] || ALLOWED_ICON_EXTENSIONS.has(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error(`Unsupported icon type: ${file.mimetype || ext || 'unknown'}`));
  },
});

const createSessionUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 20,
  },
  fileFilter: (_req, file, cb) => {
    if (
      ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype) ||
      !file.mimetype ||
      file.mimetype === '' ||
      file.mimetype.startsWith('text/')
    ) {
      cb(null, true);
      return;
    }
    cb(new Error(`Unsupported file type: ${file.mimetype || file.originalname || 'unknown'}`));
  },
});

function parseCreateSessionUpload(req: Request, res: Response, next: NextFunction) {
  createSessionUpload.array('files', 20)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? 'File too large (max 50MB)'
            : err.code === 'LIMIT_FILE_COUNT'
              ? 'Too many files (max 20)'
              : err.message;
        return res.status(400).json({
          success: false,
          error: { message, code: err.code },
        });
      }
      return res.status(400).json({
        success: false,
        error: { message: err.message, code: 'UPLOAD_ERROR' },
      });
    }
    next();
  });
}

// Validate working directory
function validateWorkingDirectory(dir: string): boolean {
  return isAllowedBasePath(dir);
}

async function assertProviderEnabled(userId: string, provider: CLIProvider): Promise<void> {
  if (!(await getEnabledCliProvidersForUser(userId)).includes(provider)) {
    throw new AppError(
      `${CLI_PROVIDERS[provider].name} is disabled in Settings`,
      409,
      'PROVIDER_DISABLED'
    );
  }
  if (provider === 'zai' && !(await getZaiApiConfigForUser(userId))) {
    throw new AppError(
      'Configure Z.AI in Settings before starting a Z.AI session',
      409,
      'PROVIDER_NOT_CONFIGURED'
    );
  }
}

// Sanitize session name for folder creation
function sanitizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äöüß]/g, (char) => {
      const map: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
      return map[char] || char;
    })
    .replace(/[^a-z0-9-_]/g, '-') // Replace non-alphanumeric chars with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .substring(0, 100); // Limit length
}

async function persistCreateSessionUploads(
  files: Express.Multer.File[] | undefined,
  workingDirectory: string
) {
  if (!files || files.length === 0) return [];

  const uploads = [];
  for (const file of files) {
    const filename = sanitizeFilename(file.originalname);
    const destination = path.join(workingDirectory, filename);
    await fs.writeFile(destination, file.buffer);
    uploads.push({
      name: filename,
      path: destination,
      size: file.size,
    });
  }

  return uploads;
}

function buildAutoGoalObjective(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed || trimmed.startsWith('/')) return null;

  const lineCount = trimmed.split(/\n/).filter((line) => line.trim()).length;
  const hasLongShape =
    trimmed.length >= AUTO_GOAL_MIN_CHARS ||
    lineCount >= 4 ||
    (trimmed.length >= 140 && AUTO_GOAL_ACTION_HINT.test(trimmed));

  if (!hasLongShape) return null;

  const compact = trimmed.replace(/\s+/g, ' ');
  const clipped =
    compact.length > AUTO_GOAL_MAX_CHARS
      ? `${compact.slice(0, AUTO_GOAL_MAX_CHARS - 3).trim()}...`
      : compact;

  return `Work through this request end-to-end and maintain an updated todo list: ${clipped}`;
}

// Ensure directory exists
async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * A cache-busting suffix derived from the icon's path, so a replaced icon gets
 * a new URL.
 *
 * `right(x, 16)` rather than `substr(x, -16)`: SQLite counts a negative start
 * from the end of the string, Postgres treats it as a position before the
 * start and returns the whole path — which would put the full filesystem path
 * of every icon into a URL the browser sees.
 */
function sessionIconSelect(prefix = ''): string {
  const p = prefix ? `${prefix}.` : '';
  return `CASE
                WHEN ${p}icon_path IS NOT NULL AND ${p}icon_path != ''
                THEN '/api/sessions/' || ${p}id || '/icon?v=' ||
                     encode(convert_to(right(${p}icon_path, 16), 'UTF8'), 'hex')
                ELSE NULL
              END as iconUrl,
              ${p}icon_source as iconSource`;
}

export function sessionUnreadCountSelect(alias = 's'): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias)) throw new Error('invalid SQL alias');
  return `(
    SELECT COUNT(*)
      FROM messages unread_message
     WHERE unread_message.session_id = ${alias}.id
       AND unread_message.chat_id IS ${alias}.active_chat_id
       AND unread_message.role = 'assistant'
       AND unread_message.seq > COALESCE((
         SELECT marker.seq
           FROM session_reads read_state
           JOIN messages marker ON marker.id = read_state.last_read_message_id
          WHERE read_state.user_id = ${alias}.user_id
            AND read_state.session_id = ${alias}.id
            AND read_state.chat_key = COALESCE(${alias}.active_chat_id, '')
          LIMIT 1
       ), 0)
  ) AS unreadCount`;
}

function getIconExtension(filename: string | undefined, mimetype?: string): string {
  const fromMime = mimetype ? ICON_EXT_BY_MIME[mimetype] : null;
  const fromName = path.extname(filename || '').toLowerCase();
  const ext = fromMime || fromName || '.png';
  if (!ALLOWED_ICON_EXTENSIONS.has(ext)) {
    throw new AppError('Unsupported icon file type', 400, 'INVALID_ICON');
  }
  return ext === '.jpeg' ? '.jpg' : ext;
}

function assertSafeSvg(buffer: Buffer): void {
  const content = buffer.toString('utf8', 0, Math.min(buffer.length, 256 * 1024)).toLowerCase();
  if (
    content.includes('<script') ||
    content.includes('javascript:') ||
    content.includes('<foreignobject') ||
    /\son[a-z]+\s*=/.test(content)
  ) {
    throw new AppError('SVG icon contains unsafe markup', 400, 'INVALID_ICON');
  }
}

function resolveSessionIconPath(iconPath: string): string {
  const base = path.resolve(SESSION_ICON_DIR);
  const resolved = path.resolve(iconPath);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new AppError('Stored icon path is invalid', 500, 'INVALID_ICON_PATH');
  }
  return resolved;
}

async function removeExistingSessionIcons(sessionId: string): Promise<void> {
  await ensureDir(SESSION_ICON_DIR);
  const entries = await fs.readdir(SESSION_ICON_DIR).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(`${sessionId}-`))
      .map(
        async (entry) => await fs.unlink(path.join(SESSION_ICON_DIR, entry)).catch(() => undefined)
      )
  );
}

async function selectSessionById(
  sessionId: string,
  userId?: string
): Promise<Record<string, unknown> | undefined> {
  const whereUser = userId ? 'AND s.user_id = ?' : '';
  const params = userId ? [sessionId, userId] : [sessionId];
  return (await pgGet(
    `SELECT s.id, s.user_id as userId, s.name, s.working_directory as workingDirectory,
              s.claude_session_id as claudeSessionId, s.status, s.last_message as lastMessage,
              ${sessionIconSelect('s')},
              s.starred, s.category, s.cli_provider as cliProvider, s.mode, s.surface,
              s.active_chat_id as activeChatId,
              s.cli_model as cliModel, s.cli_reasoning as cliReasoning,
              s.cli_service_tier as cliServiceTier,
              s.subagent_model as subagentModel,
              s.design_style_skill as designStyleSkill,
              s.writing_style_skill as writingStyleSkill,
              s.android_device_serial as androidDeviceSerial,
              s.home_assistant_entity_id as homeAssistantEntityId,
              ${sessionUnreadCountSelect('s')},
              COALESCE(s.archived, 0) as archived,
              strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', s.updated_at) as updatedAt
       FROM sessions s WHERE s.id = ? ${whereUser}`,
    ...params
  )) as unknown as Record<string, unknown> | undefined;
}

async function storeSessionIcon(
  sessionId: string,
  userId: string,
  buffer: Buffer,
  ext: string,
  source: 'upload' | 'project' | 'generated'
): Promise<Record<string, unknown>> {
  if (buffer.length > MAX_ICON_BYTES) {
    throw new AppError('Icon file is too large', 400, 'ICON_TOO_LARGE');
  }
  if (ext === '.svg') assertSafeSvg(buffer);
  await ensureDir(SESSION_ICON_DIR);
  await removeExistingSessionIcons(sessionId);
  const filename = `${sessionId}-${nanoid(10)}${ext}`;
  const iconPath = path.join(SESSION_ICON_DIR, filename);
  await fs.writeFile(iconPath, buffer);
  await pgRun(
    `UPDATE sessions
     SET icon_path = ?, icon_source = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    iconPath,
    source,
    sessionId,
    userId
  );
  const updated = await selectSessionById(sessionId, userId);
  if (!updated) throw new AppError('Session not found', 404, 'NOT_FOUND');
  return { ...updated, starred: Boolean(updated.starred) };
}

const ROOT_PROJECT_ICON_CANDIDATES = [
  '.plum/icon.png',
  '.plum/icon.webp',
  '.plum/icon.jpg',
  '.plum/icon.svg',
  'plum-icon.png',
  'icon.png',
  'icon.webp',
  'favicon.png',
  'favicon.ico',
  'favicon.svg',
  'public/icon.png',
  'public/icon.webp',
  'public/favicon.png',
  'public/favicon.ico',
  'public/favicon.svg',
  'public/icons/icon-1024.png',
  'public/icons/icon-512.png',
  'public/icons/icon-384.png',
  'public/icons/icon-256.png',
  'public/icons/icon-192.png',
  'public/icons/maskable-512.png',
  'public/icons/maskable-192.png',
  'public/icons/apple-touch-icon.png',
  'app/icon.png',
  'app/favicon.ico',
  'src/app/icon.png',
  'src/app/favicon.ico',
  'src-tauri/icons/icon.png',
  'src-tauri/icons/128x128.png',
  'assets/icon.png',
  'assets/favicon.png',
  'resources/icon.png',
];

const NESTED_PROJECT_ICON_CANDIDATES = [
  'resources/icon.png',
  'resources/icon.webp',
  'resources/icon.jpg',
  'public/icons/icon-1024.png',
  'public/icons/icon-512.png',
  'public/icons/icon-384.png',
  'public/icons/icon-256.png',
  'public/icons/icon-192.png',
  'public/icons/maskable-512.png',
  'public/icons/maskable-192.png',
  'public/icons/apple-touch-icon.png',
  'public/favicon.svg',
  'public/favicon.ico',
  'public/favicon.png',
  'public/icon.png',
  'app/icon.png',
  'app/favicon.ico',
  'src/app/icon.png',
  'src/app/favicon.ico',
  'assets/icon.png',
  'assets/favicon.png',
  'src-tauri/icons/icon.png',
  'src-tauri/icons/128x128.png',
];

function isPathInside(basePath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(basePath), path.resolve(candidatePath));
  return (
    relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function addIconCandidate(
  candidates: string[],
  seen: Set<string>,
  projectRoot: string,
  basePath: string,
  relPath: string | null | undefined
): void {
  const trimmed = relPath?.trim();
  if (!trimmed || /^(?:https?:|data:|file:)/i.test(trimmed)) return;
  const resolved = path.resolve(basePath, trimmed.replace(/^[/\\]+/, ''));
  if (!isPathInside(projectRoot, resolved) || seen.has(resolved)) return;
  seen.add(resolved);
  candidates.push(resolved);
}

async function collectProjectIconSearchRoots(projectRoot: string): Promise<string[]> {
  const roots = [projectRoot];
  const seen = new Set(roots.map((root) => path.resolve(root)));

  const addRoot = async (candidate: string) => {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved) || !isPathInside(projectRoot, resolved)) return;
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) return;
      seen.add(resolved);
      roots.push(resolved);
    } catch {
      // not a directory
    }
  };

  for (const rel of ['desktop', 'frontend', 'client', 'app']) {
    await addRoot(path.join(projectRoot, rel));
  }

  for (const rel of ['packages', 'apps']) {
    const container = path.join(projectRoot, rel);
    const entries = await fs.readdir(container, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await addRoot(path.join(container, entry.name));
      }
    }
  }

  return roots;
}

function manifestIconScore(sizes: string | undefined): number {
  if (!sizes) return 0;
  if (sizes.toLowerCase() === 'any') return 1_000_000;
  const scores = [...sizes.matchAll(/(\d+)\s*x\s*(\d+)/gi)].map((match) => {
    const width = Number(match[1]);
    const height = Number(match[2]);
    return Number.isFinite(width) && Number.isFinite(height) ? width * height : 0;
  });
  return scores.length ? Math.max(...scores) : 0;
}

async function addPackageJsonIconCandidates(
  candidates: string[],
  seen: Set<string>,
  projectRoot: string,
  searchRoot: string
): Promise<void> {
  try {
    const raw = await fs.readFile(path.join(searchRoot, 'package.json'), 'utf8');
    const parsed = safeJsonParse<{
      icon?: unknown;
      icons?: unknown;
      build?: {
        icon?: unknown;
        linux?: { icon?: unknown };
        directories?: { buildResources?: unknown };
      };
    }>(raw, {});
    const refs = [parsed.icon, parsed.build?.icon, parsed.build?.linux?.icon].filter(
      (value): value is string => typeof value === 'string'
    );

    const buildResources =
      typeof parsed.build?.directories?.buildResources === 'string'
        ? parsed.build.directories.buildResources
        : null;
    for (const ref of refs) {
      addIconCandidate(candidates, seen, projectRoot, searchRoot, ref);
      if (buildResources && !ref.includes('/') && !ref.includes('\\')) {
        addIconCandidate(candidates, seen, projectRoot, searchRoot, path.join(buildResources, ref));
      }
    }
  } catch {
    // package.json is optional
  }
}

async function addManifestIconCandidates(
  candidates: string[],
  seen: Set<string>,
  projectRoot: string,
  searchRoot: string
): Promise<void> {
  for (const manifest of ['public/manifest.json', 'public/site.webmanifest', 'manifest.json']) {
    try {
      const manifestPath = path.join(searchRoot, manifest);
      const raw = await fs.readFile(manifestPath, 'utf8');
      const parsed = safeJsonParse<{ icons?: Array<{ src?: string; sizes?: string }> }>(raw, {});
      const icons = parsed.icons
        ?.slice()
        .sort((a, b) => manifestIconScore(b.sizes) - manifestIconScore(a.sizes))
        .filter((item) => item.src);
      for (const icon of icons ?? []) {
        addIconCandidate(candidates, seen, projectRoot, path.dirname(manifestPath), icon.src);
      }
    } catch {
      // manifest is optional
    }
  }
}

export async function readProjectIconCandidate(projectPath: string): Promise<{
  path: string;
  buffer: Buffer;
  ext: string;
} | null> {
  const projectRoot = path.resolve(projectPath);
  const searchRoots = await collectProjectIconSearchRoots(projectRoot);
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const searchRoot of searchRoots) {
    const rels =
      searchRoot === projectRoot ? ROOT_PROJECT_ICON_CANDIDATES : NESTED_PROJECT_ICON_CANDIDATES;
    for (const rel of rels) {
      addIconCandidate(candidates, seen, projectRoot, searchRoot, rel);
    }
    await addPackageJsonIconCandidates(candidates, seen, projectRoot, searchRoot);
    await addManifestIconCandidates(candidates, seen, projectRoot, searchRoot);
  }

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile() || stat.size > MAX_ICON_BYTES) continue;
      const ext = getIconExtension(candidate);
      const buffer = await fs.readFile(candidate);
      return { path: candidate, buffer, ext };
    } catch {
      // try next candidate
    }
  }

  return null;
}

export function buildGeneratedIconPrompt(session: {
  name: string;
  workingDirectory: string;
}): string {
  return buildSessionIconImagePrompt(session);
}

export function buildCodexSessionIconMessage(
  session: { name: string; workingDirectory: string },
  prompt?: string | null
): string {
  const text = (prompt?.trim() || buildGeneratedIconPrompt(session)).replace(/\s+/g, ' ').trim();
  return `$imagegen ${text}`;
}

function attachRuntime<T extends Record<string, unknown>>(session: T): T & { runtime: unknown } {
  const id = typeof session.id === 'string' ? session.id : '';
  return {
    ...session,
    runtime: id ? getProcessManager().getSessionRuntimeSnapshot(id) : null,
  };
}

interface SessionUsageSnapshot {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  contextWindow: number;
  contextUsedPercent: number;
  contextUsedPercentRaw?: number;
  contextExceeded?: boolean;
  totalCostUsd: number;
  model: string;
  recordedAt?: string;
}

interface SessionTelemetry {
  usage: SessionUsageSnapshot | null;
  contextSnapshots: number;
  compactEvents: number;
}

async function getSessionTelemetrySnapshot(
  session: {
    id: string;
    userId: string;
    cliProvider: CLIProvider | null;
    cliModel?: string | null;
    claudeSessionId?: string | null;
    workingDirectory?: string | null;
  },
  runtime?: { model: string | null; usage?: SessionUsageSnapshot | null } | null
): Promise<SessionTelemetry> {
  const counts = (await pgAll(
    `
      SELECT event_type as eventType, COUNT(*) as count
      FROM session_events
      WHERE session_id = ? AND user_id = ?
        AND event_type IN ('context_snapshot', 'compact')
      GROUP BY event_type
    `,
    session.id,
    session.userId
  )) as unknown as Array<{ eventType: string; count: number }>;

  let contextSnapshots = 0;
  let compactEvents = 0;
  for (const row of counts) {
    if (row.eventType === 'context_snapshot') {
      contextSnapshots = row.count;
    } else if (row.eventType === 'compact') {
      compactEvents = row.count;
    }
  }

  const latestContext = (await pgGet(
    `
      SELECT
        session_id as sessionId,
        input_tokens as inputTokens,
        output_tokens as outputTokens,
        cache_read_tokens as cacheReadTokens,
        cache_creation_tokens as cacheCreationTokens,
        total_tokens as totalTokens,
        context_window as contextWindow,
        context_used_percent as contextUsedPercent,
        context_exceeded as contextExceeded,
        model,
        metadata_json as metadataJson,
        created_at as createdAt
      FROM session_events
      WHERE session_id = ? AND user_id = ? AND event_type = 'context_snapshot'
      ORDER BY created_at DESC, seq DESC
      LIMIT 1
    `,
    session.id,
    session.userId
  )) as unknown as
    | {
        sessionId: string;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        totalTokens: number;
        contextWindow: number;
        contextUsedPercent: number;
        contextExceeded: number;
        model: string | null;
        metadataJson: string | null;
        createdAt: string | null;
      }
    | undefined;

  const runtimeModel = runtime?.model && runtime.model !== 'unknown' ? runtime.model.trim() : null;
  const sessionModel =
    session.cliModel && session.cliModel !== 'unknown' ? session.cliModel.trim() : null;
  const fallbackModel =
    latestContext?.model?.trim() ||
    runtimeModel ||
    sessionModel ||
    (session.cliProvider ? CLI_PROVIDERS[session.cliProvider]?.defaultModel : null) ||
    null;
  const normalizedModel = fallbackModel || 'unknown';
  const fallbackContextWindow = contextWindowFor(fallbackModel);
  const latestMetadata = safeJsonParse<Record<string, unknown>>(latestContext?.metadataJson, {});
  const latestTotalCost =
    typeof latestMetadata.totalCostUsd === 'number' ? latestMetadata.totalCostUsd : 0;
  const latestRecordedAt = latestContext?.createdAt
    ? new Date(`${latestContext.createdAt.replace(' ', 'T')}Z`).toISOString()
    : undefined;

  const codexHome = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
  const codexContext =
    session.cliProvider === 'codex'
      ? await readLatestCodexContextSnapshot(codexHome, {
          threadId: session.claudeSessionId,
          cwd: session.workingDirectory,
        })
      : null;
  const codexContextUsage: SessionUsageSnapshot | null = codexContext
    ? (() => {
        const contextWindow = codexContext.contextWindow || fallbackContextWindow;
        const inputTotal = Math.max(codexContext.counters.input, 0);
        const cached = Math.min(Math.max(codexContext.counters.cached, 0), inputTotal);
        const output = Math.max(codexContext.counters.output, 0);
        const totalTokens = contextWindow > 0 ? Math.min(inputTotal + output, contextWindow) : 0;
        const contextUsedPercentRaw =
          contextWindow > 0 ? Math.round((totalTokens / contextWindow) * 100) : 0;
        return {
          sessionId: session.id,
          inputTokens: Math.max(inputTotal - cached, 0),
          outputTokens: output,
          cacheReadTokens: cached,
          cacheCreationTokens: 0,
          totalTokens,
          contextWindow,
          contextUsedPercent: Math.max(0, Math.min(100, contextUsedPercentRaw)),
          contextUsedPercentRaw,
          contextExceeded: false,
          totalCostUsd: latestTotalCost,
          model: codexContext.model || normalizedModel,
          recordedAt: codexContext.recordedAt,
        };
      })()
    : null;

  const dbUsage: SessionUsageSnapshot | null = latestContext
    ? {
        sessionId: session.id,
        inputTokens: latestContext.inputTokens || 0,
        outputTokens: latestContext.outputTokens || 0,
        cacheReadTokens: latestContext.cacheReadTokens || 0,
        cacheCreationTokens: latestContext.cacheCreationTokens || 0,
        totalTokens: latestContext.totalTokens || 0,
        contextWindow: latestContext.contextWindow || fallbackContextWindow,
        contextUsedPercent: Math.max(0, Math.min(100, latestContext.contextUsedPercent || 0)),
        contextUsedPercentRaw: latestContext.contextUsedPercent || 0,
        contextExceeded: Boolean(latestContext.contextExceeded),
        totalCostUsd: latestTotalCost,
        model: normalizedModel,
        recordedAt: latestRecordedAt,
      }
    : fallbackContextWindow > 0
      ? {
          sessionId: session.id,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          totalTokens: 0,
          contextWindow: fallbackContextWindow,
          contextUsedPercent: 0,
          contextUsedPercentRaw: 0,
          contextExceeded: false,
          totalCostUsd: 0,
          model: normalizedModel,
          recordedAt: undefined,
        }
      : null;

  const rawRuntimeUsage = runtime?.usage || null;
  const runtimeUsage =
    rawRuntimeUsage &&
    rawRuntimeUsage.totalTokens <= 0 &&
    codexContextUsage &&
    codexContextUsage.totalTokens > 0
      ? null
      : rawRuntimeUsage &&
          rawRuntimeUsage.contextUsedPercent >= 100 &&
          codexContextUsage &&
          codexContextUsage.contextUsedPercent < 100
        ? null
        : rawRuntimeUsage;
  const usageCandidates = [dbUsage, codexContextUsage, runtimeUsage].filter(
    Boolean
  ) as SessionUsageSnapshot[];
  const selectedUsage = usageCandidates.reduce<SessionUsageSnapshot | null>((best, candidate) => {
    if (!best) return candidate;
    const bestMs = best.recordedAt ? Date.parse(best.recordedAt) : 0;
    const candidateMs = candidate.recordedAt ? Date.parse(candidate.recordedAt) : 0;
    if (candidateMs > bestMs) return candidate;
    if (
      candidateMs === bestMs &&
      best.contextUsedPercent >= 100 &&
      candidate.contextUsedPercent < 100
    ) {
      return candidate;
    }
    return best;
  }, null);
  const usage =
    session.cliProvider === 'codex' && codexContextUsage ? codexContextUsage : selectedUsage;

  return { usage, contextSnapshots, compactEvents };
}

async function attachRuntimeAndTelemetry<T extends Record<string, unknown>>(
  session: T
): Promise<T & { runtime: unknown; telemetry: SessionTelemetry | null }> {
  const id = typeof session.id === 'string' ? session.id : '';
  const runtime = id ? getProcessManager().getSessionRuntimeSnapshot(id) : null;
  const telemetry =
    id &&
    typeof session.userId === 'string' &&
    session.userId &&
    typeof session.cliProvider === 'string'
      ? await getSessionTelemetrySnapshot(
          {
            id,
            userId: session.userId,
            cliProvider: session.cliProvider as CLIProvider,
            cliModel: typeof session.cliModel === 'string' ? session.cliModel : null,
            claudeSessionId:
              typeof session.claudeSessionId === 'string' ? session.claudeSessionId : null,
            workingDirectory:
              typeof session.workingDirectory === 'string' ? session.workingDirectory : null,
          },
          runtime
        )
      : null;
  return {
    ...session,
    runtime,
    telemetry,
  };
}

// List all sessions
router.get('/', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  // Sort by message activity (latest message wins) with updated_at as fallback for
  // sessions that have no messages yet. Starred sessions always float to the top.
  // `?archived=1` swaps the list over to the archive rather than mixing both.
  const includeArchived = String(req.query.archived ?? '') === '1';
  const sessions = (await pgAll(
    `SELECT s.id, s.user_id as userId, s.name, s.working_directory as workingDirectory,
	              s.claude_session_id as claudeSessionId, s.status, s.last_message as lastMessage,
	              ${sessionIconSelect('s')},
	              s.starred, s.category, s.cli_provider as cliProvider, s.mode, s.surface,
              s.active_chat_id as activeChatId,
              s.cli_model as cliModel, s.cli_reasoning as cliReasoning,
              s.cli_service_tier as cliServiceTier,
              s.subagent_model as subagentModel,
              s.design_style_skill as designStyleSkill,
              s.writing_style_skill as writingStyleSkill,
              s.android_device_serial as androidDeviceSerial,
              s.home_assistant_entity_id as homeAssistantEntityId,
              ${sessionUnreadCountSelect('s')},
              strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', s.updated_at) as updatedAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(
                (SELECT MAX(m.created_at) FROM messages m WHERE m.session_id = s.id),
                s.updated_at
              )) as lastActivity
       FROM sessions s
       WHERE s.user_id = ? AND COALESCE(s.archived, 0) = ?
       ORDER BY s.starred DESC, lastActivity DESC`,
    userId,
    includeArchived ? 1 : 0
  )) as unknown as Array<Record<string, unknown>>;

  const sessionsWithDescriptions = await Promise.all(sessions.map(attachProjectDescription));
  const sessionsWithStarred = sessionsWithDescriptions.map((s) =>
    attachRuntime({ ...s, starred: Boolean(s.starred) })
  );

  res.json({ success: true, data: sessionsWithStarred });
});

// Get session by ID
router.get('/:id', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  const rawSession = await selectSessionById(req.params.id as string, userId);

  const session = rawSession
    ? await attachRuntimeAndTelemetry({ ...rawSession, starred: Boolean(rawSession.starred) })
    : null;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  res.json({ success: true, data: session });
});

// Create new session (with rate limiting)
router.post(
  '/',
  requireAuth,
  rateLimiters.sessionCreation,
  rateLimiters.upload,
  parseCreateSessionUpload,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const parsed = createSessionSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
    }

    const {
      name,
      workingDirectory: providedWorkingDir,
      cliProvider,
      cliModel,
      cliReasoning,
      cliServiceTier,
      mode,
      surface,
      initialMessage,
    } = parsed.data;
    await assertProviderEnabled(userId, cliProvider);
    let storedReasoning = cliReasoning?.trim() || null;
    let storedServiceTier = cliProvider === 'codex' ? cliServiceTier || null : null;

    if (cliProvider === 'codex' && storedReasoning?.toLowerCase() === 'fast') {
      storedReasoning = null;
      storedServiceTier = 'fast';
    }

    let workingDirectory: string;

    if (providedWorkingDir) {
      // User selected an existing folder - use it directly
      workingDirectory = path.resolve(providedWorkingDir);

      if (!validateWorkingDirectory(workingDirectory)) {
        throw new AppError('Working directory not allowed', 400, 'INVALID_PATH');
      }

      // Verify the directory exists
      try {
        const stat = await fs.stat(workingDirectory);
        if (!stat.isDirectory()) {
          throw new AppError('Path is not a directory', 400, 'NOT_A_DIRECTORY');
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new AppError('Directory does not exist', 400, 'DIR_NOT_FOUND');
        }
        throw err;
      }
    } else {
      // No folder specified - create subfolder based on session name (original behavior)
      const settings = (await pgGet(
        'SELECT default_working_dir as defaultWorkingDir FROM user_settings WHERE user_id = ?',
        userId
      )) as unknown as { defaultWorkingDir: string | null } | undefined;

      const defaultWorkingDir = settings?.defaultWorkingDir;

      if (!defaultWorkingDir) {
        throw new AppError(
          'Please set a default working directory in Settings first',
          400,
          'NO_DEFAULT_DIR'
        );
      }

      const folderName = sanitizeFolderName(name);
      if (!folderName) {
        throw new AppError('Session name must contain valid characters', 400, 'INVALID_NAME');
      }

      workingDirectory = path.join(defaultWorkingDir, folderName);

      if (!validateWorkingDirectory(workingDirectory)) {
        throw new AppError('Working directory not allowed', 400, 'INVALID_PATH');
      }

      // Create the directory
      await ensureDir(workingDirectory);
    }

    await persistCreateSessionUploads(
      req.files as Express.Multer.File[] | undefined,
      workingDirectory
    );

    const sessionId = nanoid();

    await pgRun(
      `INSERT INTO sessions (
       id,
       user_id,
       name,
       working_directory,
       cli_provider,
       mode,
       surface,
       cli_model,
       cli_reasoning,
       cli_service_tier
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sessionId,
      userId,
      name,
      workingDirectory,
      cliProvider,
      mode,
      surface,
      cliModel?.trim() || null,
      storedReasoning,
      storedServiceTier
    );

    let newSession = (await selectSessionById(sessionId, userId)) as Record<string, unknown>;
    const projectIcon = await readProjectIconCandidate(workingDirectory).catch((err) => {
      console.warn(
        '[Sessions] Failed to scan project icon:',
        err instanceof Error ? err.message : err
      );
      return null;
    });
    if (projectIcon) {
      try {
        newSession = await storeSessionIcon(
          sessionId,
          userId,
          projectIcon.buffer,
          projectIcon.ext,
          'project'
        );
      } catch (err) {
        console.warn(
          '[Sessions] Failed to apply project icon:',
          err instanceof Error ? err.message : err
        );
      }
    }

    res.status(201).json({
      success: true,
      data: await attachRuntimeAndTelemetry({
        ...newSession,
        starred: Boolean(newSession.starred),
      }),
    });

    if (initialMessage) {
      void (async () => {
        try {
          const manager = getProcessManager();
          if (cliProvider === 'codex') {
            const objective = buildAutoGoalObjective(initialMessage);
            if (objective) {
              await manager.sendMessage(sessionId, userId, `/goal ${objective}`);
            }
          }
          await manager.sendMessage(sessionId, userId, initialMessage);
        } catch (error) {
          console.error('[Sessions] Failed to send initial dashboard message:', error);
        }
      })();
    }
  }
);

// Update session
router.put('/:id', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSessionSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const existing = await pgGet(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  );

  if (!existing) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const { name, workingDirectory } = parsed.data;
  const resolvedWorkingDirectory = workingDirectory ? path.resolve(workingDirectory) : null;

  if (resolvedWorkingDirectory && !validateWorkingDirectory(resolvedWorkingDirectory)) {
    throw new AppError('Working directory not allowed', 400, 'INVALID_PATH');
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (name) {
    updates.push('name = ?');
    values.push(name);
  }
  if (resolvedWorkingDirectory) {
    updates.push('working_directory = ?');
    values.push(resolvedWorkingDirectory);
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id);
    await pgRun(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`, ...values);
  }

  const updatedSession = (await selectSessionById(req.params.id as string, userId)) as Record<
    string,
    unknown
  >;

  res.json({
    success: true,
    data: await attachRuntimeAndTelemetry({
      ...updatedSession,
      starred: Boolean(updatedSession.starred),
    }),
  });
});

// Toggle session starred status
router.patch('/:id/star', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  // Verify session ownership
  const session = (await pgGet(
    'SELECT id, starred FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  )) as unknown as { id: string; starred: number } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  // Toggle starred status
  const newStarred = session.starred ? 0 : 1;
  await pgRun(
    'UPDATE sessions SET starred = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    newStarred,
    req.params.id
  );

  res.json({ success: true, data: { starred: Boolean(newStarred) } });
});

/**
 * Archive or restore sessions, and bulk-apply the destructive/organisational
 * actions the dashboards offer. Archiving is preferred over deleting: the
 * transcript and its usage history stay intact.
 */
router.post('/bulk', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = z
    .object({
      ids: z.array(z.string().trim().min(1)).min(1).max(500),
      action: z.enum(['archive', 'unarchive', 'delete', 'star', 'unstar', 'category']),
      categoryId: z.string().trim().min(1).nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) throw new AppError('Invalid bulk request', 400, 'VALIDATION_ERROR');

  const { ids, action, categoryId } = parsed.data;
  const marks = ids.map(() => '?').join(',');
  // Scope every statement by user_id so ids from another account are no-ops.
  const owned = (await pgAll(
    `SELECT id FROM sessions WHERE user_id = ? AND id IN (${marks})`,
    userId,
    ...ids
  )) as unknown as Array<{ id: string }>;
  const ownedIds = owned.map((row) => row.id);
  if (ownedIds.length === 0) {
    return res.json({ success: true, data: { affected: 0 } });
  }
  const ownedMarks = ownedIds.map(() => '?').join(',');

  let affected = 0;
  if (action === 'delete') {
    // Stop anything running before the row disappears underneath it.
    const processManager = getProcessManager();
    for (const id of ownedIds) {
      if (processManager.isSessionRunning(id)) {
        try {
          await processManager.stopSession(id, userId);
        } catch {
          // Already gone — deletion proceeds regardless.
        }
      }
    }
    affected = (
      await pgRun(
        `DELETE FROM sessions WHERE user_id = ? AND id IN (${ownedMarks})`,
        userId,
        ...ownedIds
      )
    ).changes;
  } else if (action === 'category') {
    affected = (
      await pgRun(
        `UPDATE sessions SET category = ?, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND id IN (${ownedMarks})`,
        categoryId ?? null,
        userId,
        ...ownedIds
      )
    ).changes;
  } else {
    const column = action === 'star' || action === 'unstar' ? 'starred' : 'archived';
    const value = action === 'archive' || action === 'star' ? 1 : 0;
    affected = (
      await pgRun(
        `UPDATE sessions SET ${column} = ?, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND id IN (${ownedMarks})`,
        value,
        userId,
        ...ownedIds
      )
    ).changes;
  }

  res.json({ success: true, data: { affected } });
});

// Update session CLI provider
router.patch('/:id/provider', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateProviderSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const existing = (await pgGet(
    'SELECT id, cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  )) as unknown as { id: string; cliProvider: string } | undefined;

  if (!existing) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const { cliProvider } = parsed.data;
  await assertProviderEnabled(userId, cliProvider);

  if (existing.cliProvider !== cliProvider) {
    await pgRun(
      `UPDATE sessions
       SET cli_provider = ?,
           claude_session_id = NULL,
           cli_model = NULL,
           cli_reasoning = NULL,
           cli_service_tier = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      cliProvider,
      req.params.id
    );

    const processManager = getProcessManager();
    if (processManager.isSessionRunning(req.params.id as string)) {
      await processManager.restartSession(req.params.id as string, userId, {
        preserveNativeContext: true,
      });
    }
  }

  const updatedSession = (await selectSessionById(req.params.id as string, userId)) as Record<
    string,
    unknown
  >;

  res.json({
    success: true,
    data: await attachRuntimeAndTelemetry({
      ...updatedSession,
      starred: Boolean(updatedSession.starred),
    }),
  });
});

// ── Multi-chat threads inside one session ────────────────────────────────────
// chat_id NULL on messages plus active_chat_id NULL on the session means the
// legacy "main" thread. The first time a second chat is created the main
// thread is materialised into session_chats so every thread has a real id.

const createChatSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
});

const renameChatSchema = z.object({
  title: z.string().trim().min(1).max(100),
});

async function requireOwnedSession(id: string, userId: string) {
  const session = (await pgGet(
    `SELECT id, active_chat_id as activeChatId, claude_session_id as claudeSessionId
       FROM sessions WHERE id = ? AND user_id = ?`,
    id,
    userId
  )) as unknown as
    | { id: string; activeChatId: string | null; claudeSessionId: string | null }
    | undefined;
  if (!session) throw new AppError('Session not found', 404, 'NOT_FOUND');
  return session;
}

async function listSessionChats(sessionId: string) {
  return (await pgAll(
    `SELECT id, title, provider_session_id as providerSessionId,
              strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
       FROM session_chats WHERE session_id = ? ORDER BY created_at ASC, seq ASC`,
    sessionId
  )) as unknown as Array<{
    id: string;
    title: string;
    providerSessionId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

async function chatListPayload(sessionId: string, activeChatId: string | null) {
  const rows = await listSessionChats(sessionId);
  if (rows.length === 0) {
    // Legacy single-thread session: present the implicit main chat.
    return {
      chats: [{ id: 'main', title: 'Chat 1', createdAt: null, updatedAt: null }],
      activeChatId: 'main',
    };
  }
  return {
    chats: rows.map(({ providerSessionId: _p, ...rest }) => rest),
    activeChatId: activeChatId,
  };
}

/** Move the implicit NULL main thread into a real session_chats row. */
async function materializeMainChat(session: {
  id: string;
  activeChatId: string | null;
  claudeSessionId: string | null;
}): Promise<string> {
  if (session.activeChatId !== null) return session.activeChatId;
  const mainId = nanoid();
  await pgRun(
    'INSERT INTO session_chats (id, session_id, title, provider_session_id) VALUES (?, ?, ?, ?)',
    mainId,
    session.id,
    'Chat 1',
    session.claudeSessionId
  );
  await pgRun(
    'UPDATE messages SET chat_id = ? WHERE session_id = ? AND chat_id IS NULL',
    mainId,
    session.id
  );
  await pgRun('UPDATE sessions SET active_chat_id = ? WHERE id = ?', mainId, session.id);
  return mainId;
}

/** Persist the outgoing chat's provider-native session id before switching. */
async function stashActiveProviderSession(
  sessionId: string,
  activeChatId: string,
  claudeSessionId: string | null
) {
  await pgRun(
    'UPDATE session_chats SET provider_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?',
    claudeSessionId,
    activeChatId,
    sessionId
  );
}

// List chat threads of a session
router.get('/:id/chats', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const session = await requireOwnedSession(req.params.id as string, userId);
  res.json({ success: true, data: await chatListPayload(session.id, session.activeChatId) });
});

// Create a new chat thread (fresh conversation context) and switch to it
router.post('/:id/chats', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = createChatSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');

  const session = await requireOwnedSession(req.params.id as string, userId);

  const currentActiveId = await materializeMainChat(session);
  if (session.activeChatId !== null) {
    await stashActiveProviderSession(session.id, currentActiveId, session.claudeSessionId);
  }

  const chatCount = (
    (await pgGet(
      'SELECT COUNT(*) as c FROM session_chats WHERE session_id = ?',
      session.id
    )) as unknown as {
      c: number;
    }
  ).c;
  const chatId = nanoid();
  const title = parsed.data.title || `Chat ${chatCount + 1}`;
  await pgRun(
    'INSERT INTO session_chats (id, session_id, title) VALUES (?, ?, ?)',
    chatId,
    session.id,
    title
  );
  // Fresh thread: no provider-native context to resume.
  await pgRun(
    `UPDATE sessions SET active_chat_id = ?, claude_session_id = NULL,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    chatId,
    session.id
  );

  // The running CLI holds the old thread's context; stop it so the next turn
  // spawns clean. No-op when nothing is running.
  try {
    await getProcessManager().stopSession(session.id, userId);
  } catch {
    /* not running */
  }

  res.json({ success: true, data: await chatListPayload(session.id, chatId) });
});

// Switch to another chat thread
router.post('/:id/chats/:chatId/activate', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const session = await requireOwnedSession(req.params.id as string, userId);
  const targetId = req.params.chatId as string;

  if (targetId === 'main' && session.activeChatId === null) {
    // Already on the implicit main thread.
    return res.json({ success: true, data: await chatListPayload(session.id, null) });
  }

  const target = (await pgGet(
    'SELECT id, provider_session_id as providerSessionId FROM session_chats WHERE id = ? AND session_id = ?',
    targetId,
    session.id
  )) as unknown as { id: string; providerSessionId: string | null } | undefined;
  if (!target) throw new AppError('Chat not found', 404, 'NOT_FOUND');

  if (session.activeChatId === target.id) {
    return res.json({ success: true, data: await chatListPayload(session.id, target.id) });
  }

  const currentActiveId = await materializeMainChat(session);
  await stashActiveProviderSession(session.id, currentActiveId, session.claudeSessionId);

  await pgRun(
    `UPDATE sessions SET active_chat_id = ?, claude_session_id = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    target.id,
    target.providerSessionId,
    session.id
  );

  try {
    await getProcessManager().stopSession(session.id, userId);
  } catch {
    /* not running */
  }

  res.json({ success: true, data: await chatListPayload(session.id, target.id) });
});

// Rename a chat thread
router.patch('/:id/chats/:chatId', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = renameChatSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');

  const session = await requireOwnedSession(req.params.id as string, userId);
  const result = await pgRun(
    'UPDATE session_chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?',
    parsed.data.title,
    req.params.chatId,
    session.id
  );
  if (result.changes === 0) throw new AppError('Chat not found', 404, 'NOT_FOUND');
  res.json({ success: true, data: await chatListPayload(session.id, session.activeChatId) });
});

// Delete a chat thread and its messages
router.delete('/:id/chats/:chatId', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const session = await requireOwnedSession(req.params.id as string, userId);
  const targetId = req.params.chatId as string;

  const target = (await pgGet(
    'SELECT id FROM session_chats WHERE id = ? AND session_id = ?',
    targetId,
    session.id
  )) as unknown as { id: string } | undefined;
  if (!target) throw new AppError('Chat not found', 404, 'NOT_FOUND');

  await pgRun('DELETE FROM messages WHERE session_id = ? AND chat_id = ?', session.id, targetId);
  await pgRun('DELETE FROM session_chats WHERE id = ?', targetId);

  if (session.activeChatId === targetId) {
    // Fall back to the oldest remaining thread (or the empty implicit main).
    const next = (await listSessionChats(session.id))[0] ?? null;
    await pgRun(
      `UPDATE sessions SET active_chat_id = ?, claude_session_id = ?,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      next?.id ?? null,
      next?.providerSessionId ?? null,
      session.id
    );
    try {
      await getProcessManager().stopSession(session.id, userId);
    } catch {
      /* not running */
    }
  }

  const updated = await requireOwnedSession(session.id, userId);
  res.json({ success: true, data: await chatListPayload(session.id, updated.activeChatId) });
});

// Update the per-session model selection so different WebUI sessions can run
// different provider/model pairs without changing any global provider default.
router.patch('/:id/model', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSessionModelSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid model', 400, 'VALIDATION_ERROR');
  }

  const session = (await pgGet(
    'SELECT id, cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  )) as unknown as { id: string; cliProvider: string } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const model = parsed.data.model?.trim() || null;
  await pgRun(
    'UPDATE sessions SET cli_model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    model,
    req.params.id
  );

  const processManager = getProcessManager();
  if (processManager.isSessionRunning(req.params.id as string)) {
    await processManager.restartSession(req.params.id as string, userId, {
      preserveNativeContext: true,
    });
  }

  const updatedSession = (await selectSessionById(req.params.id as string, userId)) as Record<
    string,
    unknown
  >;

  res.json({
    success: true,
    data: await attachRuntimeAndTelemetry({
      ...updatedSession,
      starred: Boolean(updatedSession.starred),
    }),
  });
});

// Per-session subagent model override. The value is exported to the Claude CLI
// as CLAUDE_CODE_SUBAGENT_MODEL at spawn; a routed model id (glm-*, or one of
// the configured upstream patterns) sends this session's subagents through the
// model router while the main agent stays on the session's own subscription.
router.patch('/:id/subagent-model', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSessionSubagentModelSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid subagent model', 400, 'VALIDATION_ERROR');
  }

  const session = (await pgGet(
    'SELECT id, cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  )) as unknown as { id: string; cliProvider: string } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const model = parsed.data.model?.trim() || null;
  await pgRun(
    'UPDATE sessions SET subagent_model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    model,
    req.params.id
  );

  const processManager = getProcessManager();
  if (processManager.isSessionRunning(req.params.id as string)) {
    await processManager.restartSession(req.params.id as string, userId, {
      preserveNativeContext: true,
    });
  }

  const updatedSession = (await selectSessionById(req.params.id as string, userId)) as Record<
    string,
    unknown
  >;

  res.json({
    success: true,
    data: await attachRuntimeAndTelemetry({
      ...updatedSession,
      starred: Boolean(updatedSession.starred),
    }),
  });
});

// Update the per-session reasoning/effort selection. This intentionally mirrors
// the model route: the session row is the source of truth, not user-wide settings.
router.patch('/:id/reasoning', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSessionReasoningSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid reasoning level', 400, 'VALIDATION_ERROR');
  }

  const session = (await pgGet(
    'SELECT id, cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  )) as unknown as { id: string; cliProvider: string } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const reasoning = parsed.data.reasoning?.trim() || null;
  if (session.cliProvider === 'codex' && reasoning?.toLowerCase() === 'fast') {
    await pgRun(
      `UPDATE sessions
       SET cli_reasoning = NULL,
           cli_service_tier = 'fast',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      req.params.id
    );
  } else {
    await pgRun(
      'UPDATE sessions SET cli_reasoning = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      reasoning,
      req.params.id
    );
  }

  const processManager = getProcessManager();
  if (processManager.isSessionRunning(req.params.id as string)) {
    await processManager.restartSession(req.params.id as string, userId, {
      preserveNativeContext: true,
    });
  }

  const updatedSession = (await selectSessionById(req.params.id as string, userId)) as Record<
    string,
    unknown
  >;

  res.json({
    success: true,
    data: await attachRuntimeAndTelemetry({
      ...updatedSession,
      starred: Boolean(updatedSession.starred),
    }),
  });
});

// Update the per-session Codex service/profile tier. This is separate from
// reasoning so `/fast` can be combined with xhigh effort.
router.patch('/:id/service-tier', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSessionServiceTierSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid service tier', 400, 'VALIDATION_ERROR');
  }

  const session = (await pgGet(
    'SELECT id, cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  )) as unknown as { id: string; cliProvider: string } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const serviceTier = parsed.data.serviceTier || null;
  if (serviceTier && session.cliProvider !== 'codex') {
    throw new AppError(
      'Service tier is only supported for Codex sessions',
      400,
      'VALIDATION_ERROR'
    );
  }

  await pgRun(
    'UPDATE sessions SET cli_service_tier = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    serviceTier,
    req.params.id
  );

  const processManager = getProcessManager();
  if (processManager.isSessionRunning(req.params.id as string)) {
    await processManager.restartSession(req.params.id as string, userId, {
      preserveNativeContext: true,
    });
  }

  const updatedSession = (await selectSessionById(req.params.id as string, userId)) as Record<
    string,
    unknown
  >;

  res.json({
    success: true,
    data: await attachRuntimeAndTelemetry({
      ...updatedSession,
      starred: Boolean(updatedSession.starred),
    }),
  });
});

// Persist the session permission mode. Previously lived only in localStorage, so it
// was lost when switching browser or device.
router.patch('/:id/mode', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateModeSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid mode', 400, 'VALIDATION_ERROR');
  }

  const existing = await pgGet(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  );

  if (!existing) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  await pgRun(
    'UPDATE sessions SET mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    parsed.data.mode,
    req.params.id
  );

  res.json({ success: true, data: { mode: parsed.data.mode } });
});

// Persist the visible session surface. This switches between the technical code
// workbench and the quieter task/messenger presentation over the same runtime.
router.patch('/:id/surface', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSurfaceSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid surface', 400, 'VALIDATION_ERROR');
  }

  const existing = await pgGet(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  );

  if (!existing) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  await pgRun(
    'UPDATE sessions SET surface = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    parsed.data.surface,
    req.params.id
  );

  res.json({ success: true, data: { surface: parsed.data.surface } });
});

// Persist active style-library templates for the current session. These are not
// normal skills; they are injected as session style context on each user turn.
router.patch('/:id/styles', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const sessionId = req.params.id;
  if (!sessionId) {
    throw new AppError('Session id missing', 400, 'VALIDATION_ERROR');
  }

  const parsed = updateSessionStylesSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid style selection', 400, 'VALIDATION_ERROR');
  }

  const existing = (await pgGet(
    'SELECT id, cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?',
    sessionId,
    userId
  )) as unknown as { id: string; cliProvider: string | null } | undefined;

  if (!existing) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const configHome = resolveConfigHome(existing.cliProvider || 'codex');
  const { designStyleSkill, writingStyleSkill } = parsed.data;
  const updates: string[] = [];
  const values: Array<string | null> = [];

  if (designStyleSkill !== undefined) {
    if (designStyleSkill !== null) {
      const style = await readSkillLibraryItem(configHome, designStyleSkill);
      if (!style || style.libraryKind !== 'design') {
        throw new AppError('UI style template not found', 400, 'INVALID_STYLE');
      }
    }
    updates.push('design_style_skill = ?');
    values.push(designStyleSkill);
  }

  if (writingStyleSkill !== undefined) {
    if (writingStyleSkill !== null) {
      const style = await readSkillLibraryItem(configHome, writingStyleSkill);
      if (!style || style.libraryKind !== 'writing') {
        throw new AppError('Writing style template not found', 400, 'INVALID_STYLE');
      }
    }
    updates.push('writing_style_skill = ?');
    values.push(writingStyleSkill);
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(sessionId);
    await pgRun(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`, ...values);
  }

  const updatedSession = (await selectSessionById(sessionId, userId)) as Record<string, unknown>;

  res.json({
    success: true,
    data: await attachRuntimeAndTelemetry({
      ...updatedSession,
      starred: Boolean(updatedSession.starred),
    }),
  });
});

router.get('/:id/icon', async (req, res) => {
  const userId = await validateToken(req, res);
  if (!userId) return;

  const row = (await pgGet(
    'SELECT icon_path as iconPath FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  )) as unknown as { iconPath: string | null } | undefined;

  if (!row?.iconPath) {
    throw new AppError('Session icon not found', 404, 'NOT_FOUND');
  }

  const iconPath = resolveSessionIconPath(row.iconPath);
  await fs.access(iconPath);

  const requestedSize = req.query.size;
  const thumbnailSize = parseSessionIconThumbnailSize(requestedSize);
  if (requestedSize !== undefined && thumbnailSize === null) {
    throw new AppError('Unsupported session icon thumbnail size', 400, 'INVALID_ICON_SIZE');
  }

  let responsePath = iconPath;
  let variant = 'original';
  let thumbnailFallback = false;
  if (thumbnailSize !== null) {
    try {
      responsePath = await ensureSessionIconThumbnail(iconPath, thumbnailSize);
      variant = `thumbnail-${thumbnailSize}`;
    } catch (error) {
      thumbnailFallback = true;
      variant = 'original-fallback';
      console.warn(
        `[sessions] Could not create ${thumbnailSize}px thumbnail for session ${req.params.id}; serving the original icon`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const ext = path.extname(responsePath).toLowerCase();
  const contentType = ICON_MIME_BY_EXT[ext] || 'application/octet-stream';
  const stat = await fs.stat(responsePath);
  const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  const isVersioned = typeof req.query.v === 'string' && req.query.v.length > 0;

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stat.size);
  res.setHeader(
    'Cache-Control',
    sessionIconCacheControl({ versioned: isVersioned, thumbnailFallback })
  );
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Plum-Icon-Variant', variant);
  if (req.fresh) {
    res.status(304).end();
    return;
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(responsePath).pipe(res);
});

router.post(
  '/:id/icon/upload',
  requireAuth,
  rateLimiters.upload,
  iconUpload.single('icon'),
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const sessionId = req.params.id;
    if (!sessionId) throw new AppError('Session id missing', 400, 'VALIDATION_ERROR');
    if (!req.file) throw new AppError('Icon file missing', 400, 'NO_FILE');

    const existing = await pgGet(
      'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
      sessionId,
      userId
    );
    if (!existing) throw new AppError('Session not found', 404, 'NOT_FOUND');

    const ext = getIconExtension(req.file.originalname, req.file.mimetype);
    const updatedSession = await storeSessionIcon(
      sessionId,
      userId,
      req.file.buffer,
      ext,
      'upload'
    );
    res.json({ success: true, data: await attachRuntimeAndTelemetry(updatedSession) });
  }
);

router.post('/:id/icon/project', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const sessionId = req.params.id;
  if (!sessionId) throw new AppError('Session id missing', 400, 'VALIDATION_ERROR');

  const session = (await pgGet(
    'SELECT id, working_directory as workingDirectory FROM sessions WHERE id = ? AND user_id = ?',
    sessionId,
    userId
  )) as unknown as { id: string; workingDirectory: string } | undefined;
  if (!session) throw new AppError('Session not found', 404, 'NOT_FOUND');

  const projectIcon = await readProjectIconCandidate(session.workingDirectory);
  if (!projectIcon) {
    throw new AppError('No project icon found in this workspace', 404, 'PROJECT_ICON_NOT_FOUND');
  }

  const updatedSession = await storeSessionIcon(
    sessionId,
    userId,
    projectIcon.buffer,
    projectIcon.ext,
    'project'
  );
  res.json({
    success: true,
    data: await attachRuntimeAndTelemetry(updatedSession),
    meta: { sourcePath: projectIcon.path },
  });
});

router.post('/:id/icon/generate', requireAuth, rateLimiters.imageGeneration, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const sessionId = req.params.id;
  if (!sessionId) throw new AppError('Session id missing', 400, 'VALIDATION_ERROR');

  const parsed = generateSessionIconSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError('Invalid icon prompt', 400, 'VALIDATION_ERROR');

  const session = (await pgGet(
    `SELECT id, name, working_directory as workingDirectory
         FROM sessions WHERE id = ? AND user_id = ?`,
    sessionId,
    userId
  )) as unknown as { id: string; name: string; workingDirectory: string } | undefined;
  if (!session) throw new AppError('Session not found', 404, 'NOT_FOUND');

  const scanned = await scanProject(session.workingDirectory).catch(() => null);
  const generatedIcon = await generateSessionIconImage({
    sessionId,
    session,
    prompt: parsed.data.prompt,
    project: scanned
      ? {
          framework: scanned.framework,
          techStack: scanned.techStack,
        }
      : null,
  });
  const updatedSession = await storeSessionIcon(
    sessionId,
    userId,
    generatedIcon.buffer,
    generatedIcon.ext,
    'generated'
  );
  res.json({
    success: true,
    data: await attachRuntimeAndTelemetry(updatedSession),
    meta: { generator: 'codex-imagegen', prompt: generatedIcon.prompt },
  });
});

router.delete('/:id/icon', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const sessionId = req.params.id;
  if (!sessionId) throw new AppError('Session id missing', 400, 'VALIDATION_ERROR');

  const existing = await pgGet(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
    sessionId,
    userId
  );
  if (!existing) throw new AppError('Session not found', 404, 'NOT_FOUND');

  await removeExistingSessionIcons(sessionId);
  await pgRun(
    `UPDATE sessions
       SET icon_path = NULL, icon_source = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    sessionId,
    userId
  );

  const updatedSession = await selectSessionById(sessionId, userId);
  res.json({
    success: true,
    data: await attachRuntimeAndTelemetry({
      ...updatedSession,
      starred: Boolean(updatedSession?.starred),
    }),
  });
});

// Delete session
router.delete('/:id', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const sessionId = req.params.id;
  if (!sessionId) {
    throw new AppError('Session id missing', 400, 'VALIDATION_ERROR');
  }

  // Stop any live CLI process before the row disappears, otherwise the
  // process keeps writing to a dead session_id (zombie).
  try {
    await getProcessManager().stopSession(sessionId, userId);
  } catch {
    // Not running or not owned — safe to ignore; ownership is re-checked by DELETE.
  }

  const result = await pgRun(
    'DELETE FROM sessions WHERE id = ? AND user_id = ?',
    sessionId,
    userId
  );

  if (result.changes === 0) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  res.json({ success: true });
});

// Get session messages. Paginated so a 10k-message session doesn't
// blow up memory on the server or freeze the frontend on render.
// Default returns the most recent `limit` messages in chronological order.
// Use `before` (message id) to page backwards for infinite scroll.
const createChatUploadSchema = z.object({
  filename: z.string().min(1).max(240),
  mimeType: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[\x20-\x7e]+$/)
    .optional(),
  byteSize: z
    .number()
    .int()
    .min(1)
    .max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  chunkSize: z
    .number()
    .int()
    .min(256 * 1024)
    .max(4 * 1024 * 1024)
    .optional(),
});

function throwChatUploadError(error: unknown): never {
  if (error instanceof ChatUploadError) {
    throw new AppError(error.message, error.statusCode, error.code);
  }
  throw error;
}

function parseContentRange(
  value: string | undefined
): { start: number; end: number; total: number } | undefined {
  if (!value) return undefined;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) throw new AppError('Invalid Content-Range', 400, 'INVALID_CONTENT_RANGE');
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total <= end
  ) {
    throw new AppError('Invalid Content-Range', 400, 'INVALID_CONTENT_RANGE');
  }
  return { start, end, total };
}

router.post('/:id/uploads', requireAuth, rateLimiters.upload, async (req, res) => {
  const parsed = createChatUploadSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Invalid upload metadata', 400, 'VALIDATION_ERROR');
  try {
    const upload = await createChatUpload(
      (req as AuthenticatedRequest).userId,
      req.params.id as string,
      parsed.data
    );
    res.status(201).json({ success: true, data: upload });
  } catch (error) {
    throwChatUploadError(error);
  }
});

router.put(
  '/:id/uploads/:uploadId/chunks/:chunkIndex',
  requireAuth,
  rateLimiters.uploadChunk,
  raw({ type: 'application/octet-stream', limit: '4mb' }),
  async (req, res) => {
    const index = z.coerce.number().int().min(0).max(99).safeParse(req.params.chunkIndex);
    const sha = req.header('x-chunk-sha256');
    if (!index.success || !Buffer.isBuffer(req.body)) {
      throw new AppError('Invalid upload chunk', 400, 'VALIDATION_ERROR');
    }
    if (!sha || !/^[a-f0-9]{64}$/i.test(sha)) {
      throw new AppError('Invalid chunk SHA-256', 400, 'VALIDATION_ERROR');
    }
    const contentRange = parseContentRange(req.header('content-range'));
    if (!contentRange) {
      throw new AppError('Content-Range is required', 400, 'INVALID_CONTENT_RANGE');
    }
    try {
      const upload = await putChatUploadChunk(
        (req as AuthenticatedRequest).userId,
        req.params.id as string,
        req.params.uploadId as string,
        index.data,
        req.body,
        sha,
        contentRange
      );
      res.json({ success: true, data: upload });
    } catch (error) {
      throwChatUploadError(error);
    }
  }
);

router.get('/:id/uploads/:uploadId', requireAuth, async (req, res) => {
  try {
    const upload = await getChatUpload(
      (req as AuthenticatedRequest).userId,
      req.params.id as string,
      req.params.uploadId as string
    );
    res.json({ success: true, data: upload });
  } catch (error) {
    throwChatUploadError(error);
  }
});

router.delete('/:id/uploads/:uploadId', requireAuth, async (req, res) => {
  try {
    const upload = await cancelChatUpload(
      (req as AuthenticatedRequest).userId,
      req.params.id as string,
      req.params.uploadId as string
    );
    res.json({ success: true, data: upload });
  } catch (error) {
    throwChatUploadError(error);
  }
});

const readStateQuerySchema = z.object({
  chatId: z.string().max(160).optional(),
});
const readStateUpdateSchema = z.object({
  chatId: z.string().max(160).nullable().optional(),
  lastReadMessageId: z.string().max(160).nullable().optional(),
});

router.get('/:id/read-state', requireAuth, async (req, res) => {
  const parsed = readStateQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError('Invalid read-state query', 400, 'VALIDATION_ERROR');
  try {
    const readState = await getSessionReadState(
      (req as AuthenticatedRequest).userId,
      req.params.id as string,
      parsed.data.chatId === '' ? null : parsed.data.chatId
    );
    res.json({ success: true, data: readState });
  } catch {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }
});

router.put('/:id/read-state', requireAuth, async (req, res) => {
  const parsed = readStateUpdateSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Invalid read-state payload', 400, 'VALIDATION_ERROR');
  try {
    const readState = await setSessionReadState(
      (req as AuthenticatedRequest).userId,
      req.params.id as string,
      parsed.data
    );
    res.json({ success: true, data: readState });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid read marker';
    const notFound = message === 'Session not found';
    throw new AppError(message, notFound ? 404 : 400, notFound ? 'NOT_FOUND' : 'INVALID_MARKER');
  }
});

const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  before: z.string().min(1).max(64).optional(),
  after: z.string().min(1).max(64).optional(),
  around: z.string().min(1).max(64).optional(),
  chatId: z.string().max(160).optional(),
});

router.get('/:id/messages', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = messagesQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError('Invalid query', 400, 'VALIDATION_ERROR');
  const { limit, before, after, around, chatId: requestedChatId } = parsed.data;
  if ([before, after, around].filter(Boolean).length > 1) {
    throw new AppError('before, after and around are mutually exclusive', 400, 'VALIDATION_ERROR');
  }

  const payload = await pgTransaction(async (tx) => {
    // One SQLite read transaction makes the rows, revision and newest id one
    // coherent snapshot even if another backend process is writing concurrently.
    const session = (await tx.get(
      `SELECT id, active_chat_id AS activeChatId
           FROM sessions WHERE id = ? AND user_id = ?`,
      req.params.id,
      userId
    )) as unknown as { id: string; activeChatId: string | null } | undefined;
    if (!session) throw new AppError('Session not found', 404, 'NOT_FOUND');
    const activeChatId =
      requestedChatId === undefined
        ? session.activeChatId
        : requestedChatId === ''
          ? null
          : requestedChatId;
    if (
      activeChatId !== null &&
      !(await tx.get(
        `SELECT 1 FROM session_chats WHERE id = ? AND session_id = ?`,
        activeChatId,
        req.params.id
      ))
    ) {
      throw new AppError('Chat not found in this session', 404, 'NOT_FOUND');
    }
    const total = (
      (await tx.get(
        'SELECT COUNT(*) AS count FROM messages WHERE session_id = ? AND chat_id IS ?',
        req.params.id,
        activeChatId
      )) as unknown as { count: number }
    ).count;
    const baseSelect = `SELECT id, session_id AS sessionId, chat_id AS chatId, role, content,
                               client_message_id AS clientMessageId,
                               event_sequence AS eventSequence,
                               strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS createdAt,
                               seq AS rid
                          FROM messages`;
    type HistoryRow = { rid: number; id: string; [key: string]: unknown };
    let ordered: HistoryRow[];
    let anchorIndex: number | null = null;
    let requestedCursorRowId: number | null = null;

    if (around) {
      const anchor = (await tx.get(
        `SELECT seq AS rid FROM messages
            WHERE id = ? AND session_id = ? AND chat_id IS ?`,
        around,
        req.params.id,
        activeChatId
      )) as unknown as { rid: number } | undefined;
      if (!anchor) {
        throw new AppError('Message not found in the active chat', 404, 'NOT_FOUND');
      }
      const ordinal = (
        (await tx.get(
          `SELECT COUNT(*) AS count FROM messages
              WHERE session_id = ? AND chat_id IS ? AND seq <= ?`,
          req.params.id,
          activeChatId,
          anchor.rid
        )) as unknown as { count: number }
      ).count;
      const offset = Math.max(0, Math.min(ordinal - Math.ceil(limit / 2), total - limit));
      ordered = (await tx.all(
        `${baseSelect}
            WHERE session_id = ? AND chat_id IS ?
            ORDER BY seq ASC LIMIT ? OFFSET ?`,
        req.params.id,
        activeChatId,
        limit,
        offset
      )) as unknown as HistoryRow[];
      anchorIndex = ordered.findIndex((row) => row.id === around);
    } else {
      let cursorRowId: number | null = null;
      if (before || after) {
        const cursor = (await tx.get(
          `SELECT seq AS rid FROM messages
              WHERE id = ? AND session_id = ? AND chat_id IS ?`,
          before ?? after,
          req.params.id,
          activeChatId
        )) as unknown as { rid: number } | undefined;
        if (!cursor) {
          throw new AppError('Message cursor not found in the active chat', 400, 'INVALID_CURSOR');
        }
        cursorRowId = cursor.rid;
        requestedCursorRowId = cursor.rid;
      }
      if (after && cursorRowId !== null) {
        ordered = (await tx.all(
          `${baseSelect}
              WHERE session_id = ? AND chat_id IS ? AND seq > ?
              ORDER BY seq ASC LIMIT ?`,
          req.params.id,
          activeChatId,
          cursorRowId,
          limit
        )) as unknown as HistoryRow[];
      } else {
        const newestFirst = (
          cursorRowId === null
            ? await tx.all(
                `${baseSelect}
                    WHERE session_id = ? AND chat_id IS ?
                    ORDER BY seq DESC LIMIT ?`,
                req.params.id,
                activeChatId,
                limit
              )
            : await tx.all(
                `${baseSelect}
                    WHERE session_id = ? AND chat_id IS ? AND seq < ?
                    ORDER BY seq DESC LIMIT ?`,
                req.params.id,
                activeChatId,
                cursorRowId,
                limit
              )
        ) as HistoryRow[];
        ordered = newestFirst.reverse();
      }
    }

    const oldestRid = ordered[0]?.rid ?? requestedCursorRowId;
    const newestRid = ordered.at(-1)?.rid ?? requestedCursorRowId;
    const hasMoreBefore =
      oldestRid !== null &&
      (await tx.get(
        `SELECT 1 FROM messages
            WHERE session_id = ? AND chat_id IS ? AND seq < ? LIMIT 1`,
        req.params.id,
        activeChatId,
        oldestRid
      )) !== undefined;
    const hasMoreAfter =
      newestRid !== null &&
      (await tx.get(
        `SELECT 1 FROM messages
            WHERE session_id = ? AND chat_id IS ? AND seq > ? LIMIT 1`,
        req.params.id,
        activeChatId,
        newestRid
      )) !== undefined;
    const mediaByMessage = await loadMessageMedia(ordered.map((row) => row.id));
    const messages = ordered.map(({ rid: _rid, ...message }) => {
      const media = mediaByMessage.get(message.id);
      return media?.length ? { ...message, media } : message;
    });
    return {
      success: true,
      data: messages,
      snapshot: await getMessageHistorySnapshot(req.params.id as string, userId, activeChatId),
      readState: await getSessionReadState(userId, req.params.id as string, activeChatId),
      pagination: {
        total,
        limit,
        hasMore: hasMoreBefore,
        hasMoreBefore,
        hasMoreAfter,
        oldestId: messages[0]?.id ?? null,
        newestId: messages.at(-1)?.id ?? null,
        ...(around ? { aroundId: around, anchorIndex } : {}),
      },
    };
  });

  res.json(payload);
});

// Rewind session to a specific message (deletes that message and all later ones,
// resets the Claude session so the next user message starts a fresh context)
const rewindSchema = z.object({
  messageId: z.string().min(1),
});

router.post('/:id/rewind', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const sessionId = req.params.id;
  if (!sessionId) {
    throw new AppError('Session id required', 400, 'INVALID_PAYLOAD');
  }

  const parsed = rewindSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid rewind payload', 400, 'INVALID_PAYLOAD');
  }
  const { messageId } = parsed.data;

  const session = await pgGet(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
    sessionId,
    userId
  );
  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const target = (await pgGet(
    'SELECT seq as rid, created_at as createdAt FROM messages WHERE id = ? AND session_id = ?',
    messageId,
    sessionId
  )) as unknown as { rid: number; createdAt: string } | undefined;
  if (!target) {
    throw new AppError('Message not found', 404, 'NOT_FOUND');
  }

  // Order: stop process → clear buffer → DB transaction. Stopping first prevents new
  // messages from streaming in during the delete; clearing the buffer ensures that on
  // reconnect the client doesn't replay the now-deleted tail. The DB update is one
  // transaction so a partial failure can't leave "claude_session_id set but messages gone".
  const pm = getProcessManager();
  try {
    await pm.stopSession(sessionId, userId);
  } catch {
    // Process not running or not owned by this user — safe to ignore.
  }
  pm.clearSessionBuffer(sessionId);

  const result = await pgTransaction(async (tx) => {
    const del = await tx.run(
      'DELETE FROM messages WHERE session_id = ? AND seq >= ?',
      sessionId,
      target.rid
    );
    await tx.run(
      'DELETE FROM session_events WHERE session_id = ? AND created_at >= ?',
      sessionId,
      target.createdAt
    );
    await tx.run(
      'UPDATE sessions SET claude_session_id = NULL, status = ?, last_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      'stopped',
      sessionId
    );
    return del.changes;
  });

  const remaining = await pgAll(
    `SELECT id, session_id as sessionId, role, content,
              strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt
       FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
    sessionId
  );

  res.json({ success: true, deletedCount: result, data: remaining });
});

// Get allowed directories for a session
router.get('/:id/allowed-directories', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  const session = (await pgGet(
    'SELECT allowed_directories FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  )) as unknown as { allowed_directories: string | null } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const allowedDirectories = safeJsonParse<string[]>(session.allowed_directories, []);

  res.json({ success: true, data: allowedDirectories });
});

// Add an allowed directory to a session
router.post('/:id/allowed-directories', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { directory } = req.body;

  if (!directory || typeof directory !== 'string') {
    throw new AppError('Directory path is required', 400, 'VALIDATION_ERROR');
  }

  // Normalize and validate the directory path
  const normalizedDir = path.resolve(directory);

  // Check if directory exists
  try {
    const stat = await fs.stat(normalizedDir);
    if (!stat.isDirectory()) {
      throw new AppError('Path is not a directory', 400, 'NOT_A_DIRECTORY');
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('Directory does not exist', 400, 'DIR_NOT_FOUND');
    }
    throw err;
  }

  const session = (await pgGet(
    'SELECT allowed_directories FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  )) as unknown as { allowed_directories: string | null } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const allowedDirectories = safeJsonParse<string[]>(session.allowed_directories, []);

  // Check if already exists
  if (allowedDirectories.includes(normalizedDir)) {
    return res.json({
      success: true,
      data: allowedDirectories,
      message: 'Directory already allowed',
    });
  }

  // Add the new directory
  allowedDirectories.push(normalizedDir);

  await pgRun(
    'UPDATE sessions SET allowed_directories = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    JSON.stringify(allowedDirectories),
    req.params.id
  );

  res.json({ success: true, data: allowedDirectories });
});

// Remove an allowed directory from a session
router.delete('/:id/allowed-directories', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const directory = req.query.directory as string | undefined;

  if (!directory || typeof directory !== 'string') {
    throw new AppError('Directory path is required as query parameter', 400, 'VALIDATION_ERROR');
  }

  const normalizedDir = path.resolve(directory);

  const session = (await pgGet(
    'SELECT allowed_directories FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  )) as unknown as { allowed_directories: string | null } | undefined;

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const allowedDirectories = safeJsonParse<string[]>(session.allowed_directories, []);

  // Remove the directory
  const newDirectories = allowedDirectories.filter((d) => d !== normalizedDir);

  await pgRun(
    'UPDATE sessions SET allowed_directories = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    JSON.stringify(newDirectories),
    req.params.id
  );

  res.json({ success: true, data: newDirectories });
});

// Helper function to validate token from query param or Authorization header
async function validateToken(
  req: import('express').Request,
  res: import('express').Response
): Promise<string | null> {
  const queryToken = req.query.token as string | undefined;
  const authHeader = req.headers.authorization;

  if (queryToken) {
    const jwt = await import('jsonwebtoken');
    try {
      const decoded = jwt.default.verify(queryToken, config.jwtSecret) as { userId: string };
      return decoded.userId;
    } catch {
      res
        .status(401)
        .json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
      return null;
    }
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    const jwt = await import('jsonwebtoken');
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.default.verify(token, config.jwtSecret) as { userId: string };
      return decoded.userId;
    } catch {
      res
        .status(401)
        .json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
      return null;
    }
  } else {
    res.status(401).json({
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
    });
    return null;
  }
}

// Serve durable assistant/workspace media. Unlike the legacy filename routes,
// lookup is by opaque media id and is bound to both session and authenticated
// owner. Foreign users receive the same 404 as a missing object.
router.get('/:id/media/:mediaId', requireAuth, async (req, res, next) => {
  const userId = (req as AuthenticatedRequest).userId;
  const media = await resolveOwnedChatMedia({
    sessionId: req.params.id as string,
    mediaId: req.params.mediaId as string,
    userId,
  });
  if (!media) throw new AppError('Media not found', 404, 'NOT_FOUND');

  const etag = `"sha256-${media.sha256}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('Content-Type', media.mimeType);
  res.setHeader('Content-Length', String(media.byteSize));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");

  const safeName = media.filename.replace(/[\r\n"]/g, '') || 'attachment';
  const asciiFallback = safeName.replace(/[^\x20-\x7e]/g, '_') || 'attachment';
  const disposition = media.mimeType.startsWith('image/') ? 'inline' : 'attachment';
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
  );

  if (req.header('if-none-match') === etag) {
    res.status(304).end();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    res.sendFile(media.filePath, (error) => {
      if (error) reject(error);
      else resolve();
    });
  }).catch(next);
});

// Serve session images (supports token in query param for browser image loading)
router.get('/:id/images/:filename', async (req, res, next) => {
  try {
    const userId = await validateToken(req, res);
    if (!userId) return;

    // Verify session ownership and get working directory
    const session = (await pgGet(
      'SELECT working_directory FROM sessions WHERE id = ? AND user_id = ?',
      req.params.id,
      userId
    )) as unknown as { working_directory: string } | undefined;

    if (!session) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
    }

    const filename = req.params.filename;
    // Sanitize filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res
        .status(400)
        .json({ success: false, error: { code: 'INVALID_FILENAME', message: 'Invalid filename' } });
    }

    const imagePath = path.join(session.working_directory, '.claude-webui-images', filename);

    try {
      await fs.access(imagePath);
      applyUntrustedFileHeaders(res, imagePath);
      res.sendFile(imagePath);
    } catch {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Image not found' } });
    }
  } catch (err) {
    next(err);
  }
});

// Serve session attachments (images, text, pdf, etc.)
router.get('/:id/attachments/:filename', async (req, res, next) => {
  try {
    const userId = await validateToken(req, res);
    if (!userId) return;

    // Verify session ownership and get working directory
    const session = (await pgGet(
      'SELECT working_directory FROM sessions WHERE id = ? AND user_id = ?',
      req.params.id,
      userId
    )) as unknown as { working_directory: string } | undefined;

    if (!session) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
    }

    const filename = req.params.filename;
    // Sanitize filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res
        .status(400)
        .json({ success: false, error: { code: 'INVALID_FILENAME', message: 'Invalid filename' } });
    }

    // Try both attachment directories (new and legacy)
    const attachmentPath = path.join(
      session.working_directory,
      '.claude-webui-attachments',
      filename
    );
    const legacyImagePath = path.join(session.working_directory, '.claude-webui-images', filename);

    try {
      await fs.access(attachmentPath);
      applyUntrustedFileHeaders(res, attachmentPath);
      res.sendFile(attachmentPath);
    } catch {
      // Try legacy image path
      try {
        await fs.access(legacyImagePath);
        applyUntrustedFileHeaders(res, legacyImagePath);
        res.sendFile(legacyImagePath);
      } catch {
        return res
          .status(404)
          .json({ success: false, error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
      }
    }
  } catch (err) {
    next(err);
  }
});

// Set session category
router.patch('/:id/category', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { categoryId } = req.body;

  // Verify session ownership
  const session = await pgGet(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  );

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  // If categoryId is provided, verify it belongs to the user
  if (categoryId) {
    const category = await pgGet(
      'SELECT id FROM session_categories WHERE id = ? AND user_id = ?',
      categoryId,
      userId
    );

    if (!category) {
      throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
    }
  }

  await pgRun(
    'UPDATE sessions SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    categoryId || null,
    req.params.id
  );

  res.json({ success: true, data: { category: categoryId || null } });
});

/**
 * Builds a tsquery that prefix-matches every word in the query.
 *
 * Words are extracted rather than the input being forwarded, so `foo:*`, `&`,
 * `!`, parentheses and unterminated quotes cannot reach the parser as
 * operators — the token pattern admits letters, digits and underscore and
 * nothing else. Result: `hello:* & world:*`.
 */
export function buildFtsMatch(query: string): string | null {
  const tokens = (query.normalize('NFKC').match(/[\p{L}\p{N}_]+/gu) ?? [])
    .slice(0, 24)
    .map((token) => token.slice(0, 64));
  return tokens.length > 0 ? tokens.map((token) => `${token}:*`).join(' & ') : null;
}

export function escapeMessageSearchLike(query: string): string {
  return query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * The search column is added by the migration. If that has not run yet the
 * queries below would fail outright, so search falls back to LIKE — slower, but
 * a working search box beats a 500.
 */
async function ftsAvailable(): Promise<boolean> {
  try {
    const row = await pgGet(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'messages' AND column_name = 'search_vector'`
    );
    return !!row;
  } catch {
    return false;
  }
}

// Search messages in a session
router.get('/:id/messages/search', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const requestedLimit = Number(req.query.limit ?? 50);
  const limit = Math.min(
    100,
    Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50)
  );

  if (query.length < 2 || query.length > 200) {
    throw new AppError('Query must be between 2 and 200 characters', 400, 'INVALID_QUERY');
  }

  // Verify session ownership
  const session = await pgGet(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  );

  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const ftsExpr = buildFtsMatch(query);
  const useFts = ftsExpr !== null && (await ftsAvailable());

  const messages = useFts
    ? await pgAll(
        `SELECT m.id, m.session_id as sessionId, m.chat_id AS chatId, m.role,
                  substr(
                    ts_headline('simple', m.content, to_tsquery('simple', ?),
                                'StartSel=,StopSel=,MaxWords=64,MinWords=16,MaxFragments=1'),
                    1, 2000
                  ) AS content,
                  strftime('%Y-%m-%dT%H:%M:%fZ', m.created_at) as createdAt
           FROM messages m
           WHERE m.search_vector @@ to_tsquery('simple', ?) AND m.session_id = ?
           ORDER BY m.created_at DESC
           LIMIT ?`,
        ftsExpr,
        ftsExpr,
        req.params.id,
        limit
      )
    : await pgAll(
        `SELECT id, session_id as sessionId, chat_id AS chatId, role,
                  substr(content, greatest(1, strpos(lower(content), lower(?)) - 400), 1600) AS content,
                  strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt
           FROM messages
           WHERE session_id = ? AND content LIKE ? ESCAPE '\\'
           ORDER BY created_at DESC, seq DESC
           LIMIT ?`,
        query,
        req.params.id,
        `%${escapeMessageSearchLike(query)}%`,
        limit
      );

  const data = (messages as Array<{ id: string; sessionId: string; chatId: string | null }>).map(
    (message) => ({
      ...message,
      jump: {
        sessionId: message.sessionId,
        chatId: message.chatId,
        messageId: message.id,
      },
    })
  );
  res.json({ success: true, data });
});

// Search all messages across all sessions
router.get('/messages/search', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const requestedLimit = Number(req.query.limit ?? 50);
  const limit = Math.min(
    100,
    Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50)
  );

  if (query.length < 2 || query.length > 200) {
    throw new AppError('Query must be between 2 and 200 characters', 400, 'INVALID_QUERY');
  }

  const ftsExpr = buildFtsMatch(query);
  const useFts = ftsExpr !== null && (await ftsAvailable());

  const messages = useFts
    ? await pgAll(
        `SELECT m.id, m.session_id as sessionId, m.chat_id AS chatId, m.role,
                  substr(
                    ts_headline('simple', m.content, to_tsquery('simple', ?),
                                'StartSel=,StopSel=,MaxWords=64,MinWords=16,MaxFragments=1'),
                    1, 2000
                  ) AS content,
                  strftime('%Y-%m-%dT%H:%M:%fZ', m.created_at) as createdAt,
                  s.name as sessionName
           FROM messages m
           JOIN sessions s ON m.session_id = s.id
           WHERE m.search_vector @@ to_tsquery('simple', ?) AND s.user_id = ?
           ORDER BY m.created_at DESC
           LIMIT ?`,
        ftsExpr,
        ftsExpr,
        userId,
        limit
      )
    : await pgAll(
        `SELECT m.id, m.session_id as sessionId, m.chat_id AS chatId, m.role,
                  substr(m.content, greatest(1, strpos(lower(m.content), lower(?)) - 400), 1600) AS content,
                  strftime('%Y-%m-%dT%H:%M:%fZ', m.created_at) as createdAt,
                  s.name as sessionName
           FROM messages m
           JOIN sessions s ON m.session_id = s.id
           WHERE s.user_id = ? AND m.content LIKE ? ESCAPE '\\'
           ORDER BY m.created_at DESC
           LIMIT ?`,
        query,
        userId,
        `%${escapeMessageSearchLike(query)}%`,
        limit
      );

  const data = (messages as Array<{ id: string; sessionId: string; chatId: string | null }>).map(
    (message) => ({
      ...message,
      jump: {
        sessionId: message.sessionId,
        chatId: message.chatId,
        messageId: message.id,
      },
    })
  );
  res.json({ success: true, data });
});

/**
 * GET /api/sessions/:id/export
 * Whole transcript as Markdown. Served as a download so the browser saves a
 * file, and consumed verbatim by the Android share sheet.
 */
router.get('/:id/export', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const session = (await pgGet(
    `SELECT id, name, cli_provider AS cliProvider, cli_model AS cliModel,
              working_directory AS workingDirectory,
              strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS createdAt
         FROM sessions WHERE id = ? AND user_id = ?`,
    req.params.id,
    userId
  )) as unknown as
    | {
        id: string;
        name: string;
        cliProvider: string | null;
        cliModel: string | null;
        workingDirectory: string | null;
        createdAt: string;
      }
    | undefined;
  if (!session) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const chatId = typeof req.query.chatId === 'string' ? req.query.chatId : null;
  const rows = (await pgAll(
    `SELECT role, content, strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS createdAt
         FROM messages
        WHERE session_id = ?${chatId ? ' AND chat_id = ?' : ''}
        ORDER BY created_at ASC, seq ASC`,
    ...(chatId ? [session.id, chatId] : [session.id])
  )) as unknown as Array<{
    role: string;
    content: string;
    createdAt: string;
  }>;

  const lines = [
    `# ${session.name}`,
    '',
    `- Session: \`${session.id}\``,
    `- Provider: ${session.cliProvider || 'unknown'}${session.cliModel ? ` (${session.cliModel})` : ''}`,
    `- Workspace: \`${session.workingDirectory || '—'}\``,
    `- Started: ${session.createdAt}`,
    `- Messages: ${rows.length}`,
    '',
    '---',
    '',
  ];
  for (const row of rows) {
    const who = row.role === 'user' ? 'You' : row.role === 'assistant' ? 'Agent' : row.role;
    lines.push(`### ${who} · ${row.createdAt}`, '', row.content.trim(), '');
  }

  // Keep the filename safe for every OS rather than trusting the session name.
  const slug = session.name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.md"`);
  res.send(lines.join('\n'));
});

export default router;
