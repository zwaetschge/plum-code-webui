import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { CLI_PROVIDERS } from '../services/cli-providers.js';

const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages';
const KIMI_OAUTH_TOKEN_URL = 'https://auth.kimi.com/api/oauth/token';
const KIMI_OAUTH_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const KIMI_USER_AGENT = 'KimiCLI/1.6';

const kimiHome = CLI_PROVIDERS.kimi.credentialsPath.replace('~', os.homedir());
const credentialsPath = path.join(kimiHome, 'credentials', 'kimi-code.json');
const deviceIdPath = path.join(kimiHome, 'device_id');

interface KimiCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface KimiUsageDetail {
  limit?: string | number;
  used?: string | number;
  remaining?: string | number;
  resetTime?: string;
  reset_at?: string;
  reset_time?: string;
}

interface KimiUsageLimit {
  window?: { duration?: number; timeUnit?: string; time_unit?: string };
  detail?: KimiUsageDetail;
}

interface KimiUsageResponse {
  usage?: KimiUsageDetail;
  limits?: KimiUsageLimit[];
  parallel?: { limit?: string | number; details?: unknown[] };
  subType?: string;
}

export interface KimiNormalizedWindow {
  utilization: number;
  resetsAt: string | null;
  windowSeconds: number | null;
  used: number;
  limit: number;
  remaining: number;
  unit: 'percent' | 'requests';
}

export interface KimiMappedUsage {
  subscriptionType: string;
  rateLimitTier: string;
  fiveHour: KimiNormalizedWindow | null;
  sevenDay: KimiNormalizedWindow | null;
  sevenDaySonnet: null;
  additional: Array<{ name: string } & KimiNormalizedWindow>;
  source: 'upstream';
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function utilizationPercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  const percentage = Math.min(100, Math.max(0, (used / limit) * 100));
  return Math.round(percentage * 10) / 10;
}

function resetIso(detail: KimiUsageDetail): string | null {
  const value = detail.resetTime || detail.reset_at || detail.reset_time;
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function windowSeconds(window: KimiUsageLimit): number | null {
  const duration = numberValue(window?.window?.duration);
  if (duration === null) return null;
  const unit = String(window?.window?.timeUnit || window?.window?.time_unit || '').toUpperCase();
  if (unit.includes('MINUTE')) return duration * 60;
  if (unit.includes('HOUR')) return duration * 60 * 60;
  if (unit.includes('DAY')) return duration * 24 * 60 * 60;
  return duration;
}

function mapDetail(
  detail: KimiUsageDetail | undefined,
  seconds: number | null,
  unit: KimiNormalizedWindow['unit'] = 'percent'
): KimiNormalizedWindow | null {
  if (!detail) return null;
  const limit = numberValue(detail.limit);
  let used = numberValue(detail.used);
  const suppliedRemaining = numberValue(detail.remaining);
  if (used === null && limit !== null && suppliedRemaining !== null)
    used = limit - suppliedRemaining;
  if (limit === null || used === null) return null;
  const remaining = suppliedRemaining ?? Math.max(0, limit - used);
  return {
    utilization: utilizationPercent(used, limit),
    resetsAt: resetIso(detail),
    windowSeconds: seconds,
    used,
    limit,
    remaining,
    unit,
  };
}

export function mapKimiUsage(payload: KimiUsageResponse): KimiMappedUsage {
  const rolling = payload.limits?.find((limit) => {
    const seconds = windowSeconds(limit);
    return seconds !== null && seconds <= 6 * 60 * 60;
  });
  const parallelLimit = numberValue(payload.parallel?.limit);
  const parallelUsed = payload.parallel?.details?.length ?? 0;
  const additional: KimiMappedUsage['additional'] = [];
  if (parallelLimit !== null) {
    additional.push({
      name: 'Parallel sessions',
      utilization: utilizationPercent(parallelUsed, parallelLimit),
      resetsAt: null,
      windowSeconds: null,
      used: parallelUsed,
      limit: parallelLimit,
      remaining: Math.max(0, parallelLimit - parallelUsed),
      unit: 'requests',
    });
  }

  return {
    subscriptionType: 'Kimi Code',
    rateLimitTier: payload.subType || 'Coding Plan',
    fiveHour: rolling ? mapDetail(rolling.detail, windowSeconds(rolling)) : null,
    sevenDay: mapDetail(payload.usage, 7 * 24 * 60 * 60),
    sevenDaySonnet: null,
    additional,
    source: 'upstream',
  };
}

async function readCredentials(): Promise<KimiCredentials | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(credentialsPath, 'utf8')
    ) as Partial<KimiCredentials>;
    if (!parsed.access_token || !parsed.refresh_token) return null;
    return parsed as KimiCredentials;
  } catch {
    return null;
  }
}

