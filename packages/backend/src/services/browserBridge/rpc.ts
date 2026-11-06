import { MAX_CHAT_UPLOAD_FILES } from '../chatUploads.js';
import { config } from '../../config.js';
import { generateUserToken } from '../../utils/authTokens.js';
import { all as pgAll, get as pgGet } from '../../db/pg.js';
import { listPendingPermissionsForUser } from '../../routes/permissions.js';
import { listPendingQuestionsForUser } from '../pendingQuestions.js';
import type { BridgeClientKind } from './bridge.js';
import type { ChatRelay } from './chatRelay.js';

/**
 * Requests the Plum Browser extension may make over its bridge socket.
 *
 * The pairing token deliberately grants no REST access, so the extension's
 * session picker and chat panel cannot call the API themselves. They ask here
 * instead: each method maps to one existing route, called on the owner's behalf
 * with a short-lived token, or to the socket handlers the WebUI uses (through
 * ChatRelay). Nothing outside this allowlist is reachable.
 */

export interface BridgeRpcContext {
  userId: string;
  connectionId: string;
  /** The connection's kind; a watch is limited to WATCH_RPC_METHODS. */
  kind: BridgeClientKind;
  pinSession: (sessionId: string) => void;
  unpinSession: (sessionId: string) => void;
  sessionsOnThisBrowser: () => Set<string>;
  chat: () => ChatRelay;
}

async function api(
  userId: string,
  method: 'GET' | 'PATCH' | 'POST',
  path: string,
  body?: unknown
): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${generateUserToken(userId, { expiresIn: '2m' })}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: unknown;
    error?: { message?: string };
  } | null;
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  }
  return payload.data;
}

function sessionId(params: Record<string, unknown>): string {
  const id = params.sessionId;
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) throw new Error('Invalid session id');
  return id;
}

function text(params: Record<string, unknown>, key: string, max: number): string {
  const value = params[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  if (value.length > max) throw new Error(`${key} is too long`);
  return value;
}

// Same cap as a chat message: session:send rejects more.
const MAX_IMAGES = MAX_CHAT_UPLOAD_FILES;
const MAX_IMAGE_BASE64 = 4 * 1024 * 1024;

/** Screenshots from a recorded demonstration: JPEG/PNG only, bounded in number and size. */
function images(list: unknown[]) {
  if (list.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images`);
  return list.map((item, index) => {
    const image = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const mimeType = image.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    const data = typeof image.data === 'string' ? image.data : '';
    if (!data || data.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(data)) {
      throw new Error(`Image ${index + 1} is invalid or too large`);
    }
    const filename =
      typeof image.filename === 'string' && /^[\w.-]{1,80}$/.test(image.filename)
        ? image.filename
        : `bild-${index + 1}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
    return { data, mimeType, filename };
  });
}

// Account quotas for the companion and extension popups, in the order and with
// the window names the WebUI tracker uses.
const USAGE_PROVIDERS = [
  ['codex', 'Codex', ['5 Std.', 'Woche']],
  ['claude', 'Claude', ['5 Std.', 'Woche', 'Woche Sonnet']],
  ['zai', 'Z.AI', ['5 Std.', 'Woche']],
  ['alibaba', 'Token Plan', ['Plan', 'Planperiode']],
  ['mistral', 'Mistral', ['Heute', 'Monat']],
  ['vibe', 'Vibe', ['Heute', 'Monat']],
] as const;
const WINDOW_KEYS = ['five_hour', 'seven_day', 'seven_day_sonnet'] as const;
// Providers whose windows Plum snapshots (usage_limit_snapshots), so a pace exists.
const FORECAST_PROVIDERS = new Set(['codex', 'claude', 'zai']);
// The pace is measured over the recent past of the current window only: three
// hours for the 5-hour window, a day for weekly ones so one busy hour does not
// project onto the whole week.
const FORECAST_LOOKBACK_MS: Record<string, number> = {
  five_hour: 3 * 60 * 60 * 1000,
  seven_day: 24 * 60 * 60 * 1000,
  seven_day_sonnet: 24 * 60 * 60 * 1000,
};
const FORECAST_MIN_SPAN_MS = 20 * 60 * 1000;

