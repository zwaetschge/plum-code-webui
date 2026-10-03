import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { piAuthFile, resolvePiExtensionPaths } from '../../utils/piConfig.js';
import { comfyui } from './index.js';

/**
 * Image generation through the user's Google Antigravity subscription
 * (Gemini "Nano Banana" image models), using the OAuth login Pi stores after
 * `/login antigravity`. Antigravity's Cloud Code backend serves the same
 * `streamGenerateContent` call the IDE uses; the image model comes from the
 * account's own roster (`fetchAvailableModels().imageGenerationModelIds`),
 * because not every account gets the same one.
 *
 * Tokens are refreshed in memory only: Pi owns auth.json and rewrites it on its
 * own refresh, so this module never writes it.
 *
 * This is the IDE's internal API. The pi-antigravity README warns that using it
 * outside Antigravity may violate Google's terms.
 */

/** The daily host is what the IDE uses for inference; prod answers 429 for some plans. */
const ENDPOINTS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/**
 * OAuth client of the login: Google's public Antigravity desktop client. Not
 * copied into this repo; read from the installed pi-antigravity package (the
 * same values Pi refreshes with), or from ANTIGRAVITY_CLIENT_ID/_SECRET.
 */
let oauthClient: { id: string; secret: string } | null = null;

function antigravityClient(): { id: string; secret: string } {
  if (oauthClient) return oauthClient;
  let id = process.env.ANTIGRAVITY_CLIENT_ID || '';
  let secret = process.env.ANTIGRAVITY_CLIENT_SECRET || '';
  const extension = resolvePiExtensionPaths().find((entry) => entry.includes('pi-antigravity'));
  if ((!id || !secret) && extension) {
    try {
      const source = fs.readFileSync(
        path.join(path.dirname(extension), 'auth', 'oauth.ts'),
        'utf8'
      );
      // `export const CLIENT_ID = env || Buffer.from("…" + "…", "base64")`
      const decode = (name: string) => {
        const block = new RegExp(`export const ${name}\\s*=([\\s\\S]*?)\\.toString\\(`).exec(
          source
        )?.[1];
        const literal = [...(block ?? '').matchAll(/"([A-Za-z0-9+/=]+)"/g)]
          .map((match) => match[1])
          .join('');
        return literal ? Buffer.from(literal, 'base64').toString('utf8') : '';
      };
      id ||= decode('CLIENT_ID');
      secret ||= decode('CLIENT_SECRET');
    } catch {
      // Package missing or changed: handled below.
    }
  }
  if (!id || !secret) {
    throw new AntigravityImageError(
      'The Antigravity OAuth client was not found (pi-antigravity is not installed).',
      'NOT_CONNECTED'
    );
  }
  oauthClient = { id, secret };
  return oauthClient;
}

const FALLBACK_IMAGE_MODEL = 'gemini-3.1-flash-image';
const MODEL_CACHE_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000;

export const ANTIGRAVITY_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const;

interface Credentials {
  access: string;
  refresh: string;
  expires: number;
  projectId: string;
}

const tokens = new Map<string, Credentials>();
const imageModels = new Map<string, { id: string; at: number }>();

export class AntigravityImageError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_CONNECTED' | 'QUOTA' | 'FAILED'
  ) {
    super(message);
  }
}

function readCredentials(userId: string): Credentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(piAuthFile(userId), 'utf8'));
  } catch {
    parsed = null;
  }
  const entry =
    parsed && typeof parsed === 'object'
      ? (Object.entries(parsed as Record<string, unknown>).find(([key]) =>
          key.toLowerCase().startsWith('antigravity')
        )?.[1] as Record<string, unknown> | undefined)
      : undefined;
  if (!entry || typeof entry.refresh !== 'string') {
    throw new AntigravityImageError(
      'Google Antigravity is not connected. Sign in under Settings → Provider logins (Pi → Connect Antigravity).',
      'NOT_CONNECTED'
    );
  }
  return {
    access: typeof entry.access === 'string' ? entry.access : '',
    refresh: entry.refresh,
    expires: typeof entry.expires === 'number' ? entry.expires : 0,
    projectId: typeof entry.projectId === 'string' ? entry.projectId : '',
  };
}