async function deviceHeaders(): Promise<Record<string, string>> {
  const deviceId = (await fs.readFile(deviceIdPath, 'utf8').catch(() => '')).trim();
  return {
    'User-Agent': KIMI_USER_AGENT,
    'X-Msh-Platform': 'kimi_code_cli',
    'X-Msh-Version': '0.31.1',
    'X-Msh-Device-Name': os.hostname(),
    'X-Msh-Device-Model': os.arch(),
    'X-Msh-Os-Version': os.release(),
    ...(deviceId ? { 'X-Msh-Device-Id': deviceId } : {}),
  };
}

async function refreshCredentials(current: KimiCredentials): Promise<KimiCredentials | null> {
  const body = new URLSearchParams({
    client_id: KIMI_OAUTH_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: current.refresh_token,
  });
  const response = await fetch(KIMI_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      ...(await deviceHeaders()),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as Partial<KimiCredentials>;
  if (!payload.access_token || !payload.refresh_token) return null;
  const refreshed: KimiCredentials = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at:
      numberValue(payload.expires_at) ??
      Math.floor(Date.now() / 1000) + (numberValue(payload.expires_in) ?? 900),
    expires_in: numberValue(payload.expires_in) ?? 900,
    scope: payload.scope || current.scope || 'kimi-code',
    token_type: payload.token_type || current.token_type || 'Bearer',
  };

  // Do not overwrite a token another Kimi process rotated while this request
  // was in flight. In that case the newer on-disk token wins.
  const latest = await readCredentials();
  if (latest && latest.refresh_token !== current.refresh_token) return latest;
  const temporaryPath = `${credentialsPath}.plum-${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(refreshed, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, credentialsPath);
  return refreshed;
}

async function freshCredentials(forceRefresh = false): Promise<KimiCredentials | null> {
  const credentials = await readCredentials();
  if (!credentials) return null;
  if (!forceRefresh && credentials.expires_at > Math.floor(Date.now() / 1000) + 60) {
    return credentials;
  }
  return (await refreshCredentials(credentials)) || credentials;
}

async function requestUsage(credentials: KimiCredentials): Promise<Response> {
  return fetch(KIMI_USAGE_URL, {
    headers: {
      ...(await deviceHeaders()),
      Authorization: `Bearer ${credentials.access_token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
}

export async function fetchKimiUsage(): Promise<
  { ok: true; data: KimiMappedUsage } | { ok: false; status: number; code: string; message: string }
> {
  let credentials = await freshCredentials();
  if (!credentials) {
    return {
      ok: false,
      status: 401,
      code: 'NO_CREDENTIALS',
      message: 'Kimi credentials not found',
    };
  }

  let response = await requestUsage(credentials);
  if (response.status === 401 || response.status === 403) {
    credentials = await freshCredentials(true);
    if (credentials) response = await requestUsage(credentials);
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      code:
        response.status === 401 || response.status === 403 ? 'NO_CREDENTIALS' : 'KIMI_USAGE_ERROR',
      message:
        response.status === 401 || response.status === 403
          ? 'Kimi credentials not found or expired'
          : `Kimi usage API returned ${response.status}`,
    };
  }
  return { ok: true, data: mapKimiUsage((await response.json()) as KimiUsageResponse) };
}

/**
 * The same coding endpoint that serves the Kimi CLI is Anthropic-compatible
 * (POST {base}/v1/messages with the OAuth bearer works verbatim), which makes
 * the Kimi subscription a routable subagent upstream exactly like Z.AI. These
 * accessors reuse the refresh machinery above; the token file stays the single
 * source of truth shared with the CLI.
 */
export const KIMI_CODING_BASE_URL = 'https://api.kimi.com/coding';
export const KIMI_CODING_MODELS = ['kimi-for-coding', 'kimi-for-coding-highspeed', 'k3'];

export function isKimiCodingModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.startsWith('kimi-') || normalized === 'k3' || normalized.startsWith('k3-');
}

export async function hasKimiCodingCredentials(): Promise<boolean> {
  return (await readCredentials()) !== null;
}

export async function getKimiCodingAccessToken(): Promise<string | null> {
  const credentials = await freshCredentials();
  return credentials?.access_token ?? null;
}
