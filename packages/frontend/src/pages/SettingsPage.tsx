import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Plus,
  Trash2,
  Server,
  Sun,
  Moon,
  Monitor,
  Terminal,
  CheckCircle2,
  RefreshCw,
  FolderOpen,
  FolderSearch,
  Bot,
  Wand2,
  Settings2,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Puzzle,
  Store,
  Key,
  Eye,
  EyeOff,
  KeyRound,
  Zap,
  AlertCircle,
  Loader2,
  Github,
  ExternalLink,
  Search,
  X,
  Lock,
  User,
  Users,
  Shield,
  FileText,
  LayoutDashboard,
  BarChart3,
  Bell,
  Send,
  ChevronRight,
  Globe2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FolderBrowserDialog } from '@/components/ui/folder-browser';
import { PluginEditorDialog } from '@/components/ui/plugin-editor';
import { MarketplaceBrowserDialog } from '@/components/ui/marketplace-browser';
import { CapabilityCatalogSections } from '@/components/settings/CapabilityCatalogSections';
import {
  getSkillCatalogCounts,
  type AgentInfo,
  type SkillInfo,
} from '@/components/settings/capabilityCatalog';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import { DEFAULT_ANALYTICS_HIDDEN_LIMIT_METRICS } from '@plum-code-webui/shared';
import type {
  UserSettings,
  McpServer,
  ApiResponse,
  Theme,
  BackgroundAnimation,
  CliProviderUpdateResponse,
  CliProviderUpdateResult,
  ProviderCapabilities,
  CLIProvider,
  OracleBrowserSettings,
  DiscordAlertSeverity,
  DiscordGatewayMode,
  DiscordAlertTransport,
  DiscordIntegrationSettings,
  DiscordIntegrationSettingsUpdate,
  DiscordMaintenancePolicy,
  DiscordTestResult,
  HomeAssistantIntegrationSettings,
  AnalyticsLimitProvider,
} from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { CLI_PROVIDER_LABEL } from '@/lib/providers';
import { toUiProvider } from '@/lib/providers';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import {
  applyTheme,
  BACKGROUND_ANIMATION_OPTIONS,
  getStoredBackgroundAnimation,
  getStoredTheme,
  normalizeTheme,
  setStoredTheme,
  useAppearanceStore,
} from '@/stores/appearanceStore';
import { useAuthStore } from '@/stores/authStore';
import { AdminOverviewPage } from '@/pages/admin/AdminOverviewPage';
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage';
import { AdminAuditLogPage } from '@/pages/admin/AdminAuditLogPage';
import { HomeAssistantSettingsCard } from '@/components/integrations/HomeAssistantSettingsCard';
import { CliDeviceLoginDialog } from '@/components/settings/CliDeviceLoginDialog';
import { GatewayTokensPanel } from '@/components/settings/GatewayTokensPanel';
import { SubagentUpstreamsSection } from '@/components/settings/SubagentUpstreamsSection';
import { CliSubagentsSection } from '@/components/settings/CliSubagentsSection';
import { ProviderLoginsPanel } from '@/components/settings/ProviderLoginsPanel';

interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  category?: string;
  dirPath: string;
  source: 'user' | 'marketplace';
  enabled: boolean;
  marketplace?: string;
  installedAt?: string;
}

interface OpenCodeProvider {
  id: string;
  name: string;
  apiKey: string;
  hasKey: boolean;
  envVars?: string[];
  baseUrl?: string;
  enabled: boolean;
}

interface OpenCodeAvailableProvider {
  name: string;
  models?: string[];
  description?: string;
  env?: string[];
  api?: string;
  doc?: string;
  source?: string;
  configured?: boolean;
  hasKey?: boolean;
}

interface CodexStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  authMode: 'chatgpt' | 'api-key' | 'none';
  configHome: string;
}

interface OracleBrowserTestResult {
  connected: boolean;
  mode: 'profile' | 'manual' | 'remote';
  message: string;
  chatgptUrl: string;
  remoteChrome?: string | null;
  browser?: string | null;
  protocolVersion?: string | null;
  webSocketDebuggerUrl?: string | null;
  browserPath?: string | null;
  chromeProfile?: string | null;
  chromeCookiePath?: string | null;
  manualLoginProfileDir?: string | null;
}

interface AnalyticsLimitHistoryPoint {
  provider: AnalyticsLimitProvider;
  metricKey: string;
  metricLabel: string;
}

interface AnalyticsLimitHistoryData {
  points: AnalyticsLimitHistoryPoint[];
}

const ANALYTICS_LIMIT_PROVIDER_ORDER: AnalyticsLimitProvider[] = ['codex', 'kimi', 'claude', 'zai'];

const ANALYTICS_LIMIT_PROVIDER_LABEL: Record<AnalyticsLimitProvider, string> = {
  codex: 'Codex',
  kimi: 'Kimi',
  claude: 'Claude',
  zai: 'Z.AI',
};

interface CodexFeatureFlag {
  name: string;
  stage: string;
  enabled: boolean;
}

interface CodexPluginInfo {
  id: string;
  name: string;
  marketplace: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  category?: string;
  enabled: boolean;
  installed: boolean;
  installPolicy?: string;
  authPolicy?: string;
  capabilities?: string[];
  connectors?: string[];
}

interface ProviderDiagnostic {
  id: CLIProvider;
  name: string;
  command: string;
  binaryPath: string | null;
  installed: boolean;
  version: string | null;
  credentialsPath: string;
  authenticated: boolean;
  defaultModel: string | null;
  modelCount: number;
  models: string[];
  capabilities: ProviderCapabilities;
  mcpServerCount: number;
  codexModelsCache: {
    path: string;
    exists: boolean;
    fetchedAt: string | null;
    mtime: string | null;
    modelCount: number;
  } | null;
}

interface ClaudeApiStatus {
  configured: boolean;
  baseUrl: string;
  hasAuthToken: boolean;
  authTokenPreview: string | null;
  opusModel: string;
  sonnetModel: string;
  haikuModel: string;
}

const ACTIVATABLE_CLI_PROVIDERS: Array<{
  id: CLIProvider;
  description: string;
}> = [
  { id: 'codex', description: 'OpenAI Codex subscription sessions' },
  { id: 'claude', description: 'Anthropic Claude subscription sessions' },
  { id: 'zai', description: 'Z.AI GLM Coding Plan via Claude Code' },
  { id: 'opencode', description: 'OpenCode multi-provider harness' },
  { id: 'pi', description: 'Pi harness with OpenCode connections' },
  { id: 'kimi', description: 'Moonshot Kimi Code CLI (browser login)' },
];

type SettingsTab =
  | 'general'
  | 'analytics'
  | 'security'
  | 'api-keys'
  | 'integrations'
  | 'diagnostics'
  | 'extensions'
  | 'admin';

type GeneralSettingsTab =
  | 'workspace'
  | 'logins'
  | 'codex'
  | 'claude'
  | 'zai'
  | 'subagents'
  | 'pi'
  | 'oracle'
  | 'interface'
  | 'opencode';
type AdminSettingsTab = 'overview' | 'users' | 'audit-log';
type SettingsNavTone = 'brand' | 'success' | 'warning' | 'neutral';

interface SettingsSectionShortcut {
  id: string;
  label: string;
}

interface SettingsTabDescriptor {
  label: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
  highlights: string[];
  sections: SettingsSectionShortcut[];
}

interface GeneralSettingsTabDescriptor {
  value: GeneralSettingsTab;
  label: string;
  description: string;
  icon: LucideIcon;
  sections: SettingsSectionShortcut[];
}

interface SettingsNavItem extends SettingsTabDescriptor {
  value: SettingsTab;
  badge: string;
  note: string;
  tone: SettingsNavTone;
}

interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

interface SettingsSearchResult {
  key: string;
  tab: SettingsTab;
  label: string;
  context: string;
  sectionId?: string;
  icon: LucideIcon;
}

interface SettingsPanelProps {
  id?: string;
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}

const SETTINGS_TABS = new Set<SettingsTab>([
  'general',
  'analytics',
  'security',
  'api-keys',
  'integrations',
  'diagnostics',
  'extensions',
  'admin',
]);

const ADMIN_SETTINGS_TABS = new Set<AdminSettingsTab>(['overview', 'users', 'audit-log']);

const SETTINGS_TAB_DESCRIPTORS: Record<SettingsTab, SettingsTabDescriptor> = {
  general: {
    label: 'General',
    eyebrow: 'Workspace',
    description:
      'Default workspace, provider runtime, model menus, and interface behavior live here.',
    icon: Settings2,
    highlights: ['Workspace defaults', 'Provider runtime', 'Appearance'],
    sections: [
      { id: 'active-providers', label: 'Active providers' },
      { id: 'default-directory', label: 'Default directory' },
      { id: 'cli-updates', label: 'CLI updates' },
      { id: 'codex-cli', label: 'Codex CLI' },
      { id: 'claude-cli', label: 'Claude Code' },
      { id: 'zai-cli', label: 'Z.AI Code' },
      { id: 'pi-cli', label: 'Pi' },
      { id: 'oracle-browser', label: 'Oracle browser' },
      { id: 'appearance', label: 'Appearance' },
      { id: 'opencode-models', label: 'OpenCode models' },
    ],
  },
  analytics: {
    label: 'Analytics',
    eyebrow: 'Chart visibility',
    description: 'Choose which provider quota lines appear in the combined analytics graph.',
    icon: BarChart3,
    highlights: ['Provider limits', 'Chart visibility', 'Per-account preferences'],
    sections: [{ id: 'analytics-limit-metrics', label: 'Limit metrics' }],
  },
  security: {
    label: 'Security',
    eyebrow: 'Access',
    description: 'Control the login gate and rotate the credentials used to enter Plum.',
    icon: Shield,
    highlights: ['Basic auth', 'Credential rotation', 'Access posture'],
    sections: [
      { id: 'login-protection', label: 'Login protection' },
      { id: 'change-credentials', label: 'Change credentials' },
    ],
  },
  'api-keys': {
    label: 'API Keys',
    eyebrow: 'Credentials',
    description: 'Store provider credentials and per-provider secrets used by integrations.',
    icon: KeyRound,
    highlights: ['GitHub access', 'OpenCode providers'],
    sections: [
      { id: 'github-token', label: 'GitHub token' },
      { id: 'opencode-providers', label: 'OpenCode providers' },
    ],
  },
  integrations: {
    label: 'Integrations',
    eyebrow: 'External services',
    description:
      'Wire Plum into ComfyUI, Discord alerts, and the remaining endpoints used by the stack.',
    icon: Wand2,
    highlights: ['ComfyUI endpoint', 'Discord alerts', 'Connectivity tests'],
    sections: [
      { id: 'comfyui-integration', label: 'ComfyUI integration' },
      { id: 'discord-integration', label: 'Discord alerts' },
    ],
  },
  diagnostics: {
    label: 'Diagnostics',
    eyebrow: 'Health',
    description:
      'Inspect CLI binaries, auth state, model discovery, MCP wiring, and capability flags.',
    icon: Terminal,
    highlights: ['Binary availability', 'Auth state', 'Capability matrix'],
    sections: [{ id: 'provider-diagnostics', label: 'Provider diagnostics' }],
  },
  extensions: {
    label: 'Extensions',
    eyebrow: 'Tooling',
    description:
      'Manage MCP servers plus the local agent, skill, marketplace, and plugin ecosystem.',
    icon: Puzzle,
    highlights: ['MCP servers', 'Agents and skills', 'Plugins and marketplaces'],
    sections: [
      { id: 'mcp-servers', label: 'MCP servers' },
      { id: 'agents', label: 'Agents' },
      { id: 'skills', label: 'Skills' },
      { id: 'codex-marketplace', label: 'Codex marketplace' },
      { id: 'plugins', label: 'Plugins' },
    ],
  },
  admin: {
    label: 'Admin',
    eyebrow: 'Operations',
    description: 'User management, audit visibility, and instance-level administration tools.',
    icon: LayoutDashboard,
    highlights: ['Overview', 'Users', 'Audit log'],
    sections: [
      { id: 'overview', label: 'Overview' },
      { id: 'users', label: 'Users' },
      { id: 'audit-log', label: 'Audit log' },
    ],
  },
};

const GENERAL_SETTINGS_TABS: GeneralSettingsTabDescriptor[] = [
  {
    value: 'workspace',
    label: 'Workspace',
    description: 'Default folder and CLI updates.',
    icon: FolderOpen,
    sections: [
      { id: 'active-providers', label: 'Active providers' },
      { id: 'default-directory', label: 'Default directory' },
      { id: 'cli-updates', label: 'CLI updates' },
    ],
  },
  {
    value: 'logins',
    label: 'Provider logins',
    description: 'Every sign-in method in one place.',
    icon: KeyRound,
    sections: [{ id: 'provider-logins', label: 'Provider logins' }],
  },
  {
    value: 'codex',
    label: 'Codex',
    description: 'Codex runtime, feature flags, and plugins.',
    icon: Bot,
    sections: [{ id: 'codex-cli', label: 'Codex CLI' }],
  },
  {
    value: 'claude',
    label: 'Claude Code',
    description: 'Anthropic subscription runtime.',
    icon: Bot,
    sections: [{ id: 'claude-cli', label: 'Claude Code' }],
  },
  {
    value: 'zai',
    label: 'Z.AI',
    description: 'GLM Coding Plan endpoint and model mapping.',
    icon: Globe2,
    sections: [{ id: 'zai-cli', label: 'Z.AI Code' }],
  },
  {
    value: 'subagents',
    label: 'Subagents',
    description: 'Route agent models to other subscriptions.',
    icon: Bot,
    sections: [
      { id: 'subagent-upstreams', label: 'Upstreams' },
      { id: 'cli-subagents', label: 'CLI-Subagenten' },
    ],
  },
  {
    value: 'opencode',
    label: 'OpenCode',
    description: 'Curated OpenCode model menu.',
    icon: Server,
    sections: [{ id: 'opencode-models', label: 'OpenCode models' }],
  },
  {
    value: 'pi',
    label: 'Pi',
    description: 'Pi runtime and shared provider models.',
    icon: Bot,
    sections: [{ id: 'pi-cli', label: 'Pi' }],
  },
  {
    value: 'oracle',
    label: 'Oracle',
    description: 'Browser auth for Oracle second opinions.',
    icon: Wand2,
    sections: [{ id: 'oracle-browser', label: 'Oracle browser' }],
  },
  {
    value: 'interface',
    label: 'Interface',
    description: 'Theme and background behavior.',
    icon: Settings2,
    sections: [{ id: 'appearance', label: 'Appearance' }],
  },
];

const GENERAL_SETTINGS_TAB_VALUES = new Set<GeneralSettingsTab>(
  GENERAL_SETTINGS_TABS.map((tab) => tab.value)
);

const GENERAL_SECTION_TO_TAB = GENERAL_SETTINGS_TABS.reduce((map, tab) => {
  tab.sections.forEach((section) => {
    map.set(section.id, tab.value);
  });
  return map;
}, new Map<string, GeneralSettingsTab>());

