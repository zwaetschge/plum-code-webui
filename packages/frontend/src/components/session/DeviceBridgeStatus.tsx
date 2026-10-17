import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { ApiResponse } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';

interface DeviceBridgeDevice {
  id: string;
  label: string;
  model: string;
  version: string;
  connectedAt: string;
}

interface DeviceBridgeStatusResponse {
  devices: DeviceBridgeDevice[];
}

/**
 * Phones paired through the Plum app's device control: the app's
 * accessibility service drives them, no adb. Shown in the session's
 * Verbindungen panel; the `android-device` MCP exposes the tools.
 */
export function DeviceBridgeStatus({ className }: { className?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['device-bridge', 'status'],
    staleTime: 15_000,
    refetchInterval: 20_000,
    queryFn: async () =>
      (
        await api.get<ApiResponse<DeviceBridgeStatusResponse>>('/api/device-bridge/status')
      ).data.data ?? { devices: [] },
  });

  const devices = data?.devices ?? [];

  return (
    <div className={cn('space-y-1.5 p-2 text-xs', className)}>
      <p className="text-muted-foreground">
        Gerätesteuerung über die App — Plum-Sessions lesen den Bildschirm und bedienen das Handy
        (MCP <code>android-device</code>), ganz ohne adb.
      </p>
      {isLoading ? (
        <p className="text-muted-foreground">Status wird geladen…</p>
      ) : devices.length === 0 ? (
        <p className="text-muted-foreground">
          Kein Handy gekoppelt. In der Plum-App: Einstellungen → Browser → Gerätesteuerung,
          Bedienungshilfen aktivieren — das Handy koppelt sich selbst.
        </p>
      ) : (
        devices.map((device) => (
          <div
            key={device.id}
            className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-foreground/[0.02] px-2.5 py-2"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
                {device.label}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {device.model}
                {device.version ? ` · App ${device.version}` : ''}
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-medium text-emerald-600">verbunden</span>
          </div>
        ))
      )}
    </div>
  );
}
