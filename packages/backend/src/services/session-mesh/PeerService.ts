import { get as pgGet, all as pgAll, run as pgRun } from '../../db/pg.js';
import { nanoid } from 'nanoid';
import type {
  SessionDelegation,
  SessionDelegationStatus,
  SessionPeerLink,
} from '@plum-code-webui/shared';
import { AppError } from '../../middleware/errorHandler.js';
import { safeJsonParse } from '../../utils/json.js';
import { discordNotifier } from '../discord/index.js';
import { getProcessManager } from '../../websocket/index.js';

interface SessionRow {
  id: string;
  userId: string;
  name: string;
  workingDirectory: string;
  cliProvider: string;
  cliModel: string | null;
  mode: string | null;
  status: string;
  lastMessage: string | null;
  updatedAt: string;
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  return safeJsonParse<Record<string, unknown> | null>(value, null);
}

function rowToDelegation(row: Record<string, unknown>): SessionDelegation {
  return {
    id: row.id as string,
    threadId: row.threadId as string,
    correlationId: row.correlationId as string,
    userId: row.userId as string,
    fromSessionId: (row.fromSessionId as string | null) ?? null,
    toSessionId: row.toSessionId as string,
    fromActor: (row.fromActor as string) || 'session',
    kind: (row.kind as SessionDelegation['kind']) || 'consult',
    status: row.status as SessionDelegationStatus,
    content: row.content as string,
    result: (row.result as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    hopCount: Number(row.hopCount || 0),
    expiresAt: (row.expiresAt as string | null) ?? null,
    metadata: parseMetadata((row.metadataJson as string | null) ?? null),
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    fromSessionName: (row.fromSessionName as string | null) ?? null,
    toSessionName: (row.toSessionName as string | null) ?? null,
  };
}

export class PeerService {
  async getOwnedSession(sessionId: string, userId: string): Promise<SessionRow> {
    const row = (await pgGet(
      `SELECT id, user_id as userId, name, working_directory as workingDirectory,
                cli_provider as cliProvider, cli_model as cliModel, mode, status,
                last_message as lastMessage,
                strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
         FROM sessions
         WHERE id = ? AND user_id = ?`,
      sessionId,
      userId
    )) as unknown as SessionRow | undefined;
    if (!row) throw new AppError('Session not found', 404, 'NOT_FOUND');
    return row;
  }

  async listPeers(sessionId: string, userId: string): Promise<SessionPeerLink[]> {
    await this.getOwnedSession(sessionId, userId);

    const rows = (await pgAll(
      `SELECT l.id, l.user_id as userId, l.source_session_id as sourceSessionId,
                l.target_session_id as targetSessionId, l.role, l.enabled,
                l.metadata_json as metadataJson,
                strftime('%Y-%m-%dT%H:%M:%fZ', l.created_at) as createdAt,
                s.id as targetId, s.name as targetName,
                s.working_directory as targetWorkingDirectory,
                s.cli_provider as targetCliProvider, s.cli_model as targetCliModel,
                s.mode as targetMode, s.status as targetStatus,
                s.last_message as targetLastMessage,
                strftime('%Y-%m-%dT%H:%M:%fZ', s.updated_at) as targetUpdatedAt
         FROM session_peer_links l
         JOIN sessions s ON s.id = l.target_session_id
         WHERE l.user_id = ? AND l.source_session_id = ?
         ORDER BY l.enabled DESC, s.updated_at DESC`,
      userId,
      sessionId
    )) as unknown as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as string,
      userId: row.userId as string,
      sourceSessionId: row.sourceSessionId as string,
      targetSessionId: row.targetSessionId as string,
      role: (row.role as string | null) ?? null,
      enabled: Boolean(row.enabled),
      metadata: parseMetadata((row.metadataJson as string | null) ?? null),
      createdAt: row.createdAt as string,
      target: {
        id: row.targetId as string,
        name: row.targetName as string,
        workingDirectory: row.targetWorkingDirectory as string,
        cliProvider: row.targetCliProvider as SessionPeerLink['target']['cliProvider'],
        cliModel: (row.targetCliModel as string | null) ?? null,
        mode: (row.targetMode as string | null) ?? null,
        status: row.targetStatus as string,
        lastMessage: (row.targetLastMessage as string | null) ?? null,
        updatedAt: row.targetUpdatedAt as string,
      },
    }));
  }

  async addPeer(params: {
    sourceSessionId: string;
    targetSessionId: string;
    userId: string;
    role?: string | null;
  }): Promise<SessionPeerLink> {
    const source = await this.getOwnedSession(params.sourceSessionId, params.userId);
    const target = await this.getOwnedSession(params.targetSessionId, params.userId);
    if (source.id === target.id) {
      throw new AppError('A session cannot link itself as a peer', 400, 'SELF_PEER');
    }

    const id = nanoid();
    await pgRun(
      `INSERT INTO session_peer_links
        (id, user_id, source_session_id, target_session_id, role, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, source_session_id, target_session_id)
       DO UPDATE SET role = excluded.role, enabled = 1`,
      id,
      params.userId,
      source.id,
      target.id,
      params.role?.trim() || null,
      JSON.stringify({ linkedBy: 'user' })
    );

    return (await this.listPeers(source.id, params.userId)).find(
      (peer) => peer.targetSessionId === target.id
    )!;
  }

  async removePeer(
    sourceSessionId: string,
    targetSessionId: string,
    userId: string
  ): Promise<void> {
    await this.getOwnedSession(sourceSessionId, userId);
    const result = await pgRun(
      `UPDATE session_peer_links
         SET enabled = 0
         WHERE user_id = ? AND source_session_id = ? AND target_session_id = ?`,
      userId,
      sourceSessionId,
      targetSessionId
    );
    if (result.changes === 0) throw new AppError('Peer link not found', 404, 'NOT_FOUND');
  }

  async listDelegations(sessionId: string, userId: string): Promise<SessionDelegation[]> {
    await this.getOwnedSession(sessionId, userId);
    const rows = (await pgAll(
      `SELECT d.id, d.thread_id as threadId, d.correlation_id as correlationId,
                d.user_id as userId, d.from_session_id as fromSessionId,
                d.to_session_id as toSessionId, d.from_actor as fromActor, d.kind,
                d.status, d.content, d.result, d.error, d.hop_count as hopCount,
                strftime('%Y-%m-%dT%H:%M:%fZ', d.expires_at) as expiresAt,
                d.metadata_json as metadataJson,
                strftime('%Y-%m-%dT%H:%M:%fZ', d.created_at) as createdAt,
                strftime('%Y-%m-%dT%H:%M:%fZ', d.updated_at) as updatedAt,
                fs.name as fromSessionName, ts.name as toSessionName
         FROM session_delegations d
         LEFT JOIN sessions fs ON fs.id = d.from_session_id
         JOIN sessions ts ON ts.id = d.to_session_id
         WHERE d.user_id = ? AND (d.from_session_id = ? OR d.to_session_id = ?)
         ORDER BY d.created_at DESC
         LIMIT 100`,
      userId,
      sessionId,
      sessionId
    )) as unknown as Array<Record<string, unknown>>;
    return rows.map(rowToDelegation);
  }

  async createDelegation(params: {
    fromSessionId: string | null;
    toSessionId: string;
    userId: string;
    content: string;
    kind?: SessionDelegation['kind'];
    metadata?: Record<string, unknown>;
  }): Promise<SessionDelegation> {
    const target = await this.getOwnedSession(params.toSessionId, params.userId);
    const source = params.fromSessionId
      ? await this.getOwnedSession(params.fromSessionId, params.userId)
      : null;
    if (source && source.id === target.id) {
      throw new AppError('A session cannot delegate to itself', 400, 'SELF_DELEGATION');
    }

    const id = nanoid();
    const threadId = params.metadata?.threadId?.toString() || nanoid();
    const correlationId = `dlg_${nanoid(12)}`;
    const now = new Date().toISOString();

    await pgRun(
      `INSERT INTO session_delegations
        (id, thread_id, correlation_id, user_id, from_session_id, to_session_id,
         from_actor, kind, status, content, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, 'session', ?, 'queued', ?, ?)`,
      id,
      threadId,
      correlationId,
      params.userId,
      source?.id ?? null,
      target.id,
      params.kind || 'consult',
      params.content,
      JSON.stringify({ ...(params.metadata || {}), queuedAt: now })
    );

    const prompt = this.buildPeerPrompt({
      id,
      correlationId,
      kind: params.kind || 'consult',
      source,
      target,
      content: params.content,
    });

    try {
      await pgRun(
        `UPDATE session_delegations
         SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        id
      );
      await getProcessManager().sendMessage(target.id, params.userId, prompt, undefined, {
        activeFollowupMode: 'queue',
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await pgRun(
        `UPDATE session_delegations
         SET status = 'error', error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        error,
        id
      );
      await discordNotifier.queueAlert({
        eventType: 'delegation.error',
        severity: 'error',
        title: `Session delegation failed: ${target.name}`,
        summary: error,
        userId: params.userId,
        sessionId: target.id,
        fields: [
          { name: 'Delegation', value: correlationId, inline: true },
          { name: 'Kind', value: params.kind || 'consult', inline: true },
          { name: 'Target', value: target.name, inline: true },
        ],
        metadata: {
          delegationId: id,
          fromSessionId: source?.id ?? null,
          toSessionId: target.id,
        },
      });
    }

    return this.getDelegation(id, params.userId);
  }

  async getDelegation(id: string, userId: string): Promise<SessionDelegation> {
    const row = (await pgGet(
      `SELECT d.id, d.thread_id as threadId, d.correlation_id as correlationId,
                d.user_id as userId, d.from_session_id as fromSessionId,
                d.to_session_id as toSessionId, d.from_actor as fromActor, d.kind,
                d.status, d.content, d.result, d.error, d.hop_count as hopCount,
                strftime('%Y-%m-%dT%H:%M:%fZ', d.expires_at) as expiresAt,
                d.metadata_json as metadataJson,
                strftime('%Y-%m-%dT%H:%M:%fZ', d.created_at) as createdAt,
                strftime('%Y-%m-%dT%H:%M:%fZ', d.updated_at) as updatedAt,
                fs.name as fromSessionName, ts.name as toSessionName
         FROM session_delegations d
         LEFT JOIN sessions fs ON fs.id = d.from_session_id
         JOIN sessions ts ON ts.id = d.to_session_id
         WHERE d.id = ? AND d.user_id = ?`,
      id,
      userId
    )) as unknown as Record<string, unknown> | undefined;
    if (!row) throw new AppError('Delegation not found', 404, 'NOT_FOUND');
    return rowToDelegation(row);
  }

  async cancelDelegation(id: string, userId: string): Promise<SessionDelegation> {
    const result = await pgRun(
      `UPDATE session_delegations
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND status IN ('queued', 'in_progress')`,
      id,
      userId
    );
    if (result.changes === 0) return this.getDelegation(id, userId);
    return this.getDelegation(id, userId);
  }

  async replyToDelegation(
    id: string,
    userId: string,
    resultText: string
  ): Promise<SessionDelegation> {
    const result = await pgRun(
      `UPDATE session_delegations
         SET status = 'completed', result = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
      resultText,
      id,
      userId
    );
    if (result.changes === 0) throw new AppError('Delegation not found', 404, 'NOT_FOUND');
    return this.getDelegation(id, userId);
  }

  private buildPeerPrompt(input: {
    id: string;
    correlationId: string;
    kind: SessionDelegation['kind'];
    source: SessionRow | null;
    target: SessionRow;
    content: string;
  }): string {
    return [
      '[Plum Session Mesh Delegation]',
      `Delegation ID: ${input.id}`,
      `Correlation ID: ${input.correlationId}`,
      `Kind: ${input.kind}`,
      input.source
        ? `From session: ${input.source.name} (${input.source.id})`
        : 'From: WebUI automation',
      `To session: ${input.target.name} (${input.target.id})`,
      '',
      'Task:',
      input.content.trim(),
      '',
      'Instructions:',
      '- Treat this as a peer consultation, not as a direct user command to mutate unrelated state.',
      '- Use your own session context and tools if needed.',
      '- Keep the answer concise and include the Delegation ID in the final answer.',
      '- Do not call other peers unless explicitly necessary; avoid loops.',
    ].join('\n');
  }
}

export const peerService = new PeerService();