async function accessToken(userId: string): Promise<Credentials> {
  const fromFile = readCredentials(userId);
  const cached = tokens.get(userId);
  // Pi may have refreshed (or the user re-logged in) since our last refresh.
  const current =
    cached && cached.refresh === fromFile.refresh && cached.expires > fromFile.expires
      ? cached
      : fromFile;
  if (current.access && current.expires - 60_000 > Date.now()) return current;
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: antigravityClient().id,
      client_secret: antigravityClient().secret,
      refresh_token: current.refresh,
      grant_type: 'refresh_token',
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new AntigravityImageError(
      'The Antigravity login has expired. Sign in again under Settings → Provider logins.',
      'NOT_CONNECTED'
    );
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  const refreshed = {
    ...current,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
  tokens.set(userId, refreshed);
  return refreshed;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'User-Agent': 'antigravity/1.15.8 linux/amd64',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify({
      ideType: 'ANTIGRAVITY',
      platform: 'LINUX',
      pluginType: 'GEMINI',
    }),
  };
}

async function imageModel(userId: string, creds: Credentials): Promise<string> {
  const cached = imageModels.get(userId);
  if (cached && Date.now() - cached.at < MODEL_CACHE_MS) return cached.id;
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: 'POST',
        headers: headers(creds.access),
        body: JSON.stringify({ project: creds.projectId }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { imageGenerationModelIds?: unknown };
      const ids = Array.isArray(data.imageGenerationModelIds)
        ? data.imageGenerationModelIds.filter((id): id is string => typeof id === 'string')
        : [];
      const id = ids[0] ?? FALLBACK_IMAGE_MODEL;
      imageModels.set(userId, { id, at: Date.now() });
      return id;
    } catch {
      // Try the next host.
    }
  }
  return FALLBACK_IMAGE_MODEL;
}

export interface AntigravityImageRequest {
  prompt: string;
  aspectRatio?: (typeof ANTIGRAVITY_ASPECT_RATIOS)[number];
  /** Owned attachment paths or /generated URLs: references to edit or combine. */
  inputImages?: string[];
}

export interface AntigravityImageResult {
  outputUrl: string;
  filename: string;
  model: string;
  text: string | null;
}

export async function generateAntigravityImage(
  userId: string,
  request: AntigravityImageRequest
): Promise<AntigravityImageResult> {
  const creds = await accessToken(userId);
  const model = await imageModel(userId, creds);
  const parts: Array<Record<string, unknown>> = [];
  for (const [index, value] of (request.inputImages ?? []).entries()) {
    const { bytes, mime } = await comfyui.readOwnedImage(userId, value, `input image ${index + 1}`);
    parts.push({ inlineData: { mimeType: mime, data: bytes.toString('base64') } });
  }
  parts.push({ text: request.prompt });
  const body = JSON.stringify({
    project: creds.projectId,
    model,
    request: {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(request.aspectRatio ? { imageConfig: { aspectRatio: request.aspectRatio } } : {}),
      },
    },
    requestType: 'agent',
    userAgent: 'antigravity',
    requestId: `antigravity-${Date.now()}-${randomBytes(6).toString('hex')}`,
  });

  let lastError = 'no response';
  for (const endpoint of ENDPOINTS) {
    const response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: headers(creds.access),
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      lastError = `HTTP ${response.status}: ${text.slice(0, 300)}`;
      if (response.status === 429 && /quota/i.test(text) && endpoint === ENDPOINTS.at(-1)) {
        throw new AntigravityImageError(
          `Antigravity image quota exhausted (${lastError})`,
          'QUOTA'
        );
      }
      continue;
    }
    let image: { data: string; mimeType: string } | null = null;
    const notes: string[] = [];
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      let event: Record<string, any>;
      try {
        event = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      const payload = event.response ?? event;
      for (const candidate of payload.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.inlineData?.data) image = part.inlineData;
          else if (typeof part.text === 'string' && !part.thought) notes.push(part.text);
        }
      }
    }
    if (!image) {
      throw new AntigravityImageError(
        `The model returned no image${notes.length ? `: ${notes.join(' ').slice(0, 400)}` : ''}`,
        'FAILED'
      );
    }
    const saved = await comfyui.saveGeneratedImage(
      userId,
      Buffer.from(image.data, 'base64'),
      image.mimeType
    );
    return { ...saved, model, text: notes.join('').trim() || null };
  }
  throw new AntigravityImageError(`Antigravity image request failed (${lastError})`, 'FAILED');
}
