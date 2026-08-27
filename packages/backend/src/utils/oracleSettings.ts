import { get as pgGet } from '../db/pg.js';
import type { OracleBrowserMode, OracleBrowserSettings } from '@plum-code-webui/shared';
import { safeJsonParse } from './json.js';

export const DEFAULT_ORACLE_CHATGPT_URL = 'https://chatgpt.com/';

export interface OracleRuntimeConfig {
  mode: OracleBrowserMode;
  chatgptUrl: string;
  remoteChrome: string | null;
  chromeProfile: string | null;
  chromeCookiePath: string | null;
  manualLoginProfileDir: string | null;
  embeddedRemoteChrome: string | null;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeMode(value: unknown): OracleBrowserMode | undefined {
  return value === 'profile' || value === 'manual' || value === 'remote' ? value : undefined;
}

export function parseOracleBrowserSettings(value: unknown): OracleBrowserSettings | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const raw = value as Record<string, unknown>;
  const parsed: OracleBrowserSettings = {};
  const mode = normalizeMode(raw.mode);

  if (mode) parsed.mode = mode;

  const chatgptUrl = normalizeOptionalString(raw.chatgptUrl);
  if (chatgptUrl) parsed.chatgptUrl = chatgptUrl;

  const remoteChrome = normalizeOptionalString(raw.remoteChrome);
  if (remoteChrome) parsed.remoteChrome = remoteChrome;

  const chromeProfile = normalizeOptionalString(raw.chromeProfile);
  if (chromeProfile) parsed.chromeProfile = chromeProfile;

  const chromeCookiePath = normalizeOptionalString(raw.chromeCookiePath);
  if (chromeCookiePath) parsed.chromeCookiePath = chromeCookiePath;

  const manualLoginProfileDir = normalizeOptionalString(raw.manualLoginProfileDir);
  if (manualLoginProfileDir) parsed.manualLoginProfileDir = manualLoginProfileDir;

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function buildOracleRuntimeConfig(
  settings?: OracleBrowserSettings | null
): OracleRuntimeConfig {
  return {
    mode: settings?.mode || 'manual',
    chatgptUrl: settings?.chatgptUrl || DEFAULT_ORACLE_CHATGPT_URL,
    remoteChrome: settings?.remoteChrome || null,
    chromeProfile: settings?.chromeProfile || null,
    chromeCookiePath: settings?.chromeCookiePath || null,
    manualLoginProfileDir: settings?.manualLoginProfileDir || null,
    embeddedRemoteChrome: null,
  };
}

export async function getOracleBrowserSettingsForUser(
  userId: string
): Promise<OracleBrowserSettings | undefined> {
  const row = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json: string | null } | undefined;

  if (!row?.settings_json) return undefined;

  const parsed = safeJsonParse<Record<string, unknown>>(row.settings_json, {});
  return parseOracleBrowserSettings(parsed.oracleBrowser);
}

export async function getOracleRuntimeConfigForSession(sessionId: string): Promise<{
  userId: string | null;
  config: OracleRuntimeConfig;
}> {
  const row = (await pgGet('SELECT user_id FROM sessions WHERE id = ?', sessionId)) as unknown as
    | { user_id: string }
    | undefined;

  if (!row?.user_id) {
    return {
      userId: null,
      config: buildOracleRuntimeConfig(),
    };
  }

  return {
    userId: row.user_id,
    config: buildOracleRuntimeConfig(await getOracleBrowserSettingsForUser(row.user_id)),
  };
}
