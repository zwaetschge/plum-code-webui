/**
 * What a Claude Code session's subagents spent, read from their transcripts.
 *
 * Claude Code reports the main thread only: the `usage` of a result message
 * leaves out every agent the turn started, and the agents' own messages do
 * not reach the stream. Their tokens therefore never arrived in the analytics.
 * Each agent does keep a transcript of its own, next to the session's:
 *
 *   <config home>/projects/<project>/<session id>/subagents/agent-<id>.jsonl
 *   <config home>/projects/<project>/<session id>/subagents/agent-<id>.meta.json
 *
 * with one record per content block of every model call, each carrying that
 * call's usage. This module adds them up; booking is done by the caller.
 */

import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import { StringDecoder } from 'string_decoder';

import { claudeProjectSlug } from '../../utils/projectMemory.js';

export interface TokenCounters {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export const NO_TOKENS: Readonly<TokenCounters> = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
});

export function totalTokens(counters: TokenCounters): number {
  return (
    counters.inputTokens +
    counters.outputTokens +
    counters.cacheReadTokens +
    counters.cacheCreationTokens
  );
}

export function addTokens(left: TokenCounters, right: TokenCounters): TokenCounters {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
  };
}

/** What is left of `current` once `booked` is taken off, never below zero. */
export function tokensBeyond(current: TokenCounters, booked: TokenCounters): TokenCounters {
  return {
    inputTokens: Math.max(0, current.inputTokens - booked.inputTokens),
    outputTokens: Math.max(0, current.outputTokens - booked.outputTokens),
    cacheReadTokens: Math.max(0, current.cacheReadTokens - booked.cacheReadTokens),
    cacheCreationTokens: Math.max(0, current.cacheCreationTokens - booked.cacheCreationTokens),
  };
}

export interface AgentTranscriptUsage {
  /** Tokens per model, in case an agent changed model mid-run. */
  byModel: Map<string, TokenCounters>;
  /** Model calls counted. */
  calls: number;
  /** ISO time of the newest model call. */
  lastCallAt: string | null;
}

export interface ClaudeAgentUsage {
  agentId: string;
  agentType: string | null;
  description: string | null;
  /** The model that took most of the tokens counted. */
  model: string | null;
  usage: TokenCounters;
  calls: number;
  lastCallAt: string | null;
}

interface CallUsage extends TokenCounters {
  model: string;
  at: string;
}

/**
 * Collects the model calls of one transcript.
 *
 * A call appears once per content block, each time with the same message id.
 * The counters of those records agree except for the output, which an early
 * record may still show mid-stream — so a call counts once, at its largest.
 */
export function createAgentTranscriptReader(): {
  line(text: string): void;
  result(): AgentTranscriptUsage;
} {
  const calls = new Map<string, CallUsage>();
  return {
    line(text) {
      // Tool results and prompts are most of a transcript; none mention usage.
      if (!text.includes('"usage"')) return;
      let record: {
        type?: unknown;
        timestamp?: unknown;
        message?: { id?: unknown; model?: unknown; usage?: Record<string, unknown> };
      };
      try {
        record = JSON.parse(text);
      } catch {
        return; // the line still being written
      }
      const message = record?.message;
      if (record?.type !== 'assistant' || !message?.usage || typeof message.id !== 'string') return;
      const count = (key: string) => {
        const value = Number(message.usage?.[key]);
        return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
      };
      const seen = calls.get(message.id);
      const at = typeof record.timestamp === 'string' ? record.timestamp : '';
      calls.set(message.id, {
        model: typeof message.model === 'string' && message.model ? message.model : 'unknown',
        at: seen && seen.at > at ? seen.at : at,
        inputTokens: Math.max(seen?.inputTokens ?? 0, count('input_tokens')),
        outputTokens: Math.max(seen?.outputTokens ?? 0, count('output_tokens')),
        cacheReadTokens: Math.max(seen?.cacheReadTokens ?? 0, count('cache_read_input_tokens')),
        cacheCreationTokens: Math.max(
          seen?.cacheCreationTokens ?? 0,
          count('cache_creation_input_tokens')
        ),
      });
    },
    result() {
      const byModel = new Map<string, TokenCounters>();
      let lastCallAt: string | null = null;
      let counted = 0;
      for (const call of calls.values()) {
        if (totalTokens(call) === 0) continue; // synthetic messages
        counted += 1;
        byModel.set(call.model, addTokens(byModel.get(call.model) ?? NO_TOKENS, call));
        if (call.at && (!lastCallAt || call.at > lastCallAt)) lastCallAt = call.at;
      }
      return { byModel, calls: counted, lastCallAt };
    },
  };
}

/** Parsed transcripts by path; a file is read again only once it has changed. */
const transcriptCache = new Map<
  string,
  { size: number; mtimeMs: number; usage: AgentTranscriptUsage }
>();
const TRANSCRIPT_CACHE_LIMIT = 4000;

