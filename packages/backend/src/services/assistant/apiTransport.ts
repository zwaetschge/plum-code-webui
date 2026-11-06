import { orderChatApiProviders, type AssistantApiProvider } from '@plum-code-webui/shared';
import { readModelProvidersForUser } from '../../utils/modelProviderKeys.js';
import { getModelProviderCatalog } from '../../utils/modelCatalog.js';
import { safeDecrypt } from '../../utils/encryption.js';
import { AppError } from '../../middleware/errorHandler.js';

const compatible = new Set([
  'openai',
  'openrouter',
  'mistral',
  'zai',
  'z-ai',
  'deepseek',
  'xai',
  'x-ai',
  'groq',
  'together',
  'togetherai',
  'cerebras',
  'fireworks-ai',
  'perplexity',
  'moonshotai',
  'ollama',
  'ollama-cloud',
  'lmstudio',
]);
interface Endpoint extends AssistantApiProvider {
  baseUrl: string;
  key: string;
}
async function endpoints(userId: string): Promise<Endpoint[]> {
  const providers = await readModelProvidersForUser(userId),
    catalog = getModelProviderCatalog();
  return providers.flatMap((provider) => {
    if (!provider.enabled || !provider.apiKey) return [];
    const protocol =
      provider.id === 'anthropic'
        ? 'anthropic'
        : provider.id === 'google'
          ? 'gemini'
          : compatible.has(provider.id) || (!catalog[provider.id] && provider.baseUrl)
            ? 'openai'
            : null;
    const baseUrl =
        provider.baseUrl ||
        catalog[provider.id]?.api ||
        (protocol === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : undefined),
      key = safeDecrypt(provider.apiKey);
    if (!protocol || !baseUrl || !key) return [];
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      return [];
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return [];
    const models = provider.models?.length ? provider.models : (catalog[provider.id]?.models ?? []);
    return [
      {
        id: provider.id,
        name: provider.name,
        protocol,
        baseUrl,
        key,
        models: models.slice(0, 500),
      },
    ];
  });
}
export async function apiChatProviders(userId: string): Promise<AssistantApiProvider[]> {
  return orderChatApiProviders(
    (await endpoints(userId)).map(({ id, name, protocol, models }) => ({
      id,
      name,
      protocol,
      models,
    }))
  );
}
export async function apiChatEndpoint(userId: string, providerId: string, model: string) {
  const endpoint = (await endpoints(userId)).find((item) => item.id === providerId);
  if (!endpoint || !endpoint.models.includes(model))
    throw new AppError(
      'Diese API-Verbindung oder dieses Modell ist nicht verfügbar. Prüfe deine Provider-Einstellungen.',
      409,
      'API_MODEL_UNAVAILABLE'
    );
  return endpoint;
}
export interface ApiUsage {
  input: number;
  output: number;
  cached: number;
  cacheWrite: number;
}
export interface ApiStreamResult {
  model: string;
  usage: ApiUsage | null;
  warning: string | null;
  toolCalls?: ApiToolCall[];
  nativeBlocks?: unknown[];
}
/** Thinking depth a client may request per turn; mapped to each protocol's own knob. */
export const API_REASONING_EFFORTS = ['low', 'medium', 'high', 'max', 'ultra'] as const;
export type ApiReasoningEffort = (typeof API_REASONING_EFFORTS)[number];
const ANTHROPIC_THINKING_BUDGET: Record<ApiReasoningEffort, number> = {
  low: 2048,
  medium: 6144,
  high: 16384,
  max: 32768,
  ultra: 49152,
};
const GEMINI_THINKING_BUDGET: Record<ApiReasoningEffort, number> = {
  low: 1024,
  medium: 4096,
  high: 12288,
  max: 24576,
  ultra: 32768,
};
/**
 * Models that refused `reasoning_effort`, keyed by endpoint and model. Mistral
 * accepts it only for its reasoning models and rejects the whole request for
 * the rest (400 "reasoning_effort is not enabled for this model"), so the
 * effort rail would otherwise break every turn with such a model.
 */
