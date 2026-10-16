import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { get as pgGet, run as pgRun } from '../../db/pg.js';
import { latestDesktopCompanion } from './package.js';
import { createBrowserToken } from './tokens.js';

/**
 * Plum Desktop: per-app rules the companion enforces, and the one-line
 * installer for further computers.
 */

export const DESKTOP_RULE = z.object({
  /** App class (org.kde.konsole) or part of a window title, case-insensitive. */
  match: z.string().trim().min(1).max(120),
  /** block: no input and no screenshot content; ask: confirm every input at the desktop. */
  mode: z.enum(['block', 'ask']),
  note: z.string().max(200).optional(),
});
export type DesktopRule = z.infer<typeof DESKTOP_RULE>;
export const DESKTOP_RULES = z.array(DESKTOP_RULE).max(100);

/** Password managers stay off limits, terminals and system settings ask first. */
export const DEFAULT_DESKTOP_RULES: DesktopRule[] = [
  { match: 'keepassxc', mode: 'block', note: 'Passwortmanager' },
  { match: 'bitwarden', mode: 'block', note: 'Passwortmanager' },
  { match: '1password', mode: 'block', note: 'Passwortmanager' },
  { match: 'kwalletmanager', mode: 'block', note: 'KDE-Wallet' },
  { match: 'org.kde.konsole', mode: 'ask', note: 'Terminal' },
  { match: 'org.kde.yakuake', mode: 'ask', note: 'Terminal' },
  { match: 'alacritty', mode: 'ask', note: 'Terminal' },
  { match: 'kitty', mode: 'ask', note: 'Terminal' },
  { match: 'systemsettings', mode: 'ask', note: 'Systemeinstellungen' },
];

async function settingsJson(userId: string): Promise<Record<string, unknown>> {
  const row = (await pgGet('SELECT settings_json FROM user_settings WHERE user_id = ?', userId)) as
    | { settings_json: string | null }
    | undefined;
  try {
    return row?.settings_json ? (JSON.parse(row.settings_json) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function getDesktopRules(userId: string): Promise<DesktopRule[]> {
  const parsed = DESKTOP_RULES.safeParse((await settingsJson(userId)).desktopRules);
  return parsed.success ? parsed.data : DEFAULT_DESKTOP_RULES;
}

export async function setDesktopRules(
  userId: string,
  rules: DesktopRule[]
): Promise<DesktopRule[]> {
  const json = await settingsJson(userId);
  json.desktopRules = rules;
  await pgRun(
    `INSERT INTO user_settings (user_id, theme, settings_json) VALUES (?, 'dark', ?)
     ON CONFLICT (user_id) DO UPDATE SET settings_json = excluded.settings_json`,
    userId,
    JSON.stringify(json)
  );
  return rules;
}

// ---------------------------------------------------------------- installer

const INSTALL_TTL_MS = 15 * 60_000;
const installCodes = new Map<string, { userId: string; name: string; expires: number }>();

/** A short-lived code for `curl … | bash`; the token itself is created only when it is fetched. */
export function createInstallCode(
  userId: string,
  name: string
): { code: string; expiresAt: string } {
  const now = Date.now();
  for (const [code, entry] of installCodes) if (entry.expires < now) installCodes.delete(code);
  const code = randomBytes(18).toString('base64url');
  installCodes.set(code, { userId, name, expires: now + INSTALL_TTL_MS });
  return { code, expiresAt: new Date(now + INSTALL_TTL_MS).toISOString() };
}

/** Single use: the code is gone after the first fetch. */
export async function installScript(code: string, serverUrl: string): Promise<string | null> {
  const entry = installCodes.get(code);
  installCodes.delete(code);
  if (!entry || entry.expires < Date.now()) return null;
  const companion = latestDesktopCompanion();
  if (!companion) throw new Error('Plum Desktop is not part of this Plum build');
  const { token } = await createBrowserToken(entry.userId, entry.name);
  const config = JSON.stringify({ serverUrl, token, label: entry.name }, null, 2);
  const source = Buffer.from(companion.source).toString('base64');
  return `#!/usr/bin/env bash
# Plum Desktop ${companion.version} – installer (single use).
set -euo pipefail
say() { printf '\\033[1;35m[plum]\\033[0m %s\\n' "$*"; }
[ "$(id -u)" -ne 0 ] || { echo "Bitte als normaler Benutzer ausführen, nicht als root."; exit 1; }

say "Abhängigkeiten installieren (braucht sudo)"
if command -v dnf >/dev/null; then
  sudo dnf install -y python3-pyside6 python3-evdev python3-websockets python3-gobject at-spi2-core wl-clipboard spectacle tesseract tesseract-langpack-deu pipewire-utils
elif command -v apt-get >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y python3-pyside6.qtwidgets python3-pyside6.qtdbus python3-evdev python3-websockets python3-gi gir1.2-atspi-2.0 wl-clipboard kde-spectacle tesseract-ocr tesseract-ocr-deu pipewire-bin || \\
    { sudo apt-get install -y python3-pip python3-evdev python3-gi gir1.2-atspi-2.0 wl-clipboard tesseract-ocr tesseract-ocr-deu && pip3 install --user --break-system-packages PySide6 websockets; }
elif command -v pacman >/dev/null; then
  sudo pacman -S --needed --noconfirm pyside6 python-evdev python-websockets python-gobject at-spi2-core wl-clipboard spectacle tesseract tesseract-data-deu pipewire
else
  say "Unbekannte Paketverwaltung: PySide6, python-evdev, websockets, python-gobject (Atspi), wl-clipboard, spectacle oder grim und tesseract selbst installieren."
fi

say "Eingabegeräte freigeben (virtuelle Maus/Tastatur, Escape-Stopp, Vorführungen)"
sudo tee /etc/udev/rules.d/70-plum-desktop.rules >/dev/null <<'RULES'
KERNEL=="uinput", SUBSYSTEM=="misc", TAG+="uaccess", OPTIONS+="static_node=uinput"
SUBSYSTEM=="input", KERNEL=="event*", ENV{ID_INPUT_KEYBOARD}=="1", TAG+="uaccess"
SUBSYSTEM=="input", KERNEL=="event*", ENV{ID_INPUT_MOUSE}=="1", TAG+="uaccess"
RULES
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=input --subsystem-match=misc

say "Plum Desktop einrichten"
mkdir -p ~/.local/share/plum-desktop ~/.config/plum-desktop ~/.config/autostart
echo '${source}' | base64 -d > ~/.local/share/plum-desktop/plum_desktop.py
umask 077
cat > ~/.config/plum-desktop/config.json <<'CONFIG'
${config}
CONFIG
umask 022
cat > ~/.config/autostart/plum-desktop.desktop <<'ENTRY'
[Desktop Entry]
Type=Application
Name=Plum Desktop
Comment=Plum zeigt und bedient Desktop-Programme (Modus im Tray)
Exec=python3 %h/.local/share/plum-desktop/plum_desktop.py
X-KDE-autostart-phase=2
NoDisplay=true
ENTRY
sed -i "s|%h|$HOME|" ~/.config/autostart/plum-desktop.desktop
pkill -f 'plum-desktop/plum_desktop.py' 2>/dev/null || true
nohup python3 ~/.local/share/plum-desktop/plum_desktop.py >/dev/null 2>&1 &
say "Fertig: Plum Desktop ${companion.version} läuft und startet künftig mit der Anmeldung. Das Tray-Symbol zeigt den Modus."
`;
}
