import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Extension packages served to the user: the builds from the image, or a
 * signed Firefox build from the persistent data dir.
 */

export const EXTENSION_FILES = {
  firefox: 'plum-browser-firefox.xpi',
  chrome: 'plum-browser-chrome.zip',
  chromeDir: 'chrome',
} as const;

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
