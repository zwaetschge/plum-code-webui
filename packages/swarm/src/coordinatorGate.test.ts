import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { inspect } = vi.hoisted(() => ({ inspect: vi.fn() }));
vi.mock('node:child_process', () => ({
  execFile: Object.assign(() => {}, {
    [Symbol.for('nodejs.util.promisify.custom')]: inspect,
  }),
}));
vi.mock('./db/index.js', () => ({ sql: {} }));

import { requireStoppedLegacyCoordinator } from './coordinatorGate.js';

const originalName = process.env.PLUM_SWARM_LEGACY_CONTAINER;
beforeEach(() => {
  inspect.mockReset();
  process.env.PLUM_SWARM_LEGACY_CONTAINER = 'council-matrix';
});
afterEach(() => {
  if (originalName === undefined) delete process.env.PLUM_SWARM_LEGACY_CONTAINER;
  else process.env.PLUM_SWARM_LEGACY_CONTAINER = originalName;
});

describe('legacy coordinator ownership', () => {
  it.each(['exited', 'created'])(
    'accepts a verified stopped legacy container: %s',
    async (state) => {
      inspect.mockResolvedValue({ stdout: `false false ${state}\n` });
      await expect(requireStoppedLegacyCoordinator()).resolves.toBeUndefined();
    }
  );
  it('accepts an explicitly absent legacy container', async () => {
    inspect.mockRejectedValue({
      code: 1,
      stdout: '',
      stderr: 'Error: No such container: council-matrix\n',
    });
    await expect(requireStoppedLegacyCoordinator()).resolves.toBeUndefined();
  });
  it.each(['true false running', 'true true restarting', 'true false paused'])(
    'blocks an active legacy writer: %s',
    async (state) => {
      inspect.mockResolvedValue({ stdout: `${state}\n` });
      await expect(requireStoppedLegacyCoordinator()).rejects.toThrow('noch aktiv');
    }
  );
  it('does not treat a denied Docker API request as absence', async () => {
    const failure = Object.assign(new Error('403 Forbidden'), {
      code: 1,
      stdout: '',
      stderr: '403 Forbidden',
    });
    inspect.mockRejectedValue(failure);
    await expect(requireStoppedLegacyCoordinator()).rejects.toBe(failure);
  });
  it('does not treat an unavailable Docker daemon as absence', async () => {
    const failure = Object.assign(new Error('connection refused'), {
      code: 1,
      stdout: '',
      stderr: 'connection refused',
    });
    inspect.mockRejectedValue(failure);
    await expect(requireStoppedLegacyCoordinator()).rejects.toBe(failure);
  });
  it('does not accept an absence report for another container', async () => {
    const failure = { code: 1, stdout: '', stderr: 'Error: No such container: different-writer' };
    inspect.mockRejectedValue(failure);
    await expect(requireStoppedLegacyCoordinator()).rejects.toBe(failure);
  });
});
