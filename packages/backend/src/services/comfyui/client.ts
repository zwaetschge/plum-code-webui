/**
 * Thin client for ComfyUI's HTTP API. No external dependency — uses Node's
 * built-in `fetch` (Node 18+) and `FormData` (Node 18+).
 *
 * Endpoints covered:
 *   - POST /prompt              submit a workflow, returns {prompt_id}
 *   - GET  /history/{id}        check status + final outputs
 *   - GET  /queue               see what's pending (optional, not used in hot path)
 *   - GET  /view                download an output PNG by filename/subfolder/type
 *   - POST /upload/image        upload an input image (used by edit workflow)
 *   - GET  /system_stats        health check / version
 *
 * The base URL is resolved at call time so a settings change takes effect
 * without restart.
 */

import { Buffer } from 'node:buffer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Workflow = Record<string, any>;

export interface ComfyUIQueueResponse {
  prompt_id: string;
  number?: number;
  node_errors?: Record<string, unknown>;
}

export interface ComfyUIOutputImage {
  filename: string;
  subfolder: string;
  type: 'output' | 'temp' | 'input';
}

export interface ComfyUIHistoryEntry {
  prompt?: unknown;
  outputs: Record<string, { images?: ComfyUIOutputImage[] }>;
  status?: {
    status_str?: 'success' | 'error';
    completed?: boolean;
    messages?: Array<[string, Record<string, unknown>]>;
  };
}

export class ComfyUIError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string
  ) {
    super(message);
    this.name = 'ComfyUIError';
  }
}

/**
 * Turn ComfyUI's node_errors blob into one line. Model files get moved and
 * renamed on the ComfyUI side without warning, and `value_not_in_list` on a
 * checkpoint/LoRA field is by far the most common way a workflow that shipped
 * working stops working; naming the node and the value makes that a one-look fix.
 */
function summarizePromptRejection(body: string): string {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string };
      node_errors?: Record<
        string,
        { class_type?: string; errors?: Array<{ message?: string; details?: string }> }
      >;
    };
    const parts: string[] = [];
    for (const [nodeId, node] of Object.entries(parsed.node_errors || {})) {
      for (const err of node.errors || []) {
        const what = [err.message, err.details].filter(Boolean).join(' - ');
        parts.push(`node ${nodeId} (${node.class_type || 'unknown'}) ${what}`);
      }
    }
    if (parts.length) return parts.slice(0, 3).join('; ');
    return parsed.error?.message || '';
  } catch {
    return body.slice(0, 200);
  }
}

export class ComfyUIClient {
  constructor(private readonly baseUrl: string) {
    // Strip trailing slash so URL building is consistent.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  get url(): string {
    return this.baseUrl;
  }

  /** Submit a workflow to the queue. Returns the prompt_id used by /history. */
  async submit(workflow: Workflow, clientId?: string): Promise<ComfyUIQueueResponse> {
    const body: { prompt: Workflow; client_id?: string } = { prompt: workflow };
    if (clientId) body.client_id = clientId;
    const resp = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      // A bare "rejected (400)" costs whoever sees it a round trip to ComfyUI's
      // own log. The interesting part -- which node, which field, which value --
      // is already in the body, so lift it into the message.
      const reason = summarizePromptRejection(text);
      throw new ComfyUIError(
        `ComfyUI /prompt rejected (${resp.status})${reason ? `: ${reason}` : ''}`,
        resp.status,
        text.slice(0, 1000)
      );
    }
    return (await resp.json()) as ComfyUIQueueResponse;
  }

  /**
   * Fetch the history entry for a prompt. Returns null if the prompt isn't
   * yet finished (ComfyUI omits it from /history until completion).
   */
  async getHistory(promptId: string): Promise<ComfyUIHistoryEntry | null> {
    const resp = await fetch(`${this.baseUrl}/history/${encodeURIComponent(promptId)}`);
    if (!resp.ok) {
      throw new ComfyUIError(`ComfyUI /history failed (${resp.status})`, resp.status);
    }
    const data = (await resp.json()) as Record<string, ComfyUIHistoryEntry>;
    return data[promptId] || null;
  }

  /**
   * Download an output PNG. Returns the raw bytes plus content-type for
   * persistence by the caller.
   */
  async download(image: ComfyUIOutputImage): Promise<{ bytes: Buffer; contentType: string }> {
    const url = new URL(`${this.baseUrl}/view`);
    url.searchParams.set('filename', image.filename);
    url.searchParams.set('subfolder', image.subfolder || '');
    url.searchParams.set('type', image.type || 'output');
    const resp = await fetch(url.toString());
    if (!resp.ok) {
      throw new ComfyUIError(`ComfyUI /view failed (${resp.status})`, resp.status);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    return { bytes: buf, contentType: resp.headers.get('content-type') || 'image/png' };
  }

  /**
   * Upload an image into ComfyUI's `/input` directory. Used by the edit
   * workflow before submitting so the LoadImage node can reference it.
   * Returns the filename ComfyUI stored it under (may include a hash suffix
   * if ComfyUI deduplicates).
   */
  async uploadImage(
    filename: string,
    bytes: Buffer,
    options: { contentType?: string; overwrite?: boolean; subfolder?: string } = {}
  ): Promise<{ name: string; subfolder: string; type: string }> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(bytes)], {
      type: options.contentType || 'image/png',
    });
    form.append('image', blob, filename);
    if (options.overwrite) form.append('overwrite', '1');
    if (options.subfolder) form.append('subfolder', options.subfolder);
    const resp = await fetch(`${this.baseUrl}/upload/image`, { method: 'POST', body: form });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new ComfyUIError(
        `ComfyUI /upload/image failed (${resp.status})`,
        resp.status,
        text.slice(0, 500)
      );
    }
    return (await resp.json()) as { name: string; subfolder: string; type: string };
  }

  /**
   * Lightweight liveness probe used by the settings "test connection" button.
   * /system_stats returns version + GPU info; 200 == server is reachable.
   */
  async ping(): Promise<{ ok: true; version?: string } | { ok: false; error: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const data = (await resp.json().catch(() => null)) as {
        system?: { comfyui_version?: string };
      } | null;
      return { ok: true, version: data?.system?.comfyui_version };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
