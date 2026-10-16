import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createBrowserToken } from './tokens.js';

/**
 * Extension packages served to the user: the generic builds from the image,
 * and a pre-paired Chrome package whose `plum-config.json` already holds the
 * Plum address and a fresh pairing token, so installing on another machine is
 * unzip → Load unpacked → done.
 */

export const EXTENSION_FILES = {
  firefox: 'plum-browser-firefox.xpi',
  chrome: 'plum-browser-chrome.zip',
  chromeDir: 'chrome',
} as const;

const PAIRED_FOLDER = 'Plum Browser (Chrome)';

/** First existing copy; a signed build in the persistent data dir wins. */
export function findExtensionArtifact(name: string): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    name === EXTENSION_FILES.firefox ? process.env.PLUM_FIREFOX_XPI : undefined,
    path.resolve(here, '../../../data/firefox', name),
    path.resolve(here, '../../../../firefox-extension/dist', name),
    path.resolve(process.cwd(), '../firefox-extension/dist', name),
    path.resolve('/app/packages/firefox-extension/dist', name),
  ].filter((candidate): candidate is string => !!candidate);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** Version of the extension build this Plum ships (Chrome and Firefox share it). */
export function latestExtensionVersion(): string | null {
  const dir = findExtensionArtifact('chrome');
  if (!dir) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

/** The desktop companion this Plum ships, for self-update over the bridge socket. */
export function latestDesktopCompanion(): {
  version: string;
  source: string;
  sha256: string;
} | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = [
    path.resolve(here, '../../../../desktop-companion/plum_desktop.py'),
    path.resolve('/app/packages/desktop-companion/plum_desktop.py'),
  ].find((candidate) => fs.existsSync(candidate));
  if (!file) return null;
  try {
    const source = fs.readFileSync(file, 'utf8');
    const version = /^VERSION = "([0-9.]+)"/m.exec(source)?.[1];
    if (!version) return null;
    return { version, source, sha256: createHash('sha256').update(source).digest('hex') };
  } catch {
    return null;
  }
}

/** Numeric dotted-version comparison ("0.10.0" > "0.9.3"). */
export function versionNewer(candidate: string, current: string): boolean {
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0;
  }
  return false;
}

function walk(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = path.join(dir, name);
      return fs.statSync(full).isDirectory() ? walk(full) : [full];
    });
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal deflate zip writer (same format as the extension build script). */
export function buildZip(entries: Map<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [entryName, data] of entries) {
    const name = Buffer.from(entryName);
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosDate, 12);
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
    central.writeUInt16LE(dosDate, 14);
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
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function instructions(serverUrl: string, label: string): string {
  return [
    'Plum Browser für Chrome (bereits gekoppelt)',
    '============================================',
    '',
    `Dieser Ordner ist mit ${serverUrl} gekoppelt (Browser-Name: „${label}“).`,
    'Der Token darin erlaubt nur die Browser-Steuerung. Du kannst ihn in Plum unter',
    'Settings → Browser control jederzeit entkoppeln.',
    '',
    'Installation (macOS, Windows, Linux):',
    '1. Diesen Ordner an einen festen Ort verschieben, z. B. in deinen Benutzerordner',
    '   (nicht im Downloads-Ordner lassen – Chrome lädt die Erweiterung von hier).',
    '2. In Chrome chrome://extensions öffnen.',
    '3. Oben rechts „Entwicklermodus“ einschalten.',
    '4. „Entpackte Erweiterung laden“ klicken und DIESEN Ordner wählen.',
    '5. Fertig: Die Erweiterung verbindet sich selbst. Pinne das Plum-Symbol in der',
    '   Symbolleiste an (Puzzle-Symbol → Pin). Ein Klick darauf öffnet rechts den Chat.',
    '',
    'Updates: neue Version in Plum herunterladen, den Ordnerinhalt ersetzen und in',
    'chrome://extensions beim Plum Browser auf „Neu laden“ (Kreispfeil) klicken.',
    '',
    'Falls „Entwicklermodus“ gesperrt ist, verwaltet deine Firma Chrome per Richtlinie;',
    'dann geht die Installation nur über den Chrome Web Store oder die IT.',
    '',
  ].join('\n');
}

export async function buildPairedChromePackage(opts: {
  userId: string;
  name: string;
  serverUrl: string;
}): Promise<{ zip: Buffer; fileName: string }> {
  const dir = findExtensionArtifact(EXTENSION_FILES.chromeDir);
  if (!dir || !fs.existsSync(path.join(dir, 'manifest.json'))) {
    throw new Error('Chrome extension build not found');
  }
  const label = opts.name.trim() || 'Chrome';
  const { token } = await createBrowserToken(opts.userId, label);
  const entries = new Map<string, Buffer>();
  // manifest.json first, then the rest, all inside one folder: macOS Archive
  // Utility then extracts exactly the folder that "Load unpacked" expects.
  const files = walk(dir).sort((a, b) =>
    a.endsWith(`${path.sep}manifest.json`) ? -1 : b.endsWith(`${path.sep}manifest.json`) ? 1 : 0
  );
  for (const file of files) {
    const rel = path.relative(dir, file).split(path.sep).join('/');
    entries.set(`${PAIRED_FOLDER}/${rel}`, fs.readFileSync(file));
  }
  entries.set(
    `${PAIRED_FOLDER}/plum-config.json`,
    Buffer.from(`${JSON.stringify({ serverUrl: opts.serverUrl, token, label }, null, 2)}\n`)
  );
  entries.set(`${PAIRED_FOLDER}/ANLEITUNG.txt`, Buffer.from(instructions(opts.serverUrl, label)));
  const slug = label.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'chrome';
  return { zip: buildZip(entries), fileName: `plum-browser-chrome-${slug}.zip` };
}
