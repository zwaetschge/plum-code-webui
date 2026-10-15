import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { apiChatTurns, createApiChat, startApiTurn } from '../assistant/apiChats.js';
import { apiChatProviders } from '../assistant/apiTransport.js';
import { readPersonalization } from '../assistant/personalization.js';
import { assistantSpeech, assistantTranscription } from '../assistant/voice.js';
import { AppError } from '../../middleware/errorHandler.js';

/**
 * Plum Desk: the ESP32 desk board is a voice-mode client of Plum.
 *
 * It runs the same loop as the WebUI voice mode (VoiceComposer): record until
 * the user is quiet, transcribe through Plum (Vocarium Whisper), send the text
 * as a turn of a model chat, speak the answer through Plum (Vocarium
 * OmniVoice), listen again. The chat is an ordinary Plum chat and shows up in
 * the chat list. The board authenticates with a `plum_ff_` device token.
 */

/** Same provider order as the WebUI start page (orderChatApiProviders). */
const PROVIDER_PRIORITY: Record<string, number> = {
  anthropic: 0,
  mistral: 1,
  deepseek: 2,
  'z-ai': 3,
  zai: 3,
};

/**
 * Phrases Whisper invents for noise or silence (subtitle credits from its
 * training data). Heard on their own they are dropped, not answered.
 */
const HALLUCINATIONS = [
  /^(vielen )?dank(e)?( (schön|sehr|fürs zuschauen|für ihre aufmerksamkeit))?$/,
  /^untertitel(ung)?\b/,
  /\b(amara\.org|zdf|ard|wdr|swr|funk)\b.*(untertitel|im auftrag)/,
  /^(tschüss|ciao|bis (zum nächsten mal|bald|dann))$/,
  /^copyright\b/,
  /^(\.|…|musik|\[musik\]|\*musik\*)$/,
];

function invented(text: string): boolean {
  const plain = text
    .toLowerCase()
    .replace(/[.!?,;:"'„“»«()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return !plain || HALLUCINATIONS.some((pattern) => pattern.test(plain));
}

export async function deskTranscribe(userId: string, audio: Buffer): Promise<string> {
  const result = (await assistantTranscription(
    userId,
    { buffer: audio, originalname: 'plum-desk.wav', mimetype: 'audio/wav' },
    'de'
  )) as { text?: string };
  const text = String(result.text ?? '').trim();
  return invented(text) ? '' : text;
}

/**
 * "Hey Plum" as Whisper writes it: the name comes out as Plum, Plam, Blum,
 * Plump … and the greeting as hey, hei, hi, ey or hallo.
 */
const WAKE =
  /^\s*(?:(?:hey|hei|hej|hi|ey|he|hallo|okay|ok)[\s,.!-]*)(?:p|b|f)l(?:u|a|o|ö)m+(?:p|b)?\b[\s,.!?-]*/i;

/** Checks a phrase heard in the room for the wake word. */
export async function deskWake(
  userId: string,
  audio: Buffer
): Promise<{ wake: boolean; question: string; text: string }> {
  const text = await deskTranscribe(userId, audio);
  const match = WAKE.exec(text);
  if (!match) return { wake: false, question: '', text };
  const rest = text.slice(match[0].length).trim();
  // "Hey Plum." alone wakes the board; anything longer is the question itself.
  return { wake: true, question: rest.split(/\s+/).length >= 2 ? rest : '', text };
}

/** Turns markdown into something worth hearing and cuts it into sentence groups. */
export function spokenChunks(text: string, limit = 240): string[] {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~>|#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chunks: string[] = [];
  let current = '';
  for (const sentence of plain.split(/(?<=[.!?…:])\s+/)) {
    if (current && current.length + sentence.length + 1 > limit) {
      chunks.push(current);
      current = sentence;
    } else current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) chunks.push(current);
  // A single sentence longer than the limit is split at spaces.
  return chunks.flatMap((chunk) => {
    if (chunk.length <= limit * 2) return [chunk];
    const parts: string[] = [];
    let rest = chunk;
    while (rest.length > limit) {
      const cut = rest.lastIndexOf(' ', limit) > limit / 2 ? rest.lastIndexOf(' ', limit) : limit;
      parts.push(rest.slice(0, cut));
      rest = rest.slice(cut).trim();
    }
    return rest ? [...parts, rest] : parts;
  });
}

/** Sends the spoken text as the next turn of the chat and waits for the answer. */
export async function deskTurn(
  userId: string,
  input: { text: string; chatId?: string }
): Promise<{ chatId: string; text: string; speech: string[] }> {
  let chatId = input.chatId;
  if (chatId) {
    // A chat deleted in the WebUI starts a new conversation instead of failing.
    await apiChatTurns(userId, chatId).catch(() => {
      chatId = undefined;
    });
  }
  if (!chatId) {
    const providers = (await apiChatProviders(userId))
      .filter((provider) => provider.models.length)
      .sort((a, b) => (PROVIDER_PRIORITY[a.id] ?? 4) - (PROVIDER_PRIORITY[b.id] ?? 4));
    const provider = providers[0];
    if (!provider)
      throw new AppError('Keine Modellverbindung eingerichtet', 409, 'NO_API_PROVIDER');
    const chat = await createApiChat(userId, {
      commandId: randomUUID(),
      title: `Plum Desk · ${input.text.slice(0, 70)}`,
      providerId: provider.id,
      model: provider.models[0]!,
      sourceIds: [],
    });
    chatId = chat.id;
  }
  const { chat } = await apiChatTurns(userId, chatId);
  const commandId = randomUUID();
  await startApiTurn(userId, chatId, {
    commandId,
    expectedRevision: chat.revision,
    prompt: input.text,
    voice: true,
  });
  const deadline = Date.now() + 170_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const { turns } = await apiChatTurns(userId, chatId);
    const turn = turns.find((entry) => entry.id === commandId);
    if (!turn || turn.status === 'running') continue;
    if (!turn.response && turn.status !== 'completed')
      throw new AppError(turn.error || `Antwort ${turn.status}`, 502, 'TURN_FAILED');
    return { chatId, text: turn.response, speech: spokenChunks(turn.response) };
  }
  throw new AppError('Plum hat nicht rechtzeitig geantwortet', 504, 'TURN_TIMEOUT');
}

/** Raw 16 kHz mono s16le, what the board's speaker plays without conversion. */
function toBoardPcm(wav: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-f',
        's16le',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const out: Buffer[] = [];
    let error = '';
    ffmpeg.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    ffmpeg.stderr.on('data', (chunk: Buffer) => (error += chunk.toString()));
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(out))
        : reject(new Error(`ffmpeg ${code}: ${error.slice(0, 200)}`))
    );
    ffmpeg.stdin.end(wav);
  });
}

/** One chunk of the answer as 16 kHz PCM, in the voice chosen in the personalisation. */
export async function deskSpeech(userId: string, text: string, voice?: string): Promise<Buffer> {
  const personal = await readPersonalization(userId);
  const wav = await assistantSpeech(userId, {
    text,
    voice: voice || personal.voiceName || 'Rufus Beck',
    language: 'German',
  });
  return toBoardPcm(wav);
}
