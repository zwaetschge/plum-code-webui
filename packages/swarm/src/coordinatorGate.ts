import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sql } from './db/index.js';

const exec = promisify(execFile);
/** The legacy writer does not share this lock, so its actual stopped state is mandatory. */
export async function requireStoppedLegacyCoordinator() {
  const name = process.env.PLUM_SWARM_LEGACY_CONTAINER;
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/.test(name))
    throw new Error('PLUM_SWARM_LEGACY_CONTAINER muss den bisherigen Hub eindeutig benennen');
  let result: { stdout: string };
  try {
    // Generic `docker inspect` falls back to image inspection after a container
    // 404. A deliberately restricted image API then masks absence as HTTP 403.
    result = await exec(
      'docker',
      [
        'container',
        'inspect',
        '--format',
        '{{.State.Running}} {{.State.Restarting}} {{.State.Status}}',
        name,
      ],
      { timeout: 5000, maxBuffer: 4096 }
    );
  } catch (error) {
    const failure = error as {
      code?: number;
      killed?: boolean;
      signal?: string | null;
      stdout?: string;
      stderr?: string;
    };
    const absent = new Set([
      `Error: No such container: ${name}`,
      `Error response from daemon: No such container: ${name}`,
    ]);
    // A missing legacy writer cannot race this coordinator. Permission errors,
    // transport failures and timeouts still fail closed, never imply absence.
    if (
      failure.code === 1 &&
      !failure.killed &&
      !failure.signal &&
      !(failure.stdout || '').trim() &&
      absent.has((failure.stderr || '').trim())
    )
      return;
    throw error;
  }
  if (!/^false false (exited|created)\s*$/.test(result.stdout))
    throw new Error('Der bisherige Schwarm-Hub ist noch aktiv; Koordination bleibt bei ihm');
}
export async function acquireCoordinator() {
  await requireStoppedLegacyCoordinator();
  const connection = await sql.reserve();
  const rows =
    await connection`SELECT pg_try_advisory_lock(hashtextextended('plum-swarm-coordinator',0)) AS held`;
  if (rows[0]?.held !== true) {
    connection.release();
    throw new Error('Ein anderer Plum-Prozess besitzt die Schwarm-Koordination');
  }
  // Monitor the same reserved connection and the actual legacy process, not just an env claim.
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void Promise.all([connection`SELECT 1`, requireStoppedLegacyCoordinator()])
      .catch(() => {
        clearInterval(timer);
        process.kill(process.pid, 'SIGTERM');
      })
      .finally(() => {
        checking = false;
      });
  }, 5000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await connection`SELECT pg_advisory_unlock(hashtextextended('plum-swarm-coordinator',0))`;
    connection.release();
  };
}
