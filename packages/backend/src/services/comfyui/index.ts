import { get as pgGet, all as pgAll, run as pgRun } from '../../db/pg.js';
/**
 * ComfyUI orchestrator — single source of truth for image generation jobs.
 *
 * Owns:
 *   - The current ComfyUI base URL (resolved from app_config → env → default)
 *   - A short-lived in-memory job map keyed by a WebUI-generated `generationId`
 *   - Async submit → poll → download → persist pipeline (one job per WebUI generation)
 *
 * Job lifecycle:
 *   queued → running → completed | failed
 *
 * Output files live under `data/generated/<uuid>.png` and are served by the
 * existing `/generated/*.png` static handler (auth-required, see index.ts).
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ComfyUIClient, type ComfyUIOutputImage } from './client.js';
import {
  buildWorkflow,
  validateParams,
  WORKFLOWS,
  type WorkflowId,
  type WorkflowParams,
} from './workflows.js';

export interface GenerationJob {
  id: string;
  userId: string;
  workflowId: WorkflowId;
  params: WorkflowParams;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: number;
  updatedAt: number;
  promptId?: string;
  seed?: number;
  outputFilename?: string;
  outputUrl?: string;
  error?: string;
}

const DEFAULT_COMFYUI_URL = 'http://192.168.1.23:8188';
const POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const JOB_RETENTION_MS = 30 * 60 * 1000; // keep finished jobs for 30 min
const PUBLIC_PREFIX = '/generated';
const MAX_INPUT_IMAGE_BYTES = 25 * 1024 * 1024;
const INPUT_UPLOAD_RETENTION_MS = 30 * 60 * 1000;

const OUTPUT_DIR =
  process.env.COMFYUI_OUTPUT_DIR || path.resolve(process.cwd(), 'packages/backend/data/generated');

export function isPathWithin(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function detectImageMime(bytes: Buffer): string | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6) {
    const prefix = bytes.subarray(0, 6).toString('ascii');
    if (prefix === 'GIF87a' || prefix === 'GIF89a') return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

class ComfyUIOrchestrator {
  private jobs = new Map<string, GenerationJob>();
  private uploadedInputs = new Map<string, { userId: string; expiresAt: number }>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  /** Read current ComfyUI URL from app_config, falling back to env then default. */
  async getBaseUrl(): Promise<string> {
    try {
      const row = (await pgGet(
        'SELECT value FROM app_config WHERE key = ?',
        'comfyui_url'
      )) as unknown as { value: string } | undefined;
      if (row?.value) return row.value;
    } catch {
      // DB not ready / table missing — fall through to env
    }
    return process.env.COMFYUI_URL || DEFAULT_COMFYUI_URL;
  }

  /** Persist a new ComfyUI URL. Throws if the URL isn't reachable. */
  async setBaseUrl(url: string): Promise<void> {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(trimmed)) {
      throw new Error('ComfyUI URL must start with http:// or https://');
    }
    const client = new ComfyUIClient(trimmed);
    const probe = await client.ping();
    if (!probe.ok) {
      throw new Error(`ComfyUI not reachable at ${trimmed}: ${probe.error}`);
    }

    await pgRun(
      `INSERT INTO app_config (key, value) VALUES ('comfyui_url', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      trimmed
    );
  }

  async isEnabled(): Promise<boolean> {
    try {
      const row = (await pgGet(
        'SELECT value FROM app_config WHERE key = ?',
        'comfyui_enabled'
      )) as unknown as { value: string } | undefined;
      if (row) return row.value === 'true';
    } catch {
      // fall through
    }
    // Default: enabled when COMFYUI_URL env is set OR we have a default to fall back to
    return true;
  }

  async client(): Promise<ComfyUIClient> {
    return new ComfyUIClient(await this.getBaseUrl());
  }

  async uploadInputImage(
    userId: string,
    originalName: string,
    bytes: Buffer,
    contentType?: string
  ): Promise<{ name: string; subfolder?: string; type?: string }> {
    if (bytes.length > MAX_INPUT_IMAGE_BYTES) throw new Error('input image exceeds 25 MB');
    const detectedMime = detectImageMime(bytes);
    if (!detectedMime) throw new Error('input file is not a supported image');
    if (contentType && contentType !== detectedMime) {
      throw new Error(
        `input image type mismatch (declared ${contentType}, detected ${detectedMime})`
      );
    }

    const extension =
      detectedMime === 'image/jpeg'
        ? '.jpg'
        : detectedMime === 'image/webp'
          ? '.webp'
          : detectedMime === 'image/gif'
            ? '.gif'
            : '.png';
    const safeName = `${randomUUID()}${extension}`;
    const uploaded = await (
      await this.client()
    ).uploadImage(safeName || originalName, bytes, {
      contentType: detectedMime,
      overwrite: false,
    });
    this.uploadedInputs.set(uploaded.name, {
      userId,
      expiresAt: Date.now() + INPUT_UPLOAD_RETENTION_MS,
    });
    return uploaded;
  }

  /** Background cleanup of stale jobs so the map doesn't grow forever. */
  private ensureCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const cutoff = Date.now() - JOB_RETENTION_MS;
      for (const [id, job] of this.jobs.entries()) {
        if ((job.status === 'completed' || job.status === 'failed') && job.updatedAt < cutoff) {
          this.jobs.delete(id);
        }
      }
      const now = Date.now();
      for (const [name, upload] of this.uploadedInputs) {
        if (upload.expiresAt < now) this.uploadedInputs.delete(name);
      }
    }, 60_000);
    this.cleanupTimer.unref?.();
  }

  /**
   * Submit a generation. Returns immediately with a `generationId`; the caller
   * polls `getJob(id)` for status. The actual work runs async.
   */
  async generate(
    userId: string,
    workflowId: WorkflowId,
    params: WorkflowParams,
    options: { timeoutMs?: number } = {}
  ): Promise<GenerationJob> {
    const valid = validateParams(workflowId, params);
    if (!valid.ok) throw new Error(valid.error);
    if (!(await this.isEnabled()))
      throw new Error('ComfyUI integration is disabled in WebUI settings');

    this.ensureCleanupTimer();

    const id = randomUUID();
    const now = Date.now();
    const job: GenerationJob = {
      id,
      userId,
      workflowId,
      params,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(id, job);

    // Fire-and-forget. Errors land on the job object via runJob's catch handler.
    void this.runJob(job, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    return job;
  }

  /**
   * Synchronous wait variant — used by the MCP server which needs the final
   * image URL inline. Equivalent to `generate()` + polling until terminal.
   */
  async generateAndWait(
    userId: string,
    workflowId: WorkflowId,
    params: WorkflowParams,
    options: { timeoutMs?: number } = {}
  ): Promise<GenerationJob> {
    const job = await this.generate(userId, workflowId, params, options);
    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    while (Date.now() < deadline) {
      const current = this.jobs.get(job.id);
      if (!current) throw new Error('job vanished');
      if (current.status === 'completed' || current.status === 'failed') return current;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error('generation timed out');
  }

  getJob(id: string, userId?: string): GenerationJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (userId && job.userId !== userId) return null;
    return job;
  }

  /**
   * For workflows that need an `input_image`, accept either:
   *   (a) a filename uploaded through Plum by this user, or
   *   (b) a path to this user's attachment/generated-image roots.
   *
   * If we see (b), validate ownership, type and size, upload the bytes to
   * ComfyUI via `/upload/image`, and rewrite
   * `params.input_image` to the filename ComfyUI returns. This eliminates a
   * common failure mode where callers pass a path that ComfyUI can't find →
   * LoadImage either errors or silently substitutes a stale image, producing
   * unrelated garbage output.
   */
  private async materializeInputImage(
    client: ComfyUIClient,
    userId: string,
    workflowId: WorkflowId,
    params: WorkflowParams
  ): Promise<WorkflowParams> {
    // Keyed off the workflow's own declaration rather than a hard-coded id:
    // naming one edit workflow here meant the next one silently skipped the
    // ownership check on the uploaded image.
    if (!WORKFLOWS[workflowId].requiresInputImage) return params;
    const value = params.input_image;
    if (!value) return params;

    // Pure filenames are accepted only when this user uploaded the image via
    // Plum's authenticated upload endpoint during the current process life.
    if (!value.includes('/') && !value.includes('\\')) {
      const upload = this.uploadedInputs.get(value);
      if (!upload || upload.userId !== userId || upload.expiresAt < Date.now()) {
        this.uploadedInputs.delete(value);
        throw new Error('input image is not owned by this user or has expired');
      }
      return params;
    }

    // Paths may reference only this user's session attachments or a generated
    // image owned by one of this user's jobs. Arbitrary absolute paths are
    // deliberately rejected so ComfyUI cannot be used as a file-exfiltration
    // relay from the backend/container mounts.
    const candidate = value.startsWith(`${PUBLIC_PREFIX}/`)
      ? path.join(OUTPUT_DIR, path.basename(value))
      : path.isAbsolute(value)
        ? value
        : path.resolve(value);
    let abs: string;
    let info;
    try {
      abs = await realpath(candidate);
      info = await stat(abs);
    } catch {
      throw new Error('input image does not exist');
    }
    if (!info.isFile()) {
      throw new Error('input image is not a file');
    }
    if (info.size > MAX_INPUT_IMAGE_BYTES) throw new Error('input image exceeds 25 MB');
    if (!(await this.isOwnedInputPath(abs, userId))) {
      throw new Error('input image path is outside owned attachments or generated images');
    }

    const bytes = await readFile(abs);
    const mime = detectImageMime(bytes);
    if (!mime) throw new Error('input file is not a supported image');
    const extension =
      mime === 'image/jpeg'
        ? '.jpg'
        : mime === 'image/webp'
          ? '.webp'
          : mime === 'image/gif'
            ? '.gif'
            : '.png';
    const uploaded = await client.uploadImage(`${randomUUID()}${extension}`, bytes, {
      contentType: mime,
      overwrite: false,
    });
    console.log(`[comfyui] uploaded owned input image → ComfyUI /input/${uploaded.name}`);
    return { ...params, input_image: uploaded.name };
  }

  private async isOwnedInputPath(filePath: string, userId: string): Promise<boolean> {
    try {
      const outputRoot = await realpath(OUTPUT_DIR);
      if (isPathWithin(outputRoot, filePath)) {
        const filename = path.basename(filePath);
        const liveJobOwned = Array.from(this.jobs.values()).some(
          (job) =>
            job.userId === userId && job.status === 'completed' && job.outputFilename === filename
        );
        if (liveJobOwned) return true;

        if (/^[0-9a-f-]{36}\.png$/i.test(filename)) {
          try {
            const owner = JSON.parse(
              await readFile(path.join(OUTPUT_DIR, '.owners', `${filename}.json`), 'utf8')
            ) as { userId?: unknown };
            if (owner.userId === userId) return true;
          } catch {
            // Legacy or externally-created generated images have no owner
            // metadata and therefore fail closed.
          }
        }
        return false;
      }
    } catch {
      // Generated output directory may not exist yet.
    }

    const sessions = (await pgAll(
      'SELECT working_directory FROM sessions WHERE user_id = ?',
      userId
    )) as unknown as Array<{ working_directory: string }>;
    for (const session of sessions) {
      for (const directoryName of ['.claude-webui-attachments', '.claude-webui-images']) {
        try {
          const root = await realpath(path.join(session.working_directory, directoryName));
          if (isPathWithin(root, filePath)) return true;
        } catch {
          // Missing/unreadable attachment roots are simply not eligible.
        }
      }
    }
    return false;
  }

  private async runJob(job: GenerationJob, timeoutMs: number): Promise<void> {
    const update = (patch: Partial<GenerationJob>): void => {
      Object.assign(job, patch, { updatedAt: Date.now() });
    };

    try {
      const client = await this.client();

      // For the image-edit workflow we need to make sure `input_image` is a
      // filename ComfyUI knows about in its /input directory. Callers (MCP,
      // REST clients, agents) often pass an absolute filesystem path to a
      // local attachment instead. Detect that case and auto-upload the file
      // to ComfyUI first so LoadImage actually sees it — otherwise the node
      // silently substitutes whatever happens to be in /input and the edit
      // looks like noise / random style transfer with no relation to input.
      const resolvedParams = await this.materializeInputImage(
        client,
        job.userId,
        job.workflowId,
        job.params
      );

      const workflow = buildWorkflow(job.workflowId, resolvedParams);
      // Capture the seed we actually used so the response includes it.
      const seed = extractSeed(workflow, job.workflowId);
      update({ seed, status: 'running' });

      const queueResp = await client.submit(workflow, `webui-${job.id}`);
      update({ promptId: queueResp.prompt_id });

      const deadline = Date.now() + timeoutMs;
      let history = null;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        try {
          history = await client.getHistory(queueResp.prompt_id);
        } catch (err) {
          // transient — keep polling until deadline
          console.warn('[comfyui] history poll failed:', err instanceof Error ? err.message : err);
          continue;
        }
        if (history?.status?.status_str === 'error') {
          const lastMsg = history.status.messages?.slice(-1)[0];
          const reason =
            (lastMsg &&
            typeof lastMsg[1] === 'object' &&
            lastMsg[1] &&
            'exception_message' in lastMsg[1]
              ? String((lastMsg[1] as { exception_message: unknown }).exception_message)
              : null) || 'ComfyUI reported error';
          throw new Error(reason);
        }
        if (history?.status?.completed) break;
      }
      if (!history?.status?.completed) {
        throw new Error(`generation timed out after ${timeoutMs}ms`);
      }

      // Find the first output image across all SaveImage nodes.
      let outputImage: ComfyUIOutputImage | null = null;
      for (const nodeOutput of Object.values(history.outputs)) {
        if (nodeOutput.images && nodeOutput.images.length > 0) {
          outputImage = nodeOutput.images[0]!;
          break;
        }
      }
      if (!outputImage) throw new Error('ComfyUI produced no output image');

      const { bytes } = await client.download(outputImage);

      await mkdir(OUTPUT_DIR, { recursive: true });
      const filename = `${job.id}.png`;
      await writeFile(path.join(OUTPUT_DIR, filename), bytes);
      const ownerDir = path.join(OUTPUT_DIR, '.owners');
      await mkdir(ownerDir, { recursive: true });
      await writeFile(
        path.join(ownerDir, `${filename}.json`),
        JSON.stringify({ userId: job.userId }),
        { encoding: 'utf8', mode: 0o600 }
      );

      update({
        status: 'completed',
        outputFilename: filename,
        outputUrl: `${PUBLIC_PREFIX}/${filename}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[comfyui] job ${job.id} failed: ${message}`);
      update({ status: 'failed', error: message });
    }
  }
}

/** Best-effort seed read from a built workflow, for echo in the API response. */
function extractSeed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workflow: Record<string, any>,
  id: WorkflowId
): number | undefined {
  switch (id) {
    case 'z-image-turbo':
      return workflow['59:3']?.inputs?.seed;
    case 'flux2-klein-t2i':
      return workflow['113']?.inputs?.noise_seed;
    case 'flux2-klein-edit':
      return workflow['7']?.inputs?.seed;
    case 'krea2-t2i':
      return workflow['30:3']?.inputs?.seed;
    case 'f2k-edit':
      return workflow['7']?.inputs?.seed;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const comfyui = new ComfyUIOrchestrator();
export { ComfyUIClient } from './client.js';
export {
  listWorkflows,
  VALID_ASPECTS,
  VALID_MEGAPIXELS,
  type WorkflowId,
  type WorkflowParams,
} from './workflows.js';
