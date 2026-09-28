#!/usr/bin/env node
// Builds the Plum Browser extension for both browsers from one source tree:
//
//   dist/plum-browser-firefox.xpi   Firefox, Manifest V2 (a plain zip)
//   dist/plum-browser-chrome.zip    Chrome/Edge, Manifest V3, for "Load unpacked"
//   dist/chrome/                    the same, unpacked
//
//   node packages/firefox-extension/scripts/build.mjs
//
// src/ holds the shared code; src/targets/<browser>/ adds the manifest and
// browser-only files. Zero dependencies so the Docker builder can run it
// without touching the pnpm lockfile. Both outputs are unsigned; see README.

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const distDir = join(root, 'dist');

const TARGETS = {
  firefox: {
    out: 'plum-browser-firefox.xpi',
    exclude: [],
  },
  chrome: {
    out: 'plum-browser-chrome.zip',
    unpacked: 'chrome',
    // No popup: the icon opens the side panel.
    exclude: [/^popup\./],
  },
};

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

/** Archive-relative name → file contents for one target. */
function collect(target, config) {
  const entries = new Map();
  for (const file of walk(srcDir)) {
    const name = relative(srcDir, file).split(sep).join('/');
    if (name.startsWith('targets/')) continue;
    if (config.exclude.some((pattern) => pattern.test(name))) continue;
    entries.set(name, readFileSync(file));
  }
  const targetDir = join(srcDir, 'targets', target);
  for (const file of walk(targetDir)) {
    entries.set(relative(targetDir, file).split(sep).join('/'), readFileSync(file));
  }
  return entries;
}

// Fixed DOS timestamp (2026-01-01) keeps builds reproducible.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  // manifest.json first: some tooling sniffs it from the head of the archive.
  const names = [...entries.keys()].sort((a, b) =>
    a === 'manifest.json' ? -1 : b === 'manifest.json' ? 1 : a.localeCompare(b)
  );
  for (const entryName of names) {
    const data = entries.get(entryName);
    const name = Buffer.from(entryName);
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, buf) => sum + buf.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

mkdirSync(distDir, { recursive: true });
for (const [target, config] of Object.entries(TARGETS)) {
  const entries = collect(target, config);
  const outFile = join(distDir, config.out);
  writeFileSync(outFile, zip(entries));
  if (config.unpacked) {
    const dir = join(distDir, config.unpacked);
    rmSync(dir, { recursive: true, force: true });
    for (const [name, data] of entries) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), data);
    }
  }
  const version = JSON.parse(entries.get('manifest.json').toString()).version;
  console.log(
    `[browser-extension] ${relative(process.cwd(), outFile)} (${target}, v${version}, ${entries.size} files)`
  );
}
