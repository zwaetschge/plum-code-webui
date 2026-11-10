import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { resolveConfigHome } from '../../utils/configPaths.js';
import { AppError } from '../../middleware/errorHandler.js';
import { readModelProvidersForUser } from '../../utils/modelProviderKeys.js';
import { safeDecrypt } from '../../utils/encryption.js';

/** Voices from the Mistral API are addressed as `mistral:<voice_id>`; everything else is OmniVoice. */
export const MISTRAL_VOICE_PREFIX = 'mistral:';
const MISTRAL_API = 'https://api.mistral.ai';
/**
 * Voxtral TTS 3: the voice catalogue's presets (Heidi for German and 65 more)
 * only work with this model; `voxtral-mini-tts-2603` ("speech v1") answers
 * 400 "voice is not supported for speech v1" for them.
 */
const MISTRAL_TTS_MODEL = 'voxtral-mini-tts-3';
/** Heidi, Mistral's German preset; offered even when the voice list is unavailable. */
const MISTRAL_GERMAN_VOICE = {
  id: '01a0f318-4ae8-7446-a3e4-45aa092940b2',
  name: 'Heidi',
  language: 'de',
};
const MISTRAL_PRESET_VOICES = [MISTRAL_GERMAN_VOICE];
/** Languages offered in the pickers (Swiss national languages and English), in this order. */
const MISTRAL_VOICE_LANGUAGES = ['de', 'fr', 'it', 'en'] as const;
const LANGUAGE_NAMES: Record<string, string> = {
  de: 'Deutsch',
  fr: 'Französisch',
  it: 'Italienisch',
  en: 'Englisch',
};

async function mistralKey(userId: string): Promise<string | null> {
  const providers = await readModelProvidersForUser(userId);
  const mistral = providers.find((provider) => provider.id === 'mistral');
  if (!mistral?.enabled || !mistral.apiKey) return null;
  return safeDecrypt(mistral.apiKey) || null;
}

export interface MistralVoice {
  id: string;
  name: string;
  /** Primary language, lower-case base code ("de" for de/de_de, "en" for en_GB). */
  language: string;
}

export function parseMistralVoices(payload: unknown): MistralVoice[] {
  const list = Array.isArray(payload)
    ? payload
    : (((payload as { data?: unknown; voices?: unknown; items?: unknown } | null)?.data ??
        (payload as { voices?: unknown } | null)?.voices ??
        (payload as { items?: unknown } | null)?.items ??
        []) as unknown[]);
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const voice = item as { id?: unknown; slug?: unknown; name?: unknown; languages?: unknown };
    const id =
      typeof voice.id === 'string' ? voice.id : typeof voice.slug === 'string' ? voice.slug : '';
    if (!id || id.length > 100) return [];
    const first = Array.isArray(voice.languages) ? voice.languages[0] : undefined;
    const language = typeof first === 'string' ? first.toLowerCase().split(/[_-]/)[0]! : '';
    return [{ id, name: typeof voice.name === 'string' && voice.name ? voice.name : id, language }];
  });
}

/**
 * The picker's Mistral voices: German first, then French, Italian and English
 * (the list has 66 presets in 20 languages), each labelled with its language.
 */
export function pickMistralVoices(voices: MistralVoice[]) {
  const rank = (voice: MistralVoice) =>
    MISTRAL_VOICE_LANGUAGES.indexOf(voice.language as (typeof MISTRAL_VOICE_LANGUAGES)[number]);
  return voices
    .filter((voice) => rank(voice) >= 0)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'de'))
    .map((voice) => ({
      id: `${MISTRAL_VOICE_PREFIX}${voice.id}`,
      name: `${voice.name} · ${LANGUAGE_NAMES[voice.language]}`,
      engine: 'mistral',
      language: voice.language,
    }));
}

const VOICE_LIST_TTL_MS = 6 * 60 * 60_000;
let voiceListCache: { key: string; at: number; voices: MistralVoice[] } | null = null;

