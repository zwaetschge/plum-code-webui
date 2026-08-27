import { get as pgGet } from '../../db/pg.js';
import type {
  HomeAssistantConnectionTest,
  HomeAssistantIntegrationSettings,
  HomeAssistantIntegrationSettingsUpdate,
  HomeAssistantLightEntity,
  HomeAssistantStatus,
} from '@plum-code-webui/shared';
import { getAppConfig, setAppConfig } from '../../db/index.js';
import { safeDecrypt, safeEncrypt } from '../../utils/encryption.js';

const CONFIG_KEYS = {
  enabled: 'home_assistant_enabled',
  baseUrl: 'home_assistant_url',
  accessToken: 'home_assistant_access_token',
} as const;

const COLOR_MODES = new Set(['hs', 'xy', 'rgb', 'rgbw', 'rgbww']);
const REQUEST_TIMEOUT_MS = 8_000;

interface HomeAssistantState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

interface Connection {
  baseUrl: string;
  accessToken: string;
}

interface AnimationStep {
  high: boolean;
  brightnessPct: number;
  transition: number;
  holdMs: number;
}

interface AnimationPattern {
  repeats: number;
  color: [number, number, number];
  steps: AnimationStep[];
}

interface ActiveAnimation {
  generation: number;
  originalState: HomeAssistantState;
}

export const HOME_ASSISTANT_STATUS_PATTERNS: Record<HomeAssistantStatus, AnimationPattern> = {
  success: {
    repeats: 8,
    color: [0, 255, 70],
    steps: [
      { high: true, brightnessPct: 100, transition: 0.7, holdMs: 700 },
      { high: false, brightnessPct: 12, transition: 0.7, holdMs: 800 },
    ],
  },
  problem: {
    repeats: 10,
    color: [255, 0, 0],
    steps: [
      { high: true, brightnessPct: 100, transition: 0.3, holdMs: 650 },
      { high: false, brightnessPct: 8, transition: 0.3, holdMs: 1_050 },
    ],
  },
  question: {
    repeats: 10,
    color: [0, 90, 255],
    steps: [
      { high: true, brightnessPct: 100, transition: 0.1, holdMs: 160 },
      { high: false, brightnessPct: 20, transition: 0.12, holdMs: 180 },
      { high: true, brightnessPct: 100, transition: 0.1, holdMs: 170 },
      { high: false, brightnessPct: 8, transition: 0.45, holdMs: 650 },
    ],
  },
};

export function normalizeHomeAssistantUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Home Assistant URL must use http or https');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function isHomeAssistantLightEntityId(value: string): boolean {
  return /^light\.[a-z0-9_]+$/.test(value);
}

export function homeAssistantStatusForSessionEvent(
  eventType: string,
  severity: string
): HomeAssistantStatus | null {
  if (eventType === 'session.needs_input' || eventType === 'session.permission_requested') {
    return 'question';
  }
  if (eventType === 'session.error' || severity === 'error' || severity === 'critical') {
    return 'problem';
  }
  return null;
}