interface LimitWindow {
  utilization?: number;
  resetsAt?: string | null;
}

export interface UsageForecast {
  state: 'exhausts' | 'lasts' | 'unknown';
  at: string | null;
}

/**
 * When a window hits 100 % at its recent pace: the oldest snapshot of the same
 * window (same reset time) within the lookback against the current value. No pace, or a pace that outlasts the reset, says nothing alarming.
 */
async function forecastWindow(
  userId: string,
  provider: string,
  metricKey: string,
  utilization: number,
  resetsAt: string | null,
  now = Date.now()
): Promise<UsageForecast> {
  const unknown: UsageForecast = { state: 'unknown', at: null };
  if (!FORECAST_PROVIDERS.has(provider) || utilization >= 100) return unknown;
  const resetMs = resetsAt ? Date.parse(resetsAt) : NaN;
  const lookback = FORECAST_LOOKBACK_MS[metricKey] ?? FORECAST_LOOKBACK_MS.five_hour!;
  const since = new Date(now - lookback).toISOString().slice(0, 19).replace('T', ' ');
  const rows = (await pgAll(
    `SELECT utilization, resets_at, recorded_at FROM usage_limit_snapshots
      WHERE user_id = ? AND provider = ? AND metric_key = ? AND recorded_at >= ?
      ORDER BY recorded_at ASC LIMIT 200`,
    userId,
    provider,
    metricKey,
    since
  )) as unknown as Array<{ utilization: number; resets_at: string | null; recorded_at: string }>;
  const sameWindow = rows.filter((row) => {
    if (!Number.isFinite(resetMs)) return true;
    const rowReset = row.resets_at ? Date.parse(row.resets_at) : NaN;
    return Number.isFinite(rowReset) && Math.abs(rowReset - resetMs) < 5 * 60 * 1000;
  });
  const first = sameWindow[0];
  if (!first) return unknown;
  const firstMs = Date.parse(`${first.recorded_at.replace(' ', 'T')}Z`);
  const span = now - firstMs;
  const rise = utilization - Number(first.utilization);
  if (!Number.isFinite(span) || span < FORECAST_MIN_SPAN_MS) return unknown;
  if (rise <= 0) return Number.isFinite(resetMs) ? { state: 'lasts', at: null } : unknown;
  const fullAt = now + ((100 - utilization) / rise) * span;
  if (Number.isFinite(resetMs) && fullAt >= resetMs) return { state: 'lasts', at: null };
  return { state: 'exhausts', at: new Date(fullAt).toISOString() };
}

const CLI_TO_USAGE: Record<string, string> = {
  codex: 'codex',
  claude: 'claude',
  zai: 'zai',
  vibe: 'vibe',
};

