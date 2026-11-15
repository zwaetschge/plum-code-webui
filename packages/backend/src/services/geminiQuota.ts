/**
 * Gemini (Antigravity) quota, as Google's own `agy` CLI shows it.
 *
 * Gemini runs through the agy bridge (see piConfig.resolveAgyBridgeExtension).
 * Its limits live with Google: per model group a 5-hour and a weekly window,
 * shown by agy's `/usage` screen. agy has no machine-readable quota command
 * and keeps nothing on disk, and Plum must not reuse agy's OAuth token itself
 * (that is exactly what Google blocks and its terms forbid), so this opens the
 * official CLI in a pseudo-terminal, types `/usage` and reads the screen.
 * One read takes a few seconds and no model call; results are cached.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as pty from 'node-pty';
import { agyBinary, agyOAuthTokenFile, resolveAgyBridgeExtension } from '../utils/piConfig.js';

export interface GeminiQuotaWindow {
  /** Percent used, 0–100 (agy shows what is left). */
  utilization: number;
  resetsAt: string | null;
  windowSeconds: number;
}

export interface GeminiQuotaGroup {
  /** "GEMINI MODELS", "CLAUDE AND GPT MODELS", … as agy names them. */
  name: string;
  fiveHour: GeminiQuotaWindow | null;
  weekly: GeminiQuotaWindow | null;
}

export interface GeminiQuota {
  groups: GeminiQuotaGroup[];
  checkedAt: string;
}

const FIVE_HOURS = 5 * 60 * 60;
const WEEK = 7 * 24 * 60 * 60;
const FRESH_MS = 5 * 60_000;
const READ_TIMEOUT_MS = 45_000;

