import { createHash, randomUUID } from 'node:crypto';
import { get, transaction, type TransactionScope } from '../../db/pg.js';
import { safeDecrypt, safeEncrypt } from '../../utils/encryption.js';
import { AppError } from '../../middleware/errorHandler.js';
import type { AssistantAgent } from '@plum-code-webui/shared';
import { archiveMatrixEvents } from './matrixArchive.js';
import { z } from 'zod';

const preferencesType = 'ch.zwaetschge.schwarm.einstellungen';
const nativeTemplate = z
  .object({
    id: z.string().min(1).max(200),
    titel: z.string().trim().min(1).max(200),
    agent: z
      .string()
      .regex(/^[-a-zA-Z0-9_/]+$/)
      .max(200),
    ziel: z.string().trim().min(1).max(10000),
    budgetUsd: z.number().finite().min(0).max(100000).nullable().optional(),
    budgetMin: z.number().int().min(1).max(100000).nullable().optional(),
    frist: z.string().max(200).nullable().optional(),
    favorit: z.boolean().default(false),
  })
  .passthrough();
export const MATRIX_PREFERENCES_INPUT = z
  .object({
    commandId: z.string().uuid(),
    nativeUserId: z.string().min(1).max(255),
    epoch: z.string().min(1).max(200),
    expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
    zeit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    changes: z
      .object({
        vorlagen: z
          .array(nativeTemplate)
          .max(100)
          .refine(
            (items) =>
              new Set(items.map((i) => i.id)).size === items.length &&
              items.filter((i) => i.favorit).length <= 6
          )
          .optional(),
        antwortenVorlesen: z.boolean().optional(),
        pdfSeiten: z.boolean().optional(),
        screenshotsSperren: z.boolean().optional(),
        einrichtungErledigt: z.array(z.string().min(1).max(100)).max(100).optional(),
      })
      .strict(),
  })
  .strict();
function preferencesHash(value: Record<string, unknown>) {
  // Matrix may reorder object fields while preserving the same native state.
  const sort = (item: unknown, depth = 0): unknown => {
    if (depth > 32)
      throw new AppError(
        'Einstellungsstruktur ist zu tief verschachtelt.',
        400,
        'MATRIX_PREFERENCES_INVALID'
      );
    return Array.isArray(item)
      ? item.map((value) => sort(value, depth + 1))
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => [key, sort(value, depth + 1)])
          )
        : item;
  };
  return createHash('sha256')
    .update(JSON.stringify(sort(value)))
    .digest('hex');
}
async function preferencesFor(c: MatrixConnection): Promise<Record<string, unknown>> {
  const data = await request<Record<string, unknown>>(
    c,
    `/_matrix/client/v3/user/${encodeURIComponent(c.userId)}/account_data/${preferencesType}`
  ).catch((error) => {
    if (error instanceof AppError && error.statusCode === 404) return {} as Record<string, unknown>;
    throw error;
  });
  if (
    !data ||
    Array.isArray(data) ||
    typeof data !== 'object' ||
    JSON.stringify(data).length > 50000
  )
    throw new AppError('Ungültiger nativer Einstellungsstand.', 502, 'MATRIX_PREFERENCES_INVALID');
  return data;
}
function preferencesView(settings: Record<string, unknown>) {
  const version = z.number().int().optional().safeParse(settings.v);
  if (!version.success)
    throw new AppError('Ungültige native Einstellungsversion.', 502, 'MATRIX_PREFERENCES_INVALID');
  if (version.data !== undefined && version.data !== 1) return { v: version.data };
  const fields = Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== null));
  const parsed = z
    .object({
      v: z.number().int().optional(),
      zeit: z.number().int().nonnegative().optional(),
      vorlagen: z.array(nativeTemplate).max(100).optional(),
      antwortenVorlesen: z.boolean().optional(),
      pdfSeiten: z.boolean().optional(),
      screenshotsSperren: z.boolean().optional(),
    })
    .safeParse(fields);
  if (!parsed.success)
    throw new AppError('Ungültiger nativer Einstellungsstand.', 502, 'MATRIX_PREFERENCES_INVALID');
  return parsed.data;
}
export async function matrixPreferences(userId: string) {
  const c = await connectionFor(userId),
    settings = await preferencesFor(c);
  await transaction((tx) => assertConnection(tx, userId, c));
  return {
    settings: preferencesView(settings),
    hash: preferencesHash(settings),
    nativeUserId: c.userId,
    epoch: c.epoch ?? '',
  };
}
/** Per-Plum account serialisation. Matrix itself has no cross-client compare-and-set for account_data. */
export async function updateMatrixPreferences(
  userId: string,
  input: z.infer<typeof MATRIX_PREFERENCES_INPUT>
) {
  const c = await connectionFor(userId);
  if (c.userId !== input.nativeUserId || (c.epoch ?? '') !== input.epoch)
    throw new AppError(
      'Matrix-Verbindung wurde inzwischen gewechselt.',
      409,
      'MATRIX_IDENTITY_CHANGED'
    );
  const hash = preferencesHash({ type: preferencesType, ...input });
  return transaction(async (tx) => {
    await assertConnection(tx, userId, c);
    const prior = await tx.get(
      'SELECT payload_hash,native_user_id,status,result_json FROM assistant_matrix_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (prior.payload_hash !== hash || prior.native_user_id !== c.userId)
        throw new AppError('Befehlskennung hat anderen Inhalt.', 409, 'COMMAND_CONFLICT');
      if (prior.status === 'accepted' && prior.result_json) return JSON.parse(prior.result_json);
    }
    const current = await preferencesFor(c);
    if (current.v !== undefined && current.v !== 1)
      throw new AppError(
        'Diese Version der nativen Einstellungen ist noch nicht unterstützt.',
        409,
        'MATRIX_PREFERENCES_VERSION'
      );
    const next = {
      ...current,
      ...input.changes,
      v: 1,
      zeit: input.zeit,
      geraet: c.deviceId ?? 'Plum Web',
    };
    if (JSON.stringify(next).length > 50000)
      throw new AppError(
        'Einstellungen überschreiten 50 000 Zeichen.',
        413,
        'MATRIX_PREFERENCES_LIMIT'
      );
    const currentHash = preferencesHash(current),
      nextHash = preferencesHash(next);
    const visible = preferencesView(next);
    if (currentHash !== nextHash) {
      if (currentHash !== input.expectedHash || input.zeit <= Number(current.zeit ?? 0))
        throw new AppError(
          'Die nativen Einstellungen wurden inzwischen geändert. Aktuellen Stand laden.',
          409,
          'MATRIX_PREFERENCES_CONFLICT'
        );
      await request(
        c,
        `/_matrix/client/v3/user/${encodeURIComponent(c.userId)}/account_data/${preferencesType}`,
        'PUT',
        next
      );
    }
    const result = {
      settings: visible,
      hash: nextHash,
      nativeUserId: c.userId,
      epoch: c.epoch ?? '',
    };
    await tx.run(
      "INSERT INTO assistant_matrix_commands(user_id,command_id,payload_hash,native_user_id,identity_epoch,status,result_json) VALUES(?,?,?,?,?,'accepted',?) ON CONFLICT(user_id,command_id) DO UPDATE SET status='accepted',result_json=excluded.result_json",
      userId,
      input.commandId,
      hash,
      c.userId,
      c.epoch ?? '',
      JSON.stringify(result)
    );
    return result;
  });
}