/** The usage provider of the given session, else of the user's most recent one. */
async function activeUsageProvider(userId: string, sessionId?: string): Promise<string | null> {
  const row = (sessionId
    ? await pgGet(
        'SELECT cli_provider FROM sessions WHERE user_id = ? AND id = ?',
        userId,
        sessionId
      )
    : await pgGet(
        `SELECT cli_provider FROM sessions WHERE user_id = ?
          ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
        userId
      )) as { cli_provider?: string } | undefined;
  return (row?.cli_provider && CLI_TO_USAGE[row.cli_provider]) || null;
}

export async function usageLimits(userId: string, sessionId?: string) {
  const token = generateUserToken(userId, { expiresIn: '2m' });
  const active = await activeUsageProvider(userId, sessionId).catch(() => null);
  const results = await Promise.allSettled(
    USAGE_PROVIDERS.map(async ([provider, label, names]) => {
      const response = await fetch(
        `http://127.0.0.1:${config.port}/api/usage/limits?provider=${provider}`,
        {
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30_000),
        }
      );
      const body = (await response.json().catch(() => null)) as {
        supported?: boolean;
        data?: {
          fiveHour?: LimitWindow | null;
          sevenDay?: LimitWindow | null;
          sevenDaySonnet?: LimitWindow | null;
          additional?: Array<LimitWindow & { name?: string }>;
          source?: string;
          planUsage?: { upstream?: { state?: string } | null } | null;
        } | null;
      } | null;
      const data = body?.supported ? body.data : null;
      if (!data) return null;
      const entries: Array<readonly [string, string | null, LimitWindow | null | undefined]> = [
        [names[0], WINDOW_KEYS[0], data.fiveHour],
        [names[1], WINDOW_KEYS[1], data.sevenDay],
        [names[2] ?? 'Sonnet', WINDOW_KEYS[2], data.sevenDaySonnet],
        ...(data.additional ?? []).map((item) => [item.name || 'Weiteres', null, item] as const),
      ];
      const windows = await Promise.all(
        entries
          .filter((entry): entry is readonly [string, string | null, LimitWindow] => !!entry[2])
          .map(async ([name, metricKey, window]) => {
            const utilization = Math.max(0, Math.round(Number(window.utilization) || 0));
            const resetsAt = window.resetsAt ?? null;
            const forecast = metricKey
              ? await forecastWindow(userId, provider, metricKey, utilization, resetsAt).catch(
                  (): UsageForecast => ({ state: 'unknown', at: null })
                )
              : ({ state: 'unknown', at: null } as UsageForecast);
            return { label: name, utilization, resetsAt, forecast };
          })
      );
      if (!windows.length) return null;
      return {
        provider,
        label,
        estimate: data.source === 'local-estimate' || data.source === 'local-budget',
        exhausted: data.planUsage?.upstream?.state === 'exhausted',
        active: provider === active,
        analyticsPath: `/analytics?provider=${provider}`,
        windows,
      };
    })
  );
  return results.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  );
}

export type UsageRow = Awaited<ReturnType<typeof usageLimits>>[number];

