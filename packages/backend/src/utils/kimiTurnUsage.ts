import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

export interface KimiTurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  models: Record<string, number>;
  firstRecordedAt: number | null;
  lastRecordedAt: number | null;
}

export interface KimiUsageCursor {
  kimiHome: string;
  nativeSessionId: string;
  offsets: Map<string, number>;
}

export interface KimiUsageRecord {
  model: string | null;
  recordedAt: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface KimiRootPrompt {
  recordedAt: number;
  text: string;
}

function emptyUsage(): KimiTurnUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    models: {},
    firstRecordedAt: null,
    lastRecordedAt: null,
  };
}

function finiteTokenCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function safeDirectoryEntries(directory: string): fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function resolveKimiNativeSessionDirectory(
  kimiHome: string,
  nativeSessionId: string
): string | null {
  if (!nativeSessionId || nativeSessionId.includes('/') || nativeSessionId.includes('\\')) {
    return null;
  }
  const sessionsRoot = path.join(kimiHome, 'sessions');
  for (const workspace of safeDirectoryEntries(sessionsRoot)) {
    if (!workspace.isDirectory()) continue;
    const candidate = path.join(sessionsRoot, workspace.name, nativeSessionId);
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Continue through the bounded one-directory workspace index.
    }
  }
  return null;
}

function listKimiWireFiles(kimiHome: string, nativeSessionId: string): string[] {
  const sessionDirectory = resolveKimiNativeSessionDirectory(kimiHome, nativeSessionId);
  if (!sessionDirectory) return [];

  const files: string[] = [];
  const legacyWire = path.join(sessionDirectory, 'wire.jsonl');
  if (fs.existsSync(legacyWire)) files.push(legacyWire);

  const agentsDirectory = path.join(sessionDirectory, 'agents');
  for (const agent of safeDirectoryEntries(agentsDirectory)) {
    if (!agent.isDirectory()) continue;
    const wire = path.join(agentsDirectory, agent.name, 'wire.jsonl');
    if (fs.existsSync(wire)) files.push(wire);
  }
  return files.sort();
}

function parseUsageRecords(content: string): KimiUsageRecord[] {
  const records: KimiUsageRecord[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        type?: unknown;
        usageScope?: unknown;
        model?: unknown;
        time?: unknown;
        usage?: Record<string, unknown>;
      };
      // Kimi also writes the same counters inside context.append_loop_event.
      // usage.record is the canonical single copy, so accepting both would
      // silently double every model call.
      if (event.type !== 'usage.record' || event.usageScope !== 'turn' || !event.usage) continue;
      const recordedAt = Number(event.time);
      if (!Number.isFinite(recordedAt) || recordedAt <= 0) continue;
      const usage = event.usage;
      const record: KimiUsageRecord = {
        model: typeof event.model === 'string' && event.model.trim() ? event.model.trim() : null,
        recordedAt,
        inputTokens: finiteTokenCount(
          usage.inputOther ?? usage.input_tokens ?? usage.inputTokens ?? usage.input
        ),
        outputTokens: finiteTokenCount(usage.output ?? usage.output_tokens ?? usage.outputTokens),
        cacheReadTokens: finiteTokenCount(
          usage.inputCacheRead ?? usage.cache_read_input_tokens ?? usage.cachedReadTokens
        ),
        cacheCreationTokens: finiteTokenCount(
          usage.inputCacheCreation ?? usage.cache_creation_input_tokens ?? usage.cachedWriteTokens
        ),
      };
      if (
        record.inputTokens +
          record.outputTokens +
          record.cacheReadTokens +
          record.cacheCreationTokens >
        0
      ) {
        records.push(record);
      }
    } catch {
      // A process can be appending the final JSONL line while it is sampled.
      // The next completed-turn read will see the finished record.
    }
  }
  return records;
}

