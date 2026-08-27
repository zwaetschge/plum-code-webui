import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Circle,
  Link2,
  Loader2,
  MonitorSmartphone,
  Play,
  Plug,
  RefreshCw,
  Smartphone,
  Square,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type {
  AndroidDeviceSnapshot,
  AndroidKnownDevice,
  AndroidLiveDevice,
  AndroidPairResult,
  ApiResponse,
} from '@plum-code-webui/shared';

interface AndroidDevicePanelProps {
  sessionId: string;
  className?: string;
}

interface ConnectResult {
  connect: unknown;
  selectedSerial: string | null;
  replacedSerial?: string;
  devices: AndroidDeviceSnapshot;
}

interface AndroidEmulatorStatus {
  status: 'stopped' | 'starting' | 'running' | 'error';
  vncUrl?: string | null;
}

function hostPortOf(device: AndroidLiveDevice | AndroidKnownDevice): {
  host: string;
  port: string;
} | null {
  const known = device as AndroidKnownDevice;
  const serial = String(known.serial || '');
  const match = /^(.+):(\d+)$/.exec(serial);
  const host = String(known.host || match?.[1] || '').trim();
  if (!host) return null;
  const port = known.port ? String(known.port) : match?.[2] || '5555';
  return { host, port };
}

function serialOf(device: AndroidLiveDevice | AndroidKnownDevice): string {
  return String(device.serial || device.id || device.name || '').trim();
}

function titleOf(device: AndroidLiveDevice | AndroidKnownDevice): string {
  const friendly = typeof device.friendlyName === 'string' ? device.friendlyName.trim() : '';
  const model = typeof device.model === 'string' ? device.model.trim() : '';
  const serial = serialOf(device);
  return friendly || model || serial || 'Unknown device';
}

function subtitleOf(device: AndroidLiveDevice | AndroidKnownDevice): string {
  const serial = serialOf(device);
  const host = typeof device.host === 'string' ? device.host : '';
  const port = typeof device.port === 'number' ? device.port : undefined;
  const state = typeof device.state === 'string' ? device.state : '';
  const bits = [serial, host && port ? `${host}:${port}` : host, state].filter(Boolean);
  return bits.join(' · ');
}

function deviceTone(device: AndroidLiveDevice | AndroidKnownDevice): 'live' | 'warn' | 'idle' {
  const state = typeof device.state === 'string' ? device.state.toLowerCase() : '';
  if (!state || state === 'device' || state === 'online') return 'live';
  if (state === 'offline' || state === 'unauthorized') return 'warn';
  return 'idle';
}

function Row({
  device,
  selected,
  live,
  onSelect,
  onForget,
  onReconnectPort,
  busy,
}: {
  device: AndroidLiveDevice | AndroidKnownDevice;
  selected: boolean;
  live?: boolean;
  onSelect: (serial: string) => void;
  onForget?: (serial: string) => void;
  onReconnectPort?: (device: AndroidKnownDevice, port: string) => void;
  busy?: boolean;
}) {
  const serial = serialOf(device);
  const tone = live ? deviceTone(device) : 'idle';
  const Dot = selected ? CheckCircle2 : Circle;
  const hostPort = onReconnectPort ? hostPortOf(device) : null;
  const [portOpen, setPortOpen] = useState(false);
  const [portValue, setPortValue] = useState(hostPort?.port || '5555');

  const submitPort = () => {
    const port = portValue.trim();
    if (!port || !onReconnectPort) return;
    onReconnectPort(device as AndroidKnownDevice, port);
    setPortOpen(false);
  };

  return (
    <div
      className={cn(
        'rounded-md border px-2.5 py-2',
        selected ? 'border-primary/40 bg-primary/10' : 'border-border/45 bg-foreground/[0.02]'
      )}
    >
      <div className="flex items-center gap-2">
        <Dot
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            selected && 'text-primary',
            !selected && tone === 'live' && 'text-emerald-500',
            !selected && tone === 'warn' && 'text-amber-500',
            !selected && tone === 'idle' && 'text-muted-foreground'
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground">{titleOf(device)}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {subtitleOf(device) || 'No serial'}
          </div>
        </div>
        <Button
          type="button"
          variant={selected ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={!serial || selected || busy}
          onClick={() => onSelect(serial)}
        >
          Use
        </Button>
        {hostPort && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'h-7 w-7 text-muted-foreground hover:text-foreground',
              portOpen && 'text-primary'
            )}
            disabled={busy}
            onClick={() => {
              setPortValue(hostPort.port);
              setPortOpen((open) => !open);
            }}
            title="Reconnect on a new port"
          >
            <Plug className="h-3.5 w-3.5" />
          </Button>
        )}
        {onForget && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            disabled={!serial || busy}
            onClick={() => onForget(serial)}
            title="Forget device"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {hostPort && portOpen && (
        <div className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-[11px] text-muted-foreground">{hostPort.host}:</span>
          <Input
            autoFocus
            value={portValue}
            onChange={(event) => setPortValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitPort();
              if (event.key === 'Escape') setPortOpen(false);
            }}
            placeholder="New port"
            inputMode="numeric"
            className="h-7 flex-1 text-[11px]"
          />
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={!portValue.trim() || busy}
            onClick={submitPort}
          >
            Connect
          </Button>
        </div>
      )}
    </div>
  );
}