const noReasoningEffort = new Set<string>();

/** Mistral's and OpenAI's error message, short and without the key. */
async function upstreamError(response: Response, key: string): Promise<string> {
  let text = '';
  try {
    text = (await response.text()).slice(0, 4000);
  } catch {
    return '';
  }
  let message = text;
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const error = body.error;
    const found =
      typeof body.message === 'string'
        ? body.message
        : error &&
            typeof error === 'object' &&
            typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : typeof body.detail === 'string'
            ? body.detail
            : null;
    if (found) message = found;
  } catch {
    /* plain-text error */
  }
  return message.split(key).join('…').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export interface ApiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ApiToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface ApiGeneration {
  tools?: ApiTool[];
  temperature?: number;
  maxOutputTokens?: number;
}
export interface ApiMessage {
  role: 'user' | 'assistant' | 'tool';
  toolCallId?: string;
  name?: string;
  toolCalls?: ApiToolCall[];
  nativeBlocks?: unknown[];
  content: string;
  images?: Array<{ mimeType: string; data: string }>;
}
export async function streamApiChat(
  endpoint: Endpoint,
  model: string,
  system: string,
  messages: ApiMessage[],
  signal: AbortSignal,
  onText: (text: string) => Promise<void>,
  /** 'auto' lets the model decide how long to think (voice turns). */
  effort?: ApiReasoningEffort | 'auto',
  generation: ApiGeneration = {}
): Promise<ApiStreamResult> {
  const anthropic = endpoint.protocol === 'anthropic',
    gemini = endpoint.protocol === 'gemini';
  const geminiModel = model.replace(/^models\//, '');
  if (gemini && !/^[A-Za-z0-9._-]{1,160}$/.test(geminiModel))
    throw new AppError(
      'Dieses Gemini-Modell kann nicht über GenerateContent aufgerufen werden.',
      409,
      'API_MODEL_UNAVAILABLE'
    );
  const outputLimit = generation.maxOutputTokens ?? 8192;
  const wireMessages = messages.map((message) =>
    message.role === 'tool'
      ? anthropic
        ? {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content },
            ],
          }
        : { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
      : {
          role: message.role,
          ...(!anthropic && message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: c.arguments },
                })),
              }
            : {}),
          content:
            anthropic && message.nativeBlocks
              ? message.nativeBlocks
              : message.images?.length
                ? anthropic
                  ? [
                      ...message.images.map((image) => ({
                        type: 'image',
                        source: { type: 'base64', media_type: image.mimeType, data: image.data },
                      })),
                      { type: 'text', text: message.content },
                    ]
                  : [
                      { type: 'text', text: message.content },
                      ...message.images.map((image) => ({
                        type: 'image_url',
                        image_url: { url: `data:${image.mimeType};base64,${image.data}` },
                      })),
                    ]
                : message.content,
        }
  );
  const base = new URL(endpoint.baseUrl);
  if (gemini) {
    const prefix = base.pathname.replace(/\/$/, '');
    base.pathname =
      prefix +
      (/\/v1(?:beta)?$/.test(prefix) ? '' : '/v1beta') +
      '/models/' +
      encodeURIComponent(geminiModel) +
      ':streamGenerateContent';
    base.searchParams.set('alt', 'sse');
  } else
    base.pathname =
      base.pathname.replace(/\/$/, '') +
      (anthropic
        ? base.pathname.replace(/\/$/, '').endsWith('/v1')
          ? '/messages'
          : '/v1/messages'
        : '/chat/completions');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
  };
  if (gemini) headers['x-goog-api-key'] = endpoint.key;
  else if (anthropic) {
    headers['x-api-key'] = endpoint.key;
    headers['anthropic-version'] = '2023-06-01';
  } else headers.authorization = `Bearer ${endpoint.key}`;
  const effortKey = `${endpoint.baseUrl}\u0000${model}`;
  let openaiEffort =
    !anthropic && !gemini && effort && effort !== 'auto' && !noReasoningEffort.has(effortKey)
      ? effort === 'max' || effort === 'ultra'
        ? 'high'
        : effort
      : null;
  const post = () =>
    fetch(base, {
      method: 'POST',
      headers,
      redirect: 'error',
      signal,
      body: JSON.stringify(
        gemini
          ? {
              systemInstruction: { parts: [{ text: system }] },
              contents: messages.map((message) => ({
                role: message.role === 'assistant' ? 'model' : 'user',
                parts:
                  message.nativeBlocks ??
                  (message.role === 'tool'
                    ? [
                        {
                          functionResponse: {
                            name: message.name,
                            response: { result: message.content },
                          },
                        },
                      ]
                    : [
                        { text: message.content },
                        ...(message.images ?? []).map((image) => ({
                          inlineData: { mimeType: image.mimeType, data: image.data },
                        })),
                      ]),
              })),
              ...(generation.tools?.length
                ? {
                    tools: [
                      {
                        functionDeclarations: generation.tools.map((t) => ({
                          name: t.name,
                          description: t.description,
                          parameters: t.parameters,
                        })),
                      },
                    ],
                  }
                : {}),
              generationConfig: {
                candidateCount: 1,
                ...(generation.temperature !== undefined
                  ? { temperature: generation.temperature }
                  : {}),
                maxOutputTokens:
                  outputLimit +
                  (effort === 'auto' ? 8192 : effort ? GEMINI_THINKING_BUDGET[effort] : 0),
                ...(effort === 'auto'
                  ? { thinkingConfig: { thinkingBudget: -1 } }
                  : effort
                    ? { thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET[effort] } }
                    : {}),
              },
            }
          : anthropic
            ? {
                model,
                system,
                messages: wireMessages,
                ...(generation.tools?.length
                  ? {
                      tools: generation.tools.map((t) => ({
                        name: t.name,
                        description: t.description,
                        input_schema: t.parameters,
                      })),
                    }
                  : {}),
                ...(!effort && generation.temperature !== undefined
                  ? { temperature: generation.temperature }
                  : {}),
                // The thinking budget counts against max_tokens, so the answer keeps its 8k.
                max_tokens:
                  outputLimit +
                  (effort === 'auto' ? 8192 : effort ? ANTHROPIC_THINKING_BUDGET[effort] : 0),
                stream: true,
                // Adaptive thinking: the model thinks only as long as the question needs.
                ...(effort === 'auto'
                  ? { thinking: { type: 'adaptive' } }
                  : effort
                    ? {
                        thinking: {
                          type: 'enabled',
                          budget_tokens: ANTHROPIC_THINKING_BUDGET[effort],
                        },
                      }
                    : {}),
              }
            : {
                model,
                messages: [{ role: 'system', content: system }, ...wireMessages],
                stream: true,
                stream_options: { include_usage: true },
                ...(generation.tools?.length
                  ? { tools: generation.tools.map((t) => ({ type: 'function', function: t })) }
                  : {}),
                ...(endpoint.id === 'openai'
                  ? { max_completion_tokens: outputLimit }
                  : { max_tokens: outputLimit }),
                ...(!effort && generation.temperature !== undefined
                  ? { temperature: generation.temperature }
                  : {}),
                // OpenAI-style APIs know low/medium/high; max and ultra are the highest of those.
                ...(openaiEffort ? { reasoning_effort: openaiEffort } : {}),
              }
      ),
    });
  let response = await post();
  let detail = '';
  if (!response.ok) {
    detail = await upstreamError(response, endpoint.key);
    // A model without reasoning support: answer without the effort setting
    // instead of failing, and skip it for this model from now on.
    if (response.status === 400 && openaiEffort && /reasoning[_ ]effort/i.test(detail)) {
      noReasoningEffort.add(effortKey);
      openaiEffort = null;
      response = await post();
      detail = response.ok ? '' : await upstreamError(response, endpoint.key);
    }
  }
  if (!response.ok) {
    console.warn(
      `[api-chat] ${endpoint.id}/${model} rejected: HTTP ${response.status}${detail ? ` ${detail}` : ''}`
    );
    throw new AppError(
      `Die Modell-API hat den Auftrag abgelehnt (HTTP ${response.status}${detail ? `: ${detail}` : ''}).`,
      502,
      'API_UPSTREAM_ERROR'
    );
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel();
    throw new AppError(
      'Die API liefert keinen unterstützten Antwortstream.',
      502,
      'API_STREAM_UNSUPPORTED'
    );
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    received = 0,
    done = false,
    finish = false,
    served = model,
    usage: ApiUsage | null = null,
    warning: string | null = null;
  const calls = new Map<number, ApiToolCall>();
  const blocks: Array<Record<string, unknown>> = [];
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10000000
      ? value
      : 0;
  const event = async (frame: string) => {
    const raw = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!raw) return;
    if (raw === '[DONE]') {
      done = true;
      return;
    }
    const item = JSON.parse(raw);
    if (item.error || item.type === 'error')
      throw new AppError(
        'Die Modell-API hat den Antwortstream abgebrochen.',
        502,
        'API_STREAM_ERROR'
      );
    if (typeof item.model === 'string') served = item.model.slice(0, 200);
    if (gemini) {
      if (typeof item.modelVersion === 'string') served = item.modelVersion.slice(0, 200);
      if (item.promptFeedback?.blockReason)
        throw new AppError(
          'Die Gemini-API hat die Eingabe abgewiesen.',
          502,
          'API_UPSTREAM_BLOCKED'
        );
      if (item.usageMetadata) {
        const u = item.usageMetadata,
          cached = count(u.cachedContentTokenCount);
        usage = {
          input: Math.max(0, count(u.promptTokenCount) - cached),
          output: count(u.candidatesTokenCount) + count(u.thoughtsTokenCount),
          cached,
          cacheWrite: 0,
        };
      }
      for (const candidate of item.candidates ?? []) {
        if ((candidate.index ?? 0) !== 0) continue;
        for (const part of candidate.content?.parts ?? []) {
          if (part.functionCall) {
            if (!generation.tools?.length)
              throw new AppError('Werkzeuge sind nicht aktiviert', 502, 'API_TOOL_UNSUPPORTED');
            const index = calls.size;
            calls.set(index, {
              id: `gemini_${index}`,
              name: String(part.functionCall.name),
              arguments: JSON.stringify(part.functionCall.args ?? {}),
            });
            blocks.push(part);
          } else if (part.text || part.thoughtSignature) blocks.push(part);
          if (typeof part.text === 'string' && part.thought !== true) await onText(part.text);
        }
        if (candidate.finishReason && candidate.finishReason !== 'FINISH_REASON_UNSPECIFIED') {
          finish = true;
          if (candidate.finishReason !== 'STOP')
            warning = `Die Gemini-API hat die Ausgabe mit «${String(candidate.finishReason).slice(0, 40)}» beendet.`;
        }
      }
    } else if (anthropic) {
      if (item.type === 'message_start') {
        if (typeof item.message?.model === 'string') served = item.message.model.slice(0, 200);
        const u = item.message?.usage;
        if (u)
          usage = {
            input: count(u.input_tokens),
            output: count(u.output_tokens),
            cached: count(u.cache_read_input_tokens),
            cacheWrite: count(u.cache_creation_input_tokens),
          };
      }
      if (item.type === 'content_block_start') {
        const block = item.content_block;
        blocks[item.index] = { ...block };
        if (block?.type === 'text' && typeof block.text === 'string') await onText(block.text);
        if (block?.type === 'tool_use') {
          if (!generation.tools?.length)
            throw new AppError('Werkzeuge sind nicht aktiviert', 502, 'API_TOOL_UNSUPPORTED');
          calls.set(item.index, { id: String(block.id), name: String(block.name), arguments: '' });
        }
      }
      if (item.type === 'content_block_delta') {
        const block = blocks[item.index];
        if (item.delta?.type === 'text_delta' && typeof item.delta.text === 'string') {
          await onText(item.delta.text);
          if (block) block.text = String(block.text ?? '') + item.delta.text;
        } else if (item.delta?.type === 'input_json_delta') {
          const call = calls.get(item.index);
          if (call) call.arguments += item.delta.partial_json ?? '';
        } else if (item.delta?.type === 'thinking_delta' && block)
          block.thinking = String(block.thinking ?? '') + item.delta.thinking;
        else if (item.delta?.type === 'signature_delta' && block)
          block.signature = String(block.signature ?? '') + item.delta.signature;
      }
      if (item.type === 'message_delta') {
        if (usage && item.usage) usage.output = count(item.usage.output_tokens);
        if (item.delta?.stop_reason === 'max_tokens')
          warning = 'Die API hat die Ausgabe an ihrer Token-Grenze beendet.';
      }
      if (item.type === 'message_stop') done = true;
    } else {
      if (item.usage) {
        const u = item.usage,
          cached = count(u.prompt_tokens_details?.cached_tokens);
        usage = {
          input: Math.max(0, count(u.prompt_tokens) - cached),
          output: count(u.completion_tokens),
          cached,
          cacheWrite: 0,
        };
      }
      for (const choice of item.choices ?? []) {
        if (choice.index !== 0) continue;
        for (const delta of choice.delta?.tool_calls ?? []) {
          if (!generation.tools?.length)
            throw new AppError('Werkzeuge sind nicht aktiviert', 502, 'API_TOOL_UNSUPPORTED');
          const index = Number(delta.index ?? 0),
            prior = calls.get(index) ?? { id: '', name: '', arguments: '' };
          prior.id += delta.id ?? '';
          prior.name += delta.function?.name ?? '';
          prior.arguments += delta.function?.arguments ?? '';
          if (prior.arguments.length > 64000 || calls.size > 32)
            throw new AppError('Werkzeugaufruf zu gross', 502, 'API_TOOL_LIMIT');
          calls.set(index, prior);
        }
        const text = choice.delta?.content ?? choice.delta?.refusal;
        if (typeof text === 'string') await onText(text);
        else if (Array.isArray(text)) {
          // Mistral mixes reasoning blocks and visible text blocks in delta.content.
          // Only render text; thinking blocks remain private to the model.
          for (const block of text) {
            if (block?.type === 'text' && typeof block.text === 'string') await onText(block.text);
          }
        }
        if (choice.finish_reason) {
          finish = true;
          if (!['stop', 'tool_calls'].includes(choice.finish_reason))
            warning = `Die API hat die Ausgabe mit «${String(choice.finish_reason).slice(0, 40)}» beendet.`;
        }
      }
    }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        buffer += decoder.decode();
        break;
      }
      received += chunk.value.byteLength;
      if (received > 8000000)
        throw new AppError('Der API-Antwortstream ist zu gross.', 502, 'API_STREAM_LIMIT');
      buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        await event(frame);
      }
      if (buffer.length > 262144)
        throw new AppError('Das API-Streamereignis ist zu gross.', 502, 'API_STREAM_LIMIT');
    }
    if (buffer.trim()) await event(buffer);
    if (!done && !finish)
      throw new AppError(
        'Die Verbindung endete vor der bestätigten Antwort.',
        502,
        'API_STREAM_INTERRUPTED'
      );
    const toolCalls = [...calls.values()].map((call) => ({
      ...call,
      arguments: call.arguments || '{}',
    }));
    if (anthropic)
      for (const [index, call] of calls)
        if (blocks[index]) blocks[index]!.input = JSON.parse(call.arguments || '{}');
    return {
      model: served,
      usage,
      warning,
      toolCalls,
      nativeBlocks: (anthropic || gemini) && blocks.length ? blocks : undefined,
    };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