const syncRequests = new Map<
  string,
  { completedAt?: number; request: Promise<{ synced: boolean; rooms: number }> }
>();
export async function matrixSync(userId: string) {
  const pending = syncRequests.get(userId);
  if (pending && (pending.completedAt === undefined || Date.now() - pending.completedAt < 2000))
    return pending.request;
  const entry: { completedAt?: number; request: Promise<{ synced: boolean; rooms: number }> } = {
    request: performMatrixSync(userId),
  };
  syncRequests.set(userId, entry);
  try {
    const result = await entry.request;
    entry.completedAt = Date.now();
    return result;
  } catch (error) {
    if (syncRequests.get(userId) === entry) syncRequests.delete(userId);
    throw error;
  }
}
async function performMatrixSync(userId: string) {
  const c = await connectionFor(userId);
  const stored = await get(
    'SELECT native_user_id,cursor FROM assistant_matrix_sync WHERE user_id = ?',
    userId
  );
  const since = stored?.native_user_id === c.userId ? stored.cursor : null;
  const query = new URLSearchParams({
    timeout: '0',
    filter: JSON.stringify({ room: { timeline: { limit: 100 } } }),
    ...(since ? { since: String(since) } : {}),
  });
  const data = await request<{
    next_batch: string;
    rooms?: {
      join?: Record<
        string,
        { timeline?: { events: MatrixEvent[]; limited?: boolean; prev_batch?: string } }
      >;
    };
  }>(c, `/_matrix/client/v3/sync?${query}`);
  if (!data.next_batch)
    throw new AppError(
      'Matrix-Sync hat keinen Fortsetzungspunkt geliefert',
      502,
      'MATRIX_RESPONSE_INVALID'
    );
  const rooms = Object.entries(data.rooms?.join ?? {});
  for (const [roomId, room] of rooms) {
    await archiveMatrixEvents(userId, c.userId, roomId, room.timeline?.events ?? [], c.epoch ?? '');
    // A limited incremental timeline introduces a gap even in a previously imported room.
    // Start a backward pass at the new boundary; event IDs deduplicate overlapping history.
    await updateFor(
      userId,
      c,
      `INSERT INTO assistant_matrix_rooms (user_id,room_id,native_user_id,history_cursor,history_complete,updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id,room_id) DO UPDATE SET native_user_id = excluded.native_user_id, updated_at = excluded.updated_at,
      history_cursor = CASE WHEN ? THEN excluded.history_cursor ELSE assistant_matrix_rooms.history_cursor END,
      history_complete = CASE WHEN ? THEN 0 ELSE assistant_matrix_rooms.history_complete END`,
      userId,
      roomId,
      c.userId,
      room.timeline?.prev_batch ?? null,
      room.timeline?.limited === false && !since ? 1 : 0,
      new Date().toISOString(),
      Boolean(since && room.timeline?.limited),
      Boolean(since && room.timeline?.limited)
    );
  }
  await updateFor(
    userId,
    c,
    `INSERT INTO assistant_matrix_sync (user_id,native_user_id,cursor,updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET native_user_id = excluded.native_user_id,cursor = excluded.cursor,updated_at = excluded.updated_at
    WHERE assistant_matrix_sync.cursor IS NOT DISTINCT FROM ?`,
    userId,
    c.userId,
    data.next_batch,
    new Date().toISOString(),
    stored?.cursor ?? null
  );
  return { synced: true, rooms: rooms.length };
}

