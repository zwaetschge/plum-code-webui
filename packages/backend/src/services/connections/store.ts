import { nanoid } from 'nanoid';
import {
  all as pgAll,
  get as pgGet,
  run as pgRun,
  transaction as pgTransaction,
} from '../../db/pg.js';
import { safeDecrypt, safeEncrypt } from '../../utils/encryption.js';
import type { SshConnectionConfig, SshKeySource } from './sshConfig.js';

/**
 * Persistence for Verbindungen. Rows are always read and written with the
 * owner's id in the WHERE clause; `secret_enc` is decrypted only for
 * materializing a key file and is never part of a response.
 */

export interface ConnectionRow {
  id: string;
  user_id: string;
  kind: string;
  name: string;
  config_json: string;
  secret_enc: string | null;
  created_at: string;
  updated_at: string;
}

export interface SshConnectionDto extends SshConnectionConfig {
  id: string;
  kind: 'ssh';
  name: string;
  keyConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS = 'id, user_id, kind, name, config_json, secret_enc, created_at, updated_at';

export function parseSshConfig(row: Pick<ConnectionRow, 'config_json'>): SshConnectionConfig {
  let raw: Partial<SshConnectionConfig> = {};
  try {
    raw = JSON.parse(row.config_json || '{}') as Partial<SshConnectionConfig>;
  } catch {
    raw = {};
  }
  return {
    alias: String(raw.alias ?? ''),
    host: String(raw.host ?? ''),
    port: Number(raw.port) || 22,
    user: String(raw.user ?? ''),
    jumpHost: raw.jumpHost ? String(raw.jumpHost) : null,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    keySource: (raw.keySource === 'upload' ? 'upload' : 'file') as SshKeySource,
    keyFile: raw.keyFile ? String(raw.keyFile) : null,
  };
}

export function toSshDto(row: ConnectionRow): SshConnectionDto {
  const config = parseSshConfig(row);
  return {
    id: row.id,
    kind: 'ssh',
    name: row.name,
    ...config,
    keyConfigured: config.keySource === 'upload' ? !!row.secret_enc : !!config.keyFile,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listConnectionRows(userId: string): Promise<ConnectionRow[]> {
  return (await pgAll(
    `SELECT ${COLUMNS} FROM connections WHERE user_id = ? AND kind = 'ssh' ORDER BY name, created_at`,
    userId
  )) as ConnectionRow[];
}

export async function getConnectionRow(
  userId: string,
  id: string
): Promise<ConnectionRow | undefined> {
  return (await pgGet(
    `SELECT ${COLUMNS} FROM connections WHERE id = ? AND user_id = ?`,
    id,
    userId
  )) as ConnectionRow | undefined;
}

export async function aliasTaken(
  userId: string,
  alias: string,
  exceptId?: string
): Promise<boolean> {
  const rows = await listConnectionRows(userId);
  return rows.some((row) => row.id !== exceptId && parseSshConfig(row).alias === alias);
}

export async function insertConnection(
  userId: string,
  name: string,
  config: SshConnectionConfig,
  privateKey: string | null
): Promise<ConnectionRow> {
  const id = nanoid();
  await pgRun(
    `INSERT INTO connections (id, user_id, kind, name, config_json, secret_enc)
     VALUES (?, ?, 'ssh', ?, ?, ?)`,
    id,
    userId,
    name,
    JSON.stringify(config),
    privateKey ? safeEncrypt(privateKey) : null
  );
  return (await getConnectionRow(userId, id))!;
}

export async function updateConnection(
  userId: string,
  id: string,
  name: string,
  config: SshConnectionConfig,
  secret: { kind: 'keep' } | { kind: 'clear' } | { kind: 'set'; value: string }
): Promise<ConnectionRow | undefined> {
  const secretSql =
    secret.kind === 'keep'
      ? ''
      : secret.kind === 'clear'
        ? ', secret_enc = NULL'
        : ', secret_enc = ?';
  const params: unknown[] = [name, JSON.stringify(config)];
  if (secret.kind === 'set') params.push(safeEncrypt(secret.value));
  params.push(id, userId);
  await pgRun(
    `UPDATE connections SET name = ?, config_json = ?${secretSql},
       updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
     WHERE id = ? AND user_id = ?`,
    ...params
  );
  return getConnectionRow(userId, id);
}

export async function deleteConnection(userId: string, id: string): Promise<boolean> {
  const result = await pgRun('DELETE FROM connections WHERE id = ? AND user_id = ?', id, userId);
  return result.changes > 0;
}

/** Decrypted uploaded key, for materializing a 0600 file only. */
export function decryptPrivateKey(row: ConnectionRow): string | null {
  return row.secret_enc ? safeDecrypt(row.secret_enc) : null;
}

export async function userOwnsSession(sessionId: string, userId: string): Promise<boolean> {
  return !!(await pgGet(
    'SELECT 1 AS ok FROM sessions WHERE id = ? AND user_id = ?',
    sessionId,
    userId
  ));
}

export async function listSessionConnectionRows(
  sessionId: string,
  userId: string
): Promise<ConnectionRow[]> {
  try {
    return (await pgAll(
      `SELECT c.id, c.user_id, c.kind, c.name, c.config_json, c.secret_enc, c.created_at, c.updated_at
         FROM session_connections sc
         JOIN connections c ON c.id = sc.connection_id
         JOIN sessions s ON s.id = sc.session_id
        WHERE sc.session_id = ? AND c.user_id = ? AND s.user_id = ?
        ORDER BY c.name, c.created_at`,
      sessionId,
      userId,
      userId
    )) as ConnectionRow[];
  } catch {
    // Test schemas and first boot before migration 015 have no such table.
    return [];
  }
}

/** Replaces the attached set; ids not owned by the user are ignored. */
export async function setSessionConnections(
  sessionId: string,
  userId: string,
  connectionIds: string[]
): Promise<void> {
  const owned = new Set((await listConnectionRows(userId)).map((row) => row.id));
  const wanted = [...new Set(connectionIds)].filter((id) => owned.has(id));
  await pgTransaction(async (tx) => {
    await tx.run(
      `DELETE FROM session_connections
        WHERE session_id = ? AND connection_id IN (SELECT id FROM connections WHERE user_id = ?)`,
      sessionId,
      userId
    );
    for (const id of wanted) {
      await tx.run(
        'INSERT INTO session_connections (session_id, connection_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
        sessionId,
        id
      );
    }
  });
}

export async function sessionsUsingConnection(connectionId: string): Promise<string[]> {
  const rows = (await pgAll(
    'SELECT session_id FROM session_connections WHERE connection_id = ?',
    connectionId
  )) as Array<{ session_id: string }>;
  return rows.map((row) => row.session_id);
}
