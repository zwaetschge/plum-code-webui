import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { resolveConfigHome } from '../../utils/configPaths.js';
import { AppError } from '../../middleware/errorHandler.js';

async function vocariumUrl(): Promise<string> {
  let registered = '';
  try {
    const settings = JSON.parse(
      await readFile(path.join(resolveConfigHome(), 'settings.json'), 'utf8')
    );
    registered = String(settings.mcpServers?.vocarium?.env?.VOCARIUM_API_URL ?? '');
  } catch {
    /* Environment or the internal service is the existing fallback. */
  }
  const url = new URL(
    process.env.PLUM_VOCARIUM_URL ||
      registered ||
      process.env.VOCARIUM_API_URL ||
      'http://vocarium-api:8280'
  );
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new AppError('Vocarium-Adresse ist ungültig', 503, 'VOICE_NOT_CONFIGURED');
  return url.href.replace(/\/$/, '');
}
async function call(userId: string, endpoint: string, options: RequestInit = {}) {
  const user = `plum-user-${createHash('sha256').update(userId).digest('hex').slice(0, 16)}`;
  const response = await fetch(`${await vocariumUrl()}${endpoint}`, {
    ...options,
    headers: { ...options.headers, 'Remote-User': user },
    redirect: 'error',
    signal: options.signal ?? AbortSignal.timeout(180000),
  }).catch(() => {
    throw new AppError('Vocarium ist nicht erreichbar', 503, 'VOICE_UNAVAILABLE');
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      'Vocarium konnte den Auftrag nicht ausführen',
      response.status === 429 ? 429 : 502,
      'VOICE_REQUEST_FAILED'
    );
  }
  return response;
}
async function voiceJson(response: Response): Promise<Record<string, unknown> | unknown[]> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (response.body)
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 2 * 1024 * 1024)
        throw new AppError('Vocarium-Antwort ist zu gross', 502, 'VOICE_RESPONSE_INVALID');
      chunks.push(chunk);
    }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('Vocarium-Antwort ist ungültig', 502, 'VOICE_RESPONSE_INVALID');
  }
}
export async function assistantVoices(userId: string) {
  const response = await call(userId, '/api/voices');
  const data = await voiceJson(response);
  const voices = Array.isArray(data) ? data : ((data as { voices?: unknown[] }).voices ?? []);
  return voices.filter(
    (voice) =>
      typeof voice === 'object' &&
      voice !== null &&
      (voice as { engine?: string }).engine === 'omnivoice'
  );
}
export async function assistantSpeech(
  userId: string,
  input: { text: string; voice: string; language: string }
) {
  // Engine is explicit and cannot silently fall back to Kikiri or Edge.
  const response = await call(userId, '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: input.text,
      voice_id: input.voice,
      language: input.language,
      engine: 'omnivoice',
      response_format: 'wav',
    }),
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (response.body)
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 64 * 1024 * 1024)
        throw new AppError('Audio überschreitet die Grössengrenze', 413, 'AUDIO_TOO_LARGE');
      chunks.push(chunk);
    }
  const audio = Buffer.concat(chunks);
  if (audio.subarray(0, 4).toString('ascii') !== 'RIFF')
    throw new AppError('Vocarium hat kein WAV-Audio geliefert', 502, 'VOICE_RESPONSE_INVALID');
  return audio;
}
export async function assistantTranscription(
  userId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string },
  language: string
) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
    file.originalname
  );
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  if (language) form.append('language', language);
  const response = await call(userId, '/v1/audio/transcriptions', { method: 'POST', body: form });
  const result = await voiceJson(response);
  if (Array.isArray(result) || typeof result.text !== 'string' || result.text.length > 50000)
    throw new AppError(
      'Vocarium hat kein gültiges Transkript geliefert',
      502,
      'VOICE_RESPONSE_INVALID'
    );
  return {
    text: result.text,
    ...(Array.isArray(result.words) ? { words: result.words } : {}),
    ...(Array.isArray(result.segments) ? { segments: result.segments } : {}),
  };
}
