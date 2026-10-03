import { config } from '../../config.js';
import { generateUserToken } from '../../utils/authTokens.js';
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

const MAX_IMAGES = 12;
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

export async function handleBridgeRpc(
  ctx: BridgeRpcContext,
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (method) {
    case 'sessions.list': {
      const rows = (await api(ctx.userId, 'GET', '/api/sessions')) as Array<
        Record<string, unknown>
      >;
      const here = ctx.sessionsOnThisBrowser();
      return rows.slice(0, 80).map((row) => pickSession(row, here));
    }
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
        'speech.webm'
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
        ? api(ctx.userId, 'POST', '/api/opencode/questions/respond', {
            requestId,
            providerSessionId,
            answers,
          })
        : api(ctx.userId, 'POST', '/api/opencode/questions/reject', {
            requestId,
            providerSessionId,
          });
    }
    default:
      throw new Error(`Unknown method ${method}`);
  }
}