interface MatrixIdentity {
  homeserver: string;
  userId: string;
  deviceId: string;
  epoch?: string;
}
interface MatrixConnection extends MatrixIdentity {
  token: string;
}
export interface MatrixEvent {
  event_id?: string;
  type: string;
  sender?: string;
  state_key?: string;
  origin_server_ts?: number;
  content: Record<string, unknown>;
  redacts?: string;
}
export function matrixHomeserver(): string {
  const configured = process.env.PLUM_MATRIX_HOMESERVER?.trim();
  if (!configured)
    throw new AppError(
      'Der Matrix-Homeserver ist noch nicht konfiguriert',
      503,
      'MATRIX_NOT_CONFIGURED'
    );
  const url = new URL(configured);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new AppError('Ungültiger Matrix-Homeserver', 503, 'MATRIX_NOT_CONFIGURED');
  return url.href.replace(/\/$/, '');
}
async function request<T>(
  connection: Pick<MatrixConnection, 'homeserver'> & Partial<Pick<MatrixConnection, 'token'>>,
  path: string,
  method = 'GET',
  body?: unknown
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${connection.homeserver}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        'Content-Type': 'application/json',
        ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new AppError('Matrix ist nicht erreichbar', 503, 'MATRIX_UNAVAILABLE');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      response.status === 401
        ? 'Matrix-Anmeldung ist abgelaufen'
        : response.status === 403
          ? 'Keine Berechtigung für diese Matrix-Aktion'
          : 'Matrix-Anfrage fehlgeschlagen',
      response.status === 401
        ? 401
        : response.status === 403
          ? 403
          : response.status === 404
            ? 404
            : response.status === 429
              ? 429
              : 502,
      'MATRIX_REQUEST_FAILED'
    );
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (response.body)
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 10 * 1024 * 1024) {
        await response.body.cancel().catch(() => {});
        throw new AppError('Matrix-Antwort ist zu gross', 502, 'MATRIX_RESPONSE_TOO_LARGE');
      }
      chunks.push(chunk);
    }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new AppError('Ungültige Matrix-Antwort', 502, 'MATRIX_RESPONSE_INVALID');
  }
}
async function connectionFor(userId: string): Promise<MatrixConnection> {
  const row = (await get(
    'SELECT public_json, secret_encrypted FROM assistant_credentials WHERE user_id = ? AND service = ?',
    userId,
    'matrix'
  )) as { public_json: string; secret_encrypted: string } | undefined;
  if (!row) throw new AppError('Matrix-Konto zuerst verbinden', 409, 'MATRIX_NOT_CONNECTED');
  const identity = JSON.parse(row.public_json) as MatrixIdentity;
  const token = safeDecrypt(row.secret_encrypted);
  if (!token) throw new AppError('Matrix-Zugang erneut verbinden', 409, 'MATRIX_NOT_CONNECTED');
  // Operator-controlled upstream only; a database import cannot redirect credentials.
  if (identity.homeserver !== matrixHomeserver())
    throw new AppError(
      'Homeserver wurde geändert; Konto erneut verbinden',
      409,
      'MATRIX_SERVER_CHANGED'
    );
  return { ...identity, token };
}
/** Verify the current principal without enumerating or synchronising every joined room. */
export async function verifyMatrixIdentity(userId: string) {
  const c = await connectionFor(userId);
  const identity = await request<{ user_id: string }>(c, '/_matrix/client/v3/account/whoami');
  if (identity.user_id !== c.userId)
    throw new AppError('Matrix-Konto wurde gewechselt.', 409, 'MATRIX_IDENTITY_CHANGED');
  await transaction((tx) => assertConnection(tx, userId, c));
  return { userId: identity.user_id, epoch: c.epoch };
}
async function assertConnection(tx: TransactionScope, userId: string, c: MatrixConnection) {
  await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
  const row = await tx.get(
      "SELECT public_json FROM assistant_credentials WHERE user_id=? AND service='matrix'",
      userId
    ),
    identity = row ? JSON.parse(row.public_json) : null;
  if (
    !identity ||
    identity.userId !== c.userId ||
    identity.homeserver !== c.homeserver ||
    (identity.epoch ?? '') !== (c.epoch ?? '')
  )
    throw new AppError(
      'Matrix-Verbindung wurde inzwischen gewechselt',
      409,
      'MATRIX_IDENTITY_CHANGED'
    );
}
async function updateFor(userId: string, c: MatrixConnection, sql: string, ...args: unknown[]) {
  return transaction(async (tx) => {
    await assertConnection(tx, userId, c);
    return tx.run(sql, ...args);
  });
}
export async function matrixStatus(userId: string) {
  const row = (await get(
    'SELECT public_json FROM assistant_credentials WHERE user_id = ? AND service = ?',
    userId,
    'matrix'
  )) as { public_json: string } | undefined;
  return {
    configured: !!process.env.PLUM_MATRIX_HOMESERVER,
    connected: !!row,
    ...(row ? JSON.parse(row.public_json) : {}),
  };
}
export async function connectMatrix(
  userId: string,
  credentials: { username?: string; password?: string; accessToken?: string }
) {
  syncRequests.delete(userId);
  const homeserver = matrixHomeserver();
  let token = credentials.accessToken;
  let deviceId = '';
  if (!token) {
    const login = await request<{ access_token: string; device_id: string }>(
      { homeserver },
      '/_matrix/client/v3/login',
      'POST',
      {
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: credentials.username },
        password: credentials.password,
        initial_device_display_name: 'Plum',
      }
    );
    token = login.access_token;
    deviceId = login.device_id;
  }
  if (!token) throw new AppError('Matrix-Anmeldung fehlgeschlagen', 401, 'MATRIX_LOGIN_FAILED');
  const who = await request<{ user_id: string; device_id?: string }>(
    { homeserver, token },
    '/_matrix/client/v3/account/whoami'
  );
  const identity = {
    homeserver,
    userId: who.user_id,
    deviceId: who.device_id || deviceId,
    epoch: randomUUID(),
  };
  const encrypted = safeEncrypt(token);
  if (!encrypted)
    throw new AppError(
      'Zugang konnte nicht verschlüsselt werden',
      500,
      'CREDENTIAL_STORAGE_FAILED'
    );
  await transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const previous = await tx.get(
      "SELECT public_json FROM assistant_credentials WHERE user_id=? AND service='matrix'",
      userId
    );
    if (previous && JSON.parse(previous.public_json).userId !== identity.userId) {
      await tx.run('DELETE FROM assistant_matrix_sync WHERE user_id=?', userId);
      await tx.run(
        'UPDATE assistant_matrix_rooms SET history_cursor=NULL,history_complete=0 WHERE user_id=?',
        userId
      );
    }
    await tx.run(
      `INSERT INTO assistant_credentials (user_id, service, public_json, secret_encrypted, updated_at) VALUES (?, 'matrix', ?, ?, ?)
    ON CONFLICT(user_id, service) DO UPDATE SET public_json = excluded.public_json, secret_encrypted = excluded.secret_encrypted, updated_at = excluded.updated_at`,
      userId,
      JSON.stringify(identity),
      encrypted,
      new Date().toISOString()
    );
  });
  return { connected: true, ...identity };
}
export async function disconnectMatrix(userId: string): Promise<void> {
  syncRequests.delete(userId);
  // Do not log out a supplied existing Matrix token: it may belong to another active client.
  await transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    await tx.run("DELETE FROM assistant_credentials WHERE user_id=? AND service='matrix'", userId);
  });
}
export async function matrixRooms(userId: string) {
  const c = await connectionFor(userId);
  const joined = await request<{ joined_rooms: string[] }>(c, '/_matrix/client/v3/joined_rooms');
  const results: Array<{
    id: string;
    name: string;
    alias: string | null;
    encrypted: boolean;
    agents: AssistantAgent[];
    state: MatrixEvent[];
  }> = [];
  // Bound concurrency and inspect every joined room, not a hardcoded agent list.
  for (let offset = 0; offset < joined.joined_rooms.length; offset += 4) {
    const batch = await Promise.all(
      joined.joined_rooms.slice(offset, offset + 4).map(async (id) => {
        const state = await request<MatrixEvent[]>(
          c,
          `/_matrix/client/v3/rooms/${encodeURIComponent(id)}/state`
        );
        const alias =
          (state.find((e) => e.type === 'm.room.canonical_alias')?.content.alias as
            | string
            | undefined) ?? null;
        const name = String(
          state.find((e) => e.type === 'm.room.name')?.content.name ?? alias ?? id
        );
        const hub = `@schwarm:${c.userId.split(':').slice(1).join(':')}`;
        const agents = state
          .filter((e) => e.type === 'ch.zwaetschge.swarm.agent' && e.sender === hub && e.state_key)
          .map((e) => {
            const b = e.content;
            const nativeId = String(b.id ?? e.state_key);
            return {
              id: `matrix:${nativeId}`,
              nativeId,
              name: String(b.name ?? nativeId),
              source: 'matrix' as const,
              available: b.status === 'online' && b.stillgelegt !== true && (b.v ?? 1) === 1,
              state: String(b.status ?? 'unknown'),
              nativeRoomId: typeof b.room === 'string' ? b.room : id,
              mode: (['native', 'worker', 'notify'].includes(String(b.mode ?? 'native'))
                ? (b.mode ?? 'native')
                : 'unknown') as AssistantAgent['mode'],
              model: typeof b.model === 'string' ? b.model : undefined,
              trust: typeof b.trust === 'string' ? b.trust : undefined,
              retired: b.stillgelegt === true,
              schemaVersion: typeof b.v === 'number' ? b.v : 1,
              capabilities: Array.isArray(b.faehigkeiten ?? b.skills)
                ? ((b.faehigkeiten ?? b.skills) as unknown[]).filter(
                    (s: unknown): s is string => typeof s === 'string'
                  )
                : [],
            };
          });
        await updateFor(
          userId,
          c,
          `INSERT INTO assistant_matrix_rooms (user_id, room_id, native_user_id, state_json, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id,room_id) DO UPDATE SET native_user_id = excluded.native_user_id, state_json = excluded.state_json, updated_at = excluded.updated_at`,
          userId,
          id,
          c.userId,
          JSON.stringify(state),
          new Date().toISOString()
        );
        return {
          id,
          name,
          alias,
          encrypted: state.some((e) => e.type === 'm.room.encryption'),
          agents,
          state,
        };
      })
    );
    results.push(...batch);
  }
  return results;
}
async function requireJoined(c: MatrixConnection, roomId: string, encryptedContent = true) {
  const rooms = await request<{ joined_rooms: string[] }>(c, '/_matrix/client/v3/joined_rooms');
  if (!rooms.joined_rooms.includes(roomId))
    throw new AppError('Raum nicht zugänglich', 404, 'NOT_FOUND');
  if (!encryptedContent) return;
  const encryption = await request<Record<string, unknown>>(
    c,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption`
  ).catch((e) => {
    if (e instanceof AppError && e.statusCode === 404) return null;
    throw e;
  });
  if (encryption)
    throw new AppError('Dieser Raum benötigt einen E2EE-fähigen Client', 409, 'E2EE_REQUIRED');
}
export async function matrixInvitations(userId: string) {
  return invitationsFor(await connectionFor(userId));
}
async function invitationsFor(c: MatrixConnection) {
  const query = new URLSearchParams({
    timeout: '0',
    filter: JSON.stringify({
      presence: { types: [] },
      account_data: { types: [] },
      room: { timeline: { limit: 1 }, state: { types: [] } },
    }),
  });
  const result = await request<{
    rooms?: { invite?: Record<string, { invite_state?: { events?: MatrixEvent[] } }> };
  }>(c, `/_matrix/client/v3/sync?${query}`);
  return Object.entries(result.rooms?.invite ?? {}).map(([id, room]) => {
    const state = room.invite_state?.events ?? [];
    return {
      id,
      name: String(state.find((event) => event.type === 'm.room.name')?.content.name ?? id),
      invitedBy:
        state.find((event) => event.type === 'm.room.member' && event.state_key === c.userId)
          ?.sender ?? null,
    };
  });
}
export async function matrixMembers(userId: string, roomId: string) {
  const c = await connectionFor(userId);
  await requireJoined(c, roomId, false);
  const result = await request<{ chunk: MatrixEvent[] }>(
    c,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members`
  );
  return result.chunk
    .filter((event) => event.type === 'm.room.member')
    .map((event) => ({
      userId: event.state_key ?? '',
      name: String(event.content.displayname ?? event.state_key ?? ''),
      membership: String(event.content.membership ?? 'unknown'),
    }));
}
export async function matrixMembership(
  userId: string,
  roomId: string,
  input: { action: 'join' | 'leave' | 'invite'; nativeUserId: string; target?: string }
) {
  const c = await connectionFor(userId);
  if (c.userId !== input.nativeUserId)
    throw new AppError('Matrix-Konto wurde inzwischen gewechselt', 409, 'MATRIX_IDENTITY_CHANGED');
  if (input.action === 'join') {
    if (!(await invitationsFor(c)).some((room) => room.id === roomId)) {
      // A lost successful response may be retried; joining is a desired membership, not a new task.
      await requireJoined(c, roomId, false);
      return { roomId, action: input.action };
    }
  } else if (input.action === 'leave') {
    try {
      await requireJoined(c, roomId, false);
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode !== 404) throw error;
      if (!(await invitationsFor(c)).some((room) => room.id === roomId))
        return { roomId, action: input.action };
    }
  } else await requireJoined(c, roomId, false);
  await transaction((tx) => assertConnection(tx, userId, c));
  await request(
    c,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/${input.action}`,
    'POST',
    input.action === 'invite' ? { user_id: input.target } : {}
  );
  return { roomId, action: input.action };
}
export async function matrixMessages(
  userId: string,
  roomId: string,
  options: { from?: string; threadId?: string } = {}
) {
  const c = await connectionFor(userId);
  await requireJoined(c, roomId);
  const base = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}`;
  const query = new URLSearchParams({ limit: '50', dir: 'b' });
  if (options.from) query.set('from', options.from);
  const page = await request<{ chunk: MatrixEvent[]; end?: string; next_batch?: string }>(
    c,
    `${options.threadId ? `${base}/relations/${encodeURIComponent(options.threadId)}/m.thread` : `${base}/messages`}?${query}`
  );
  if (options.threadId && !options.from) {
    const root = await request<MatrixEvent>(
      c,
      `${base}/event/${encodeURIComponent(options.threadId)}`
    );
    page.chunk = [root, ...page.chunk.filter((event) => event.event_id !== root.event_id)];
  }
  await archiveMatrixEvents(userId, c.userId, roomId, page.chunk, c.epoch ?? '');
  return page;
}
export async function matrixEvent(userId: string, roomId: string, eventId: string) {
  const c = await connectionFor(userId);
  await requireJoined(c, roomId);
  return request<MatrixEvent>(
    c,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`
  );
}
export async function matrixSend(
  userId: string,
  roomId: string,
  commandId: string,
  type: string,
  content: Record<string, unknown>,
  expectedNativeUserId?: string,
  expectedIdentityEpoch?: string
) {
  const c = await connectionFor(userId);
  if (
    (expectedNativeUserId && c.userId !== expectedNativeUserId) ||
    (expectedIdentityEpoch !== undefined && (c.epoch ?? '') !== expectedIdentityEpoch)
  )
    throw new AppError(
      'Matrix-Konto passt nicht zu diesem Auftrag',
      409,
      'MATRIX_IDENTITY_CHANGED'
    );
  await requireJoined(c, roomId);
  const hash = createHash('sha256')
    .update(JSON.stringify([roomId, type, content]))
    .digest('hex');
  const previousReceipt = await transaction(async (tx) => {
    await assertConnection(tx, userId, c);
    const prior = await tx.get(
      'SELECT payload_hash,native_user_id,identity_epoch,status,result_json FROM assistant_matrix_commands WHERE user_id = ? AND command_id = ?',
      userId,
      commandId
    );
    if (
      prior &&
      (prior.payload_hash !== hash ||
        prior.native_user_id !== c.userId ||
        (prior.status !== 'accepted' && prior.identity_epoch !== (c.epoch ?? '')))
    )
      throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
    if (prior?.status === 'accepted' && prior.result_json)
      return JSON.parse(prior.result_json) as { event_id: string };
    await tx.run(
      "INSERT INTO assistant_matrix_commands (user_id, command_id, payload_hash, native_user_id,identity_epoch,status) VALUES (?, ?, ?, ?,?,'pending') ON CONFLICT(user_id,command_id) DO NOTHING",
      userId,
      commandId,
      hash,
      c.userId,
      c.epoch ?? ''
    );
  });
  if (previousReceipt) return previousReceipt;
  const result = await request<{ event_id: string }>(
    c,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(type)}/${encodeURIComponent(commandId)}`,
    'PUT',
    content
  );
  await updateFor(
    userId,
    c,
    "UPDATE assistant_matrix_commands SET status = 'accepted', result_json = ? WHERE user_id = ? AND command_id = ?",
    JSON.stringify(result),
    userId,
    commandId
  );
  return result;
}
export async function matrixRead(
  userId: string,
  roomId: string,
  eventId: string,
  threadId?: string
) {
  const c = await connectionFor(userId);
  await requireJoined(c, roomId);
  return request(
    c,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
    'POST',
    threadId ? { thread_id: threadId } : {}
  );
}
const ACCOUNT_TYPES = [
  'ch.zwaetschge.schwarm.einstellungen',
  'ch.zwaetschge.schwarm.allgemein',
  'ch.zwaetschge.schwarm.chats',
  'm.direct',
] as const;
export async function matrixAccountData(userId: string, captured?: MatrixConnection) {
  const c = captured ?? (await connectionFor(userId));
  return Object.fromEntries(
    await Promise.all(
      ACCOUNT_TYPES.map(async (type) => [
        type,
        await request(
          c,
          `/_matrix/client/v3/user/${encodeURIComponent(c.userId)}/account_data/${encodeURIComponent(type)}`
        ).catch((e) => {
          if (e instanceof AppError && e.statusCode === 404) return null;
          throw e;
        }),
      ])
    )
  );
}

