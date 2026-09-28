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