export function homeAssistantStatusForGoalStatus(status: string): HomeAssistantStatus | null {
  if (status === 'completed') return 'success';
  if (status === 'blocked') return 'problem';
  return null;
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function supportedColorModes(state: HomeAssistantState): string[] {
  const modes = state.attributes.supported_color_modes;
  return Array.isArray(modes)
    ? modes.filter((mode): mode is string => typeof mode === 'string')
    : [];
}

function supportsColor(state: HomeAssistantState): boolean {
  return supportedColorModes(state).some((mode) => COLOR_MODES.has(mode));
}

function supportsBrightness(state: HomeAssistantState): boolean {
  const modes = supportedColorModes(state);
  return modes.length === 0 || modes.some((mode) => mode !== 'onoff');
}

function friendlyName(state: HomeAssistantState): string {
  const value = state.attributes.friendly_name;
  return typeof value === 'string' && value.trim() ? value.trim() : state.entity_id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HomeAssistantStatusLightService {
  private readonly activeAnimations = new Map<string, ActiveAnimation>();
  private generation = 0;

  async getSettings(): Promise<HomeAssistantIntegrationSettings> {
    const storedUrl = (await getAppConfig(CONFIG_KEYS.baseUrl))?.trim() || '';
    const envUrl = process.env.HOME_ASSISTANT_URL?.trim() || '';
    const storedToken = getAppConfig(CONFIG_KEYS.accessToken);
    const envToken = process.env.HOME_ASSISTANT_TOKEN?.trim() || '';
    const baseUrl = storedUrl || envUrl;
    const accessTokenConfigured = Boolean(storedToken || envToken);
    const configured = Boolean(baseUrl && accessTokenConfigured);

    return {
      enabled: parseBoolean(await getAppConfig(CONFIG_KEYS.enabled), configured),
      configured,
      baseUrl,
      baseUrlFromEnv: !storedUrl && Boolean(envUrl),
      accessTokenConfigured,
      accessTokenFromEnv: !storedToken && Boolean(envToken),
    };
  }

  async updateSettings(
    input: HomeAssistantIntegrationSettingsUpdate
  ): Promise<HomeAssistantIntegrationSettings> {
    if (input.baseUrl !== undefined) {
      await setAppConfig(CONFIG_KEYS.baseUrl, normalizeHomeAssistantUrl(input.baseUrl));
    }
    if (input.accessToken !== undefined && input.accessToken.trim()) {
      await setAppConfig(CONFIG_KEYS.accessToken, safeEncrypt(input.accessToken.trim()) || '');
    }
    if (input.clearAccessToken) {
      await setAppConfig(CONFIG_KEYS.accessToken, '');
    }
    if (input.enabled !== undefined) {
      await setAppConfig(CONFIG_KEYS.enabled, input.enabled ? 'true' : 'false');
    }
    return this.getSettings();
  }

  async testConnection(overrides?: {
    baseUrl?: string;
    accessToken?: string;
  }): Promise<HomeAssistantConnectionTest> {
    const connection = await this.resolveConnection(overrides);
    const [config, states] = await Promise.all([
      this.request<Record<string, unknown>>(connection, '/api/config'),
      this.request<HomeAssistantState[]>(connection, '/api/states'),
    ]);
    return {
      connected: true,
      version: typeof config.version === 'string' ? config.version : null,
      locationName: typeof config.location_name === 'string' ? config.location_name : null,
      lightCount: states.filter((state) => state.entity_id.startsWith('light.')).length,
    };
  }

  async listLights(): Promise<HomeAssistantLightEntity[]> {
    const states = await this.request<HomeAssistantState[]>(
      await this.resolveConnection(),
      '/api/states'
    );
    return states
      .filter((state) => state.entity_id.startsWith('light.'))
      .map((state) => ({
        entityId: state.entity_id,
        name: friendlyName(state),
        state: state.state,
        available: state.state !== 'unavailable' && state.state !== 'unknown',
        colorCapable: supportsColor(state),
        supportedColorModes: supportedColorModes(state),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async validateLightEntity(entityId: string): Promise<void> {
    if (!isHomeAssistantLightEntityId(entityId)) {
      throw new Error('Entity must be a Home Assistant light.* entity');
    }
    const state = await this.getState(await this.resolveConnection(), entityId);
    if (state.state === 'unavailable') {
      throw new Error(`${entityId} is currently unavailable`);
    }
  }

  async notifySession(sessionId: string, status: HomeAssistantStatus): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.enabled || !settings.configured) return;
    const row = (await pgGet(
      'SELECT home_assistant_entity_id as entityId FROM sessions WHERE id = ?',
      sessionId
    )) as unknown as { entityId: string | null } | undefined;
    if (!row?.entityId) return;
    void this.animate(row.entityId, status).catch((error) => {
      console.warn(
        `[HOME ASSISTANT] Status light failed for session ${sessionId}:`,
        error instanceof Error ? error.message : String(error)
      );
    });
  }

  async previewSession(
    sessionId: string,
    userId: string,
    status: HomeAssistantStatus
  ): Promise<void> {
    const row = (await pgGet(
      'SELECT home_assistant_entity_id as entityId FROM sessions WHERE id = ? AND user_id = ?',
      sessionId,
      userId
    )) as unknown as { entityId: string | null } | undefined;
    if (!row) throw new Error('Session not found');
    if (!row.entityId) throw new Error('No Home Assistant light is assigned to this session');
    await this.startAnimation(row.entityId, status);
  }

  private async resolveConnection(overrides?: {
    baseUrl?: string;
    accessToken?: string;
  }): Promise<Connection> {
    const storedUrl = (await getAppConfig(CONFIG_KEYS.baseUrl))?.trim() || '';
    const storedToken = safeDecrypt(await getAppConfig(CONFIG_KEYS.accessToken))?.trim() || '';
    const baseUrl = normalizeHomeAssistantUrl(
      overrides?.baseUrl || storedUrl || process.env.HOME_ASSISTANT_URL || ''
    );
    const accessToken =
      overrides?.accessToken?.trim() ||
      storedToken ||
      process.env.HOME_ASSISTANT_TOKEN?.trim() ||
      '';
    if (!baseUrl || !accessToken) {
      throw new Error('Home Assistant URL and long-lived access token are required');
    }
    return { baseUrl, accessToken };
  }

  private async request<T>(
    connection: Connection,
    pathname: string,
    init?: RequestInit
  ): Promise<T> {
    const response = await fetch(`${connection.baseUrl}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 240);
      throw new Error(
        `Home Assistant returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private getState(connection: Connection, entityId: string): Promise<HomeAssistantState> {
    return this.request<HomeAssistantState>(
      connection,
      `/api/states/${encodeURIComponent(entityId)}`
    );
  }

  private callLight(
    connection: Connection,
    service: 'turn_on' | 'turn_off',
    data: Record<string, unknown>
  ): Promise<unknown> {
    return this.request(connection, `/api/services/light/${service}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  private async startAnimation(entityId: string, status: HomeAssistantStatus): Promise<void> {
    const connection = await this.resolveConnection();
    const generation = ++this.generation;
    const existing = this.activeAnimations.get(entityId);
    const originalState = existing?.originalState ?? (await this.getState(connection, entityId));
    const active: ActiveAnimation = { generation, originalState };
    this.activeAnimations.set(entityId, active);
    const original = active.originalState;
    if (!this.isCurrent(entityId, generation)) return;
    void this.runAnimation(connection, entityId, original, status, generation);
  }

  private async animate(entityId: string, status: HomeAssistantStatus): Promise<void> {
    await this.startAnimation(entityId, status);
  }

  private isCurrent(entityId: string, generation: number): boolean {
    return this.activeAnimations.get(entityId)?.generation === generation;
  }

  private async runAnimation(
    connection: Connection,
    entityId: string,
    original: HomeAssistantState,
    status: HomeAssistantStatus,
    generation: number
  ): Promise<void> {
    const pattern = HOME_ASSISTANT_STATUS_PATTERNS[status];
    try {
      for (let repeat = 0; repeat < pattern.repeats; repeat += 1) {
        for (const step of pattern.steps) {
          if (!this.isCurrent(entityId, generation)) return;
          await this.applyStep(connection, entityId, original, pattern.color, step);
          await sleep(step.holdMs);
        }
      }
    } finally {
      if (this.isCurrent(entityId, generation)) {
        try {
          await this.restoreState(connection, original);
        } finally {
          if (this.isCurrent(entityId, generation)) this.activeAnimations.delete(entityId);
        }
      }
    }
  }

  private applyStep(
    connection: Connection,
    entityId: string,
    original: HomeAssistantState,
    color: [number, number, number],
    step: AnimationStep
  ): Promise<unknown> {
    if (!step.high && !supportsBrightness(original)) {
      return this.callLight(connection, 'turn_off', {
        entity_id: entityId,
        transition: step.transition,
      });
    }
    return this.callLight(connection, 'turn_on', {
      entity_id: entityId,
      ...(supportsBrightness(original) ? { brightness_pct: step.brightnessPct } : {}),
      ...(supportsColor(original) ? { rgb_color: color } : {}),
      transition: step.transition,
    });
  }

  private restoreState(connection: Connection, original: HomeAssistantState): Promise<unknown> {
    if (original.state !== 'on') {
      return this.callLight(connection, 'turn_off', {
        entity_id: original.entity_id,
        transition: 0.5,
      });
    }

    const attributes = original.attributes;
    const data: Record<string, unknown> = {
      entity_id: original.entity_id,
      transition: 0.5,
    };
    if (typeof attributes.brightness === 'number') data.brightness = attributes.brightness;
    const colorMode = typeof attributes.color_mode === 'string' ? attributes.color_mode : '';
    if (colorMode === 'color_temp' && typeof attributes.color_temp_kelvin === 'number') {
      data.color_temp_kelvin = attributes.color_temp_kelvin;
    } else if (colorMode === 'hs' && Array.isArray(attributes.hs_color)) {
      data.hs_color = attributes.hs_color;
    } else if (colorMode === 'xy' && Array.isArray(attributes.xy_color)) {
      data.xy_color = attributes.xy_color;
    } else if (colorMode.startsWith('rgb') && Array.isArray(attributes.rgb_color)) {
      data.rgb_color = attributes.rgb_color;
    }
    if (typeof attributes.effect === 'string' && attributes.effect !== 'off') {
      data.effect = attributes.effect;
    }
    return this.callLight(connection, 'turn_on', data);
  }
}

export const homeAssistantStatusLights = new HomeAssistantStatusLightService();
