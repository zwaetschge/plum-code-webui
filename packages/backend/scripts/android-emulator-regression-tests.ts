import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');

async function main(): Promise<void> {
  const routeSource = await fs.readFile(
    path.join(repoRoot, 'packages/backend/src/routes/android.ts'),
    'utf-8'
  );
  const panelSource = await fs.readFile(
    path.join(repoRoot, 'packages/frontend/src/components/session/AndroidDevicePanel.tsx'),
    'utf-8'
  );
  const mcpSource = await fs.readFile(
    path.join(repoRoot, 'scripts/mcp-servers/android-builder.mjs'),
    'utf-8'
  );

  assert.match(
    routeSource,
    /router\.get\(\s*['"]\/emulator\/status['"]/,
    'Plum must proxy emulator status through its authenticated Android API'
  );
  assert.match(
    routeSource,
    /['"]\/devices\/:serial\/screenshot\.png['"]/,
    'Plum must expose an authenticated live screenshot endpoint'
  );
  assert.match(
    panelSource,
    /Android emulator/i,
    'the Android panel must show a dedicated emulator section'
  );
  assert.match(
    panelSource,
    /screenshot\.png/,
    'the Android panel must render the emulator instead of trusting a relative noVNC URL'
  );
  // The handler routes per build engine since several engines exist: a single
  // engine keeps the direct call, several pick a target engine first. Both
  // paths must translate the MCP `avd` parameter to the builder's `avdName`.
  const emulatorStart = /\n {2}emulator_start: async \(a\) => \{\n([\s\S]*?)\n {2}\},\n/.exec(
    mcpSource
  )?.[1];
  assert.ok(emulatorStart, 'the MCP server must implement emulator_start');
  assert.match(
    emulatorStart,
    /if \(!MULTI\) return http\(\s*'POST',\s*'\/api\/emulator\/start',\s*\{\s*avdName:\s*a\.avd\s*\}\s*\)/,
    'with one engine the MCP avd parameter must be translated to the builder avdName contract'
  );
  assert.match(
    emulatorStart,
    /engineHttp\(\s*target,\s*'POST',\s*'\/api\/emulator\/start',\s*\{\s*avdName:\s*a\.avd\s*\}\s*\)/,
    'with several engines the chosen engine must get the same avdName contract'
  );

  console.log('android emulator regression tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