// CSI/OSC/other escapes. Cursor moves become a space so words that the TUI
// placed side by side do not glue together; colours vanish.
const ANSI_PATTERN =
  /\x1b\[[0-9;?]*m|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[=>()][0-9A-Za-z]?/g;

export function stripTerminal(raw: string): string {
  return raw
    .replace(ANSI_PATTERN, (match) => (match.endsWith('m') && match.startsWith('\x1b[') ? '' : ' '))
    .replace(/\r/g, '\n');
}

function parseRefresh(text: string | undefined, now: number): string | null {
  if (!text) return null;
  const days = /(\d+)\s*d/.exec(text)?.[1];
  const hours = /(\d+)\s*h/.exec(text)?.[1];
  const minutes = /(\d+)\s*m(?!s)/.exec(text)?.[1];
  if (days === undefined && hours === undefined && minutes === undefined) return null;
  const seconds =
    Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + Number(minutes ?? 0) * 60;
  return new Date(now + seconds * 1000).toISOString();
}

function parseWindow(
  block: string,
  label: string,
  windowSeconds: number,
  now: number
): GeminiQuotaWindow | null {
  const match = new RegExp(
    `${label}\\s+Remaining[^%]*?([\\d.]+)\\s*%\\s*(?:Refreshes in\\s+((?:\\d+\\s*[dhm]\\s*)+))?`,
    'i'
  ).exec(block);
  if (!match) return null;
  const remaining = Number(match[1]);
  if (!Number.isFinite(remaining) || remaining < 0 || remaining > 100) return null;
  return {
    utilization: Math.round((100 - remaining) * 100) / 100,
    resetsAt: parseRefresh(match[2], now),
    windowSeconds,
  };
}

/** The groups on agy's `/usage` screen ("Models & Quota"). */
export function parseAgyUsageScreen(screen: string, now = Date.now()): GeminiQuotaGroup[] {
  const text = stripTerminal(screen).replace(/[ \t]+/g, ' ');
  const start = text.search(/Models\s*&\s*Quota/i);
  const body = start >= 0 ? text.slice(start) : text;
  const headings = [...body.matchAll(/\b([A-Z][A-Z0-9 ,&]*MODELS)\b/g)];
  const groups: GeminiQuotaGroup[] = [];
  const seen = new Set<string>();
  headings.forEach((heading, index) => {
    const name = heading[1]!.trim();
    if (seen.has(name)) return; // the TUI repaints; the first full block counts
    const from = heading.index! + heading[0].length;
    const to = headings[index + 1]?.index ?? body.length;
    const block = body.slice(from, to);
    const fiveHour = parseWindow(block, 'Five Hour Limit', FIVE_HOURS, now);
    const weekly = parseWindow(block, 'Weekly Limit', WEEK, now);
    if (!fiveHour && !weekly) return;
    seen.add(name);
    groups.push({ name, fiveHour, weekly });
  });
  return groups;
}

export function isGeminiQuotaAvailable(): boolean {
  return !!resolveAgyBridgeExtension() && fs.existsSync(agyOAuthTokenFile());
}

function probeDir(): string {
  // An empty folder of its own: agy asks once whether to trust a workspace.
  const dir = path.join(os.homedir(), '.pi', 'agy-gemini', 'usage-probe');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Opens agy, types `/usage`, returns the screen text once both windows show. */
function readAgyUsageScreen(): Promise<string> {
  const binary = agyBinary();
  if (!binary) return Promise.reject(new Error('agy CLI not installed'));
  return new Promise((resolve, reject) => {
    let output = '';
    let typed = false;
    let trusted = false;
    let settled = false;
    const proc = pty.spawn(binary, [], {
      name: 'xterm-256color',
      cols: 220,
      rows: 80,
      cwd: probeDir(),
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        proc.kill();
      } catch {
        // already gone
      }
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(
      () => finish(new Error('agy /usage did not answer in time')),
      READ_TIMEOUT_MS
    );
    proc.onData((chunk) => {
      output += chunk;
      if (output.length > 2_000_000) output = output.slice(-1_000_000);
      const plain = stripTerminal(output);
      if (!trusted && /Do you trust the contents/i.test(plain)) {
        trusted = true;
        proc.write('\r');
        return;
      }
      if (/not signed in|Select login method/i.test(plain)) {
        finish(new Error('agy is not signed in'));
        return;
      }
      if (!typed && /for shortcuts/i.test(plain)) {
        typed = true;
        // Typed in two steps: the prompt drops keys sent before it settled.
        setTimeout(() => proc.write('/usage'), 600);
        setTimeout(() => proc.write('\r'), 1400);
        return;
      }
      if (typed) {
        const after = plain.slice(plain.search(/Models\s*&\s*Quota/i));
        if (
          /Models\s*&\s*Quota/i.test(plain) &&
          (after.match(/Five Hour Limit/gi)?.length ?? 0) >= 2
        ) {
          // Let the last bar finish painting.
          setTimeout(() => finish(null), 800);
        }
      }
    });
    proc.onExit(() => finish(output ? null : new Error('agy exited without output')));
  });
}

let cached: GeminiQuota | null = null;
let inFlight: Promise<GeminiQuota> | null = null;
let lastError: string | null = null;

async function refresh(): Promise<GeminiQuota> {
  if (!inFlight) {
    inFlight = readAgyUsageScreen()
      .then((screen) => {
        const groups = parseAgyUsageScreen(screen);
        if (groups.length === 0) throw new Error('agy /usage screen not recognised');
        cached = { groups, checkedAt: new Date().toISOString() };
        lastError = null;
        return cached;
      })
      .catch((error: unknown) => {
        lastError = error instanceof Error ? error.message : String(error);
        throw error;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/**
 * The latest quota: cached for five minutes, refreshed in the background after
 * that (the stale value is returned meanwhile). Only the very first read waits.
 */
export async function getGeminiQuota(): Promise<{
  quota: GeminiQuota | null;
  error: string | null;
}> {
  const age = cached ? Date.now() - Date.parse(cached.checkedAt) : Infinity;
  if (cached && age < FRESH_MS) return { quota: cached, error: null };
  if (cached) {
    refresh().catch(() => undefined);
    return { quota: cached, error: null };
  }
  try {
    return { quota: await refresh(), error: null };
  } catch {
    return { quota: null, error: lastError };
  }
}

function toWindow(window: GeminiQuotaWindow | null) {
  return window
    ? {
        utilization: window.utilization,
        resetsAt: window.resetsAt,
        windowSeconds: window.windowSeconds,
      }
    : null;
}

/** `/api/usage/limits?provider=gemini`, in the shared limits shape. */
export async function buildGeminiLimitResponse() {
  if (!isGeminiQuotaAvailable()) {
    return { success: true, supported: false, provider: 'gemini' as const, data: null };
  }
  const { quota, error } = await getGeminiQuota();
  if (!quota) {
    return {
      success: false,
      supported: true,
      provider: 'gemini' as const,
      data: null,
      error: { code: 'GEMINI_QUOTA_UNAVAILABLE', message: error ?? 'Gemini quota unavailable' },
    };
  }
  const gemini = quota.groups.find((group) => /GEMINI/i.test(group.name)) ?? quota.groups[0]!;
  const others = quota.groups.filter((group) => group !== gemini);
  const label = (name: string) =>
    name
      .replace(/\s*MODELS$/i, '')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\bGpt\b/, 'GPT')
      .replace(/\bAnd\b/, '+');
  const additional = others.flatMap((group) =>
    [
      group.fiveHour && { name: `${label(group.name)} · 5 Std.`, ...toWindow(group.fiveHour)! },
      group.weekly && { name: `${label(group.name)} · Woche`, ...toWindow(group.weekly)! },
    ].filter((entry): entry is NonNullable<typeof entry> => !!entry)
  );
  return {
    success: true,
    supported: true,
    provider: 'gemini' as const,
    data: {
      subscriptionType: 'antigravity',
      rateLimitTier: 'antigravity',
      fiveHour: toWindow(gemini.fiveHour),
      sevenDay: toWindow(gemini.weekly),
      sevenDaySonnet: null,
      additional,
      source: 'upstream' as const,
    },
  };
}
