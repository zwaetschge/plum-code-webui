import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { fileURLToPath } from 'node:url';

let child: ChildProcess | null = null;
/** Native coordinator runs in its own environment; CLI session keys are never inherited. */
export async function startAssistantCoordinator(): Promise<void> {
  if (process.env.PLUM_SWARM_COORDINATOR_ENABLED !== 'true') return;
  if (child) return;
  const environmentFile = process.env.PLUM_SWARM_ENV_FILE;
  if (!environmentFile) throw new Error('Für die Übernahme ist PLUM_SWARM_ENV_FILE erforderlich');
  const native = parse(await readFile(environmentFile));
  for (const key of [
    'DATABASE_URL',
    'AS_TOKEN',
    'HS_TOKEN',
    'MATRIX_DOMAIN',
    'OWNER_MXID',
    'AGENTS_FILE',
    'ROOMS_FILE',
  ])
    if (!native[key]) throw new Error(`Schwarm-Konfiguration fehlt: ${key}`);
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: process.env.NODE_ENV,
    ...native,
    PLUM_SWARM_COORDINATOR_ENABLED: 'true',
    PLUM_SWARM_LEGACY_CONTAINER: process.env.PLUM_SWARM_LEGACY_CONTAINER,
    PLUM_OEFFENTLICH: process.env.FRONTEND_URL || process.env.WEBUI_FRONTEND_URL,
  };
  child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.resolve('@plum-code-webui/swarm/runtime'))],
    {
      env: environment,
      stdio: ['ignore', 'inherit', 'inherit'],
    }
  );
  child.once('error', () => {
    child = null;
    console.error('[assistant] Nativer Schwarm-Prozess konnte nicht gestartet werden');
  });
  child.once('exit', (code) => {
    child = null;
    if (code)
      console.error(
        '[assistant] Nativer Schwarm-Prozess beendet; keine automatische parallele Ersatzinstanz'
      );
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => child?.kill('SIGTERM'));
}