/** Every page of `/v1/audio/voices` (10 per page, `offset`), cached six hours. */
async function mistralVoiceCatalogue(key: string): Promise<MistralVoice[]> {
  const cacheKey = createHash('sha256').update(key).digest('hex');
  if (voiceListCache?.key === cacheKey && Date.now() - voiceListCache.at < VOICE_LIST_TTL_MS)
    return voiceListCache.voices;
  const voices: MistralVoice[] = [];
  for (let offset = 0; offset < 300; ) {
    const response = await fetch(`${MISTRAL_API}/v1/audio/voices?offset=${offset}`, {
      headers: { Authorization: `Bearer ${key}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      break;
    }
    const body = (await response.json()) as { total?: unknown };
    const page = parseMistralVoices(body);
    if (!page.length) break;
    voices.push(...page.filter((voice) => !voices.some((known) => known.id === voice.id)));
    offset += page.length;
    if (typeof body.total === 'number' && voices.length >= body.total) break;
  }
  if (voices.length) voiceListCache = { key: cacheKey, at: Date.now(), voices };
  return voices;
}

async function mistralVoices(userId: string) {
  const key = await mistralKey(userId);
  if (!key) return [];
  const catalogue = await mistralVoiceCatalogue(key).catch(() => [] as MistralVoice[]);
  // The German preset keeps the engine usable when the list is unavailable.
  return pickMistralVoices(catalogue.length ? catalogue : MISTRAL_PRESET_VOICES);
}

async function mistralSpeech(userId: string, voiceId: string, text: string) {
  const key = await mistralKey(userId);
  if (!key)
    throw new AppError(
      'Für Mistral-Stimmen fehlt eine aktive Mistral-API-Verbindung.',
      409,
      'VOICE_NOT_CONFIGURED'
    );
  const request = (voice: string) =>
    fetch(`${MISTRAL_API}/v1/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MISTRAL_TTS_MODEL,
        input: text,
        voice_id: voice,
        response_format: 'wav',
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(120000),
    }).catch(() => {
      throw new AppError('Mistral ist nicht erreichbar', 503, 'VOICE_UNAVAILABLE');
    });
  let response = await request(voiceId);
  // A stored voice from the retired v1 list (e.g. "gb_jane_neutral") no longer
  // exists: speak with Heidi instead of failing the whole voice conversation.
  if (response.status === 400 && voiceId !== MISTRAL_GERMAN_VOICE.id) {
    await response.body?.cancel();
    response = await request(MISTRAL_GERMAN_VOICE.id);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      response.status === 403
        ? 'Mistral hat den Text abgelehnt (Moderation).'
        : 'Mistral konnte die Sprachausgabe nicht erzeugen.',
      response.status === 429 ? 429 : 502,
      'VOICE_REQUEST_FAILED'
    );
  }
  const body = (await response.json().catch(() => null)) as { audio_data?: unknown } | null;
  if (typeof body?.audio_data !== 'string' || body.audio_data.length > 90 * 1024 * 1024)
    throw new AppError('Mistral hat kein Audio geliefert', 502, 'VOICE_RESPONSE_INVALID');
  const audio = Buffer.from(body.audio_data, 'base64');
  if (audio.subarray(0, 4).toString('ascii') !== 'RIFF')
    throw new AppError('Mistral hat kein WAV-Audio geliefert', 502, 'VOICE_RESPONSE_INVALID');
  return audio;
}

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
  // OmniVoice may be down while Mistral still works (and vice versa), so neither blocks the other.
  const omni = await call(userId, '/api/voices')
    .then(async (response) => {
      const data = await voiceJson(response);
      const voices = Array.isArray(data) ? data : ((data as { voices?: unknown[] }).voices ?? []);
      return voices.filter(
        (voice) =>
          typeof voice === 'object' &&
          voice !== null &&
          (voice as { engine?: string }).engine === 'omnivoice'
      );
    })
    .catch(() => null);
  const mistral = await mistralVoices(userId).catch(() => []);
  if (omni === null && !mistral.length)
    throw new AppError('Vocarium ist nicht erreichbar', 503, 'VOICE_UNAVAILABLE');
  return [...(omni ?? []), ...mistral];
}
export async function assistantSpeech(
  userId: string,
  input: { text: string; voice: string; language: string }
) {
  if (input.voice.startsWith(MISTRAL_VOICE_PREFIX))
    return mistralSpeech(userId, input.voice.slice(MISTRAL_VOICE_PREFIX.length), input.text);
  // Engine is explicit and cannot silently fall back to Kikiri or Edge.
  // Vocarium ids use hyphens ("Rufus-Beck") while profiles and clients store the
  // spoken name ("Rufus Beck"), so the hyphenated form is tried when the name is unknown.
  // Vocarium also turns non-ASCII letters into hyphens ("Tobi Knödel" -> "Tobi-Kn-del").
  const request = (voice: string) =>
    call(userId, '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        voice_id: voice,
        language: input.language,
        engine: 'omnivoice',
        response_format: 'wav',
      }),
    });
  const candidates = [
    ...new Set([
      input.voice,
      input.voice.trim().replace(/\s+/g, '-'),
      input.voice.trim().replace(/[^A-Za-z0-9]+/g, '-'),
    ]),
  ];
  let response: Response | undefined;
  for (const [index, voice] of candidates.entries()) {
    try {
      response = await request(voice);
      break;
    } catch (failure) {
      if (index === candidates.length - 1) throw failure;
    }
  }
  if (!response) throw new AppError('Stimme nicht gefunden', 404, 'VOICE_NOT_FOUND');
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

/** Half a second of 16 kHz mono silence as WAV: enough for Whisper to load. */
function silentWav(): Buffer {
  const pcm = Buffer.alloc(16000);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Brings Whisper and the chosen voice up before a voice conversation, so the
 * first spoken turn does not wait for models to load on the GPU. Both run in
 * parallel; each reports whether it is ready, how long it took, or its error.
 */
export async function assistantVoiceWarmup(
  userId: string,
  input: { voice: string; language: string }
) {
  const timed = async (work: () => Promise<unknown>) => {
    const start = Date.now();
    try {
      await work();
      return { ready: true, ms: Date.now() - start };
    } catch (failure) {
      return {
        ready: false,
        ms: Date.now() - start,
        error: failure instanceof Error ? failure.message : String(failure),
      };
    }
  };
  const [whisper, speech] = await Promise.all([
    timed(() =>
      assistantTranscription(
        userId,
        { buffer: silentWav(), originalname: 'warmup.wav', mimetype: 'audio/wav' },
        'de'
      )
    ),
    timed(() => assistantSpeech(userId, { text: 'Hallo.', ...input })),
  ]);
  return { whisper, speech };
}
