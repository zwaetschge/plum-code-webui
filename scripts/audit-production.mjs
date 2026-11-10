#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const allowedAdvisories = new Map([
  [
    'GHSA-qwww-vcr4-c8h2',
    'React Router advisory applies only to unstable RSC APIs; Plum uses declarative BrowserRouter.',
  ],
  [
    // Fixed only in zod 4.6.6; the 3.x line Plum and @agentclientprotocol/sdk
    // 0.23 use has no patch. The attack needs a huge array in a request body,
    // and every public JSON route keeps Express's default 100 kB limit (checked
    // below), which caps the array at a size that cannot exhaust memory. Goes
    // away with the zod 4 / ACP SDK 2 migration.
    'GHSA-mrhx-c7xc-m3w5',
    'Zod array DoS needs an oversized body; public JSON routes keep the 100 kB default limit.',
  ],
]);

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(fullPath));
    else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const frontendSource = collectSourceFiles('packages/frontend/src')
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
const usesUnstableReactRouterRsc = [
  /@react-router\/(?:dev|rsc)/,
  /react-server-dom/,
  /unstable_[A-Za-z0-9_]*RSC/,
].some((pattern) => pattern.test(frontendSource));

// The zod exception above only holds while the global JSON parser keeps its
// default limit and larger limits stay on the hook-secret `/internal` routes.
const backendEntry = fs.readFileSync('packages/backend/src/index.ts', 'utf8');
const jsonLimits = [
  ...backendEntry.matchAll(/app\.use\(\s*(['"][^'"]+['"])?\s*,?\s*express\.json\(([^)]*)\)/g),
];
const defaultJsonLimitKept = jsonLimits.some((match) => !match[1] && match[2].trim() === '');
const largeJsonLimitsAreInternal = jsonLimits
  .filter(
    (match) => /limit:\s*['"](\d+)mb['"]/.test(match[2]) && Number(/(\d+)mb/.exec(match[2])[1]) > 2
  )
  .every((match) => /\/internal['"]$/.test(match[1] ?? ''));
const zodBodyLimitHolds = defaultJsonLimitKept && largeJsonLimitsAreInternal;

const audit = spawnSync('pnpm', ['audit', '--prod', '--json'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(audit.stderr || audit.stdout || 'pnpm audit returned no JSON output\n');
  process.exit(1);
}

const advisories = Object.values(report.advisories || {});
const blocking = advisories.filter(
  (advisory) => (severityRank[advisory.severity] ?? 0) >= severityRank.high
);
const rejected = blocking.filter((advisory) => {
  if (!allowedAdvisories.has(advisory.github_advisory_id)) return true;
  if (advisory.github_advisory_id === 'GHSA-mrhx-c7xc-m3w5') return !zodBodyLimitHolds;
  return advisory.github_advisory_id === 'GHSA-qwww-vcr4-c8h2' && usesUnstableReactRouterRsc;
});

if (rejected.length > 0) {
  for (const advisory of rejected) {
    console.error(
      `${advisory.severity.toUpperCase()} ${advisory.github_advisory_id}: ${advisory.title}`
    );
  }
  process.exit(1);
}

for (const advisory of blocking) {
  console.warn(
    `Audited exception ${advisory.github_advisory_id}: ${allowedAdvisories.get(advisory.github_advisory_id)}`
  );
}
console.log(`Production dependency audit passed (${advisories.length} advisories inspected).`);