export async function readAgentTranscript(file: string): Promise<AgentTranscriptUsage> {
  const stat = await fs.stat(file);
  const cached = transcriptCache.get(file);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.usage;

  const reader = createAgentTranscriptReader();
  // Split on LF by hand: readline also breaks on the Unicode line separators
  // that a JSON string may contain unescaped.
  const decoder = new StringDecoder('utf8');
  let pending = '';
  for await (const chunk of createReadStream(file)) {
    pending += decoder.write(chunk as Buffer);
    let start = 0;
    for (;;) {
      const end = pending.indexOf('\n', start);
      if (end < 0) break;
      reader.line(pending.slice(start, end));
      start = end + 1;
    }
    pending = pending.slice(start);
  }
  pending += decoder.end();
  if (pending) reader.line(pending);

  const usage = reader.result();
  if (transcriptCache.size >= TRANSCRIPT_CACHE_LIMIT) {
    const oldest = transcriptCache.keys().next().value;
    if (oldest !== undefined) transcriptCache.delete(oldest);
  }
  transcriptCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, usage });
  return usage;
}

const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The directory holding a session's agent transcripts, or null if it has none.
 *
 * The project directory is named after the working directory the CLI saw,
 * which is not always the one Plum stored (a symlinked share resolves to its
 * target). The stored one is tried first; failing that, the session id — which
 * is unique — is looked up across all projects.
 */
export async function findClaudeSubagentDir(
  configHome: string,
  claudeSessionId: string,
  workingDirectory?: string | null
): Promise<string | null> {
  if (!SAFE_SESSION_ID.test(claudeSessionId)) return null;
  const projects = path.join(configHome, 'projects');
  if (workingDirectory) {
    const direct = path.join(
      projects,
      claudeProjectSlug(workingDirectory),
      claudeSessionId,
      'subagents'
    );
    if (await isDirectory(direct)) return direct;
  }
  let names: string[];
  try {
    names = await fs.readdir(projects);
  } catch {
    return null;
  }
  for (const name of names) {
    const candidate = path.join(projects, name, claudeSessionId, 'subagents');
    if (await isDirectory(candidate)) return candidate;
  }
  return null;
}

/**
 * Every session that has agent transcripts, by session id. For a pass over
 * many sessions: one listing instead of a search per session.
 */
export async function indexClaudeSubagentDirs(configHome: string): Promise<Map<string, string>> {
  const projects = path.join(configHome, 'projects');
  const index = new Map<string, string>();
  let names: string[];
  try {
    names = await fs.readdir(projects);
  } catch {
    return index;
  }
  for (const name of names) {
    let sessions: string[];
    try {
      sessions = await fs.readdir(path.join(projects, name));
    } catch {
      continue; // a file, or gone
    }
    for (const session of sessions) {
      if (session.endsWith('.jsonl') || !SAFE_SESSION_ID.test(session)) continue;
      const candidate = path.join(projects, name, session, 'subagents');
      if (await isDirectory(candidate)) index.set(session, candidate);
    }
  }
  return index;
}

async function readAgentMeta(
  file: string
): Promise<{ agentType: string | null; description: string | null }> {
  try {
    const meta = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
    return {
      agentType: typeof meta.agentType === 'string' && meta.agentType ? meta.agentType : null,
      description:
        typeof meta.description === 'string' && meta.description ? meta.description : null,
    };
  } catch {
    return { agentType: null, description: null };
  }
}

/**
 * Tokens of every agent of one Claude Code session.
 *
 * `countsModel` leaves out calls that are booked elsewhere: in a session that
 * runs through the model router, an agent on a routed model has its usage
 * written by the router the moment each response completes.
 */
export async function readClaudeSubagentUsage(
  configHome: string,
  claudeSessionId: string,
  options: {
    workingDirectory?: string | null;
    countsModel?: (model: string) => boolean;
    /** Known location, from {@link indexClaudeSubagentDirs}; skips the search. */
    directory?: string;
    /**
     * Leave out agents whose transcript has not changed since (ms since epoch).
     * The transcripts of a long-lived session run to hundreds of megabytes;
     * an agent that finished before the last booking has nothing new in it.
     */
    modifiedSince?: number;
  } = {}
): Promise<ClaudeAgentUsage[]> {
  const directory =
    options.directory ??
    (await findClaudeSubagentDir(configHome, claudeSessionId, options.workingDirectory));
  if (!directory) return [];
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return [];
  }

  const agents: ClaudeAgentUsage[] = [];
  for (const name of names) {
    const agentId = /^agent-([A-Za-z0-9_-]+)\.jsonl$/.exec(name)?.[1];
    if (!agentId) continue;
    let transcript: AgentTranscriptUsage;
    try {
      const file = path.join(directory, name);
      if (options.modifiedSince && (await fs.stat(file)).mtimeMs < options.modifiedSince) continue;
      transcript = await readAgentTranscript(file);
    } catch {
      continue; // removed between the listing and the read
    }
    let usage: TokenCounters = NO_TOKENS;
    let model: string | null = null;
    let most = 0;
    for (const [callModel, counters] of transcript.byModel) {
      if (options.countsModel && !options.countsModel(callModel)) continue;
      usage = addTokens(usage, counters);
      if (totalTokens(counters) > most) {
        most = totalTokens(counters);
        model = callModel;
      }
    }
    if (totalTokens(usage) === 0) continue;
    const meta = await readAgentMeta(path.join(directory, `agent-${agentId}.meta.json`));
    agents.push({
      agentId,
      agentType: meta.agentType,
      description: meta.description,
      model,
      usage,
      calls: transcript.calls,
      lastCallAt: transcript.lastCallAt,
    });
  }
  return agents;
}
