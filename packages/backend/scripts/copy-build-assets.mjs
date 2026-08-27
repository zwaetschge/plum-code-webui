#!/usr/bin/env node
/**
 * Copies the non-TypeScript files the compiled backend reads at runtime.
 *
 * `tsc` emits only what it compiles, so a file loaded with `readFileSync` next
 * to its module — `db/schema.sql` — exists under src/ and not under dist/. The
 * difference is invisible in development, where everything runs from src/ via
 * tsx, and fatal in the image: initDatabase() throws ENOENT before the server
 * listens, so the container never becomes ready and the deployment rolls back
 * with a healthy-looking build behind it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = ['db/schema.sql'];

let copied = 0;
for (const asset of ASSETS) {
  const from = path.join(backend, 'src', asset);
  const to = path.join(backend, 'dist', asset);
  if (!fs.existsSync(from)) {
    console.error(`[assets] missing source: src/${asset}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied++;
}
console.log(`[assets] copied ${copied} runtime file(s) into dist/`);