export async function matrixSetAccountData(
  userId: string,
  type: string,
  content: Record<string, unknown>,
  captured?: MatrixConnection
) {
  if (!ACCOUNT_TYPES.some((allowed) => allowed === type))
    throw new AppError('Unbekannter Einstellungsbereich', 400, 'VALIDATION_ERROR');
  const c = captured ?? (await connectionFor(userId));
  const current = await connectionFor(userId);
  if (current.userId !== c.userId || current.epoch !== c.epoch)
    throw new AppError(
      'Matrix-Verbindung wurde inzwischen gewechselt',
      409,
      'MATRIX_IDENTITY_CHANGED'
    );
  return request(
    c,
    `/_matrix/client/v3/user/${encodeURIComponent(c.userId)}/account_data/${encodeURIComponent(type)}`,
    'PUT',
    content
  );
}

/** Bounded, resumable historical ingestion; never treats a latest timeline slice as a full import. */
export async function matrixImportHistory(userId: string, roomId: string, pages: number) {
  const c = await connectionFor(userId);
  await requireJoined(c, roomId);
  await updateFor(
    userId,
    c,
    `INSERT INTO assistant_matrix_rooms (user_id,room_id,native_user_id,updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id,room_id) DO NOTHING`,
    userId,
    roomId,
    c.userId,
    new Date().toISOString()
  );
  let cursor = (await get(
    'SELECT history_cursor, history_complete FROM assistant_matrix_rooms WHERE user_id = ? AND room_id = ?',
    userId,
    roomId
  )) as { history_cursor: string | null; history_complete: number };
  if (cursor.history_complete) return { roomId, complete: true, pages: 0 };
  let processed = 0;
  let complete = false;
  for (let i = 0; i < Math.max(1, Math.min(10, pages)); i++) {
    const query = new URLSearchParams({
      dir: 'b',
      limit: '50',
      ...(cursor.history_cursor ? { from: cursor.history_cursor } : {}),
    });
    const page = await request<{ chunk: MatrixEvent[]; end?: string }>(
      c,
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?${query}`
    );
    await archiveMatrixEvents(userId, c.userId, roomId, page.chunk, c.epoch ?? '');
    complete = !page.chunk.length || !page.end || page.end === cursor.history_cursor;
    const saved = await updateFor(
      userId,
      c,
      'UPDATE assistant_matrix_rooms SET history_cursor = ?, history_complete = ?, updated_at = ? WHERE user_id = ? AND room_id = ? AND history_cursor IS NOT DISTINCT FROM ?',
      page.end ?? cursor.history_cursor,
      complete ? 1 : 0,
      new Date().toISOString(),
      userId,
      roomId,
      cursor.history_cursor
    );
    if (!saved.changes) return { roomId, complete: false, pages: processed + 1, conflict: true };
    cursor = {
      history_cursor: page.end ?? cursor.history_cursor,
      history_complete: complete ? 1 : 0,
    };
    processed++;
    if (complete) break;
  }
  return { roomId, complete, pages: processed };
}

/** Reuse the real Brian DM. Creating a room never substitutes another model for Hermes. */
const brianRequests = new Map<string, Promise<{ roomId: string; agentId: string }>>();
export async function matrixBrianConversation(userId: string) {
  const pending = brianRequests.get(userId);
  if (pending) return pending;
  const request = openBrianConversation(userId);
  brianRequests.set(userId, request);
  try {
    return await request;
  } finally {
    if (brianRequests.get(userId) === request) brianRequests.delete(userId);
  }
}
async function openBrianConversation(userId: string): Promise<{ roomId: string; agentId: string }> {
  const c = await connectionFor(userId);
  const brian = `@brian:${c.userId.split(':').slice(1).join(':')}`;
  const data = await matrixAccountData(userId, c);
  const general = data['ch.zwaetschge.schwarm.allgemein'] as Record<string, unknown> | null;
  const direct = (data['m.direct'] ?? {}) as Record<string, unknown>;
  const candidates = new Set([
    ...(typeof general?.room_id === 'string' ? [general.room_id] : []),
    ...(Array.isArray(direct[brian])
      ? direct[brian].filter((id): id is string => typeof id === 'string')
      : []),
  ]);
  const joined = await request<{ joined_rooms: string[] }>(c, '/_matrix/client/v3/joined_rooms');
  for (const roomId of candidates) {
    if (!joined.joined_rooms.includes(roomId)) continue;
    const members = await request<{ joined: Record<string, unknown> }>(
      c,
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`
    );
    if (
      Object.keys(members.joined).length === 2 &&
      members.joined[brian] &&
      members.joined[c.userId]
    ) {
      await requireJoined(c, roomId);
      return { roomId, agentId: 'matrix:brian' };
    }
  }
  const created = await request<{ room_id: string }>(c, '/_matrix/client/v3/createRoom', 'POST', {
    preset: 'trusted_private_chat',
    is_direct: true,
    invite: [brian],
    name: 'Brian',
  });
  await matrixSetAccountData(
    userId,
    'ch.zwaetschge.schwarm.allgemein',
    {
      ...general,
      room_id: created.room_id,
    },
    c
  );
  await matrixSetAccountData(
    userId,
    'm.direct',
    {
      ...direct,
      [brian]: [
        ...new Set([...(Array.isArray(direct[brian]) ? direct[brian] : []), created.room_id]),
      ],
    },
    c
  );
  return { roomId: created.room_id, agentId: 'matrix:brian' };
}