/** Open tool approvals and questions across the user's sessions, oldest first. */
async function approvals(userId: string) {
  const permissions = listPendingPermissionsForUser(userId).map((request) => ({
    kind: 'permission' as const,
    sessionId: request.sessionId,
    requestId: request.requestId,
    toolName: request.toolName,
    description: request.description,
    createdAt: request.createdAt,
  }));
  const questions = listPendingQuestionsForUser(userId).map((record) => ({
    kind: 'question' as const,
    sessionId: record.sessionId,
    requestId: record.requestId,
    providerSessionId: record.providerSessionId ?? null,
    questions: record.questions.map((item) => ({
      header: item.header,
      question: item.question,
      multiple: !!item.multiple,
      options: item.options.map((option) => ({
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
    })),
    createdAt: record.createdAt,
  }));
  const items = [...permissions, ...questions]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, 10);
  const ids = [...new Set(items.map((item) => item.sessionId))];
  const names = new Map<string, string>();
  if (ids.length) {
    const rows = (await pgAll(
      `SELECT id, name FROM sessions WHERE user_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
      userId,
      ...ids
    )) as unknown as Array<{ id: string; name: string }>;
    for (const row of rows) names.set(row.id, row.name);
  }
  return items.map((item) => ({ ...item, sessionName: names.get(item.sessionId) ?? null }));
}

/** Message rows the panel renders; tool payloads and media stay out. */
function pickMessage(row: Record<string, unknown>) {
  return {
    id: row.id,
    role: row.role,
    content: typeof row.content === 'string' ? row.content : '',
    createdAt: row.createdAt,
  };
}

function pickSession(row: Record<string, unknown>, onThisBrowser: Set<string>) {
  return {
    id: row.id,
    name: row.name,
    provider: row.cliProvider,
    model: row.cliModel ?? null,
    status: row.status,
    busy: (row.runtime as { busy?: boolean } | undefined)?.busy ?? row.status === 'running',
    starred: !!row.starred,
    workingDirectory: row.workingDirectory,
    lastActivity: row.lastActivity,
    pinnedHere: onThisBrowser.has(String(row.id)),
  };
}

/**
 * Everything a Wear OS watch may ask for: usage, open approvals and sessions,
 * a short chat (quick and voice replies, stop) and answering approvals and
 * questions. No session creation, provider/model changes, pinning or
 * transcription.
 */
export const WATCH_RPC_METHODS: ReadonlySet<string> = new Set([
  'usage.limits',
  'approvals.list',
  'sessions.list',
  'chat.open',
  'chat.close',
  'chat.send',
  'chat.interrupt',
  'permission.respond',
  'question.respond',
]);

export async function handleBridgeRpc(
  ctx: BridgeRpcContext,
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  if (ctx.kind === 'watch' && !WATCH_RPC_METHODS.has(method)) {
    throw new Error('Not allowed for watch');
  }
  switch (method) {
    case 'sessions.list': {
      const rows = (await api(ctx.userId, 'GET', '/api/sessions')) as Array<
        Record<string, unknown>
      >;
      const here = ctx.sessionsOnThisBrowser();
      return rows.slice(0, 80).map((row) => pickSession(row, here));
    }
    case 'usage.limits':
      return usageLimits(
        ctx.userId,
        typeof params.sessionId === 'string' && /^[\w-]{1,64}$/.test(params.sessionId)
          ? params.sessionId
          : undefined
      );
    case 'approvals.list':
      return approvals(ctx.userId);
    case 'providers.list': {
      const rows = (await api(ctx.userId, 'GET', '/api/cli-providers')) as Array<
        Record<string, unknown>
      >;
      return rows
        .filter((row) => row.available)
        .map((row) => ({
          id: row.id,
          name: row.name,
          icon: row.icon ?? null,
          defaultModel: row.defaultModel ?? null,
          models: Array.isArray(row.models) ? row.models : [],
          modelLabels: row.modelLabels ?? {},
        }));
    }
    case 'session.setProvider': {
      const provider = params.provider;
      if (typeof provider !== 'string') throw new Error('provider is required');
      const row = await api(ctx.userId, 'PATCH', `/api/sessions/${sessionId(params)}/provider`, {
        cliProvider: provider,
      });
      return pickSession(row as Record<string, unknown>, ctx.sessionsOnThisBrowser());
    }
    case 'session.setModel': {
      const model = typeof params.model === 'string' ? params.model : null;
      const row = await api(ctx.userId, 'PATCH', `/api/sessions/${sessionId(params)}/model`, {
        model,
      });
      return pickSession(row as Record<string, unknown>, ctx.sessionsOnThisBrowser());
    }
    case 'session.attach': {
      // Only the user's own sessions: the GET 404s for anything else.
      const id = sessionId(params);
      await api(ctx.userId, 'GET', `/api/sessions/${id}`);
      ctx.pinSession(id);
      return { sessionId: id, connectionId: ctx.connectionId };
    }
    case 'session.detach': {
      ctx.unpinSession(sessionId(params));
      return { ok: true };
    }
    case 'session.create': {
      const body: Record<string, unknown> = { name: text(params, 'name', 100) };
      if (typeof params.provider === 'string') body.cliProvider = params.provider;
      if (typeof params.model === 'string' && params.model) body.cliModel = params.model;
      if (typeof params.workingDirectory === 'string' && params.workingDirectory.trim()) {
        body.workingDirectory = params.workingDirectory.trim();
      }
      const row = await api(ctx.userId, 'POST', '/api/sessions', body);
      return pickSession(row as Record<string, unknown>, ctx.sessionsOnThisBrowser());
    }
    case 'settings.defaults': {
      const settings = (await api(ctx.userId, 'GET', '/api/settings')) as Record<string, unknown>;
      return { defaultWorkingDir: settings.defaultWorkingDir ?? null };
    }

    // ── chat panel ──────────────────────────────────────────────────────
    case 'chat.open': {
      // History plus a live feed of this session's events.
      const id = sessionId(params);
      const limit = Math.min(Math.max(Number(params.limit) || 60, 1), 200);
      const [session, history, pending] = await Promise.all([
        api(ctx.userId, 'GET', `/api/sessions/${id}`),
        api(ctx.userId, 'GET', `/api/sessions/${id}/messages?limit=${limit}`),
        api(ctx.userId, 'GET', `/api/permissions/pending/${id}`).catch(() => []),
      ]);
      ctx.chat().watch(id);
      return {
        session: pickSession(session as Record<string, unknown>, ctx.sessionsOnThisBrowser()),
        messages: (history as Array<Record<string, unknown>>).map(pickMessage),
        pendingPermissions: pending,
      };
    }
    case 'chat.close': {
      ctx.chat().unwatch(sessionId(params));
      return { ok: true };
    }
    case 'chat.send': {
      return ctx.chat().send({
        sessionId: sessionId(params),
        message: text(params, 'message', 40_000),
        clientMessageId: text(params, 'clientMessageId', 64),
        activeFollowupMode: params.activeFollowupMode === 'steer' ? 'steer' : 'queue',
        ...(Array.isArray(params.images) ? { images: images(params.images) } : {}),
      });
    }
    case 'chat.interrupt': {
      ctx.chat().interrupt(sessionId(params));
      return { ok: true };
    }
    case 'permission.respond': {
      const action = params.action;
      if (action !== 'allow_once' && action !== 'allow_project' && action !== 'deny') {
        throw new Error('Unsupported action');
      }
      return api(ctx.userId, 'POST', '/api/permissions/respond', {
        sessionId: sessionId(params),
        requestId: text(params, 'requestId', 200),
        action,
      });
    }
    case 'permission.legacy': {
      // Claude's denial flow: the turn already ended; approving re-runs it.
      const id = sessionId(params);
      if (params.approve === true) {
        const toolNames = Array.isArray(params.toolNames)
          ? params.toolNames.filter((name): name is string => typeof name === 'string')
          : [];
        ctx.chat().approveDenied(id, toolNames, text(params, 'originalMessage', 40_000));
      } else {
        ctx.chat().denyDenied(id);
      }
      return { ok: true };
    }
    case 'transcribe': {
      // Push-to-talk in the panel: the audio goes to Plum's transcription route.
      const data = typeof params.data === 'string' ? params.data : '';
      if (!data || data.length > 20 * 1024 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(data)) {
        throw new Error('Invalid audio');
      }
      const mimeType =
        typeof params.mimeType === 'string' && /^audio\/[\w.+-]+(;.*)?$/.test(params.mimeType)
          ? params.mimeType.split(';')[0]!
          : 'audio/webm';
      const form = new FormData();
      form.append(
        'audio',
        new Blob([Buffer.from(data, 'base64')], { type: mimeType }),
        // The transcriber picks the decoder from the file extension.
        mimeType === 'audio/wav' ? 'speech.wav' : 'speech.webm'
      );
      if (typeof params.language === 'string')
        form.append('language', params.language.slice(0, 10));
      const response = await fetch(`http://127.0.0.1:${config.port}/api/transcribe`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${generateUserToken(ctx.userId, { expiresIn: '2m' })}`,
        },
        body: form,
        signal: AbortSignal.timeout(130_000),
      });
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: { text?: string };
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      }
      return { text: payload.data?.text ?? '' };
    }
    case 'question.respond': {
      const answers = Array.isArray(params.answers)
        ? params.answers.map((group) =>
            Array.isArray(group) ? group.filter((item) => typeof item === 'string') : []
          )
        : null;
      const requestId = text(params, 'requestId', 200);
      const providerSessionId =
        typeof params.providerSessionId === 'string' ? params.providerSessionId : undefined;
      return answers
        ? api(ctx.userId, 'POST', '/api/permissions/questions/respond', {
            requestId,
            providerSessionId,
            answers,
          })
        : api(ctx.userId, 'POST', '/api/permissions/questions/reject', {
            requestId,
            providerSessionId,
          });
    }
    default:
      throw new Error(`Unknown method ${method}`);
  }
}
