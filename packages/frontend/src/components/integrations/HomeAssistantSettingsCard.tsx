import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Home, Loader2, Trash2, Zap } from 'lucide-react';
import type {
  ApiResponse,
  HomeAssistantConnectionTest,
  HomeAssistantIntegrationSettings,
  HomeAssistantIntegrationSettingsUpdate,
} from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

function errorMessage(error: unknown): string {
  const apiMessage = (error as { response?: { data?: { error?: { message?: string } } } })?.response
    ?.data?.error?.message;
  return apiMessage || (error instanceof Error ? error.message : 'Request failed');
}

export function HomeAssistantSettingsCard() {
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const [baseUrl, setBaseUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [testResult, setTestResult] = useState<HomeAssistantConnectionTest | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['home-assistant-settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<HomeAssistantIntegrationSettings>>(
        '/api/home-assistant/settings'
      );
      return response.data.data;
    },
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setBaseUrl(settingsQuery.data.baseUrl || '');
    setEnabled(settingsQuery.data.enabled);
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (payload: HomeAssistantIntegrationSettingsUpdate) => {
      const response = await api.put<ApiResponse<HomeAssistantIntegrationSettings>>(
        '/api/home-assistant/settings',
        payload
      );
      return response.data.data;
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(['home-assistant-settings'], settings);
      queryClient.invalidateQueries({ queryKey: ['home-assistant-lights'] });
      setAccessToken('');
      toast({ title: 'Home-Assistant-Einstellungen gespeichert' });
    },
    onError: (error) => {
      toast({
        title: 'Home-Assistant-Fehler',
        description: errorMessage(error),
        variant: 'destructive',
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<HomeAssistantConnectionTest>>(
        '/api/home-assistant/test',
        {
          ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
          ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
        }
      );
      return response.data.data;
    },
    onSuccess: (result) => {
      setTestResult(result || null);
      toast({
        title: 'Home Assistant verbunden',
        description: `${result?.locationName || 'Home Assistant'} · ${result?.lightCount ?? 0} Lampen`,
      });
    },
    onError: (error) => {
      setTestResult(null);
      toast({
        title: 'Verbindung fehlgeschlagen',
        description: errorMessage(error),
        variant: 'destructive',
      });
    },
  });

  const settings = settingsQuery.data;
  const statusLabel = settings?.configured
    ? settings.enabled
      ? 'Active'
      : 'Configured'
    : 'Not configured';

  return (
    <section id="home-assistant-integration">
      <div className="settings-section-headband">
        <h2 className="text-lg font-semibold">Home Assistant</h2>
        <Home className="h-4 w-4 text-muted-foreground" />
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-base">
                Physical session status lights
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {statusLabel}
                </span>
              </CardTitle>
              <CardDescription>
                Connect Plum to Home Assistant once, then assign any light entity to each session.
                Goal completion pulses green, problems pulse red, and questions use a blue
                heartbeat. Plum restores the previous light state afterwards.
              </CardDescription>
            </div>
            <Zap className="h-5 w-5 shrink-0 text-primary" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isAdmin ? (
            <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
              An administrator manages the Home Assistant connection. You can assign available
              lights from each session's settings.
            </div>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Home Assistant URL</label>
                  <Input
                    type="url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="http://homeassistant.local:8123"
                    className="font-mono text-sm"
                    disabled={settings?.baseUrlFromEnv}
                  />
                  {settings?.baseUrlFromEnv && (
                    <p className="text-xs text-muted-foreground">Provided by HOME_ASSISTANT_URL.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Long-lived access token</label>
                  <Input
                    type="password"
                    value={accessToken}
                    onChange={(event) => setAccessToken(event.target.value)}
                    placeholder={settings?.accessTokenConfigured ? 'Token saved' : 'Paste token'}
                    className="font-mono text-sm"
                    disabled={settings?.accessTokenFromEnv}
                  />
                  <p className="text-xs text-muted-foreground">
                    Create one in Home Assistant under Profile → Security → Long-lived access
                    tokens.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Enable session lights</p>
                  <p className="text-xs text-muted-foreground">
                    Disabled connections keep assignments but send no light commands.
                  </p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              {testResult?.connected && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    Connected to {testResult.locationName || 'Home Assistant'}
                    {testResult.version ? ` ${testResult.version}` : ''} · {testResult.lightCount}{' '}
                    lights
                  </span>
                </div>
              )}

              {settingsQuery.isError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" /> Could not load Home Assistant settings.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    saveMutation.mutate({
                      enabled,
                      baseUrl: baseUrl.trim(),
                      ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
                    })
                  }
                  disabled={saveMutation.isPending || !baseUrl.trim()}
                >
                  {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || !baseUrl.trim()}
                >
                  {testMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Test connection
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => saveMutation.mutate({ enabled: false, clearAccessToken: true })}
                  disabled={saveMutation.isPending || !settings?.accessTokenConfigured}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Remove token
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