const MEDIA_LIMIT = 25 * 1024 * 1024;
async function uploadFor(
  userId: string,
  c: MatrixConnection,
  roomId: string,
  data: Buffer,
  filename: string,
  mimeType: string
) {
  await requireJoined(c, roomId);
  if (!data.length || data.length > MEDIA_LIMIT)
    throw new AppError('Datei ist zu gross oder leer', 400, 'INVALID_MEDIA');
  await transaction((tx) => assertConnection(tx, userId, c));
  const query = new URLSearchParams({ filename });
  const response = await fetch(`${c.homeserver}/_matrix/media/v3/upload?${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': mimeType },
    body: new Uint8Array(data),
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
  }).catch(() => {
    throw new AppError('Datei konnte nicht hochgeladen werden', 503, 'MATRIX_UNAVAILABLE');
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError('Matrix-Upload fehlgeschlagen', 502, 'MATRIX_UPLOAD_FAILED');
  }
  const result = (await response.json()) as { content_uri?: string };
  if (!/^mxc:\/\/[^/]+\/[^/?#]+$/.test(result.content_uri ?? ''))
    throw new AppError('Ungültige Medienadresse', 502, 'MATRIX_RESPONSE_INVALID');
  await transaction((tx) => assertConnection(tx, userId, c));
  return { url: result.content_uri!, filename, mimeType, size: data.length };
}
export async function matrixUpload(
  userId: string,
  roomId: string,
  data: Buffer,
  filename: string,
  mimeType: string
) {
  return uploadFor(userId, await connectionFor(userId), roomId, data, filename, mimeType);
}
const pendingUploads = new Map<
  string,
  Promise<{ url: string; filename: string; mimeType: string; size: number }>
>();
/** Matrix upload has no transaction ID. A confirmed upload is reused before stable message delivery. */
export async function matrixUploadOnce(
  userId: string,
  roomId: string,
  commandId: string,
  data: Buffer,
  filename: string,
  mimeType: string,
  expectedNativeUserId: string,
  expectedIdentityEpoch?: string
) {
  const key = JSON.stringify([userId, commandId]);
  const c = await connectionFor(userId);
  if (
    c.userId !== expectedNativeUserId ||
    (expectedIdentityEpoch !== undefined && (c.epoch ?? '') !== expectedIdentityEpoch)
  )
    throw new AppError(
      'Matrix-Konto passt nicht zu diesem Auftrag',
      409,
      'MATRIX_IDENTITY_CHANGED'
    );
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        'upload',
        roomId,
        filename,
        mimeType,
        createHash('sha256').update(data).digest('hex'),
      ])
    )
    .digest('hex');
  const previous = await transaction(async (tx) => {
    await assertConnection(tx, userId, c);
    const row = await tx.get(
      'SELECT * FROM assistant_matrix_commands WHERE user_id=? AND command_id=?',
      userId,
      commandId
    );
    if (
      row &&
      (row.payload_hash !== hash ||
        row.native_user_id !== c.userId ||
        (row.status !== 'accepted' && row.identity_epoch !== (c.epoch ?? '')))
    )
      throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
    if (row?.status === 'accepted' && row.result_json)
      return JSON.parse(row.result_json) as Awaited<ReturnType<typeof uploadFor>>;
    await tx.run(
      "INSERT INTO assistant_matrix_commands(user_id,command_id,payload_hash,native_user_id,identity_epoch,status) VALUES(?,?,?,?,?,'pending') ON CONFLICT DO NOTHING",
      userId,
      commandId,
      hash,
      c.userId,
      c.epoch ?? ''
    );
    return null;
  });
  if (previous) return previous;
  const pending = pendingUploads.get(key);
  if (pending) return pending;
  if (pendingUploads.size >= 20)
    throw new AppError('Medienzustellung ist gerade ausgelastet', 429, 'MATRIX_MEDIA_BUSY');
  const upload = (async () => {
    const result = await uploadFor(userId, c, roomId, data, filename, mimeType);
    await updateFor(
      userId,
      c,
      "UPDATE assistant_matrix_commands SET status='accepted',result_json=? WHERE user_id=? AND command_id=?",
      JSON.stringify(result),
      userId,
      commandId
    );
    return result;
  })();
  pendingUploads.set(key, upload);
  try {
    return await upload;
  } finally {
    if (pendingUploads.get(key) === upload) pendingUploads.delete(key);
  }
}

/** Media must belong to an event the native Matrix account can actually read. */
export async function matrixDownload(userId: string, roomId: string, eventId: string) {
  const c = await connectionFor(userId);
  const event = await matrixEvent(userId, roomId, eventId);
  if (event.content.file)
    throw new AppError('Diese Datei benötigt native Entschlüsselung', 409, 'E2EE_REQUIRED');
  const uri = typeof event.content.url === 'string' ? event.content.url : '';
  const match = /^mxc:\/\/([^/?#]+)\/([^/?#]+)$/.exec(uri);
  if (!match) throw new AppError('Datei nicht gefunden', 404, 'NOT_FOUND');
  const response = await fetch(
    `${c.homeserver}/_matrix/client/v1/media/download/${encodeURIComponent(match[1]!)}/${encodeURIComponent(match[2]!)}`,
    {
      headers: { Authorization: `Bearer ${c.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    }
  ).catch(() => {
    throw new AppError('Datei ist nicht erreichbar', 503, 'MATRIX_UNAVAILABLE');
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError('Datei nicht zugänglich', 404, 'NOT_FOUND');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (response.body)
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MEDIA_LIMIT)
        throw new AppError('Datei übersteigt die Downloadgrenze', 413, 'MEDIA_TOO_LARGE');
      chunks.push(chunk);
    }
  const type = response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream';
  return {
    data: Buffer.concat(chunks),
    mimeType: /^(image\/(png|jpeg|webp|gif)|audio\/(mpeg|ogg|wav|webm)|video\/(mp4|webm))$/.test(
      type
    )
      ? type
      : 'application/octet-stream',
    filename: String(event.content.body ?? 'Datei')
      .replace(/[\r\n]/g, '')
      .slice(0, 200),
  };
}