function readFileSuffix(filePath: string, offset: number): string {
  let descriptor: number | null = null;
  try {
    const size = fs.statSync(filePath).size;
    const start = offset >= 0 && offset <= size ? offset : 0;
    if (size <= start) return '';
    descriptor = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(size - start);
    fs.readSync(descriptor, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } catch {
    return '';
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function summarizeKimiUsage(records: KimiUsageRecord[]): KimiTurnUsage {
  const result = emptyUsage();
  for (const record of records) {
    result.inputTokens += record.inputTokens;
    result.outputTokens += record.outputTokens;
    result.cacheReadTokens += record.cacheReadTokens;
    result.cacheCreationTokens += record.cacheCreationTokens;
    result.firstRecordedAt =
      result.firstRecordedAt === null
        ? record.recordedAt
        : Math.min(result.firstRecordedAt, record.recordedAt);
    result.lastRecordedAt =
      result.lastRecordedAt === null
        ? record.recordedAt
        : Math.max(result.lastRecordedAt, record.recordedAt);
    if (record.model) {
      const total =
        record.inputTokens +
        record.outputTokens +
        record.cacheReadTokens +
        record.cacheCreationTokens;
      result.models[record.model] = (result.models[record.model] || 0) + total;
    }
  }
  result.totalTokens =
    result.inputTokens + result.outputTokens + result.cacheReadTokens + result.cacheCreationTokens;
  return result;
}

async function safeDirectoryEntriesAsync(directory: string): Promise<Array<fs.Dirent>> {
  try {
    return await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function resolveKimiNativeSessionDirectoryAsync(
  kimiHome: string,
  nativeSessionId: string
): Promise<string | null> {
  if (!nativeSessionId || nativeSessionId.includes('/') || nativeSessionId.includes('\\')) {
    return null;
  }
  const sessionsRoot = path.join(kimiHome, 'sessions');
  for (const workspace of await safeDirectoryEntriesAsync(sessionsRoot)) {
    if (!workspace.isDirectory()) continue;
    const candidate = path.join(sessionsRoot, workspace.name, nativeSessionId);
    try {
      if ((await fsp.stat(candidate)).isDirectory()) return candidate;
    } catch {
      // Continue through the bounded one-directory workspace index.
    }
  }
  return null;
}

/**
 * Cheap change detector for one session's native ledgers.
 *
 * The expensive half of the usage backfill is reading and parsing every
 * `wire.jsonl` a session owns — files that grow to megabytes on a long session.
 * They are append-only, so "same set of files, same sizes" means "nothing has
 * been written since the last look": one `stat` per file instead of a full
 * parse. Returns an empty string when the session has no ledger on disk at all.
 *
 * Async on purpose. This runs once per Kimi session near boot, where the
 * synchronous helpers below — which each serve a single live turn — would add
 * up to a real stall on the event loop.
 */
export async function readKimiLedgerSignature(
  kimiHome: string,
  nativeSessionId: string
): Promise<string> {
  const sessionDirectory = await resolveKimiNativeSessionDirectoryAsync(kimiHome, nativeSessionId);
  if (!sessionDirectory) return '';

  const candidates = [path.join(sessionDirectory, 'wire.jsonl')];
  const agentsDirectory = path.join(sessionDirectory, 'agents');
  for (const agent of await safeDirectoryEntriesAsync(agentsDirectory)) {
    if (!agent.isDirectory()) continue;
    candidates.push(path.join(agentsDirectory, agent.name, 'wire.jsonl'));
  }

  const parts: string[] = [];
  for (const filePath of candidates.sort()) {
    try {
      // A failed stat is how a missing file reports itself here, which is why
      // there is no separate existence check.
      const { size } = await fsp.stat(filePath);
      parts.push(`${path.relative(sessionDirectory, filePath)}:${size}`);
    } catch {
      // Absent, or gone between listing and stat.
    }
  }
  return parts.join('|');
}

export function captureKimiUsageCursor(kimiHome: string, nativeSessionId: string): KimiUsageCursor {
  const offsets = new Map<string, number>();
  for (const filePath of listKimiWireFiles(kimiHome, nativeSessionId)) {
    try {
      offsets.set(filePath, fs.statSync(filePath).size);
    } catch {
      // A short-lived subagent file may disappear between listing and stat.
    }
  }
  return { kimiHome, nativeSessionId, offsets };
}

export function readKimiUsageSince(cursor: KimiUsageCursor): KimiTurnUsage {
  const records: KimiUsageRecord[] = [];
  for (const filePath of listKimiWireFiles(cursor.kimiHome, cursor.nativeSessionId)) {
    records.push(...parseUsageRecords(readFileSuffix(filePath, cursor.offsets.get(filePath) || 0)));
  }
  return summarizeKimiUsage(records);
}

export function readAllKimiUsageRecords(
  kimiHome: string,
  nativeSessionId: string
): KimiUsageRecord[] {
  return listKimiWireFiles(kimiHome, nativeSessionId)
    .flatMap((filePath) => parseUsageRecords(readFileSuffix(filePath, 0)))
    .sort((a, b) => a.recordedAt - b.recordedAt);
}

export function readKimiRootPrompts(kimiHome: string, nativeSessionId: string): KimiRootPrompt[] {
  const sessionDirectory = resolveKimiNativeSessionDirectory(kimiHome, nativeSessionId);
  if (!sessionDirectory) return [];
  const candidates = [
    path.join(sessionDirectory, 'agents', 'main', 'wire.jsonl'),
    path.join(sessionDirectory, 'wire.jsonl'),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const prompts: KimiRootPrompt[] = [];
    for (const line of readFileSuffix(filePath, 0).split('\n')) {
      try {
        const event = JSON.parse(line) as { type?: unknown; time?: unknown; input?: unknown };
        const time = Number(event.time);
        if (event.type !== 'turn.prompt' || !Number.isFinite(time) || time <= 0) continue;
        const text = Array.isArray(event.input)
          ? event.input
              .map((block) =>
                block && typeof block === 'object' && 'text' in block
                  ? String((block as { text?: unknown }).text || '')
                  : ''
              )
              .join('\n')
          : typeof event.input === 'string'
            ? event.input
            : '';
        prompts.push({ recordedAt: time, text });
      } catch {
        // Ignore incomplete or legacy records.
      }
    }
    return prompts.sort((a, b) => a.recordedAt - b.recordedAt);
  }
  return [];
}

export function readKimiRootPromptTimes(kimiHome: string, nativeSessionId: string): number[] {
  return readKimiRootPrompts(kimiHome, nativeSessionId).map((prompt) => prompt.recordedAt);
}

export function summarizeKimiUsageBetween(
  records: KimiUsageRecord[],
  startsAt: number,
  endsAt: number
): KimiTurnUsage {
  return summarizeKimiUsage(
    records.filter((record) => record.recordedAt >= startsAt && record.recordedAt < endsAt)
  );
}