function SettingsPanel({
  id,
  eyebrow,
  title,
  description,
  action,
  className,
  contentClassName,
  children,
}: SettingsPanelProps) {
  return (
    <Card id={id} className={cn('settings-panel-card border border-border/70', className)}>
      <CardHeader className="settings-panel-header flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <p className="settings-panel-eyebrow text-[11px] font-semibold uppercase text-muted-foreground">
            {eyebrow}
          </p>
          <div className="space-y-1">
            <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
            {description ? (
              <CardDescription className="max-w-2xl text-sm leading-6">
                {description}
              </CardDescription>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent className={cn('settings-panel-content space-y-4', contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

function getSettingsTab(tab: string | null, isAdmin: boolean): SettingsTab {
  if (
    tab === 'admin-overview' ||
    tab === 'admin-users' ||
    tab === 'admin-audit-log' ||
    tab === 'admin'
  ) {
    return isAdmin ? 'admin' : 'general';
  }

  if (tab && SETTINGS_TABS.has(tab as SettingsTab)) {
    return tab === 'admin' && !isAdmin ? 'general' : (tab as SettingsTab);
  }

  return 'general';
}

function getAdminSettingsTab(tab: string | null, adminTab: string | null): AdminSettingsTab {
  if (adminTab && ADMIN_SETTINGS_TABS.has(adminTab as AdminSettingsTab)) {
    return adminTab as AdminSettingsTab;
  }

  if (tab === 'admin-users') return 'users';
  if (tab === 'admin-audit-log') return 'audit-log';
  return 'overview';
}

function getGeneralSettingsTab(tab: string | null, sectionId?: string | null): GeneralSettingsTab {
  if (sectionId) {
    return GENERAL_SECTION_TO_TAB.get(sectionId) || 'workspace';
  }

  if (tab && GENERAL_SETTINGS_TAB_VALUES.has(tab as GeneralSettingsTab)) {
    return tab as GeneralSettingsTab;
  }

  return 'workspace';
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const configProvider = useMemo(() => 'claude' as const, []);
  const configQuery = useMemo(
    () => `provider=${encodeURIComponent(configProvider)}`,
    [configProvider]
  );
  const withProvider = useMemo(() => {
    return (endpoint: string) => `${endpoint}${endpoint.includes('?') ? '&' : '?'}${configQuery}`;
  }, [configQuery]);
  const activeTab = useMemo(
    () => getSettingsTab(searchParams.get('tab'), isAdmin),
    [isAdmin, searchParams]
  );
  const activeAdminTab = useMemo(
    () => getAdminSettingsTab(searchParams.get('tab'), searchParams.get('adminTab')),
    [searchParams]
  );
  const activeGeneralTab = useMemo(
    () => getGeneralSettingsTab(searchParams.get('generalTab'), searchParams.get('section')),
    [searchParams]
  );
  const handleSettingsTabChange = (value: string) => {
    const tab = value as SettingsTab;
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    next.delete('section');

    if (tab === 'admin') {
      next.set('adminTab', activeAdminTab);
      next.delete('generalTab');
    } else if (tab === 'general') {
      next.set('generalTab', activeGeneralTab);
      next.delete('adminTab');
    } else {
      next.delete('adminTab');
      next.delete('generalTab');
    }

    setSearchParams(next);
    setSettingsSearchQuery('');
  };
  const handleGeneralTabChange = (value: string) => {
    const generalTab = value as GeneralSettingsTab;
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'general');
    next.set('generalTab', generalTab);
    next.delete('adminTab');
    next.delete('section');
    setSearchParams(next);
    setSettingsSearchQuery('');
  };
  const handleAdminTabChange = (value: string) => {
    const adminTab = value as AdminSettingsTab;
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'admin');
    next.set('adminTab', adminTab);
    next.delete('generalTab');
    next.delete('section');
    setSearchParams(next);
    setSettingsSearchQuery('');
  };
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const { setBackgroundAnimation } = useAppearanceStore();
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getStoredTheme());
  const [currentBackgroundAnimation, setCurrentBackgroundAnimation] = useState<BackgroundAnimation>(
    () => getStoredBackgroundAnimation()
  );
  const [settingsSearchQuery, setSettingsSearchQuery] = useState('');
  const [newMcpServer, setNewMcpServer] = useState<{
    name: string;
    type: 'subprocess' | 'sse';
    command: string;
    url: string;
  }>({
    name: '',
    type: 'subprocess',
    command: '',
    url: '',
  });

  const [cliUpdateResults, setCliUpdateResults] = useState<CliProviderUpdateResult[] | null>(null);

  // Plugin editor state
  const [pluginEditorOpen, setPluginEditorOpen] = useState(false);
  const [pluginEditorMode, setPluginEditorMode] = useState<'create' | 'edit'>('create');
  const [editingPlugin, setEditingPlugin] = useState<{
    name: string;
    data: Record<string, unknown>;
  } | null>(null);

  // Marketplace browser state
  const [marketplaceBrowserOpen, setMarketplaceBrowserOpen] = useState(false);
  const [codexMarketplaceBrowserOpen, setCodexMarketplaceBrowserOpen] = useState(false);

  // Plugin search state
  const [pluginSearchQuery, setPluginSearchQuery] = useState('');
  const [codexPluginSearchQuery, setCodexPluginSearchQuery] = useState('');

  // GitHub token state
  const [githubTokenInput, setGithubTokenInput] = useState('');
  const [showGithubToken, setShowGithubToken] = useState(false);

  const [claudeApiDraft, setClaudeApiDraft] = useState({
    baseUrl: '',
    opusModel: '',
    sonnetModel: '',
    haikuModel: '',
  });
  const [claudeAuthTokenInput, setClaudeAuthTokenInput] = useState('');
  const [showClaudeAuthToken, setShowClaudeAuthToken] = useState(false);

  // Integration URL state (ComfyUI)
  const [comfyuiUrlInput, setComfyuiUrlInput] = useState('');
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordTransport, setDiscordTransport] = useState<DiscordAlertTransport>('bot');
  const [discordWebhookInput, setDiscordWebhookInput] = useState('');
  const [discordBotTokenInput, setDiscordBotTokenInput] = useState('');
  const [discordChannelIdInput, setDiscordChannelIdInput] = useState('');
  const [discordChannelLabelInput, setDiscordChannelLabelInput] = useState('');
  const [discordCriticalRoleIdInput, setDiscordCriticalRoleIdInput] = useState('');
  const [discordMinSeverity, setDiscordMinSeverity] = useState<DiscordAlertSeverity>('warning');
  const [discordGatewayMode, setDiscordGatewayMode] = useState<DiscordGatewayMode>('supervisor');
  const [discordMaintenancePolicy, setDiscordMaintenancePolicy] =
    useState<DiscordMaintenancePolicy>('session_mode');
  const [discordInboundJobsEnabled, setDiscordInboundJobsEnabled] = useState(false);
  // Result of the "Test connection" button next to ComfyUI URL.
  const [comfyuiTestResult, setComfyuiTestResult] = useState<{
    state: 'idle' | 'testing' | 'ok' | 'error';
    message?: string;
  }>({ state: 'idle' });
  const [oracleBrowserDraft, setOracleBrowserDraft] = useState<OracleBrowserSettings>({});
  const [oracleTestResult, setOracleTestResult] = useState<{
    state: 'idle' | 'testing' | 'ok' | 'error';
    message?: string;
    details?: OracleBrowserTestResult;
  }>({ state: 'idle' });

  // Basic auth credentials state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // MCP test state
  const [mcpTestResults, setMcpTestResults] = useState<
    Record<string, { testing: boolean; connected?: boolean; error?: string }>
  >({});

  // Fetch settings
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<UserSettings>>('/api/settings');
      return response.data.data;
    },
  });

  const { data: analyticsLimitHistory, isLoading: analyticsLimitHistoryLoading } = useQuery({
    queryKey: ['usage-limit-history', '90d', 'settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AnalyticsLimitHistoryData>>(
        '/api/usage/limit-history?range=90d&providers=codex,kimi,claude,zai'
      );
      return response.data.data;
    },
    enabled: activeTab === 'analytics',
    staleTime: 60_000,
  });

  // Fetch MCP servers
  const { data: mcpServers, isLoading: mcpLoading } = useQuery({
    queryKey: ['mcp-servers'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<McpServer[]>>('/api/mcp-servers');
      return response.data.data || [];
    },
    enabled: activeTab === 'extensions',
  });

  // Fetch OpenCode providers
  const { data: openCodeProviders, refetch: refetchOpenCodeProviders } = useQuery({
    queryKey: ['opencode-providers'],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data?: OpenCodeProvider[] }>(
        '/api/opencode/providers'
      );
      return response.data.data || [];
    },
    enabled:
      activeTab === 'api-keys' || (activeTab === 'general' && activeGeneralTab === 'opencode'),
  });

  // Fetch available OpenCode providers (with models)
  const { data: availableProviders } = useQuery({
    queryKey: ['opencode-available-providers'],
    queryFn: async () => {
      const response = await api.get<{
        success: boolean;
        data?: Record<string, OpenCodeAvailableProvider>;
      }>('/api/opencode/available-providers');
      return response.data.data || {};
    },
    enabled:
      activeTab === 'api-keys' || (activeTab === 'general' && activeGeneralTab === 'opencode'),
  });

  // Check Claude CLI status
  const { data: claudeStatus, refetch: refetchClaudeStatus } = useQuery({
    queryKey: ['claude-status'],
    queryFn: async () => {
      const response =
        await api.get<
          ApiResponse<{ installed: boolean; authenticated: boolean; version?: string }>
        >('/api/claude/status');
      return response.data.data;
    },
  });

  const {
    data: codexStatus,
    refetch: refetchCodexStatus,
    isFetching: isRefetchingCodex,
  } = useQuery({
    queryKey: ['codex-status'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CodexStatus>>('/api/codex/status');
      return response.data.data;
    },
  });

  const { data: codexFeatures, isLoading: codexFeaturesLoading } = useQuery({
    queryKey: ['codex-features'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CodexFeatureFlag[]>>('/api/codex/features');
      return response.data.data || [];
    },
    enabled: activeTab === 'general' || activeTab === 'diagnostics',
  });

  const { data: codexPlugins, isLoading: codexPluginsLoading } = useQuery({
    queryKey: ['codex-plugins'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CodexPluginInfo[]>>('/api/codex/plugins');
      return response.data.data || [];
    },
    enabled: activeTab === 'extensions',
  });

  const {
    data: providerDiagnostics,
    isLoading: providerDiagnosticsLoading,
    refetch: refetchProviderDiagnostics,
  } = useQuery({
    queryKey: ['provider-diagnostics'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<ProviderDiagnostic[]>>(
        '/api/cli-providers/diagnostics'
      );
      return response.data.data || [];
    },
    enabled: activeTab === 'diagnostics' || (activeTab === 'general' && activeGeneralTab === 'pi'),
  });

  // Fetch Claude agents from ~/.claude/agents/
  const { data: claudeAgents } = useQuery({
    queryKey: ['claude-agents', configProvider],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AgentInfo[]>>(
        withProvider('/api/claude-config/agents')
      );
      return response.data.data || [];
    },
    enabled: activeTab === 'extensions',
  });

  // Fetch Claude skills from ~/.claude/skills/
  const { data: claudeSkills } = useQuery({
    queryKey: ['claude-skills', configProvider],
    queryFn: async () => {
      const response = await api.get<ApiResponse<SkillInfo[]>>(
        withProvider('/api/claude-config/skills?library=all')
      );
      return response.data.data || [];
    },
    enabled: activeTab === 'extensions',
  });

  // Fetch installed plugins
  const { data: installedPlugins } = useQuery({
    queryKey: ['installed-plugins', configProvider],
    queryFn: async () => {
      const response = await api.get<ApiResponse<PluginInfo[]>>(
        withProvider('/api/claude-config/plugins')
      );
      return response.data.data || [];
    },
    enabled: activeTab === 'extensions',
  });

  // Fetch known marketplaces
  const { data: marketplaces } = useQuery({
    queryKey: ['marketplaces', configProvider],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<
          {
            id: string;
            name: string;
            source: { source: string; repo?: string; url?: string };
            lastUpdated: string;
            plugins?: { name: string; description: string; version: string }[];
          }[]
        >
      >(withProvider('/api/claude-config/marketplaces'));
      return response.data.data || [];
    },
    enabled: activeTab === 'extensions',
  });

  // Fetch GitHub token status
  const { data: githubTokenStatus, refetch: refetchGithubToken } = useQuery({
    queryKey: ['github-token'],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<{ hasToken: boolean; tokenPreview: string | null }>
      >('/api/settings/github-token');
      return response.data.data;
    },
    enabled: activeTab === 'api-keys',
  });

  const { data: claudeApiStatus, refetch: refetchClaudeApi } = useQuery({
    queryKey: ['zai-api'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<ClaudeApiStatus>>('/api/settings/zai-api');
      return response.data.data;
    },
    enabled: activeTab === 'general' && activeGeneralTab === 'zai',
  });

  // Fetch integration URL (ComfyUI)
  const { data: integrations, refetch: refetchIntegrations } = useQuery({
    queryKey: ['integrations'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<{ comfyuiUrl: string }>>(
        '/api/settings/integrations'
      );
      const data = response.data.data ?? { comfyuiUrl: '' };
      setComfyuiUrlInput(data.comfyuiUrl || '');
      return data;
    },
    enabled: activeTab === 'integrations',
  });

  const { data: homeAssistantSettings } = useQuery({
    queryKey: ['home-assistant-settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<HomeAssistantIntegrationSettings>>(
        '/api/home-assistant/settings'
      );
      return response.data.data;
    },
    enabled: activeTab === 'integrations',
  });

  const { data: discordSettings, refetch: refetchDiscordSettings } = useQuery({
    queryKey: ['discord-settings'],
    queryFn: async () => {
      const response =
        await api.get<ApiResponse<DiscordIntegrationSettings>>('/api/discord/settings');
      const data = response.data.data;
      if (data) {
        setDiscordEnabled(data.enabled);
        setDiscordTransport(data.transport);
        setDiscordChannelIdInput(data.channelId || '');
        setDiscordChannelLabelInput(data.channelLabel || '');
        setDiscordCriticalRoleIdInput(data.criticalRoleId || '');
        setDiscordMinSeverity(data.minSeverity);
        setDiscordGatewayMode(data.gatewayMode);
        setDiscordMaintenancePolicy(data.maintenancePolicy);
        setDiscordInboundJobsEnabled(data.inboundJobsEnabled);
      }
      return data;
    },
    enabled: activeTab === 'integrations',
  });

  // Fetch basic auth credentials info
  const { data: basicAuthCredentials, refetch: refetchBasicAuth } = useQuery({
    queryKey: ['basic-auth-credentials'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<{ username: string; enabled: boolean }>>(
        '/api/basic-auth/credentials'
      );
      return response.data.data;
    },
    enabled: activeTab === 'security',
  });

  useEffect(() => {
    setOracleBrowserDraft(settings?.oracleBrowser || {});
  }, [settings?.oracleBrowser]);

  useEffect(() => {
    if (!claudeApiStatus) return;
    setClaudeApiDraft({
      baseUrl: claudeApiStatus.baseUrl,
      opusModel: claudeApiStatus.opusModel,
      sonnetModel: claudeApiStatus.sonnetModel,
      haikuModel: claudeApiStatus.haikuModel,
    });
  }, [claudeApiStatus]);

  // Filter installed plugins based on search
  const filteredPlugins = useMemo(() => {
    if (!installedPlugins) return [];
    if (!pluginSearchQuery.trim()) return installedPlugins;

    const query = pluginSearchQuery.toLowerCase();
    return installedPlugins.filter(
      (plugin) =>
        plugin.name.toLowerCase().includes(query) ||
        plugin.description?.toLowerCase().includes(query) ||
        plugin.author?.toLowerCase().includes(query) ||
        plugin.category?.toLowerCase().includes(query) ||
        plugin.marketplace?.toLowerCase().includes(query)
    );
  }, [installedPlugins, pluginSearchQuery]);

  const { skillPackageCount, stylePresetCount } = useMemo(
    () => getSkillCatalogCounts(claudeSkills),
    [claudeSkills]
  );

  const filteredCodexPlugins = useMemo(() => {
    if (!codexPlugins) return [];
    const query = codexPluginSearchQuery.trim().toLowerCase();
    if (!query) return codexPlugins;

    return codexPlugins.filter(
      (plugin) =>
        plugin.displayName.toLowerCase().includes(query) ||
        plugin.name.toLowerCase().includes(query) ||
        plugin.description?.toLowerCase().includes(query) ||
        plugin.category?.toLowerCase().includes(query) ||
        plugin.marketplace.toLowerCase().includes(query)
    );
  }, [codexPlugins, codexPluginSearchQuery]);

  const enabledCodexPlugins = useMemo(
    () => (codexPlugins || []).filter((plugin) => plugin.enabled),
    [codexPlugins]
  );

  const codexFeatureGroups = useMemo(() => {
    const features = codexFeatures || [];
    return {
      stable: features.filter((feature) => feature.stage === 'stable'),
      experimental: features.filter((feature) => feature.stage !== 'stable'),
    };
  }, [codexFeatures]);

  const updateCliProvidersMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<CliProviderUpdateResponse>>(
        '/api/cli-providers/update',
        {}
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      const results = data?.results || [];
      setCliUpdateResults(results);

      const summary =
        results.length > 0
          ? results
              .map((result) => `${CLI_PROVIDER_LABEL[result.provider]}: ${result.status}`)
              .join(', ')
          : 'No update results returned.';
      const hasFailure = results.some((result) => result.status === 'failed');
      toast({
        title: 'CLI update finished',
        description: summary,
        variant: hasFailure ? 'destructive' : undefined,
      });
      refetchClaudeStatus();
      refetchCodexStatus();
      queryClient.invalidateQueries({ queryKey: ['cli-providers'] });
    },
    onError: (error: Error) => {
      toast({ title: 'CLI update failed', description: error.message, variant: 'destructive' });
    },
  });

  // Update settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<UserSettings>) => {
      const response = await api.put<ApiResponse<UserSettings>>('/api/settings', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['cli-providers'] });
      toast({ title: 'Settings saved' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const codexFeatureMutation = useMutation({
    mutationFn: async ({ name, enabled }: { name: string; enabled: boolean }) => {
      const response = await api.post<ApiResponse<CodexFeatureFlag[]>>(
        `/api/codex/features/${encodeURIComponent(name)}`,
        { enabled }
      );
      return response.data.data || [];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['codex-features'] });
      toast({ title: 'Codex feature updated' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Codex feature update failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const codexPluginMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const response = await api.post<ApiResponse<CodexPluginInfo[]>>(
        `/api/codex/plugins/${encodeURIComponent(id)}`,
        { enabled }
      );
      return response.data.data || [];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['codex-plugins'] });
      toast({
        title: 'Codex plugin updated',
        description: 'New Codex sessions will load the updated plugin set.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Codex plugin update failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Create MCP server mutation
  const createMcpMutation = useMutation({
    mutationFn: async (data: typeof newMcpServer) => {
      const response = await api.post<ApiResponse<McpServer>>('/api/mcp-servers', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
      setShowMcpForm(false);
      setNewMcpServer({ name: '', type: 'subprocess', command: '', url: '' });
      toast({ title: 'MCP server added' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete MCP server mutation
  const deleteMcpMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/mcp-servers/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
      toast({ title: 'MCP server deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Test MCP server connection
  const testMcpServer = async (serverId: string) => {
    setMcpTestResults((prev) => ({
      ...prev,
      [serverId]: { testing: true },
    }));

    try {
      const response = await api.post<ApiResponse<{ connected: boolean; error?: string }>>(
        `/api/mcp-servers/${serverId}/test`
      );
      const result = response.data.data;

      setMcpTestResults((prev) => ({
        ...prev,
        [serverId]: {
          testing: false,
          connected: result?.connected,
          error: result?.error,
        },
      }));

      if (result?.connected) {
        toast({ title: 'Connection successful', description: 'MCP server is responding' });
      } else {
        toast({
          title: 'Connection failed',
          description: result?.error || 'Could not connect to server',
          variant: 'destructive',
        });
      }
    } catch (error) {
      setMcpTestResults((prev) => ({
        ...prev,
        [serverId]: {
          testing: false,
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      }));
      toast({
        title: 'Test failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  // Delete plugin mutation
  const deletePluginMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(withProvider(`/api/claude-config/plugin/${encodeURIComponent(id)}`));
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installed-plugins', configProvider] });
      toast({ title: 'Plugin uninstalled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Toggle plugin mutation
  const togglePluginMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.put<ApiResponse<{ enabled: boolean }>>(
        withProvider(`/api/claude-config/plugin/${name}/toggle`)
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['installed-plugins', configProvider] });
      toast({ title: data?.enabled ? 'Plugin enabled' : 'Plugin disabled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Set GitHub token mutation
  const setGithubTokenMutation = useMutation({
    mutationFn: async (token: string) => {
      const response = await api.put<ApiResponse<{ hasToken: boolean; tokenPreview: string }>>(
        '/api/settings/github-token',
        { token }
      );
      return response.data.data;
    },
    onSuccess: () => {
      refetchGithubToken();
      setGithubTokenInput('');
      toast({ title: 'GitHub token saved' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete GitHub token mutation
  const deleteGithubTokenMutation = useMutation({
    mutationFn: async () => {
      await api.delete('/api/settings/github-token');
    },
    onSuccess: () => {
      refetchGithubToken();
      toast({ title: 'GitHub token removed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const saveClaudeApiMutation = useMutation({
    mutationFn: async () => {
      const response = await api.put<ApiResponse<ClaudeApiStatus>>('/api/settings/zai-api', {
        ...claudeApiDraft,
        ...(claudeAuthTokenInput.trim() ? { authToken: claudeAuthTokenInput.trim() } : {}),
      });
      return response.data.data;
    },
    onSuccess: () => {
      setClaudeAuthTokenInput('');
      refetchClaudeApi();
      queryClient.invalidateQueries({ queryKey: ['cli-providers'] });
      queryClient.invalidateQueries({ queryKey: ['usage-limits'] });
      toast({
        title: 'Z.AI Code saved',
        description: 'New and restarted Z.AI sessions will use this endpoint.',
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const resetClaudeApiMutation = useMutation({
    mutationFn: async () => {
      await api.delete('/api/settings/zai-api');
    },
    onSuccess: () => {
      setClaudeAuthTokenInput('');
      setClaudeApiDraft({ baseUrl: '', opusModel: '', sonnetModel: '', haikuModel: '' });
      refetchClaudeApi();
      queryClient.invalidateQueries({ queryKey: ['cli-providers'] });
      queryClient.invalidateQueries({ queryKey: ['usage-limits'] });
      toast({
        title: 'Z.AI configuration removed',
        description: 'Claude subscription sessions are unchanged.',
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Save integration URL mutation
  const saveIntegrationsMutation = useMutation({
    mutationFn: async (payload: { comfyuiUrl?: string }) => {
      const response = await api.put<ApiResponse<{ comfyuiUrl: string }>>(
        '/api/settings/integrations',
        payload
      );
      return response.data.data;
    },
    onSuccess: () => {
      refetchIntegrations();
      toast({
        title: 'Integrations saved',
        description: 'New sessions will use the updated URLs.',
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const saveDiscordSettingsMutation = useMutation({
    mutationFn: async (payload: DiscordIntegrationSettingsUpdate) => {
      const response = await api.put<ApiResponse<DiscordIntegrationSettings>>(
        '/api/discord/settings',
        payload
      );
      return response.data.data;
    },
    onSuccess: () => {
      setDiscordWebhookInput('');
      setDiscordBotTokenInput('');
      refetchDiscordSettings();
      queryClient.invalidateQueries({ queryKey: ['discord-outbox'] });
      toast({ title: 'Discord settings saved' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const testDiscordMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<DiscordTestResult>>('/api/discord/test');
      return response.data.data;
    },
    onSuccess: (result) => {
      refetchDiscordSettings();
      queryClient.invalidateQueries({ queryKey: ['discord-outbox'] });
      toast({
        title: result?.sent ? 'Discord test sent' : 'Discord test queued for retry',
        description:
          result?.error ||
          (result?.sent ? undefined : 'The message is in the Discord outbox and will be retried.'),
        variant: result?.sent ? 'default' : 'destructive',
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Discord test failed', description: error.message, variant: 'destructive' });
    },
  });

  // Update basic auth credentials mutation
  const updateBasicAuthMutation = useMutation({
    mutationFn: async (data: {
      currentPassword: string;
      newUsername?: string;
      newPassword?: string;
    }) => {
      const response = await api.put<ApiResponse<{ username: string; message: string }>>(
        '/api/basic-auth/credentials',
        data
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      refetchBasicAuth();
      setCurrentPassword('');
      setNewUsername('');
      setNewPassword('');
      setConfirmPassword('');
      toast({ title: 'Success', description: data?.message || 'Credentials updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Toggle basic auth mutation
  const toggleBasicAuthMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await api.put<ApiResponse<{ enabled: boolean; message: string }>>(
        '/api/basic-auth/toggle',
        { enabled }
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      refetchBasicAuth();
      toast({ title: data?.enabled ? 'Basic auth enabled' : 'Basic auth disabled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // OpenCode providers mutations
  const deleteOpenCodeProviderMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/opencode/providers/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opencode-providers'] });
      queryClient.invalidateQueries({ queryKey: ['opencode-available-providers'] });
      toast({ title: 'Provider deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const [testingOpenCodeProviderId, setTestingOpenCodeProviderId] = useState<string | null>(null);

  const testOpenCodeProvider = async (id: string) => {
    setTestingOpenCodeProviderId(id);
    try {
      const response = await api.post<
        ApiResponse<{
          connected: boolean;
          message: string;
          envVars?: string[];
          modelCount?: number;
        }>
      >(`/api/opencode/providers/${encodeURIComponent(id)}/test`);
      const result = response.data.data;
      toast({
        title: result?.connected ? 'Provider ready' : 'Provider not ready',
        description: result?.message || 'No response from OpenCode.',
        variant: result?.connected ? undefined : 'destructive',
      });
    } catch (error) {
      toast({
        title: 'Provider test failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setTestingOpenCodeProviderId(null);
    }
  };

  // OpenCode models state
  const [modelProviderId, setModelProviderId] = useState<string>('');
  const [modelModelId, setModelModelId] = useState<string>('');
  const openCodeModels = settings?.cliProviderModelLists?.opencode || [];
  const openCodeProviderById = useMemo(() => {
    const map = new Map<string, OpenCodeProvider>();
    for (const provider of openCodeProviders || []) {
      map.set(provider.id, provider);
    }
    return map;
  }, [openCodeProviders]);
  const piDiagnostic = useMemo(
    () => providerDiagnostics?.find((provider) => provider.id === 'pi'),
    [providerDiagnostics]
  );
  const piModelGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const model of piDiagnostic?.models || []) {
      const separatorIndex = model.indexOf('/');
      const providerId = separatorIndex > 0 ? model.slice(0, separatorIndex) : 'other';
      const providerModels = groups.get(providerId) || [];
      providerModels.push(model);
      groups.set(providerId, providerModels);
    }
    return Array.from(groups.entries());
  }, [piDiagnostic?.models]);
  const selectedModelProvider = modelProviderId ? availableProviders?.[modelProviderId] : undefined;
  const selectedStoredModelProvider = modelProviderId
    ? openCodeProviderById.get(modelProviderId)
    : undefined;

  const removeOpenCodeModel = (model: string) => {
    const current = openCodeModels || [];
    const updated = current.filter((m) => m !== model);
    updateSettingsMutation.mutate({
      cliProviderModelLists: {
        ...settings?.cliProviderModelLists,
        opencode: updated.length > 0 ? updated : undefined,
      },
    });
  };

  // OpenCode providers state
  const [openCodeProviderDialog, setOpenCodeProviderDialog] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [openCodeProviderForm, setOpenCodeProviderForm] = useState({
    id: '',
    name: '',
    apiKey: '',
    baseUrl: '',
  });
  const [showOpenCodeApiKey, setShowOpenCodeApiKey] = useState(false);

  const openOpenCodeProviderDialog = (providerId?: string) => {
    const stored = providerId ? openCodeProviderById.get(providerId) : undefined;
    const available = providerId ? availableProviders?.[providerId] : undefined;
    setSelectedProviderId(providerId || '');
    setOpenCodeProviderForm({
      id: providerId || '',
      name: stored?.name || available?.name || '',
      apiKey: '',
      baseUrl: stored?.baseUrl || available?.api || '',
    });
    setShowOpenCodeApiKey(false);
    setOpenCodeProviderDialog(true);
  };
  const dialogAvailableProvider = selectedProviderId
    ? availableProviders?.[selectedProviderId]
    : undefined;
  const dialogStoredProvider = selectedProviderId
    ? openCodeProviderById.get(selectedProviderId)
    : undefined;
  const dialogEnvVars = dialogStoredProvider?.envVars || dialogAvailableProvider?.env || [];

  const saveOpenCodeProvider = async () => {
    try {
      const response = await api.put<ApiResponse<OpenCodeProvider>>('/api/opencode/providers', {
        id: openCodeProviderForm.id,
        name: openCodeProviderForm.name,
        apiKey: openCodeProviderForm.apiKey || undefined,
        baseUrl: openCodeProviderForm.baseUrl || undefined,
        enabled: true,
      });

      if (response.data.success) {
        toast({ title: 'Provider erfolgreich gespeichert' });
        setOpenCodeProviderDialog(false);
        setSelectedProviderId('');
        setOpenCodeProviderForm({ id: '', name: '', apiKey: '', baseUrl: '' });
        refetchOpenCodeProviders();
        queryClient.invalidateQueries({ queryKey: ['opencode-available-providers'] });
      } else {
        toast({
          title: 'Error saving provider',
          description: response.data.error?.toString() || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (error: unknown) {
      console.error('Failed to save OpenCode provider:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to save provider';
      toast({ title: 'Error', description: errorMsg, variant: 'destructive' });
    }
  };

  const handleThemeChange = (theme: Theme) => {
    const nextTheme = normalizeTheme(theme);
    setStoredTheme(nextTheme);
    setCurrentTheme(nextTheme);
    applyTheme(nextTheme);
    // Appearance is device-local unless the user opted into syncing, in which
    // case the server copy has to follow along for the other clients.
    if (settings?.appearanceSync) {
      updateSettingsMutation.mutate({ theme: nextTheme });
    }
  };

  const handleBackgroundAnimationChange = (backgroundAnimation: BackgroundAnimation) => {
    setCurrentBackgroundAnimation(backgroundAnimation);
    setBackgroundAnimation(backgroundAnimation);
    if (settings?.appearanceSync) {
      updateSettingsMutation.mutate({ backgroundAnimation });
    }
  };

  /** Sends one sample notification through database, socket and web push. */
  const sendTestAlert = async () => {
    try {
      await api.post('/api/workspace/notifications/test', {});
      toast({ title: 'Test alert sent', description: 'Check the bell in the sidebar.' });
    } catch (error) {
      toast({
        title: 'Test alert failed',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const saveOracleBrowserSettings = () => {
    updateSettingsMutation.mutate({ oracleBrowser: oracleBrowserDraft });
  };

  const testOracleBrowserSettings = async () => {
    setOracleTestResult({ state: 'testing' });

    try {
      const response = await api.get<ApiResponse<OracleBrowserTestResult>>('/api/oracle/test');
      const data = response.data.data;
      setOracleTestResult({
        state: 'ok',
        message: data?.message || 'Oracle browser path looks good.',
        details: data || undefined,
      });
      toast({
        title: 'Oracle browser ready',
        description: data?.message || 'Oracle browser settings validated.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Oracle browser test failed';
      setOracleTestResult({ state: 'error', message });
      toast({
        title: 'Oracle browser test failed',
        description: message,
        variant: 'destructive',
      });
    }
  };

  const openPluginEditor = (mode: 'create' | 'edit', plugin?: PluginInfo) => {
    setPluginEditorMode(mode);
    if (plugin) {
      // Extract base name from dirPath
      const baseName = plugin.dirPath.split('/').pop()?.replace('.disabled', '') || plugin.name;
      setEditingPlugin({
        name: baseName,
        data: {
          name: plugin.name,
          description: plugin.description,
          version: plugin.version,
          author: plugin.author,
          category: plugin.category,
          content: '', // Will be fetched by the editor
        },
      });
    } else {
      setEditingPlugin(null);
    }
    setPluginEditorOpen(true);
  };

  const themeOptions = [
    { value: 'light' as Theme, label: 'Light', icon: Sun, description: 'Bright glass surface' },
    { value: 'dark' as Theme, label: 'Dark', icon: Moon, description: 'Graphite glass surface' },
    {
      value: 'system' as Theme,
      label: 'System',
      icon: Monitor,
      description: 'Follow device preference',
    },
    {
      value: 'eink' as Theme,
      label: 'E-Ink',
      icon: FileText,
      description: 'Static high-contrast grayscale',
    },
  ];

  const configuredOpenCodeProviders =
    openCodeProviders?.filter((provider) => provider.hasKey) || [];
  const configuredApiKeyCount =
    (githubTokenStatus?.hasToken ? 1 : 0) + configuredOpenCodeProviders.length;
  const healthyProviderCount =
    providerDiagnostics?.filter((provider) => provider.installed && provider.authenticated)
      .length || 0;
  const totalProviderCount = providerDiagnostics?.length || 0;
  const analyticsLimitMetricsByProvider = useMemo(() => {
    const byProvider = new Map<AnalyticsLimitProvider, Array<{ key: string; label: string }>>();
    ANALYTICS_LIMIT_PROVIDER_ORDER.forEach((provider) => byProvider.set(provider, []));
    const seen = new Set<string>();
    for (const point of analyticsLimitHistory?.points || []) {
      const identity = `${point.provider}\u001f${point.metricKey}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      byProvider.get(point.provider)?.push({ key: point.metricKey, label: point.metricLabel });
    }
    byProvider.forEach((metrics) => metrics.sort((a, b) => a.label.localeCompare(b.label)));
    return byProvider;
  }, [analyticsLimitHistory]);
  const analyticsHiddenLimitMetrics =
    settings?.analytics?.hiddenLimitMetrics ?? DEFAULT_ANALYTICS_HIDDEN_LIMIT_METRICS;
  const analyticsLimitMetricCount = Array.from(analyticsLimitMetricsByProvider.values()).reduce(
    (total, metrics) => total + metrics.length,
    0
  );
  const analyticsVisibleLimitMetricCount = Array.from(
    analyticsLimitMetricsByProvider.entries()
  ).reduce(
    (total, [provider, metrics]) =>
      total +
      metrics.filter((metric) => !analyticsHiddenLimitMetrics[provider]?.includes(metric.key))
        .length,
    0
  );
  const updateAnalyticsLimitMetricVisibility = (
    provider: AnalyticsLimitProvider,
    metricKey: string,
    visible: boolean
  ) => {
    const nextHidden = Object.fromEntries(
      ANALYTICS_LIMIT_PROVIDER_ORDER.map((item) => [
        item,
        [...(analyticsHiddenLimitMetrics[item] || [])],
      ])
    ) as Partial<Record<AnalyticsLimitProvider, string[]>>;
    const providerHidden = new Set(nextHidden[provider] || []);
    if (visible) providerHidden.delete(metricKey);
    else providerHidden.add(metricKey);
    nextHidden[provider] = [...providerHidden];
    updateSettingsMutation.mutate({ analytics: { hiddenLimitMetrics: nextHidden } });
  };

  const settingsNavItems = useMemo<SettingsNavItem[]>(() => {
    const items: SettingsNavItem[] = [
      {
        value: 'general',
        ...SETTINGS_TAB_DESCRIPTORS.general,
        badge: settings?.defaultWorkingDir ? 'Ready' : 'Needs setup',
        note: settings?.defaultWorkingDir
          ? settings.defaultWorkingDir
          : 'Set the default workspace, appearance, and tool policy first.',
        tone: settings?.defaultWorkingDir ? 'success' : 'warning',
      },
      {
        value: 'security',
        ...SETTINGS_TAB_DESCRIPTORS.security,
        badge: basicAuthCredentials?.enabled ? 'Protected' : 'Open',
        note: basicAuthCredentials?.enabled
          ? `Basic auth enabled for ${basicAuthCredentials.username || 'admin'}.`
          : 'No basic-auth gate is active before the login screen.',
        tone: basicAuthCredentials?.enabled ? 'success' : 'warning',
      },
      {
        value: 'analytics',
        ...SETTINGS_TAB_DESCRIPTORS.analytics,
        badge:
          analyticsLimitMetricCount > 0
            ? `${analyticsVisibleLimitMetricCount}/${analyticsLimitMetricCount}`
            : 'Defaults',
        note:
          analyticsLimitMetricCount > 0
            ? `${analyticsVisibleLimitMetricCount} provider limit curves visible in Analytics.`
            : 'Choose which provider limit curves appear in the combined graph.',
        tone: 'brand',
      },
      {
        value: 'api-keys',
        ...SETTINGS_TAB_DESCRIPTORS['api-keys'],
        badge: `${configuredApiKeyCount} saved`,
        note:
          configuredApiKeyCount > 0
            ? `${configuredOpenCodeProviders.length} OpenCode provider key${configuredOpenCodeProviders.length === 1 ? '' : 's'} plus GitHub credentials.`
            : 'No provider credentials stored yet.',
        tone: configuredApiKeyCount > 0 ? 'brand' : 'neutral',
      },
      {
        value: 'integrations',
        ...SETTINGS_TAB_DESCRIPTORS.integrations,
        badge:
          integrations?.comfyuiUrl ||
          discordSettings?.configured ||
          homeAssistantSettings?.configured
            ? 'Configured'
            : 'Pending',
        note: homeAssistantSettings?.configured
          ? `Home Assistant session lights ${homeAssistantSettings.enabled ? 'enabled' : 'configured'}.`
          : discordSettings?.configured
            ? `Discord alerts ${discordSettings.enabled ? 'enabled' : 'configured'} via ${discordSettings.transport === 'bot' ? 'bot token' : 'webhook'}.`
            : integrations?.comfyuiUrl
              ? integrations.comfyuiUrl
              : 'Add Home Assistant, ComfyUI, or Discord to unlock external workflows.',
        tone:
          integrations?.comfyuiUrl ||
          discordSettings?.configured ||
          homeAssistantSettings?.configured
            ? 'success'
            : 'warning',
      },
      {
        value: 'diagnostics',
        ...SETTINGS_TAB_DESCRIPTORS.diagnostics,
        badge: totalProviderCount > 0 ? `${healthyProviderCount}/${totalProviderCount}` : 'Idle',
        note:
          totalProviderCount > 0
            ? `${healthyProviderCount} provider${healthyProviderCount === 1 ? '' : 's'} fully ready right now.`
            : 'Run diagnostics to inspect CLI availability and auth state.',
        tone:
          totalProviderCount === 0
            ? 'neutral'
            : healthyProviderCount === totalProviderCount
              ? 'success'
              : 'warning',
      },
      {
        value: 'extensions',
        ...SETTINGS_TAB_DESCRIPTORS.extensions,
        badge: `${(mcpServers?.length || 0) + (installedPlugins?.length || 0) + (claudeSkills?.length || 0) + (claudeAgents?.length || 0)}`,
        note: `${mcpServers?.length || 0} MCP · ${claudeAgents?.length || 0} agents · ${skillPackageCount} skills · ${stylePresetCount} presets · ${installedPlugins?.length || 0} plugins`,
        tone:
          (mcpServers?.length || 0) +
            (installedPlugins?.length || 0) +
            (claudeSkills?.length || 0) >
          0
            ? 'brand'
            : 'neutral',
      },
    ];

    if (isAdmin) {
      items.push({
        value: 'admin',
        ...SETTINGS_TAB_DESCRIPTORS.admin,
        badge: 'Admin',
        note:
          activeAdminTab === 'overview'
            ? 'Instance health and high-level metrics.'
            : activeAdminTab === 'users'
              ? 'User management and roles.'
              : 'Recent audit trail for sensitive actions.',
        tone: 'brand',
      });
    }

    return items;
  }, [
    activeAdminTab,
    analyticsLimitMetricCount,
    analyticsVisibleLimitMetricCount,
    basicAuthCredentials?.enabled,
    basicAuthCredentials?.username,
    claudeAgents?.length,
    claudeSkills?.length,
    configuredApiKeyCount,
    configuredOpenCodeProviders.length,
    discordSettings?.configured,
    discordSettings?.enabled,
    discordSettings?.transport,
    healthyProviderCount,
    homeAssistantSettings?.configured,
    homeAssistantSettings?.enabled,
    installedPlugins?.length,
    skillPackageCount,
    stylePresetCount,
    integrations?.comfyuiUrl,
    isAdmin,
    mcpServers?.length,
    settings?.defaultWorkingDir,
    totalProviderCount,
  ]);

  const settingsNavGroups = useMemo<SettingsNavGroup[]>(() => {
    const byValue = new Map(settingsNavItems.map((item) => [item.value, item]));
    const groups: Array<{ label: string; values: SettingsTab[] }> = [
      { label: 'Essentials', values: ['general', 'security'] },
      { label: 'Insights', values: ['analytics'] },
      { label: 'Connections', values: ['api-keys', 'integrations'] },
      { label: 'System', values: ['diagnostics', 'extensions', 'admin'] },
    ];

    return groups
      .map((group) => ({
        label: group.label,
        items: group.values
          .map((value) => byValue.get(value))
          .filter((item): item is SettingsNavItem => Boolean(item)),
      }))
      .filter((group) => group.items.length > 0);
  }, [settingsNavItems]);

  const normalizedSettingsSearch = settingsSearchQuery.trim().toLowerCase();
  const settingsSearchResults = useMemo<SettingsSearchResult[]>(() => {
    if (!normalizedSettingsSearch) return [];

    const results: SettingsSearchResult[] = [];
    settingsNavItems.forEach((item) => {
      const tabHaystack = [
        item.label,
        item.eyebrow,
        item.description,
        item.badge,
        item.note,
        ...item.highlights,
      ]
        .join(' ')
        .toLowerCase();

      if (tabHaystack.includes(normalizedSettingsSearch)) {
        results.push({
          key: item.value,
          tab: item.value,
          label: item.label,
          context: item.description,
          icon: item.icon,
        });
      }

      item.sections.forEach((section) => {
        const sectionHaystack = `${item.label} ${section.label}`.toLowerCase();
        if (sectionHaystack.includes(normalizedSettingsSearch)) {
          results.push({
            key: `${item.value}-${section.id}`,
            tab: item.value,
            sectionId: section.id,
            label: section.label,
            context: item.label,
            icon: item.icon,
          });
        }
      });
    });

    return results.slice(0, 8);
  }, [normalizedSettingsSearch, settingsNavItems]);

  const handleSettingsDestination = (tab: SettingsTab, sectionId?: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);

    if (tab === 'admin') {
      next.set('adminTab', (sectionId as AdminSettingsTab | undefined) || activeAdminTab);
      next.delete('section');
      next.delete('generalTab');
    } else {
      next.delete('adminTab');
      if (tab === 'general') {
        next.set(
          'generalTab',
          sectionId ? getGeneralSettingsTab(null, sectionId) : activeGeneralTab
        );
      } else {
        next.delete('generalTab');
      }
      if (sectionId) {
        next.set('section', sectionId);
      } else {
        next.delete('section');
      }
    }

    setSearchParams(next);
    setSettingsSearchQuery('');
  };

  useEffect(() => {
    const hashSection = location.hash.startsWith('#')
      ? decodeURIComponent(location.hash.slice(1))
      : '';
    const sectionId = searchParams.get('section') || hashSection;
    if (!sectionId || activeTab === 'admin') return;

    const scrollToSection = () => {
      window.requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({
          // Re-run after async query/layout milestones below; smooth scrolling
          // would let later layout shifts interrupt the correction.
          behavior: 'auto',
          block: 'start',
          inline: 'nearest',
        });
      });
    };
    const timeoutIds = [0, 150, 500, 1_200].map((delay) =>
      window.setTimeout(scrollToSection, delay)
    );

    return () => timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
  }, [
    activeTab,
    claudeAgents?.length,
    claudeSkills?.length,
    codexPlugins?.length,
    installedPlugins?.length,
    location.hash,
    mcpServers?.length,
    searchParams,
  ]);

  if (settingsLoading || mcpLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loader" />
      </div>
    );
  }

  return (
    <div className="settings-shell glass-page settings-dashboard min-h-screen">
      <div className="settings-dashboard-inner w-full px-3 pb-12 sm:px-4 xl:px-6 2xl:px-8">
        <Tabs
          value={activeTab}
          onValueChange={handleSettingsTabChange}
          className="settings-app-grid"
        >
          <aside className="settings-sidebar-panel">
            <div className="settings-sidebar-header">
              <div className="settings-app-icon">
                <Settings2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="settings-overline">Settings</p>
                <h1 className="truncate text-xl font-semibold tracking-tight">Plum</h1>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => refetchCodexStatus()}
                disabled={isRefetchingCodex}
                className="h-9 w-9 shrink-0 rounded-full"
                title="Refresh Codex status"
              >
                <RefreshCw className={cn('h-4 w-4', isRefetchingCodex && 'animate-spin')} />
              </Button>
            </div>

            <div className="settings-search-field">
              <Search className="settings-search-icon h-4 w-4" />
              <Input
                value={settingsSearchQuery}
                onChange={(event) => setSettingsSearchQuery(event.target.value)}
                placeholder="Search settings"
                className="settings-search-input"
              />
              {settingsSearchQuery && (
                <button
                  type="button"
                  onClick={() => setSettingsSearchQuery('')}
                  className="settings-search-clear"
                  aria-label="Clear settings search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {settingsSearchQuery && (
              <div className="settings-search-results">
                {settingsSearchResults.length > 0 ? (
                  settingsSearchResults.map((result) => {
                    const ResultIcon = result.icon;
                    return (
                      <button
                        type="button"
                        key={result.key}
                        onClick={() => handleSettingsDestination(result.tab, result.sectionId)}
                        className="settings-search-result"
                      >
                        <span className="settings-search-result-icon">
                          <ResultIcon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{result.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {result.context}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </button>
                    );
                  })
                ) : (
                  <div className="settings-search-empty">No settings match that search.</div>
                )}
              </div>
            )}

            <TabsList className="settings-tabs-list" aria-label="Settings categories">
              {settingsNavGroups.map((group) => (
                <div key={group.label} className="settings-nav-group">
                  <p className="settings-nav-group-label">{group.label}</p>
                  {group.items.map((item) => {
                    const Icon = item.icon;

                    return (
                      <TabsTrigger
                        key={item.value}
                        value={item.value}
                        className={cn('settings-tab-trigger', `is-${item.tone}`)}
                      >
                        <span className="settings-tab-trigger-icon">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="settings-tab-trigger-copy">
                          <span className="settings-tab-trigger-top">
                            <span className="settings-tab-trigger-label">{item.label}</span>
                            <span className="settings-tab-trigger-badge">{item.badge}</span>
                          </span>
                          <span className="settings-tab-trigger-note">{item.note}</span>
                        </span>
                        <ChevronRight className="settings-tab-trigger-chevron h-4 w-4" />
                      </TabsTrigger>
                    );
                  })}
                </div>
              ))}
            </TabsList>

            <div className="settings-sidebar-footer">
              <div className="settings-sidebar-stat">
                <span>Codex</span>
                <strong>{codexStatus?.authenticated ? 'Ready' : 'Login needed'}</strong>
              </div>
              <div className="settings-sidebar-stat">
                <span>Extensions</span>
                <strong>
                  {(claudeAgents?.length || 0) +
                    (claudeSkills?.length || 0) +
                    (installedPlugins?.length || 0)}
                </strong>
              </div>
              <div className="settings-sidebar-stat">
                <span>Providers</span>
                <strong>
                  {totalProviderCount > 0
                    ? `${healthyProviderCount}/${totalProviderCount}`
                    : 'Idle'}
                </strong>
              </div>
            </div>

            {!codexStatus?.authenticated && codexStatus?.installed && (
              <Button onClick={() => handleGeneralTabChange('codex')} size="sm" className="w-full">
                Open Codex login
              </Button>
            )}
          </aside>

          <main className="settings-detail-column">
            <div className="settings-content-surface">
              {/* Security Tab */}
              <TabsContent value="security" className="settings-pane-rail mt-0">
                <>
                  <SettingsPanel
                    id="login-protection"
                    eyebrow="Gate"
                    title="Login Protection"
                    description="Put a password wall in front of the OAuth/login screen when Plum is exposed beyond a private network."
                    action={
                      <Button
                        variant={basicAuthCredentials?.enabled ? 'default' : 'outline'}
                        size="sm"
                        onClick={() =>
                          toggleBasicAuthMutation.mutate(!basicAuthCredentials?.enabled)
                        }
                        disabled={toggleBasicAuthMutation.isPending}
                        className="gap-2"
                      >
                        {basicAuthCredentials?.enabled ? (
                          <>
                            <ToggleRight className="h-4 w-4" />
                            Enabled
                          </>
                        ) : (
                          <>
                            <ToggleLeft className="h-4 w-4" />
                            Disabled
                          </>
                        )}
                      </Button>
                    }
                    className={cn(
                      basicAuthCredentials?.enabled
                        ? 'border-green-500/30 bg-green-500/5'
                        : 'border-border/70'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'rounded-lg p-2',
                          basicAuthCredentials?.enabled
                            ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        <Lock className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {basicAuthCredentials?.enabled
                            ? 'Password protection is active'
                            : 'Password protection is disabled'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Current username:{' '}
                          <span className="font-mono">
                            {basicAuthCredentials?.username || 'admin'}
                          </span>
                        </p>
                      </div>
                    </div>

                    {basicAuthCredentials?.enabled ? (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                        <AlertCircle className="mr-2 inline h-4 w-4" />
                        Users must enter the password before reaching the provider login screen.
                      </div>
                    ) : (
                      <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm text-muted-foreground">
                        Anyone who can reach the WebUI can continue to the normal login flow.
                      </div>
                    )}
                  </SettingsPanel>

                  <SettingsPanel
                    id="change-credentials"
                    eyebrow="Credentials"
                    title="Change Credentials"
                    description="Rotate the username or password used by the basic-auth gate."
                  >
                    {/* Current Password */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Current Password *</label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type={showCurrentPassword ? 'text' : 'password'}
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="Enter current password"
                          className="pl-10 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                        >
                          {showCurrentPassword ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* New Username */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium">New Username</label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            type="text"
                            value={newUsername}
                            onChange={(e) => setNewUsername(e.target.value)}
                            placeholder="Leave empty to keep current"
                            className="pl-10"
                          />
                        </div>
                      </div>

                      {/* New Password */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium">New Password</label>
                        <div className="relative">
                          <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            type={showNewPassword ? 'text' : 'password'}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Leave empty to keep current"
                            className="pl-10 pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                          >
                            {showNewPassword ? (
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Confirm Password */}
                    {newPassword && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Confirm New Password</label>
                        <div className="relative">
                          <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            type={showNewPassword ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirm new password"
                            className={cn(
                              'pl-10',
                              confirmPassword &&
                                newPassword !== confirmPassword &&
                                'border-destructive'
                            )}
                          />
                        </div>
                        {confirmPassword && newPassword !== confirmPassword && (
                          <p className="text-xs text-destructive">Passwords do not match</p>
                        )}
                      </div>
                    )}

                    <Button
                      onClick={() => {
                        if (newPassword && newPassword !== confirmPassword) {
                          toast({
                            title: 'Error',
                            description: 'Passwords do not match',
                            variant: 'destructive',
                          });
                          return;
                        }
                        updateBasicAuthMutation.mutate({
                          currentPassword,
                          newUsername: newUsername || undefined,
                          newPassword: newPassword || undefined,
                        });
                      }}
                      disabled={
                        !currentPassword ||
                        (!newUsername && !newPassword) ||
                        (newPassword && newPassword !== confirmPassword) ||
                        updateBasicAuthMutation.isPending
                      }
                    >
                      {updateBasicAuthMutation.isPending ? 'Updating...' : 'Update Credentials'}
                    </Button>
                  </SettingsPanel>
                </>
              </TabsContent>

              {/* General Tab */}
              <TabsContent value="general" className="settings-pane-rail mt-0">
                <>
                  <Tabs
                    value={activeGeneralTab}
                    onValueChange={handleGeneralTabChange}
                    className="settings-general-subtabs"
                  >
                    <TabsList
                      className="settings-general-tabs-list"
                      aria-label="General settings sections"
                    >
                      {GENERAL_SETTINGS_TABS.map((tab) => {
                        const Icon = tab.icon;
                        return (
                          <TabsTrigger
                            key={tab.value}
                            value={tab.value}
                            className="settings-general-tab-trigger"
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">
                                {tab.label}
                              </span>
                              <span className="block truncate text-[11px] font-medium text-muted-foreground">
                                {tab.description}
                              </span>
                            </span>
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>

                    <TabsContent value="workspace" className="settings-general-pane mt-0">
                      <div className="settings-pane-column">
                        <SettingsPanel
                          id="active-providers"
                          eyebrow="Runtime"
                          title="Active providers"
                          description="Choose which providers appear when creating or switching sessions. Existing sessions remain visible."
                        >
                          <div className="grid gap-2 sm:grid-cols-2">
                            {ACTIVATABLE_CLI_PROVIDERS.map((provider) => {
                              const enabledProviders =
                                settings?.enabledCliProviders ??
                                ACTIVATABLE_CLI_PROVIDERS.map((item) => item.id);
                              const enabled = enabledProviders.includes(provider.id);
                              const lastEnabled = enabled && enabledProviders.length === 1;
                              return (
                                <div
                                  key={provider.id}
                                  className="flex items-center gap-3 rounded-lg border border-border/70 bg-card/50 p-3"
                                >
                                  <ProviderLogo
                                    provider={toUiProvider(provider.id)}
                                    className="h-8 w-8"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium">
                                      {CLI_PROVIDER_LABEL[provider.id]}
                                    </p>
                                    <p className="truncate text-xs text-muted-foreground">
                                      {provider.description}
                                    </p>
                                  </div>
                                  {provider.id === 'kimi' && (
                                    <CliDeviceLoginDialog
                                      provider="kimi"
                                      triggerClassName="h-8 px-3 text-xs"
                                    />
                                  )}
                                  <Switch
                                    checked={enabled}
                                    disabled={lastEnabled || updateSettingsMutation.isPending}
                                    aria-label={`${enabled ? 'Disable' : 'Enable'} ${CLI_PROVIDER_LABEL[provider.id]}`}
                                    onCheckedChange={(checked) => {
                                      const next = checked
                                        ? [...enabledProviders, provider.id]
                                        : enabledProviders.filter((id) => id !== provider.id);
                                      updateSettingsMutation.mutate({
                                        enabledCliProviders: [...new Set(next)],
                                      });
                                    }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Claude Code uses your Anthropic subscription. Z.AI has separate
                            credentials and can run at the same time in another session.
                          </p>
                        </SettingsPanel>

                        <SettingsPanel
                          id="default-directory"
                          eyebrow="Workspace"
                          title="Default Directory"
                          description="The base folder Plum starts in for new sessions across every CLI provider."
                        >
                          <div className="settings-directory-row flex gap-2">
                            <div className="settings-field-icon-bubble">
                              <FolderOpen className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <Input
                              value={settings?.defaultWorkingDir || ''}
                              onChange={(e) =>
                                updateSettingsMutation.mutate({
                                  defaultWorkingDir: e.target.value || null,
                                })
                              }
                              placeholder="/home/user/projects"
                              className="settings-path-input h-10 flex-1 font-mono text-sm"
                            />
                            <Button
                              variant="secondary"
                              size="icon"
                              onClick={() => setShowFolderBrowser(true)}
                              className="h-10 w-10 shrink-0"
                            >
                              <FolderSearch className="h-4 w-4" />
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Shared across all providers and reused whenever you create a new
                            session.
                          </p>
                        </SettingsPanel>

                        {/* CLI Updates */}
                        <section id="cli-updates">
                          <Card className="settings-utility-card border border-border/70">
                            <CardHeader className="settings-utility-card-header flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                              <div className="space-y-1">
                                <CardTitle className="text-base">CLI Updates</CardTitle>
                                <CardDescription>
                                  Update Claude, Codex, and OpenCode CLI tools.
                                </CardDescription>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => updateCliProvidersMutation.mutate()}
                                disabled={updateCliProvidersMutation.isPending}
                              >
                                {updateCliProvidersMutation.isPending
                                  ? 'Updating...'
                                  : 'Update CLI tools'}
                              </Button>
                            </CardHeader>
                            {cliUpdateResults && (
                              <CardContent className="space-y-3">
                                <div className="grid gap-2 text-sm">
                                  {cliUpdateResults.map((result) => (
                                    <div
                                      key={result.provider}
                                      className="flex items-center justify-between"
                                    >
                                      <span className="font-medium">
                                        {CLI_PROVIDER_LABEL[result.provider]}
                                      </span>
                                      <span
                                        className={cn(
                                          'text-xs font-semibold uppercase tracking-wide',
                                          result.status === 'updated'
                                            ? 'text-green-600 dark:text-green-400'
                                            : 'text-red-600 dark:text-red-400'
                                        )}
                                      >
                                        {result.status}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                                <pre className="max-h-64 overflow-auto rounded-lg border border-border/70 bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap">
                                  {cliUpdateResults
                                    .map((result) => {
                                      const label = CLI_PROVIDER_LABEL[result.provider];
                                      const output = result.output || 'No output.';
                                      return `# ${label} (${result.status})\n${output}`;
                                    })
                                    .join('\n\n')}
                                </pre>
                              </CardContent>
                            )}
                          </Card>
                        </section>
                      </div>
                    </TabsContent>

                    {/* Codex CLI */}
                    <TabsContent value="logins" className="settings-general-pane mt-0">
                      <div className="settings-pane-column">
                        <SettingsPanel
                          id="provider-logins"
                          eyebrow="Access"
                          title="Provider logins"
                          description="Harness sign-in, API endpoints, and Antigravity — each with the method it actually uses."
                        >
                          <ProviderLoginsPanel />
                        </SettingsPanel>
                      </div>
                    </TabsContent>

                    <TabsContent value="codex" className="settings-general-pane mt-0">
                      <div className="settings-pane-column">
                        <section id="codex-cli">
                          <Card className="border border-border/70">
                            <CardHeader>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <CardTitle className="text-base">Codex CLI</CardTitle>
                                  <CardDescription>
                                    Control Codex-specific workflows used by chat sessions.
                                  </CardDescription>
                                </div>
                                <div
                                  className={cn(
                                    'rounded-full px-2.5 py-1 text-xs font-medium',
                                    codexStatus?.authenticated
                                      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                  )}
                                >
                                  {codexStatus?.authenticated
                                    ? codexStatus.authMode === 'chatgpt'
                                      ? 'ChatGPT auth'
                                      : 'API key auth'
                                    : 'Not authenticated'}
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-5">
                              <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                                <div className="space-y-1">
                                  <p className="text-sm font-medium">Runtime</p>
                                  <p className="text-xs text-muted-foreground">
                                    {codexStatus?.installed
                                      ? `${codexStatus.version || 'Codex installed'} · ${codexStatus.configHome}`
                                      : 'Codex CLI is not available in the WebUI container.'}
                                  </p>
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <CliDeviceLoginDialog
                                    provider="codex"
                                    authenticated={codexStatus?.authenticated}
                                    disabled={!codexStatus?.installed}
                                    onCompleted={() => refetchCodexStatus()}
                                    triggerClassName="gap-2"
                                  />
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => refetchCodexStatus()}
                                    disabled={isRefetchingCodex}
                                    className="gap-2"
                                  >
                                    <RefreshCw
                                      className={cn(
                                        'h-3.5 w-3.5',
                                        isRefetchingCodex && 'animate-spin'
                                      )}
                                    />
                                    Refresh
                                  </Button>
                                </div>
                              </div>

                              <div className="grid gap-3 md:grid-cols-[1fr_260px] md:items-center">
                                <div>
                                  <p className="text-sm font-medium">Web search</p>
                                  <p className="text-xs text-muted-foreground">
                                    Applied to the next Codex turn via <code>web_search</code>{' '}
                                    config override.
                                  </p>
                                </div>
                                <Select
                                  value={settings?.codexWebSearch || 'auto'}
                                  onValueChange={(value) =>
                                    updateSettingsMutation.mutate({
                                      codexWebSearch: value as UserSettings['codexWebSearch'],
                                    })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="auto">Auto</SelectItem>
                                    <SelectItem value="cached">Cached</SelectItem>
                                    <SelectItem value="live">Live</SelectItem>
                                    <SelectItem value="disabled">Disabled</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-3 border-t pt-4">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium">Feature flags</p>
                                    <p className="text-xs text-muted-foreground">
                                      Mirrors <code>codex features list</code>; toggles persist to{' '}
                                      <code>~/.codex/config.toml</code>.
                                    </p>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      queryClient.invalidateQueries({
                                        queryKey: ['codex-features'],
                                      })
                                    }
                                    disabled={codexFeaturesLoading}
                                  >
                                    <RefreshCw
                                      className={cn(
                                        'h-3.5 w-3.5',
                                        codexFeaturesLoading && 'animate-spin'
                                      )}
                                    />
                                  </Button>
                                </div>

                                {codexFeaturesLoading ? (
                                  <div className="text-sm text-muted-foreground">
                                    Loading feature flags...
                                  </div>
                                ) : (
                                  <div className="grid gap-2 md:grid-cols-2">
                                    {[
                                      ...codexFeatureGroups.stable,
                                      ...codexFeatureGroups.experimental,
                                    ]
                                      .filter((feature) => feature.stage !== 'removed')
                                      .slice(0, 24)
                                      .map((feature) => (
                                        <button
                                          type="button"
                                          key={feature.name}
                                          onClick={() =>
                                            codexFeatureMutation.mutate({
                                              name: feature.name,
                                              enabled: !feature.enabled,
                                            })
                                          }
                                          disabled={
                                            codexFeatureMutation.isPending ||
                                            feature.stage === 'deprecated' ||
                                            feature.stage === 'removed'
                                          }
                                          className={cn(
                                            'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                                            feature.enabled
                                              ? 'border-green-500/25 bg-green-500/5'
                                              : 'border-border bg-card hover:border-primary/30'
                                          )}
                                        >
                                          {feature.enabled ? (
                                            <ToggleRight className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                                          ) : (
                                            <ToggleLeft className="h-5 w-5 shrink-0 text-muted-foreground" />
                                          )}
                                          <span className="min-w-0 flex-1">
                                            <span className="block truncate text-xs font-medium">
                                              {feature.name}
                                            </span>
                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                              {feature.stage}
                                            </span>
                                          </span>
                                        </button>
                                      ))}
                                  </div>
                                )}
                              </div>

                              <div className="space-y-3 border-t pt-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-medium">Codex plugins</p>
                                    <p className="text-xs text-muted-foreground">
                                      Writes official Codex plugin flags to{' '}
                                      <code>~/.codex/config.toml</code>. Start a new chat after
                                      changes.
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setCodexMarketplaceBrowserOpen(true)}
                                      className="h-8 gap-1.5 text-xs"
                                    >
                                      <Store className="h-3.5 w-3.5" />
                                      Marketplace
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        queryClient.invalidateQueries({
                                          queryKey: ['codex-plugins'],
                                        })
                                      }
                                      disabled={codexPluginsLoading}
                                    >
                                      <RefreshCw
                                        className={cn(
                                          'h-3.5 w-3.5',
                                          codexPluginsLoading && 'animate-spin'
                                        )}
                                      />
                                    </Button>
                                  </div>
                                </div>

                                {(codexPlugins?.length || 0) > 6 && (
                                  <div className="relative">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                      value={codexPluginSearchQuery}
                                      onChange={(event) =>
                                        setCodexPluginSearchQuery(event.target.value)
                                      }
                                      placeholder="Search Codex plugins..."
                                      className="h-9 pl-9 pr-9 text-sm"
                                    />
                                    {codexPluginSearchQuery && (
                                      <button
                                        type="button"
                                        onClick={() => setCodexPluginSearchQuery('')}
                                        className="absolute right-3 top-1/2 rounded p-0.5 -translate-y-1/2 hover:bg-muted"
                                      >
                                        <X className="h-4 w-4 text-muted-foreground" />
                                      </button>
                                    )}
                                  </div>
                                )}

                                {codexPluginsLoading ? (
                                  <div className="text-sm text-muted-foreground">
                                    Loading Codex plugins...
                                  </div>
                                ) : filteredCodexPlugins.length > 0 ? (
                                  <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                                    {filteredCodexPlugins.map((plugin) => {
                                      const nextEnabled = !plugin.enabled;
                                      const actionLabel = plugin.enabled
                                        ? 'Disable'
                                        : plugin.installed
                                          ? 'Enable'
                                          : 'Install';
                                      return (
                                        <div
                                          key={plugin.id}
                                          className={cn(
                                            'flex min-h-[104px] gap-3 rounded-lg border p-3 transition-colors',
                                            plugin.enabled
                                              ? 'border-green-500/25 bg-green-500/5'
                                              : 'border-border bg-card'
                                          )}
                                        >
                                          <div
                                            className={cn(
                                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                                              plugin.enabled
                                                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                                : 'bg-muted text-muted-foreground'
                                            )}
                                          >
                                            <Puzzle className="h-4 w-4" />
                                          </div>
                                          <div className="min-w-0 flex-1 space-y-2">
                                            <div className="flex items-start justify-between gap-2">
                                              <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold">
                                                  {plugin.displayName}
                                                </p>
                                                <p className="truncate text-[11px] text-muted-foreground">
                                                  {plugin.name}@{plugin.marketplace}
                                                </p>
                                              </div>
                                              <Button
                                                variant={plugin.enabled ? 'outline' : 'default'}
                                                size="sm"
                                                onClick={() =>
                                                  codexPluginMutation.mutate({
                                                    id: plugin.id,
                                                    enabled: nextEnabled,
                                                  })
                                                }
                                                disabled={codexPluginMutation.isPending}
                                                className="h-7 shrink-0 px-2 text-xs"
                                              >
                                                {actionLabel}
                                              </Button>
                                            </div>
                                            <p className="line-clamp-2 text-xs text-muted-foreground">
                                              {plugin.description || 'No description'}
                                            </p>
                                            <div className="flex flex-wrap gap-1">
                                              <span
                                                className={cn(
                                                  'rounded px-1.5 py-0.5 text-[10px]',
                                                  plugin.enabled
                                                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                                    : plugin.installed
                                                      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                                      : 'bg-muted text-muted-foreground'
                                                )}
                                              >
                                                {plugin.enabled
                                                  ? 'Enabled'
                                                  : plugin.installed
                                                    ? 'Installed'
                                                    : 'Available'}
                                              </span>
                                              {plugin.category && (
                                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                                  {plugin.category}
                                                </span>
                                              )}
                                              {plugin.connectors &&
                                                plugin.connectors.length > 0 && (
                                                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                                    {plugin.connectors.length} connector
                                                    {plugin.connectors.length === 1 ? '' : 's'}
                                                  </span>
                                                )}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                                    No Codex plugins found.
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </section>
                      </div>
                    </TabsContent>

                    {/* Claude Code subscription */}
                    <TabsContent value="claude" className="settings-general-pane mt-0">
                      <div className="settings-pane-column">
                        <section id="claude-cli">
                          <Card className="border border-border/70">
                            <CardHeader>
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <CardTitle className="text-base">Claude Code</CardTitle>
                                  <CardDescription>
                                    Anthropic subscription sessions, isolated from Z.AI credentials.
                                  </CardDescription>
                                </div>
                                <div
                                  className={cn(
                                    'w-fit rounded-full px-2.5 py-1 text-xs font-medium',
                                    claudeStatus?.authenticated
                                      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                  )}
                                >
                                  {claudeStatus?.authenticated
                                    ? 'Subscription connected'
                                    : 'Login required'}
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-5">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-lg border border-border/70 bg-card/50 p-4">
                                  <p className="text-sm font-medium">Authentication</p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {claudeStatus?.installed
                                      ? `${claudeStatus.version || 'Claude Code installed'} · uses the saved Anthropic subscription`
                                      : 'Claude Code CLI is not installed in the WebUI container.'}
                                  </p>
                                </div>
                                <div className="rounded-lg border border-border/70 bg-card/50 p-4">
                                  <p className="text-sm font-medium">Credential isolation</p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Z.AI endpoint variables and API tokens are removed from every
                                    Claude subscription process.
                                  </p>
                                </div>
                              </div>
                              <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-xs text-muted-foreground">
                                  Claude and Z.AI sessions can run concurrently because each process
                                  receives its own provider environment.
                                </p>
                                <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                                  <CliDeviceLoginDialog
                                    provider="claude"
                                    authenticated={claudeStatus?.authenticated}
                                    disabled={!claudeStatus?.installed}
                                    onCompleted={() => refetchClaudeStatus()}
                                    triggerClassName="gap-2"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => refetchClaudeStatus()}
                                    className="gap-2"
                                  >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    Refresh status
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </section>
                      </div>
                    </TabsContent>

                    {/* Z.AI Code */}
                    <TabsContent value="zai" className="settings-general-pane mt-0">
                      <div className="settings-pane-column">
                        <section id="zai-cli">
                          <Card className="border border-border/70">
                            <CardHeader>
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <CardTitle className="text-base">Z.AI Code</CardTitle>
                                  <CardDescription>
                                    Configure Z.AI independently from Claude subscription sessions.
                                  </CardDescription>
                                </div>
                                <div
                                  className={cn(
                                    'w-fit rounded-full px-2.5 py-1 text-xs font-medium',
                                    claudeApiStatus?.configured
                                      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                      : 'bg-muted text-muted-foreground'
                                  )}
                                >
                                  {claudeApiStatus?.configured
                                    ? 'Z.AI configured'
                                    : 'Not configured'}
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-5">
                              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="space-y-1">
                                    <p className="text-sm font-medium">Z.AI GLM Coding Plan</p>
                                    <p className="text-xs text-muted-foreground">
                                      Uses Z.AI's Anthropic-compatible Claude Code endpoint. Model
                                      mappings stay optional.
                                    </p>
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      setClaudeApiDraft((current) => ({
                                        ...current,
                                        baseUrl: 'https://api.z.ai/api/anthropic',
                                      }))
                                    }
                                    className="shrink-0 gap-2"
                                  >
                                    <Zap className="h-3.5 w-3.5" />
                                    Use Z.AI endpoint
                                  </Button>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <label
                                  className="text-sm font-medium"
                                  htmlFor="claude-api-base-url"
                                >
                                  API base URL
                                </label>
                                <div className="relative">
                                  <Globe2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                  <Input
                                    id="claude-api-base-url"
                                    type="url"
                                    value={claudeApiDraft.baseUrl}
                                    onChange={(event) =>
                                      setClaudeApiDraft((current) => ({
                                        ...current,
                                        baseUrl: event.target.value,
                                      }))
                                    }
                                    placeholder="https://api.example.com/anthropic"
                                    className="pl-10 font-mono text-sm"
                                  />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Saved as <code>ANTHROPIC_BASE_URL</code>. HTTPS and
                                  private-network HTTP endpoints are both accepted for Z.AI
                                  sessions.
                                </p>
                              </div>

                              <div className="space-y-2">
                                <label className="text-sm font-medium" htmlFor="claude-api-token">
                                  API token
                                </label>
                                <div className="relative">
                                  <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                  <Input
                                    id="claude-api-token"
                                    type={showClaudeAuthToken ? 'text' : 'password'}
                                    value={claudeAuthTokenInput}
                                    onChange={(event) =>
                                      setClaudeAuthTokenInput(event.target.value)
                                    }
                                    placeholder={
                                      claudeApiStatus?.hasAuthToken
                                        ? `Configured: ${claudeApiStatus.authTokenPreview || 'encrypted token'}`
                                        : 'Enter API token'
                                    }
                                    className="pl-10 pr-10 font-mono text-sm"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setShowClaudeAuthToken((visible) => !visible)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-muted"
                                    aria-label={
                                      showClaudeAuthToken ? 'Hide API token' : 'Show API token'
                                    }
                                  >
                                    {showClaudeAuthToken ? (
                                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                      <Eye className="h-4 w-4 text-muted-foreground" />
                                    )}
                                  </button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Stored encrypted per user and passed as{' '}
                                  <code>ANTHROPIC_AUTH_TOKEN</code> only to Z.AI sessions. Claude
                                  subscription sessions never receive it. Leave blank to keep the
                                  saved token.
                                </p>
                              </div>

                              <div className="space-y-3">
                                <div>
                                  <p className="text-sm font-medium">Optional model mapping</p>
                                  <p className="text-xs text-muted-foreground">
                                    Map Claude's aliases to model IDs exposed by the target API.
                                    Blank fields use the provider's defaults.
                                  </p>
                                </div>
                                <div className="grid gap-3 md:grid-cols-3">
                                  {(
                                    [
                                      ['opusModel', 'Opus', 'glm-5.2'],
                                      ['sonnetModel', 'Sonnet', 'glm-5.2'],
                                      ['haikuModel', 'Haiku', 'glm-5.2'],
                                    ] as const
                                  ).map(([field, label, placeholder]) => (
                                    <div key={field} className="space-y-1.5">
                                      <label
                                        className="text-xs font-medium"
                                        htmlFor={`claude-${field}`}
                                      >
                                        {label}
                                      </label>
                                      <Input
                                        id={`claude-${field}`}
                                        value={claudeApiDraft[field]}
                                        onChange={(event) =>
                                          setClaudeApiDraft((current) => ({
                                            ...current,
                                            [field]: event.target.value,
                                          }))
                                        }
                                        placeholder={placeholder}
                                        className="font-mono text-sm"
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-between">
                                <Button
                                  variant="ghost"
                                  onClick={() => resetClaudeApiMutation.mutate()}
                                  disabled={
                                    !claudeApiStatus?.configured || resetClaudeApiMutation.isPending
                                  }
                                  className="text-muted-foreground"
                                >
                                  Remove Z.AI configuration
                                </Button>
                                <Button
                                  onClick={() => saveClaudeApiMutation.mutate()}
                                  disabled={
                                    !claudeApiDraft.baseUrl.trim() ||
                                    (!claudeAuthTokenInput.trim() &&
                                      !claudeApiStatus?.hasAuthToken) ||
                                    saveClaudeApiMutation.isPending
                                  }
                                  className="gap-2"
                                >
                                  {saveClaudeApiMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="h-4 w-4" />
                                  )}
                                  Save Z.AI Code
                                </Button>
                              </div>

                              <p className="text-xs text-muted-foreground">
                                The change applies when a Z.AI session starts or restarts.{' '}
                                <a
                                  href="https://docs.z.ai/devpack/tool/claude"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline"
                                >
                                  Z.AI Claude Code documentation
                                </a>
                              </p>
                            </CardContent>
                          </Card>
                        </section>
                      </div>
                    </TabsContent>

                    {/* Subagent model routing */}
                    <TabsContent value="subagents" className="settings-general-pane mt-0">
                      <div className="settings-pane-column">
                        <section id="subagent-upstreams">
                          <Card className="border border-border/70">
                            <CardHeader>
                              <CardTitle className="text-base">Subagent-Modelle</CardTitle>
                              <CardDescription>
                                Claude-Sessions können Subagenten auf anderen Abos laufen lassen:
                                Der Hauptagent bleibt auf dem Claude-Abo, ein Agent, dessen
                                Modellfeld eine hier gelistete Modell-ID nennt, läuft über den
                                zugehörigen Anbieter. GLM-Modelle routen automatisch über die
                                Z.AI-Konfiguration; hier kommen weitere Anthropic-kompatible
                                Anbieter dazu. Das Modell wählst du pro Agent unter Extensions →
                                Agents.
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <SubagentUpstreamsSection />
                            </CardContent>
                          </Card>
                        </section>
                        <section id="cli-subagents">
                          <Card className="border border-border/70">
                            <CardHeader>
                              <CardTitle className="text-base">CLI-Subagenten</CardTitle>
                              <CardDescription>
                                Delegation über Harness-Grenzen hinweg: Jede Session kann per
                                MCP-Tool <code>run_subagent</code> einen anderen Provider-CLI als
                                Einmal-Worker starten — unabhängig davon, welcher Provider die
                                Session selbst fährt.
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <CliSubagentsSection />
                            </CardContent>
                          </Card>
                        </section>
                      </div>
                    </TabsContent>

                    {/* Oracle Browser Auth */}
                    <TabsContent value="oracle" className="settings-general-pane mt-0">
                      <div className="settings-pane-column">
                        <section id="oracle-browser">
                          <Card className="border border-border/70">
                            <CardHeader>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <CardTitle className="text-base">Oracle Browser Auth</CardTitle>
                                  <CardDescription>
                                    Configure how Oracle reaches ChatGPT for browser-mode second
                                    opinions.
                                  </CardDescription>
                                </div>
                                <div className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                                  {(oracleBrowserDraft.mode || 'manual') === 'remote'
                                    ? 'Remote browser'
                                    : (oracleBrowserDraft.mode || 'manual') === 'manual'
                                      ? 'Embedded browser'
                                      : 'Cookie profile'}
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-5">
                              <div className="grid gap-3 md:grid-cols-[1fr_260px] md:items-center">
                                <div>
                                  <p className="text-sm font-medium">Mode</p>
                                  <p className="text-xs text-muted-foreground">
                                    Embedded Browser keeps the ChatGPT login flow inside Plum's
                                    session browser tab. Remote Browser is only for attaching Oracle
                                    to a browser you opened somewhere else.
                                  </p>
                                </div>
                                <Select
                                  value={oracleBrowserDraft.mode || 'manual'}
                                  onValueChange={(value) =>
                                    setOracleBrowserDraft((prev) => ({
                                      ...prev,
                                      mode: value as OracleBrowserSettings['mode'],
                                    }))
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="manual">
                                      Embedded Browser (Recommended)
                                    </SelectItem>
                                    <SelectItem value="remote">Remote Browser</SelectItem>
                                    <SelectItem value="profile">Cookie Profile (Legacy)</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="grid gap-3 md:grid-cols-[1fr_260px] md:items-center">
                                <div>
                                  <p className="text-sm font-medium">ChatGPT URL</p>
                                  <p className="text-xs text-muted-foreground">
                                    Oracle opens or targets this ChatGPT location for browser runs.
                                  </p>
                                </div>
                                <Input
                                  value={oracleBrowserDraft.chatgptUrl || ''}
                                  onChange={(event) =>
                                    setOracleBrowserDraft((prev) => ({
                                      ...prev,
                                      chatgptUrl: event.target.value,
                                    }))
                                  }
                                  placeholder="https://chatgpt.com/"
                                />
                              </div>

                              {(oracleBrowserDraft.mode || 'manual') === 'remote' && (
                                <div className="space-y-3 rounded-lg border border-border/70 bg-muted/30 p-4">
                                  <div className="grid gap-3 md:grid-cols-[1fr_260px] md:items-center">
                                    <div>
                                      <p className="text-sm font-medium">Remote Chrome Target</p>
                                      <p className="text-xs text-muted-foreground">
                                        Chrome DevTools endpoint on the host browser you open
                                        yourself.
                                      </p>
                                    </div>
                                    <Input
                                      value={oracleBrowserDraft.remoteChrome || ''}
                                      onChange={(event) =>
                                        setOracleBrowserDraft((prev) => ({
                                          ...prev,
                                          remoteChrome: event.target.value,
                                        }))
                                      }
                                      placeholder="host.docker.internal:9222"
                                    />
                                  </div>
                                  <div className="rounded-md border border-primary/15 bg-primary/5 p-3 text-xs text-muted-foreground">
                                    Start your browser with DevTools enabled, then sign into ChatGPT
                                    there. Example:{' '}
                                    <code>google-chrome --remote-debugging-port=9222</code>
                                  </div>
                                </div>
                              )}

                              {(oracleBrowserDraft.mode || 'manual') === 'manual' && (
                                <div className="space-y-3 rounded-lg border border-border/70 bg-muted/30 p-4">
                                  <div className="grid gap-3 md:grid-cols-[1fr_260px] md:items-center">
                                    <div>
                                      <p className="text-sm font-medium">
                                        Embedded Browser Profile Dir
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        Persistent Chromium profile used by Plum's embedded Oracle
                                        browser.
                                      </p>
                                    </div>
                                    <Input
                                      value={oracleBrowserDraft.manualLoginProfileDir || ''}
                                      onChange={(event) =>
                                        setOracleBrowserDraft((prev) => ({
                                          ...prev,
                                          manualLoginProfileDir: event.target.value,
                                        }))
                                      }
                                      placeholder="/home/node/.codex/oracle/browser-profile"
                                    />
                                  </div>
                                  <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
                                    Start and control this browser from a session's right-side
                                    `Browser` tab. Once it is logged into ChatGPT, Oracle can attach
                                    to that running browser directly without leaving Plum.
                                  </div>
                                </div>
                              )}

                              {(oracleBrowserDraft.mode || 'manual') === 'profile' && (
                                <div className="space-y-3 rounded-lg border border-border/70 bg-muted/30 p-4">
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <label className="space-y-2 text-sm">
                                      <span className="font-medium">Chrome profile</span>
                                      <Input
                                        value={oracleBrowserDraft.chromeProfile || ''}
                                        onChange={(event) =>
                                          setOracleBrowserDraft((prev) => ({
                                            ...prev,
                                            chromeProfile: event.target.value,
                                          }))
                                        }
                                        placeholder="Default"
                                      />
                                    </label>
                                    <label className="space-y-2 text-sm">
                                      <span className="font-medium">Cookie DB path</span>
                                      <Input
                                        value={oracleBrowserDraft.chromeCookiePath || ''}
                                        onChange={(event) =>
                                          setOracleBrowserDraft((prev) => ({
                                            ...prev,
                                            chromeCookiePath: event.target.value,
                                          }))
                                        }
                                        placeholder="/path/to/Cookies"
                                      />
                                    </label>
                                  </div>
                                  <div className="rounded-md border border-border/70 bg-background/70 p-3 text-xs text-muted-foreground">
                                    Legacy mode: Oracle copies cookies from a browser profile it can
                                    reach from inside the container.
                                  </div>
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                                <Button
                                  variant="outline"
                                  onClick={() =>
                                    window.open(
                                      oracleBrowserDraft.chatgptUrl || 'https://chatgpt.com/',
                                      '_blank',
                                      'noopener,noreferrer'
                                    )
                                  }
                                  className="gap-2"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  Open ChatGPT Externally
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={testOracleBrowserSettings}
                                  disabled={oracleTestResult.state === 'testing'}
                                  className="gap-2"
                                >
                                  {oracleTestResult.state === 'testing' ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Terminal className="h-4 w-4" />
                                  )}
                                  Test Oracle Path
                                </Button>
                                <Button
                                  onClick={saveOracleBrowserSettings}
                                  disabled={updateSettingsMutation.isPending}
                                >
                                  {updateSettingsMutation.isPending
                                    ? 'Saving...'
                                    : 'Save Oracle Settings'}
                                </Button>
                              </div>

                              {oracleTestResult.state !== 'idle' && (
                                <div
                                  className={cn(
                                    'rounded-lg border p-3 text-sm',
                                    oracleTestResult.state === 'ok'
                                      ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
                                      : oracleTestResult.state === 'testing'
                                        ? 'border-border bg-muted/40 text-muted-foreground'
                                        : 'border-destructive/30 bg-destructive/10 text-destructive'
                                  )}
                                >
                                  <p>
                                    {oracleTestResult.message ||
                                      'Testing Oracle browser settings...'}
                                  </p>
                                  {oracleTestResult.details?.remoteChrome && (
                                    <p className="mt-2 text-xs">
                                      Remote target:{' '}
                                      <code>{oracleTestResult.details.remoteChrome}</code>
                                    </p>
                                  )}
                                  {oracleTestResult.details?.browserPath && (
                                    <p className="mt-2 text-xs">
                                      Browser path:{' '}
                                      <code>{oracleTestResult.details.browserPath}</code>
                                    </p>
                                  )}
                                  {oracleTestResult.details?.browser && (
                                    <p className="mt-2 text-xs">
                                      Browser: <code>{oracleTestResult.details.browser}</code>
                                    </p>
                                  )}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        </section>
                      </div>
                    </TabsContent>

                    <TabsContent value="interface" className="settings-general-pane mt-0">
                      <div className="settings-pane-column">
                        <SettingsPanel
                          id="appearance"
                          eyebrow="Appearance"
                          title="Theme and background"
                          description="Choose the interface contrast mode and the background used outside static E-Ink mode."
                        >
                          <div className="space-y-4">
                            <div className="flex flex-wrap gap-2">
                              {themeOptions.map((option) => {
                                const Icon = option.icon;
                                const isActive = currentTheme === option.value;

                                return (
                                  <button
                                    type="button"
                                    key={option.value}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleThemeChange(option.value);
                                    }}
                                    className={cn(
                                      'flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2.5 text-left transition-all',
                                      'hover:scale-[1.02] active:scale-[0.98]',
                                      isActive
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-border bg-card hover:border-primary/40'
                                    )}
                                  >
                                    <Icon className="h-4 w-4" />
                                    <span className="min-w-0">
                                      <span className="block text-sm font-medium">
                                        {option.label}
                                      </span>
                                      <span className="hidden text-xs text-muted-foreground sm:block">
                                        {option.description}
                                      </span>
                                    </span>
                                    {isActive ? <CheckCircle2 className="ml-1 h-4 w-4" /> : null}
                                  </button>
                                );
                              })}
                            </div>

                            {currentTheme === 'eink' ? (
                              <p className="text-xs text-muted-foreground">
                                E-Ink mode keeps the interface static and ignores animated
                                backgrounds until you switch back to Light, Dark, or System.
                              </p>
                            ) : null}

                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {BACKGROUND_ANIMATION_OPTIONS.map((option) => {
                                const isActive = currentBackgroundAnimation === option.value;
                                const backgroundDisabled = currentTheme === 'eink';

                                return (
                                  <button
                                    type="button"
                                    key={option.value}
                                    disabled={backgroundDisabled}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (backgroundDisabled) return;
                                      handleBackgroundAnimationChange(option.value);
                                    }}
                                    className={cn(
                                      'flex min-h-[58px] items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all',
                                      'hover:scale-[1.01] active:scale-[0.99]',
                                      backgroundDisabled && 'cursor-not-allowed opacity-55',
                                      isActive
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-border bg-card hover:border-primary/40'
                                    )}
                                  >
                                    <Wand2 className="h-4 w-4 shrink-0" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-medium">
                                        {option.label}
                                      </span>
                                      <span className="block truncate text-xs text-muted-foreground">
                                        {option.description}
                                      </span>
                                    </span>
                                    {isActive ? (
                                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Appearance stays per device by default; a phone
                                and a desktop rarely want the same theme. */}
                            <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                              <span className="min-w-0">
                                <span className="block text-sm font-medium">
                                  Sync appearance across devices
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  Applies this theme and background to the Android app and every
                                  other browser you sign in from.
                                </span>
                              </span>
                              <input
                                type="checkbox"
                                className="h-4 w-4 shrink-0 accent-primary"
                                checked={settings?.appearanceSync ?? false}
                                onChange={(event) =>
                                  updateSettingsMutation.mutate({
                                    appearanceSync: event.target.checked,
                                    ...(event.target.checked
                                      ? {
                                          theme: currentTheme,
                                          backgroundAnimation: currentBackgroundAnimation,
                                        }
                                      : {}),
                                  })
                                }
                              />
                            </label>

                            {/* Alert thresholds live on the account so the app
                                and the WebUI cannot drift apart. */}
                            <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="min-w-0">
                                  <span className="block text-sm font-medium">Usage alerts</span>
                                  <span className="block text-xs text-muted-foreground">
                                    Notify when a provider quota or the daily spend passes these
                                    limits.
                                  </span>
                                </span>
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 shrink-0 accent-primary"
                                  checked={settings?.usageAlerts?.enabled ?? true}
                                  onChange={(event) =>
                                    updateSettingsMutation.mutate({
                                      usageAlerts: { enabled: event.target.checked },
                                    })
                                  }
                                />
                              </div>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <label className="text-xs text-muted-foreground">
                                  Quota warning at %
                                  <input
                                    type="number"
                                    min={1}
                                    max={100}
                                    defaultValue={settings?.usageAlerts?.quotaPercent ?? 80}
                                    onBlur={(event) => {
                                      const value = Number(event.target.value);
                                      if (value >= 1 && value <= 100) {
                                        updateSettingsMutation.mutate({
                                          usageAlerts: { quotaPercent: Math.round(value) },
                                        });
                                      }
                                    }}
                                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                                  />
                                </label>
                                <label className="text-xs text-muted-foreground">
                                  Daily spend limit (USD)
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.5"
                                    defaultValue={settings?.usageAlerts?.dailyCostUsd ?? 5}
                                    onBlur={(event) => {
                                      const value = Number(event.target.value);
                                      if (Number.isFinite(value) && value >= 0) {
                                        updateSettingsMutation.mutate({
                                          usageAlerts: { dailyCostUsd: value },
                                        });
                                      }
                                    }}
                                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                                  />
                                </label>
                              </div>
                              <button
                                type="button"
                                onClick={() => void sendTestAlert()}
                                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-primary/40"
                              >
                                Send test alert
                              </button>
                            </div>

                            <GatewayTokensPanel />
                          </div>
                        </SettingsPanel>
                      </div>
                    </TabsContent>

                    {/* OpenCode Models */}
                    <TabsContent value="opencode" className="settings-general-pane mt-0">
                      <div className="settings-pane-column">
                        <section id="opencode-models">
                          <Card className="border border-border/70">
                            <CardHeader className="pb-4">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <CardTitle className="text-base">OpenCode Models</CardTitle>
                                  <CardDescription>
                                    Curate the model menu for OpenCode sessions from the providers
                                    you have available.
                                  </CardDescription>
                                </div>
                                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                                  75+ routed providers
                                </span>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              {/* Provider Selection */}
                              <div className="space-y-2">
                                <label className="text-sm font-medium">1. Choose provider</label>
                                <Select
                                  value={modelProviderId}
                                  onValueChange={(value) => {
                                    setModelProviderId(value);
                                    setModelModelId('');
                                  }}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Choose a provider..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(availableProviders || {}).map(
                                      ([id, provider]) => (
                                        <SelectItem key={id} value={id}>
                                          <div className="flex flex-col">
                                            <span className="font-medium">{provider.name}</span>
                                            <span className="text-xs text-muted-foreground">
                                              {id}
                                              {provider.models?.length
                                                ? ` - ${provider.models.length} models`
                                                : ''}
                                              {provider.configured ? ' - configured' : ''}
                                            </span>
                                          </div>
                                        </SelectItem>
                                      )
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>

                              {modelProviderId && (
                                <div
                                  className={cn(
                                    'flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between',
                                    selectedModelProvider?.hasKey ||
                                      selectedStoredModelProvider?.hasKey
                                      ? 'border-green-500/25 bg-green-500/5'
                                      : 'border-amber-500/25 bg-amber-500/5'
                                  )}
                                >
                                  <div className="flex min-w-0 items-start gap-3">
                                    <div
                                      className={cn(
                                        'mt-0.5 rounded-lg p-2',
                                        selectedModelProvider?.hasKey ||
                                          selectedStoredModelProvider?.hasKey
                                          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                      )}
                                    >
                                      <Key className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium">
                                        {selectedModelProvider?.hasKey ||
                                        selectedStoredModelProvider?.hasKey
                                          ? 'API key saved for this provider'
                                          : 'No API key saved for this provider'}
                                      </p>
                                      <p className="truncate text-xs text-muted-foreground">
                                        {(
                                          selectedStoredModelProvider?.envVars ||
                                          selectedModelProvider?.env ||
                                          []
                                        )
                                          .slice(0, 4)
                                          .join(', ') || 'OpenCode default credential lookup'}
                                      </p>
                                    </div>
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openOpenCodeProviderDialog(modelProviderId)}
                                    className="h-8 shrink-0 gap-1.5 text-xs"
                                  >
                                    <KeyRound className="h-3.5 w-3.5" />
                                    {selectedModelProvider?.hasKey ||
                                    selectedStoredModelProvider?.hasKey
                                      ? 'Update key'
                                      : 'Add key'}
                                  </Button>
                                </div>
                              )}

                              {/* Model Selection */}
                              {modelProviderId && availableProviders?.[modelProviderId]?.models && (
                                <div className="space-y-2">
                                  <label className="text-sm font-medium">2. Choose model</label>
                                  <Select value={modelModelId} onValueChange={setModelModelId}>
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Choose a model..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {availableProviders[modelProviderId].models?.map((model) => (
                                        <SelectItem key={model} value={model}>
                                          <code className="text-xs">{model}</code>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}

                              {/* Add Button */}
                              <div className="flex gap-2">
                                <Button
                                  onClick={() => {
                                    if (modelProviderId && modelModelId) {
                                      const fullModel = `${modelProviderId}/${modelModelId}`;
                                      const current = openCodeModels || [];
                                      if (!current.includes(fullModel)) {
                                        updateSettingsMutation.mutate({
                                          cliProviderModelLists: {
                                            ...settings?.cliProviderModelLists,
                                            opencode: [...current, fullModel],
                                          },
                                        });
                                      }
                                      setModelModelId('');
                                    }
                                  }}
                                  disabled={!modelProviderId || !modelModelId}
                                  className="bg-purple-600 hover:bg-purple-700"
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  Add model
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setModelProviderId('');
                                    setModelModelId('');
                                  }}
                                >
                                  Reset
                                </Button>
                              </div>

                              {/* Configured Models */}
                              {openCodeModels && openCodeModels.length > 0 && (
                                <div className="space-y-2 pt-4 border-t">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">
                                      Curated models ({openCodeModels.length})
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-xs text-destructive"
                                      onClick={() => {
                                        updateSettingsMutation.mutate({
                                          cliProviderModelLists: {
                                            ...settings?.cliProviderModelLists,
                                            opencode: undefined,
                                          },
                                        });
                                      }}
                                    >
                                      Clear all
                                    </Button>
                                  </div>
                                  <div className="flex min-w-0 max-w-full flex-wrap gap-2 overflow-hidden">
                                    {openCodeModels.map((model) => (
                                      <div
                                        key={model}
                                        title={model}
                                        className="group flex min-w-0 max-w-full items-center gap-1 rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 font-mono text-sm sm:max-w-[calc(50%_-_0.25rem)] 2xl:max-w-[calc(33.333%_-_0.35rem)]"
                                      >
                                        <span className="block min-w-0 truncate">{model}</span>
                                        <button
                                          type="button"
                                          onClick={() => removeOpenCodeModel(model)}
                                          className="shrink-0 opacity-0 transition-opacity text-muted-foreground hover:text-destructive group-hover:opacity-100"
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        </section>
                      </div>
                    </TabsContent>

                    {/* Pi runtime */}
                    <TabsContent value="pi" className="settings-general-pane mt-0">
                      <div className="settings-pane-column">
                        <section id="pi-cli">
                          <Card className="border border-border/70">
                            <CardHeader>
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <CardTitle className="text-base">Pi</CardTitle>
                                  <CardDescription>
                                    Pi uses your enabled OpenCode provider accounts with its own
                                    persistent RPC session runtime.
                                  </CardDescription>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div
                                    className={cn(
                                      'w-fit rounded-full px-2.5 py-1 text-xs font-medium',
                                      piDiagnostic?.installed &&
                                        piDiagnostic.authenticated &&
                                        piDiagnostic.modelCount > 0
                                        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                    )}
                                  >
                                    {providerDiagnosticsLoading
                                      ? 'Checking...'
                                      : piDiagnostic?.installed &&
                                          piDiagnostic.authenticated &&
                                          piDiagnostic.modelCount > 0
                                        ? 'Pi ready'
                                        : 'Setup needed'}
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => refetchProviderDiagnostics()}
                                    disabled={providerDiagnosticsLoading}
                                    className="gap-2"
                                  >
                                    <RefreshCw
                                      className={cn(
                                        'h-3.5 w-3.5',
                                        providerDiagnosticsLoading && 'animate-spin'
                                      )}
                                    />
                                    Refresh
                                  </Button>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-5">
                              <div className="grid gap-3 sm:grid-cols-3">
                                <div className="rounded-lg border border-border/70 bg-card/50 p-4">
                                  <p className="text-sm font-medium">Runtime</p>
                                  <p className="mt-1 truncate text-xs text-muted-foreground">
                                    {piDiagnostic?.installed
                                      ? piDiagnostic.version || 'Pi CLI installed'
                                      : 'Pi CLI is not installed'}
                                  </p>
                                </div>
                                <div className="rounded-lg border border-border/70 bg-card/50 p-4">
                                  <p className="text-sm font-medium">Provider accounts</p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {piModelGroups.length > 0
                                      ? `${piModelGroups.length} enabled connection${piModelGroups.length === 1 ? '' : 's'}`
                                      : 'No usable connection found'}
                                  </p>
                                </div>
                                <div className="rounded-lg border border-border/70 bg-card/50 p-4">
                                  <p className="text-sm font-medium">Model menu</p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {piDiagnostic
                                      ? `${piDiagnostic.modelCount} runnable models`
                                      : 'Loading user-specific models'}
                                  </p>
                                </div>
                              </div>

                              {providerDiagnosticsLoading ? (
                                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                                  Loading Pi runtime and model discovery...
                                </div>
                              ) : piDiagnostic && piDiagnostic.modelCount > 0 ? (
                                <div className="space-y-3">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                    <div>
                                      <p className="text-sm font-medium">Available models</p>
                                      <p className="text-xs text-muted-foreground">
                                        Generated from your enabled provider accounts. Image- and
                                        video-only models are excluded.
                                      </p>
                                    </div>
                                    <p className="shrink-0 text-xs text-muted-foreground">
                                      Default: <code>{piDiagnostic.defaultModel || 'auto'}</code>
                                    </p>
                                  </div>
                                  <div className="grid max-h-[440px] gap-3 overflow-y-auto pr-1 md:grid-cols-2">
                                    {piModelGroups.map(([providerId, models]) => (
                                      <div
                                        key={providerId}
                                        className="min-w-0 rounded-lg border border-border/70 bg-card/40 p-3"
                                      >
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                          <p className="truncate text-sm font-semibold">
                                            {providerId}
                                          </p>
                                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                            {models.length}
                                          </span>
                                        </div>
                                        <div className="space-y-1.5">
                                          {models.map((model) => (
                                            <div
                                              key={model}
                                              title={model}
                                              className="truncate rounded-md bg-muted/55 px-2.5 py-1.5 font-mono text-xs"
                                            >
                                              {model}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
                                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                                    Pi needs an enabled provider account
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Add or enable a Z.AI, Qwen/Alibaba, DeepSeek, or other OpenCode
                                    connection. Pi will rebuild its model menu automatically.
                                  </p>
                                </div>
                              )}

                              <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-xs text-muted-foreground">
                                  Credentials stay in the per-user OpenCode store. Pi receives only
                                  the generated, secret-free provider configuration.
                                </p>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    handleSettingsDestination('api-keys', 'opencode-providers')
                                  }
                                  className="shrink-0 gap-2"
                                >
                                  <KeyRound className="h-3.5 w-3.5" />
                                  Manage provider accounts
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        </section>
                      </div>
                    </TabsContent>
                  </Tabs>
                </>
              </TabsContent>

              {/* Analytics Tab */}
              <TabsContent value="analytics" className="settings-pane-rail mt-0">
                <SettingsPanel
                  id="analytics-limit-metrics"
                  eyebrow="Combined chart"
                  title="Provider limit curves"
                  description="Choose which quota and account-limit curves appear in Analytics. Token model curves are unaffected; provider switches on the Analytics page filter both together."
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={updateSettingsMutation.isPending}
                      onClick={() =>
                        updateSettingsMutation.mutate({
                          analytics: {
                            hiddenLimitMetrics: Object.fromEntries(
                              Object.entries(DEFAULT_ANALYTICS_HIDDEN_LIMIT_METRICS).map(
                                ([provider, metrics]) => [provider, [...metrics]]
                              )
                            ),
                          },
                        })
                      }
                    >
                      Restore defaults
                    </Button>
                  }
                >
                  {analyticsLimitHistoryLoading ? (
                    <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading provider limits…
                    </div>
                  ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                      {ANALYTICS_LIMIT_PROVIDER_ORDER.map((provider) => {
                        const metrics = analyticsLimitMetricsByProvider.get(provider) || [];
                        const hidden = new Set(analyticsHiddenLimitMetrics[provider] || []);
                        const visibleCount = metrics.filter(
                          (metric) => !hidden.has(metric.key)
                        ).length;
                        return (
                          <div
                            key={provider}
                            className="rounded-xl border border-border/70 bg-card/50 p-4"
                          >
                            <div className="mb-4 flex items-center gap-3">
                              <ProviderLogo provider={toUiProvider(provider)} className="h-9 w-9" />
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold">
                                  {ANALYTICS_LIMIT_PROVIDER_LABEL[provider]}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {visibleCount}/{metrics.length} curves visible
                                </p>
                              </div>
                            </div>
                            {metrics.length > 0 ? (
                              <div className="space-y-2">
                                {metrics.map((metric) => {
                                  const visible = !hidden.has(metric.key);
                                  return (
                                    <div
                                      key={metric.key}
                                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/45 px-3 py-2.5"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">
                                          {metric.label}
                                        </p>
                                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                                          {metric.key}
                                        </p>
                                      </div>
                                      <Switch
                                        checked={visible}
                                        disabled={updateSettingsMutation.isPending}
                                        aria-label={`${visible ? 'Hide' : 'Show'} ${metric.label} for ${ANALYTICS_LIMIT_PROVIDER_LABEL[provider]}`}
                                        onCheckedChange={(checked) =>
                                          updateAnalyticsLimitMetricVisibility(
                                            provider,
                                            metric.key,
                                            checked
                                          )
                                        }
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="rounded-lg border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
                                No recorded limit metrics yet. They appear here after the first
                                successful provider quota sample.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Defaults hide Parallel sessions, Web search, and GPT-5.3-Codex-Spark. Changes
                    are stored per Plum account and apply on every device.
                  </p>
                </SettingsPanel>
              </TabsContent>

              {/* API Keys Tab */}
              <TabsContent value="api-keys" className="settings-pane-rail mt-0">
                {/* GitHub Token */}
                <section id="github-token">
                  <div className="settings-section-headband">
                    <h2 className="text-lg font-semibold">GitHub Token</h2>
                    <Github className="h-4 w-4 text-gray-500" />
                  </div>
                  <Card
                    className={cn(
                      'border',
                      githubTokenStatus?.hasToken
                        ? 'border-green-500/30 bg-green-500/5'
                        : 'border-gray-500/30 bg-gray-500/5'
                    )}
                  >
                    <CardContent className="pt-4 pb-4">
                      {githubTokenStatus?.hasToken ? (
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-green-500/15">
                            <Github className="h-4 w-4 text-green-600 dark:text-green-400" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-green-600 dark:text-green-400">
                              Token configured
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {githubTokenStatus.tokenPreview}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteGithubTokenMutation.mutate()}
                            disabled={deleteGithubTokenMutation.isPending}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Remove
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-gray-500/15">
                              <Github className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                                No token set
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Required for GitHub integration features
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <Input
                                type={showGithubToken ? 'text' : 'password'}
                                value={githubTokenInput}
                                onChange={(e) => setGithubTokenInput(e.target.value)}
                                placeholder="ghp_..."
                                className="font-mono text-sm pr-10"
                              />
                              <button
                                type="button"
                                onClick={() => setShowGithubToken(!showGithubToken)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                              >
                                {showGithubToken ? (
                                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <Eye className="h-4 w-4 text-muted-foreground" />
                                )}
                              </button>
                            </div>
                            <Button
                              onClick={() => setGithubTokenMutation.mutate(githubTokenInput)}
                              disabled={!githubTokenInput || setGithubTokenMutation.isPending}
                            >
                              {setGithubTokenMutation.isPending ? 'Saving...' : 'Save'}
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Get a Personal Access Token from{' '}
                            <a
                              href="https://github.com/settings/tokens/new"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              GitHub Settings
                            </a>{' '}
                            (scopes: repo, read:user)
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </section>

                {/* OpenCode Providers (wrapped in its own section) */}
                <section id="opencode-providers">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">OpenCode Providers</CardTitle>
                          <CardDescription>
                            Configure API keys once; OpenCode and Pi use the same connections and
                            model catalogue
                          </CardDescription>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => openOpenCodeProviderDialog()}
                          className="gap-1.5 h-8 px-3 text-xs"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Provider
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {openCodeProviders && openCodeProviders.length > 0 ? (
                        <div className="space-y-2">
                          {openCodeProviders.map((provider) => (
                            <div
                              key={provider.id}
                              className="group flex items-center gap-4 p-4 rounded-xl border bg-card transition-all hover:border-primary/30 hover:shadow-sm"
                            >
                              <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
                                <Key className="h-4 w-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="font-medium">{provider.name}</p>
                                  <span className="text-xs text-muted-foreground font-mono">
                                    {provider.id}
                                  </span>
                                  {!provider.enabled && (
                                    <span className="text-xs text-muted-foreground">
                                      (disabled)
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {provider.hasKey ? 'API key configured' : 'No API key'}
                                  {provider.baseUrl && ` • ${provider.baseUrl}`}
                                </p>
                                {(provider.envVars?.length ||
                                  availableProviders?.[provider.id]?.env?.length) && (
                                  <p className="mt-0.5 text-[11px] text-muted-foreground font-mono">
                                    {(
                                      provider.envVars ||
                                      availableProviders?.[provider.id]?.env ||
                                      []
                                    )
                                      .slice(0, 3)
                                      .join(', ')}
                                  </p>
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => testOpenCodeProvider(provider.id)}
                                disabled={testingOpenCodeProviderId === provider.id}
                                className="h-8 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                {testingOpenCodeProviderId === provider.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Zap className="h-4 w-4" />
                                )}
                                <span className="ml-1 text-xs">Test</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openOpenCodeProviderDialog(provider.id)}
                                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Edit provider key"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteOpenCodeProviderMutation.mutate(provider.id)}
                                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-8 text-center">
                          <div className="p-4 rounded-full bg-muted/50 mb-4">
                            <Key className="h-8 w-8 text-muted-foreground/50" />
                          </div>
                          <p className="font-medium text-muted-foreground mb-1">
                            No providers configured
                          </p>
                          <p className="text-sm text-muted-foreground/70 max-w-xs">
                            Add OpenCode-compatible providers like OpenAI, Anthropic, or custom
                            endpoints
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </section>
              </TabsContent>

              {/* Integrations Tab */}
              <TabsContent value="integrations" className="settings-pane-rail mt-0">
                <HomeAssistantSettingsCard />
                <section id="comfyui-integration">
                  <div className="settings-section-headband">
                    <h2 className="text-lg font-semibold">ComfyUI Integration</h2>
                    <Wand2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Image generation</CardTitle>
                      <CardDescription>
                        Plum Code WebUI ships three baked-in workflows (Z-Image Turbo, Flux.2 Klein
                        T2I, Flux.2 Klein image-edit). Set your ComfyUI server URL below — every CLI
                        session can then generate images via the{' '}
                        <code className="px-1 py-0.5 rounded bg-muted text-xs">generate_image</code>
                        ,{' '}
                        <code className="px-1 py-0.5 rounded bg-muted text-xs">
                          generate_image_quality
                        </code>{' '}
                        and <code className="px-1 py-0.5 rounded bg-muted text-xs">edit_image</code>{' '}
                        MCP tools without any external LoRA Tester container. Defaults to{' '}
                        <code className="px-1 py-0.5 rounded bg-muted text-xs">$COMFYUI_URL</code>{' '}
                        env var when unset.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">ComfyUI URL</label>
                        <div className="flex gap-2">
                          <Input
                            type="url"
                            value={comfyuiUrlInput}
                            onChange={(e) => setComfyuiUrlInput(e.target.value)}
                            placeholder="http://192.168.1.23:8188"
                            className="font-mono text-sm"
                          />
                          <Button
                            variant="outline"
                            onClick={async () => {
                              setComfyuiTestResult({ state: 'testing' });
                              try {
                                const resp =
                                  await api.get<
                                    ApiResponse<{ reachable: boolean; version: string | null }>
                                  >('/api/comfyui/test');
                                const reachable = resp.data.data?.reachable;
                                const version = resp.data.data?.version;
                                if (reachable) {
                                  setComfyuiTestResult({
                                    state: 'ok',
                                    message: version ? `ComfyUI ${version}` : 'reachable',
                                  });
                                } else {
                                  setComfyuiTestResult({
                                    state: 'error',
                                    message: 'not reachable',
                                  });
                                }
                              } catch (err) {
                                const msg =
                                  (
                                    err as {
                                      response?: { data?: { error?: { message?: string } } };
                                    }
                                  )?.response?.data?.error?.message ||
                                  (err instanceof Error ? err.message : 'request failed');
                                setComfyuiTestResult({ state: 'error', message: msg });
                              }
                            }}
                            disabled={
                              comfyuiTestResult.state === 'testing' || !comfyuiUrlInput.trim()
                            }
                          >
                            {comfyuiTestResult.state === 'testing' ? 'Testing...' : 'Test'}
                          </Button>
                        </div>
                        {comfyuiTestResult.state === 'ok' && (
                          <p className="text-xs text-emerald-500">✓ {comfyuiTestResult.message}</p>
                        )}
                        {comfyuiTestResult.state === 'error' && (
                          <p className="text-xs text-red-500">✗ {comfyuiTestResult.message}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Direct ComfyUI server. The WebUI talks to it via{' '}
                          <code className="px-1 py-0.5 rounded bg-muted text-xs">POST /prompt</code>{' '}
                          +{' '}
                          <code className="px-1 py-0.5 rounded bg-muted text-xs">GET /history</code>{' '}
                          + <code className="px-1 py-0.5 rounded bg-muted text-xs">GET /view</code>.
                          The "Test" button does a quick{' '}
                          <code className="px-1 py-0.5 rounded bg-muted text-xs">
                            /system_stats
                          </code>{' '}
                          probe.
                        </p>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <Button
                          onClick={() =>
                            saveIntegrationsMutation.mutate({
                              comfyuiUrl: comfyuiUrlInput.trim(),
                            })
                          }
                          disabled={saveIntegrationsMutation.isPending}
                        >
                          {saveIntegrationsMutation.isPending ? 'Saving...' : 'Save'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setComfyuiUrlInput(integrations?.comfyuiUrl || '');
                            setComfyuiTestResult({ state: 'idle' });
                          }}
                          disabled={saveIntegrationsMutation.isPending}
                        >
                          Reset
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </section>

                <section id="discord-integration">
                  <div className="settings-section-headband">
                    <h2 className="text-lg font-semibold">Discord Alerts</h2>
                    <Bell className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Plum ops channel</CardTitle>
                      <CardDescription>
                        Send redacted session errors, permission requests, watchdog incidents, and
                        delegation failures into your Discord server.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="flex flex-col gap-3 rounded-md border border-border/70 bg-muted/20 p-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-sm font-medium">Alerts enabled</div>
                          <div className="text-xs text-muted-foreground">
                            {discordSettings?.configured
                              ? discordSettings.transport === 'bot'
                                ? `Bot transport to channel ${discordSettings.channelId || 'configured channel'}`
                                : discordSettings.webhookUrlPreview
                              : 'Save a bot token + channel ID or a webhook URL first.'}
                          </div>
                        </div>
                        <Switch checked={discordEnabled} onCheckedChange={setDiscordEnabled} />
                      </div>

                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Transport</label>
                          <Select
                            value={discordTransport}
                            onValueChange={(value) =>
                              setDiscordTransport(value as DiscordAlertTransport)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="bot">Bot token</SelectItem>
                              <SelectItem value="webhook">Webhook</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Minimum severity</label>
                          <Select
                            value={discordMinSeverity}
                            onValueChange={(value) =>
                              setDiscordMinSeverity(value as DiscordAlertSeverity)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="info">Info</SelectItem>
                              <SelectItem value="warning">Warning</SelectItem>
                              <SelectItem value="error">Error</SelectItem>
                              <SelectItem value="critical">Critical</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Channel label</label>
                          <Input
                            value={discordChannelLabelInput}
                            onChange={(event) => setDiscordChannelLabelInput(event.target.value)}
                            placeholder="#plum-ops"
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Gateway mode</label>
                          <Select
                            value={discordGatewayMode}
                            onValueChange={(value) =>
                              setDiscordGatewayMode(value as DiscordGatewayMode)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="alerts_only">Alerts only</SelectItem>
                              <SelectItem value="supervisor">Supervisor</SelectItem>
                              <SelectItem value="autonomous">Autonomous</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Maintenance policy</label>
                          <Select
                            value={discordMaintenancePolicy}
                            onValueChange={(value) =>
                              setDiscordMaintenancePolicy(value as DiscordMaintenancePolicy)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="approval_required">Approval required</SelectItem>
                              <SelectItem value="session_mode">Follow session mode</SelectItem>
                              <SelectItem value="autonomous_allowed">Autonomous allowed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/20 p-3">
                          <div>
                            <div className="text-sm font-medium">Inbound jobs</div>
                            <div className="text-xs text-muted-foreground">
                              Authorize Discord-created Plum tasks.
                            </div>
                          </div>
                          <Switch
                            checked={discordInboundJobsEnabled}
                            onCheckedChange={setDiscordInboundJobsEnabled}
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Discord bot token</label>
                          <Input
                            type="password"
                            value={discordBotTokenInput}
                            onChange={(event) => setDiscordBotTokenInput(event.target.value)}
                            placeholder={
                              discordSettings?.botTokenFromEnv
                                ? 'Configured through DISCORD_BOT_TOKEN'
                                : discordSettings?.botTokenConfigured
                                  ? 'Bot token is stored; paste a new one to replace it'
                                  : 'Bot token'
                            }
                            disabled={discordSettings?.botTokenFromEnv}
                            className="font-mono text-sm"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Discord channel ID</label>
                          <Input
                            value={discordChannelIdInput}
                            onChange={(event) => setDiscordChannelIdInput(event.target.value)}
                            placeholder={
                              discordSettings?.channelIdFromEnv
                                ? 'Configured through DISCORD_CHANNEL_ID'
                                : 'Channel ID'
                            }
                            disabled={discordSettings?.channelIdFromEnv}
                            className="font-mono text-sm"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Discord webhook URL{' '}
                          <span className="text-muted-foreground">(optional fallback)</span>
                        </label>
                        <Input
                          type="password"
                          value={discordWebhookInput}
                          onChange={(event) => setDiscordWebhookInput(event.target.value)}
                          placeholder={
                            discordSettings?.webhookUrlFromEnv
                              ? 'Configured through DISCORD_WEBHOOK_URL'
                              : discordSettings?.webhookConfigured
                                ? 'Webhook is stored; paste a new one to replace it'
                                : 'https://discord.com/api/webhooks/...'
                          }
                          disabled={discordSettings?.webhookUrlFromEnv}
                          className="font-mono text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          Bot token and webhook secrets are stored encrypted when ENCRYPTION_KEY is
                          available. Full secrets are never returned to the browser after saving.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Critical role ID <span className="text-muted-foreground">(optional)</span>
                        </label>
                        <Input
                          value={discordCriticalRoleIdInput}
                          onChange={(event) => setDiscordCriticalRoleIdInput(event.target.value)}
                          placeholder="Discord role ID for critical mentions"
                          className="font-mono text-sm"
                        />
                      </div>

                      <div className="grid gap-3 text-sm md:grid-cols-3">
                        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                          <div className="text-xs uppercase text-muted-foreground">Pending</div>
                          <div className="mt-1 text-lg font-semibold">
                            {discordSettings?.outboxPending ?? 0}
                          </div>
                        </div>
                        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                          <div className="text-xs uppercase text-muted-foreground">Failed</div>
                          <div className="mt-1 text-lg font-semibold">
                            {discordSettings?.outboxFailed ?? 0}
                          </div>
                        </div>
                        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                          <div className="text-xs uppercase text-muted-foreground">Last sent</div>
                          <div className="mt-1 truncate font-mono text-xs">
                            {discordSettings?.lastSentAt || '-'}
                          </div>
                        </div>
                      </div>

                      {discordSettings?.lastError && (
                        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                          {discordSettings.lastError}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          onClick={() => {
                            const payload: DiscordIntegrationSettingsUpdate = {
                              enabled: discordEnabled,
                              transport: discordTransport,
                              minSeverity: discordMinSeverity,
                              gatewayMode: discordGatewayMode,
                              maintenancePolicy: discordMaintenancePolicy,
                              inboundJobsEnabled: discordInboundJobsEnabled,
                              channelLabel: discordChannelLabelInput.trim() || null,
                              criticalRoleId: discordCriticalRoleIdInput.trim() || null,
                            };
                            if (discordBotTokenInput.trim()) {
                              payload.botToken = discordBotTokenInput.trim();
                            }
                            if (discordChannelIdInput.trim()) {
                              payload.channelId = discordChannelIdInput.trim();
                            }
                            if (discordWebhookInput.trim()) {
                              payload.webhookUrl = discordWebhookInput.trim();
                            }
                            saveDiscordSettingsMutation.mutate(payload);
                          }}
                          disabled={saveDiscordSettingsMutation.isPending}
                        >
                          {saveDiscordSettingsMutation.isPending ? 'Saving...' : 'Save Discord'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => testDiscordMutation.mutate()}
                          disabled={!discordSettings?.configured || testDiscordMutation.isPending}
                        >
                          <Send className="mr-2 h-4 w-4" />
                          {testDiscordMutation.isPending ? 'Sending...' : 'Send Test'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            saveDiscordSettingsMutation.mutate({ clearWebhookUrl: true })
                          }
                          disabled={
                            saveDiscordSettingsMutation.isPending ||
                            discordSettings?.webhookUrlFromEnv ||
                            !discordSettings?.configured
                          }
                        >
                          Remove stored webhook
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            saveDiscordSettingsMutation.mutate({ clearBotToken: true })
                          }
                          disabled={
                            saveDiscordSettingsMutation.isPending ||
                            discordSettings?.botTokenFromEnv ||
                            !discordSettings?.botTokenConfigured
                          }
                        >
                          Remove stored bot token
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </section>
              </TabsContent>

              {/* Diagnostics Tab */}
              <TabsContent value="diagnostics" className="settings-pane-rail mt-0">
                <Card id="provider-diagnostics" className="border border-border/70">
                  <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base">Provider Diagnostics</CardTitle>
                      <CardDescription>
                        CLI availability, auth state, model discovery, MCP wiring, and capability
                        flags.
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchProviderDiagnostics()}
                      disabled={providerDiagnosticsLoading}
                      className="gap-2"
                    >
                      <RefreshCw
                        className={cn('h-3.5 w-3.5', providerDiagnosticsLoading && 'animate-spin')}
                      />
                      Refresh
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {providerDiagnosticsLoading ? (
                      <div className="text-sm text-muted-foreground">Checking providers...</div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {(providerDiagnostics || []).map((provider) => {
                          const healthy = provider.installed && provider.authenticated;
                          const caps = provider.capabilities;
                          const activeCaps = [
                            caps.nativeVision
                              ? 'native vision'
                              : caps.imageBridge
                                ? 'vision bridge'
                                : null,
                            caps.approvals ? 'approvals' : null,
                            caps.mcp ? `${provider.mcpServerCount} MCP` : null,
                            caps.usageLimits !== 'none' ? caps.usageLimits : null,
                            caps.allowedDirectories ? 'allowed dirs' : null,
                          ].filter((item): item is string => Boolean(item));

                          return (
                            <div
                              key={provider.id}
                              className={cn(
                                'rounded-lg border p-4',
                                healthy
                                  ? 'border-green-500/25 bg-green-500/5'
                                  : 'border-amber-500/25 bg-amber-500/5'
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold">{provider.name}</span>
                                    <span
                                      className={cn(
                                        'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
                                        healthy
                                          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                      )}
                                    >
                                      {healthy ? 'ready' : 'attention'}
                                    </span>
                                  </div>
                                  <p className="mt-1 truncate text-xs text-muted-foreground">
                                    {provider.version || provider.command}
                                  </p>
                                </div>
                                {healthy ? (
                                  <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                                ) : (
                                  <AlertCircle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                                )}
                              </div>

                              <div className="mt-4 grid gap-2 text-xs">
                                <div className="flex justify-between gap-3">
                                  <span className="text-muted-foreground">Binary</span>
                                  <span className="truncate font-mono">
                                    {provider.binaryPath || 'not found'}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span className="text-muted-foreground">Credentials</span>
                                  <span className="truncate font-mono">
                                    {provider.credentialsPath}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span className="text-muted-foreground">Models</span>
                                  <span>
                                    {provider.modelCount} discovered · default{' '}
                                    {provider.defaultModel || 'auto'}
                                  </span>
                                </div>
                                {provider.codexModelsCache && (
                                  <div className="flex justify-between gap-3">
                                    <span className="text-muted-foreground">Codex cache</span>
                                    <span>
                                      {provider.codexModelsCache.exists
                                        ? `${provider.codexModelsCache.modelCount} models`
                                        : 'missing'}
                                    </span>
                                  </div>
                                )}
                              </div>

                              <div className="mt-4 flex flex-wrap gap-1.5">
                                {activeCaps.map((cap) => (
                                  <span key={cap} className="ui-pill ui-pill-subtle text-[11px]">
                                    {cap}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Extensions Tab */}
              <TabsContent value="extensions" className="settings-pane-rail mt-0">
                {/* MCP Servers */}
                <section id="mcp-servers">
                  <div className="settings-section-headband">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold">MCP Servers</h2>
                      {mcpServers && mcpServers.length > 0 && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-muted rounded-full">
                          {mcpServers.length}
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setShowMcpForm(true)}
                      className="gap-1.5 h-8 px-3 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add
                    </Button>
                  </div>

                  {showMcpForm && (
                    <Card className="mb-4 border-primary/30 bg-primary/5 animate-scale-in">
                      <CardHeader className="pb-4">
                        <CardTitle className="text-base">New MCP Server</CardTitle>
                        <CardDescription>
                          Configure a Model Context Protocol server connection
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Server Name</label>
                            <Input
                              value={newMcpServer.name}
                              onChange={(e) =>
                                setNewMcpServer({ ...newMcpServer, name: e.target.value })
                              }
                              placeholder="My Server"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Type</label>
                            <select
                              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                              value={newMcpServer.type}
                              onChange={(e) =>
                                setNewMcpServer({
                                  ...newMcpServer,
                                  type: e.target.value as 'subprocess' | 'sse',
                                })
                              }
                            >
                              <option value="subprocess">Subprocess</option>
                              <option value="sse">SSE (Server-Sent Events)</option>
                            </select>
                          </div>
                        </div>
                        {newMcpServer.type === 'subprocess' ? (
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Command</label>
                            <Input
                              value={newMcpServer.command}
                              onChange={(e) =>
                                setNewMcpServer({ ...newMcpServer, command: e.target.value })
                              }
                              placeholder="npx @modelcontextprotocol/server-filesystem"
                              className="font-mono text-sm"
                            />
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <label className="text-sm font-medium">URL</label>
                            <Input
                              value={newMcpServer.url}
                              onChange={(e) =>
                                setNewMcpServer({ ...newMcpServer, url: e.target.value })
                              }
                              placeholder="https://api.example.com/mcp/sse"
                              className="font-mono text-sm"
                            />
                          </div>
                        )}
                        <div className="flex gap-3 pt-2">
                          <Button
                            onClick={() => createMcpMutation.mutate(newMcpServer)}
                            disabled={!newMcpServer.name || createMcpMutation.isPending}
                          >
                            {createMcpMutation.isPending ? 'Adding...' : 'Add Server'}
                          </Button>
                          <Button variant="ghost" onClick={() => setShowMcpForm(false)}>
                            Cancel
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {mcpServers && mcpServers.length > 0 ? (
                    <div className="space-y-2">
                      {mcpServers.map((server) => {
                        const testResult = mcpTestResults[server.id];
                        return (
                          <div
                            key={server.id}
                            className={cn(
                              'group flex items-center gap-4 p-4 rounded-xl border bg-card transition-all hover:border-primary/30 hover:shadow-sm',
                              testResult?.connected === true && 'border-green-500/30',
                              testResult?.connected === false && 'border-red-500/30'
                            )}
                          >
                            <div
                              className={cn(
                                'p-2.5 rounded-lg transition-colors',
                                testResult?.connected === true
                                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                  : testResult?.connected === false
                                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                                    : server.type === 'subprocess'
                                      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                      : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                              )}
                            >
                              {testResult?.testing ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : testResult?.connected === true ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : testResult?.connected === false ? (
                                <AlertCircle className="h-4 w-4" />
                              ) : (
                                <Server className="h-4 w-4" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium">{server.name}</p>
                                {server.readOnly && (
                                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                    <Lock className="h-3 w-3" />
                                    Global
                                  </span>
                                )}
                                {testResult?.connected === true && (
                                  <span className="text-xs text-green-600 dark:text-green-400">
                                    Connected
                                  </span>
                                )}
                                {testResult?.connected === false && (
                                  <span className="text-xs text-red-600 dark:text-red-400">
                                    Failed
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground font-mono truncate">
                                {server.type === 'subprocess' ? server.command : server.url}
                              </p>
                              {testResult?.error && (
                                <p className="text-xs text-red-500 truncate mt-0.5">
                                  {testResult.error}
                                </p>
                              )}
                            </div>
                            <span
                              className={cn(
                                'px-2.5 py-1 text-xs rounded-full font-medium shrink-0',
                                server.type === 'subprocess'
                                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                  : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                              )}
                            >
                              {server.type.toUpperCase()}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => testMcpServer(server.id)}
                              disabled={testResult?.testing}
                              className="h-8 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              {testResult?.testing ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Zap className="h-4 w-4" />
                              )}
                              <span className="ml-1 text-xs">Test</span>
                            </Button>
                            {!server.readOnly && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteMcpMutation.mutate(server.id)}
                                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    !showMcpForm && (
                      <Card className="border-dashed">
                        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                          <div className="p-4 rounded-full bg-muted/50 mb-4">
                            <Server className="h-8 w-8 text-muted-foreground/50" />
                          </div>
                          <p className="font-medium text-muted-foreground mb-1">
                            No MCP servers configured
                          </p>
                          <p className="text-sm text-muted-foreground/70 max-w-xs">
                            Add Model Context Protocol servers to extend Claude's capabilities
                          </p>
                        </CardContent>
                      </Card>
                    )
                  )}
                </section>

                <CapabilityCatalogSections
                  agents={claudeAgents}
                  skills={claudeSkills}
                  configProvider={configProvider}
                />
                {/* Codex Marketplace */}
                <section id="codex-marketplace">
                  <div className="settings-section-headband">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold">Codex Marketplace</h2>
                      {codexPlugins && codexPlugins.length > 0 && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">
                          {enabledCodexPlugins.length}/{codexPlugins.length}
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCodexMarketplaceBrowserOpen(true)}
                      className="gap-1.5 h-8 px-3 text-xs"
                    >
                      <Store className="h-3.5 w-3.5" />
                      Browse
                    </Button>
                  </div>

                  <Card>
                    <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
                          <Puzzle className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">Official Codex plugins</p>
                          <p className="text-xs text-muted-foreground">
                            Browse OpenAI-curated plugins and enable them for new Codex sessions.
                          </p>
                          {enabledCodexPlugins.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {enabledCodexPlugins.slice(0, 6).map((plugin) => (
                                <span
                                  key={plugin.id}
                                  className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400"
                                >
                                  {plugin.displayName}
                                </span>
                              ))}
                              {enabledCodexPlugins.length > 6 && (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  +{enabledCodexPlugins.length - 6}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => setCodexMarketplaceBrowserOpen(true)}
                        className="shrink-0 gap-1.5"
                      >
                        <Store className="h-4 w-4" />
                        Open Marketplace
                      </Button>
                    </CardContent>
                  </Card>
                </section>

                {/* Plugins */}
                <section id="plugins">
                  <div className="settings-section-headband">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold">Plugins</h2>
                      {installedPlugins && installedPlugins.length > 0 && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-violet-500/10 text-violet-600 dark:text-violet-400 rounded-full">
                          {filteredPlugins.length}/{installedPlugins.length}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setMarketplaceBrowserOpen(true)}
                        className="gap-1.5 h-8 px-3 text-xs"
                      >
                        <Store className="h-3.5 w-3.5" />
                        Browse
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => openPluginEditor('create')}
                        className="gap-1.5 h-8 px-3 text-xs bg-violet-600 hover:bg-violet-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Create
                      </Button>
                    </div>
                  </div>

                  {/* Search input */}
                  {installedPlugins && installedPlugins.length > 0 && (
                    <div className="relative mb-4">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={pluginSearchQuery}
                        onChange={(e) => setPluginSearchQuery(e.target.value)}
                        placeholder="Search plugins by name, description, category..."
                        className="pl-10 pr-10"
                      />
                      {pluginSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setPluginSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
                        >
                          <X className="h-4 w-4 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  )}

                  {installedPlugins && installedPlugins.length > 0 ? (
                    filteredPlugins.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {filteredPlugins.map((plugin) => {
                          const baseName =
                            plugin.source === 'user'
                              ? plugin.dirPath.split('/').pop()?.replace('.disabled', '') ||
                                plugin.name
                              : plugin.name;
                          const isUserPlugin = plugin.source === 'user';

                          return (
                            <Card
                              key={plugin.id}
                              className={cn(
                                'group relative overflow-hidden transition-all hover:shadow-md',
                                plugin.enabled
                                  ? 'hover:border-violet-500/30'
                                  : 'opacity-60 hover:opacity-80'
                              )}
                            >
                              <CardContent className="pt-5 pb-4">
                                <div className="flex items-start gap-3">
                                  <div
                                    className={cn(
                                      'p-2 rounded-lg shrink-0',
                                      plugin.enabled
                                        ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
                                        : 'bg-muted text-muted-foreground'
                                    )}
                                  >
                                    <Puzzle className="h-4 w-4" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <p className="font-semibold truncate">{plugin.name}</p>
                                      {!plugin.enabled && (
                                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground shrink-0">
                                          Disabled
                                        </span>
                                      )}
                                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground shrink-0">
                                        v{plugin.version}
                                      </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                      {plugin.description || 'No description'}
                                    </p>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                      <span
                                        className={cn(
                                          'px-1.5 py-0.5 text-[10px] rounded',
                                          isUserPlugin
                                            ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
                                            : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                        )}
                                      >
                                        {isUserPlugin ? 'User' : `@${plugin.marketplace}`}
                                      </span>
                                      {plugin.category && (
                                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted/70 text-muted-foreground">
                                          {plugin.category}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Action buttons */}
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {isUserPlugin && (
                                    <>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => togglePluginMutation.mutate(baseName)}
                                        title={plugin.enabled ? 'Disable' : 'Enable'}
                                      >
                                        {plugin.enabled ? (
                                          <ToggleRight className="h-4 w-4 text-violet-600" />
                                        ) : (
                                          <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                                        )}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => openPluginEditor('edit', plugin)}
                                        title="Edit"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                    </>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => deletePluginMutation.mutate(plugin.id)}
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    title="Delete"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </CardContent>
                              <div
                                className={cn(
                                  'absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-violet-500/50 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity',
                                  !plugin.enabled &&
                                    'from-muted-foreground/30 to-muted-foreground/10'
                                )}
                              />
                            </Card>
                          );
                        })}
                      </div>
                    ) : (
                      <Card className="border-dashed">
                        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                          <Search className="h-8 w-8 text-muted-foreground/50 mb-3" />
                          <p className="font-medium text-muted-foreground mb-1">
                            No matching plugins
                          </p>
                          <p className="text-sm text-muted-foreground/70 max-w-xs mb-3">
                            No plugins found matching "{pluginSearchQuery}"
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPluginSearchQuery('')}
                            className="gap-2"
                          >
                            <X className="h-4 w-4" />
                            Clear search
                          </Button>
                        </CardContent>
                      </Card>
                    )
                  ) : (
                    <Card className="border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="p-4 rounded-full bg-violet-500/10 mb-4">
                          <Puzzle className="h-8 w-8 text-violet-500/50" />
                        </div>
                        <p className="font-medium text-muted-foreground mb-1">
                          No plugins installed
                        </p>
                        <p className="text-sm text-muted-foreground/70 max-w-xs mb-4">
                          Create custom plugins or install from marketplaces
                        </p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setMarketplaceBrowserOpen(true)}
                            className="gap-2"
                          >
                            <Store className="h-4 w-4" />
                            Browse Marketplace
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => openPluginEditor('create')}
                            className="gap-2 bg-violet-600 hover:bg-violet-700"
                          >
                            <Plus className="h-4 w-4" />
                            Create Plugin
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Marketplaces */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Store className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-muted-foreground">
                          Marketplaces
                        </span>
                        {marketplaces && marketplaces.length > 0 && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground">
                            {marketplaces.length}
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setMarketplaceBrowserOpen(true)}
                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Manage
                      </Button>
                    </div>
                    {marketplaces && marketplaces.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {marketplaces.map((mp) => (
                          <button
                            type="button"
                            key={mp.id}
                            onClick={() => setMarketplaceBrowserOpen(true)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border text-sm hover:border-violet-500/30 transition-colors"
                          >
                            <span className="font-medium">{mp.name}</span>
                            {mp.plugins && (
                              <span className="text-xs text-muted-foreground">
                                ({mp.plugins.length} plugins)
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No marketplaces added. Click "Manage" to add one.
                      </p>
                    )}
                  </div>
                </section>
              </TabsContent>

              {isAdmin && (
                <TabsContent value="admin" className="space-y-6">
                  <Tabs
                    value={activeAdminTab}
                    onValueChange={handleAdminTabChange}
                    className="w-full"
                  >
                    <TabsList className="grid h-11 w-full max-w-xl grid-cols-3">
                      <TabsTrigger value="overview" className="gap-2">
                        <LayoutDashboard className="h-4 w-4" />
                        <span className="hidden sm:inline">Overview</span>
                      </TabsTrigger>
                      <TabsTrigger value="users" className="gap-2">
                        <Users className="h-4 w-4" />
                        <span className="hidden sm:inline">Users</span>
                      </TabsTrigger>
                      <TabsTrigger value="audit-log" className="gap-2">
                        <FileText className="h-4 w-4" />
                        <span className="hidden sm:inline">Audit Log</span>
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-4">
                      <AdminOverviewPage />
                    </TabsContent>
                    <TabsContent value="users" className="space-y-4">
                      <AdminUsersPage />
                    </TabsContent>
                    <TabsContent value="audit-log" className="space-y-4">
                      <AdminAuditLogPage />
                    </TabsContent>
                  </Tabs>
                </TabsContent>
              )}
            </div>
          </main>
        </Tabs>

        {/* Dialogs */}
        <FolderBrowserDialog
          open={showFolderBrowser}
          onOpenChange={setShowFolderBrowser}
          value={settings?.defaultWorkingDir || ''}
          onChange={(path) => {
            updateSettingsMutation.mutate({ defaultWorkingDir: path });
          }}
        />

        <PluginEditorDialog
          open={pluginEditorOpen}
          onOpenChange={setPluginEditorOpen}
          mode={pluginEditorMode}
          initialData={editingPlugin?.data}
          editName={editingPlugin?.name}
          configProvider={configProvider}
        />

        <MarketplaceBrowserDialog
          open={marketplaceBrowserOpen}
          onOpenChange={setMarketplaceBrowserOpen}
          configProvider={configProvider}
        />

        <MarketplaceBrowserDialog
          open={codexMarketplaceBrowserOpen}
          onOpenChange={setCodexMarketplaceBrowserOpen}
          configProvider="codex"
        />

        {/* OpenCode Provider Dialog */}
        <Dialog open={openCodeProviderDialog} onOpenChange={setOpenCodeProviderDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {dialogStoredProvider?.hasKey
                  ? 'Update OpenCode Provider'
                  : 'Add OpenCode Provider'}
              </DialogTitle>
              <DialogDescription>
                Wähle einen Provider aus der Liste und hinterlege den passenden API Key
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Provider Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Provider auswählen</label>
                <Select
                  value={selectedProviderId}
                  onValueChange={(value) => {
                    setSelectedProviderId(value);
                    const provider = availableProviders?.[value];
                    const stored = openCodeProviderById.get(value);
                    if (provider) {
                      setOpenCodeProviderForm({
                        ...openCodeProviderForm,
                        id: value,
                        name: stored?.name || provider.name,
                        baseUrl: stored?.baseUrl || provider.api || '',
                      });
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Provider auswählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(availableProviders || {}).map(([id, provider]) => (
                      <SelectItem key={id} value={id}>
                        <div className="flex flex-col">
                          <span className="font-medium">{provider.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {id}
                            {provider.models?.length ? ` - ${provider.models.length} Modelle` : ''}
                            {provider.configured ? ' - konfiguriert' : ''}
                            {provider.description ? ` - ${provider.description}` : ''}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedProviderId && (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {dialogAvailableProvider?.name || openCodeProviderForm.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {dialogStoredProvider?.hasKey
                          ? 'A key is already saved. Leave the field empty to keep it.'
                          : 'No key is saved yet.'}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
                        dialogStoredProvider?.hasKey
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      )}
                    >
                      {dialogStoredProvider?.hasKey ? 'configured' : 'missing key'}
                    </span>
                  </div>
                  {dialogEnvVars.length > 0 && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      OpenCode env:{' '}
                      <span className="font-mono">{dialogEnvVars.slice(0, 4).join(', ')}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Available Models for selected provider */}
              {selectedProviderId && availableProviders?.[selectedProviderId]?.models && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Verfügbare Modelle</label>
                  <div className="p-3 bg-muted/50 rounded-lg space-y-1">
                    {availableProviders[selectedProviderId].models?.map((model) => (
                      <div key={model} className="flex items-center justify-between text-sm">
                        <code className="text-xs bg-background px-2 py-1 rounded font-mono">
                          {selectedProviderId}/{model}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            const fullModel = `${selectedProviderId}/${model}`;
                            const current = openCodeModels || [];
                            if (!current.includes(fullModel)) {
                              updateSettingsMutation.mutate({
                                cliProviderModelLists: {
                                  ...settings?.cliProviderModelLists,
                                  opencode: [...current, fullModel],
                                },
                              });
                            }
                          }}
                        >
                          {openCodeModels.includes(`${selectedProviderId}/${model}`)
                            ? 'Hinzugefügt'
                            : 'Hinzufügen'}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* API Key */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  API Key {dialogStoredProvider?.hasKey ? '(optional)' : ''}
                </label>
                <div className="relative">
                  <Input
                    type={showOpenCodeApiKey ? 'text' : 'password'}
                    value={openCodeProviderForm.apiKey}
                    onChange={(e) =>
                      setOpenCodeProviderForm({ ...openCodeProviderForm, apiKey: e.target.value })
                    }
                    placeholder={
                      dialogStoredProvider?.hasKey
                        ? 'Leer lassen, um den gespeicherten Key zu behalten'
                        : 'sk-... oder provider-spezifischer Key'
                    }
                    className="font-mono text-sm pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOpenCodeApiKey(!showOpenCodeApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                  >
                    {showOpenCodeApiKey ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Der API Key wird verschlüsselt gespeichert und beim OpenCode-Start als Provider
                  Env gesetzt.
                </p>
              </div>

              {/* Optional Base URL */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Base URL (optional)</label>
                <Input
                  value={openCodeProviderForm.baseUrl}
                  onChange={(e) =>
                    setOpenCodeProviderForm({ ...openCodeProviderForm, baseUrl: e.target.value })
                  }
                  placeholder="https://api.example.com/v1"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Nur erforderlich für Custom Endpoints
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpenCodeProviderDialog(false);
                  setSelectedProviderId('');
                  setOpenCodeProviderForm({ id: '', name: '', apiKey: '', baseUrl: '' });
                }}
              >
                Abbrechen
              </Button>
              <Button
                onClick={saveOpenCodeProvider}
                disabled={
                  !openCodeProviderForm.id ||
                  (!openCodeProviderForm.apiKey && !dialogStoredProvider?.hasKey)
                }
                className="bg-purple-600 hover:bg-purple-700"
              >
                {dialogStoredProvider?.hasKey ? 'Provider aktualisieren' : 'Provider speichern'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