export function AndroidDevicePanel({ sessionId, className }: AndroidDevicePanelProps) {
  const queryClient = useQueryClient();
  const [pairHost, setPairHost] = useState('');
  const [pairPort, setPairPort] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [connectPort, setConnectPort] = useState('5555');
  const [friendlyName, setFriendlyName] = useState('');
  const [connectHost, setConnectHost] = useState('');
  const [connectHostPort, setConnectHostPort] = useState('5555');
  const [screenshotVersion, setScreenshotVersion] = useState(() => Date.now());

  const devicesQuery = useQuery({
    queryKey: ['android-devices', sessionId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AndroidDeviceSnapshot>>(
        `/api/android/devices?sessionId=${encodeURIComponent(sessionId)}`
      );
      return response.data.data;
    },
    enabled: !!sessionId,
    refetchInterval: 5000,
  });

  const snapshot = devicesQuery.data;
  const liveSerials = useMemo(
    () => new Set((snapshot?.live || []).map((device) => serialOf(device)).filter(Boolean)),
    [snapshot?.live]
  );
  const knownOnly = useMemo(
    () => (snapshot?.known || []).filter((device) => !liveSerials.has(serialOf(device))),
    [liveSerials, snapshot?.known]
  );
  const selectedSerial = snapshot?.selectedSerial || null;
  const emulatorSerial = useMemo(() => {
    const live = snapshot?.live || [];
    const selected = live.find((device) => serialOf(device) === selectedSerial);
    if (selected?.type === 'emulator') return serialOf(selected);
    const emulator = live.find((device) => device.type === 'emulator');
    return emulator ? serialOf(emulator) : '';
  }, [selectedSerial, snapshot?.live]);

  const emulatorQuery = useQuery({
    queryKey: ['android-emulator-status'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AndroidEmulatorStatus>>(
        '/api/android/emulator/status'
      );
      return response.data.data;
    },
    refetchInterval: 2500,
  });

  const emulatorRunning = emulatorQuery.data?.status === 'running';

  const startEmulatorMutation = useMutation({
    mutationFn: async () => api.post('/api/android/emulator/start', {}),
    onSuccess: () => {
      emulatorQuery.refetch();
      toast({ title: 'Android emulator starting' });
    },
    onError: (error) => {
      toast({
        title: 'Emulator start failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const stopEmulatorMutation = useMutation({
    mutationFn: async () => api.post('/api/android/emulator/stop', {}),
    onSuccess: () => {
      emulatorQuery.refetch();
      toast({ title: 'Android emulator stopped' });
    },
    onError: (error) => {
      toast({
        title: 'Emulator stop failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  useEffect(() => {
    if (!emulatorRunning || !emulatorSerial) return;
    const timer = window.setInterval(() => setScreenshotVersion(Date.now()), 2000);
    return () => window.clearInterval(timer);
  }, [emulatorRunning, emulatorSerial]);

  const refresh = async () => {
    await devicesQuery.refetch();
  };

  const onSnapshot = (next?: AndroidDeviceSnapshot) => {
    if (next) {
      queryClient.setQueryData(['android-devices', sessionId], next);
    } else {
      queryClient.invalidateQueries({ queryKey: ['android-devices', sessionId] });
    }
    queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
  };

  const selectMutation = useMutation({
    mutationFn: async (serial: string | null) => {
      const response = await api.put<ApiResponse<AndroidDeviceSnapshot>>(
        `/api/android/sessions/${encodeURIComponent(sessionId)}/device`,
        { serial }
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      onSnapshot(data);
      toast({ title: data?.selectedSerial ? 'Android device selected' : 'Android device cleared' });
    },
    onError: (error) => {
      toast({
        title: 'Device selection failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const reconnectMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<
        ApiResponse<{ result: unknown; devices: AndroidDeviceSnapshot }>
      >(`/api/android/devices/reconnect-all?sessionId=${encodeURIComponent(sessionId)}`);
      return response.data.data;
    },
    onSuccess: (data) => {
      onSnapshot(data?.devices);
      toast({ title: 'Reconnect requested' });
    },
    onError: (error) => {
      toast({
        title: 'Reconnect failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const pairMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<AndroidPairResult>>('/api/android/devices/pair', {
        sessionId,
        host: pairHost.trim(),
        port: Number(pairPort),
        pairingCode: pairCode.trim(),
        connectPort: Number(connectPort || 5555),
        friendlyName: friendlyName.trim() || undefined,
        connectAfterPair: true,
        selectForSession: true,
      });
      return response.data.data;
    },
    onSuccess: (data) => {
      onSnapshot(data?.devices);
      setPairCode('');
      toast({
        title: data?.connectError ? 'Paired, connect failed' : 'Android device paired',
        description: data?.connectError,
        variant: data?.connectError ? 'destructive' : undefined,
      });
    },
    onError: (error) => {
      toast({
        title: 'Pairing failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<ConnectResult>>('/api/android/devices/connect', {
        sessionId,
        host: connectHost.trim(),
        port: Number(connectHostPort || 5555),
        friendlyName: friendlyName.trim() || undefined,
        selectForSession: true,
      });
      return response.data.data;
    },
    onSuccess: (data) => {
      onSnapshot(data?.devices);
      toast({ title: 'Android device connected' });
    },
    onError: (error) => {
      toast({
        title: 'Connect failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  // Wireless debugging picks a new port on every restart. Reconnect the phone we
  // already paired with instead of walking the whole pair flow again.
  const reconnectPortMutation = useMutation({
    mutationFn: async ({ device, port }: { device: AndroidKnownDevice; port: string }) => {
      const hostPort = hostPortOf(device);
      if (!hostPort) throw new Error('Device has no host to reconnect to');
      const response = await api.post<ApiResponse<ConnectResult>>('/api/android/devices/connect', {
        sessionId,
        host: hostPort.host,
        port: Number(port),
        friendlyName: device.friendlyName || undefined,
        selectForSession: true,
        replaceSerial: serialOf(device),
      });
      return response.data.data;
    },
    onSuccess: (data) => {
      onSnapshot(data?.devices);
      toast({
        title: 'Reconnected',
        description: data?.selectedSerial ? `Now on ${data.selectedSerial}` : undefined,
      });
    },
    onError: (error) => {
      toast({
        title: 'Reconnect failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const forgetMutation = useMutation({
    mutationFn: async (serial: string) => {
      await api.delete(`/api/android/devices/${encodeURIComponent(serial)}`);
      return serial;
    },
    onSuccess: (serial) => {
      if (selectedSerial === serial) {
        selectMutation.mutate(null);
      } else {
        onSnapshot();
      }
      toast({ title: 'Device forgotten' });
    },
    onError: (error) => {
      toast({
        title: 'Forget failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const busy =
    devicesQuery.isFetching ||
    selectMutation.isPending ||
    reconnectMutation.isPending ||
    pairMutation.isPending ||
    connectMutation.isPending ||
    forgetMutation.isPending ||
    reconnectPortMutation.isPending ||
    startEmulatorMutation.isPending ||
    stopEmulatorMutation.isPending;

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background/20', className)}>
      <div className="shrink-0 border-b border-border/50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Smartphone className="h-4 w-4 text-primary" />
              <span>Android</span>
            </div>
            <div className="mt-1 truncate text-[11px] text-muted-foreground">
              {selectedSerial || 'No device selected'}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={refresh}
              disabled={busy}
              title="Refresh"
            >
              {devicesQuery.isFetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => selectMutation.mutate(null)}
              disabled={!selectedSerial || busy}
              title="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {devicesQuery.error && (
          <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            {devicesQuery.error instanceof Error ? devicesQuery.error.message : 'Builder offline'}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <section className="mb-4 rounded-lg border border-border/50 bg-foreground/[0.02] p-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <MonitorSmartphone className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground">Android emulator</div>
                <div className="text-[10px] text-muted-foreground">
                  {emulatorQuery.data?.status || (emulatorQuery.isLoading ? 'checking' : 'unknown')}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Start emulator"
                disabled={busy || emulatorRunning || emulatorQuery.data?.status === 'starting'}
                onClick={() => startEmulatorMutation.mutate()}
              >
                {startEmulatorMutation.isPending || emulatorQuery.data?.status === 'starting' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Stop emulator"
                disabled={busy || !emulatorRunning}
                onClick={() => stopEmulatorMutation.mutate()}
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {emulatorRunning && emulatorSerial ? (
            <img
              src={`/api/android/devices/${encodeURIComponent(emulatorSerial)}/screenshot.png?t=${screenshotVersion}`}
              alt="Live Android emulator screen"
              className="mx-auto max-h-[420px] w-auto max-w-full rounded-md border border-border/50 bg-black object-contain"
              draggable={false}
            />
          ) : (
            <div className="flex h-28 items-center justify-center rounded-md border border-dashed border-border/50 bg-black/20 px-3 text-center text-[11px] text-muted-foreground">
              {emulatorQuery.data?.status === 'starting'
                ? 'Booting the emulator…'
                : 'Start the emulator to see its live screen.'}
            </div>
          )}
        </section>

        <div className="mb-4 flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 flex-1 gap-1.5 text-xs"
            onClick={() => reconnectMutation.mutate()}
            disabled={busy}
          >
            {reconnectMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wifi className="h-3.5 w-3.5" />
            )}
            Reconnect
          </Button>
        </div>

        <section className="mb-4">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Live
          </div>
          <div className="space-y-2">
            {(snapshot?.live || []).length === 0 ? (
              <div className="rounded-md border border-border/45 bg-foreground/[0.02] px-3 py-2 text-xs text-muted-foreground">
                Empty
              </div>
            ) : (
              snapshot!.live.map((device) => {
                const serial = serialOf(device);
                return (
                  <Row
                    key={serial || JSON.stringify(device)}
                    device={device}
                    live
                    selected={!!serial && serial === selectedSerial}
                    onSelect={(nextSerial) => selectMutation.mutate(nextSerial)}
                    busy={busy}
                  />
                );
              })
            )}
          </div>
        </section>

        <section className="mb-4">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Known
          </div>
          <div className="space-y-2">
            {knownOnly.length === 0 ? (
              <div className="rounded-md border border-border/45 bg-foreground/[0.02] px-3 py-2 text-xs text-muted-foreground">
                Empty
              </div>
            ) : (
              knownOnly.map((device) => {
                const serial = serialOf(device);
                return (
                  <Row
                    key={serial || JSON.stringify(device)}
                    device={device}
                    selected={!!serial && serial === selectedSerial}
                    onSelect={(nextSerial) => selectMutation.mutate(nextSerial)}
                    onForget={(nextSerial) => forgetMutation.mutate(nextSerial)}
                    onReconnectPort={(knownDevice, port) =>
                      reconnectPortMutation.mutate({ device: knownDevice, port })
                    }
                    busy={busy}
                  />
                );
              })
            )}
          </div>
        </section>

        <section className="mb-4">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <Wifi className="h-3 w-3" />
            Pair
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={pairHost}
              onChange={(event) => setPairHost(event.target.value)}
              placeholder="Host"
              className="h-8 text-xs"
              autoCapitalize="off"
              autoCorrect="off"
            />
            <Input
              value={pairPort}
              onChange={(event) => setPairPort(event.target.value)}
              placeholder="Pair port"
              inputMode="numeric"
              className="h-8 text-xs"
            />
            <Input
              value={pairCode}
              onChange={(event) => setPairCode(event.target.value)}
              placeholder="Code"
              inputMode="numeric"
              className="h-8 text-xs"
            />
            <Input
              value={connectPort}
              onChange={(event) => setConnectPort(event.target.value)}
              placeholder="Connect port"
              inputMode="numeric"
              className="h-8 text-xs"
            />
            <Input
              value={friendlyName}
              onChange={(event) => setFriendlyName(event.target.value)}
              placeholder="Name"
              className="col-span-2 h-8 text-xs"
            />
            <Button
              type="button"
              size="sm"
              className="col-span-2 h-8 gap-1.5 text-xs"
              disabled={!pairHost.trim() || !pairPort.trim() || !pairCode.trim() || busy}
              onClick={() => pairMutation.mutate()}
            >
              {pairMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wifi className="h-3.5 w-3.5" />
              )}
              Pair
            </Button>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <Link2 className="h-3 w-3" />
            Connect
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={connectHost}
              onChange={(event) => setConnectHost(event.target.value)}
              placeholder="Host"
              className="h-8 text-xs"
              autoCapitalize="off"
              autoCorrect="off"
            />
            <Input
              value={connectHostPort}
              onChange={(event) => setConnectHostPort(event.target.value)}
              placeholder="Port"
              inputMode="numeric"
              className="h-8 text-xs"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="col-span-2 h-8 gap-1.5 text-xs"
              disabled={!connectHost.trim() || busy}
              onClick={() => connectMutation.mutate()}
            >
              {connectMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              Connect
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
