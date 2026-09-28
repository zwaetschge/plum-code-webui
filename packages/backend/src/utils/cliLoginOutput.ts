const ANSI_ESCAPE_REGEX =
  /\x1B\[[0-9;]*[a-zA-Z]|\x1B\[\?[0-9;]*[a-zA-Z]|\x1B\[[<>=][^\x1B]*[a-zA-Z]/g;
// OSC sequences, hyperlinks above all: ESC ] 8 ; ; <url> BEL <label> ESC ] 8 ; ; BEL
// carries the address twice. Leaving them in made the extractor run from the
// payload straight through the BEL into the label — BEL is not whitespace — and
// hand Google a query string with the whole URL appended to ?prompt=consent.
const OSC_SEQUENCE_REGEX = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;
// Control characters end a URL as surely as a space does.
const URL_REGEX = /(https?:\/\/[^\s"'<>\u0000-\u001f]+)/i;
// OpenAI's device codes are dash-separated uppercase segments, but the lengths
// differ between CLI releases (0.153.x prints 4-5 like "LLOC-FSBO4", classic
// device codes are 4-4 like "WDJB-MJHT"). Segment lengths ≥4/≥3 keep ISO dates
// ("2026-09-19") and lowercase URLs out of the match.
const DEVICE_CODE_REGEX = /\b[A-Z0-9]{4,}(?:-[A-Z0-9]{3,})+\b/;

const CLI_LOGIN_INVOCATIONS = {
  claude: ['auth', 'login'],
  codex: ['login', '--device-auth'],
  opencode: ['auth', 'login'],
  // Kimi Code CLI device-code login: prints the verification URL + user code to
  // stderr and self-polls until the browser authorization completes (exit 0).
  kimi: ['login'],
  // Pi has no CLI-level login: /login is a built-in TUI command, and its own RPC
  // docs state built-in commands "would not execute if sent via prompt". So the
  // TUI is started bare and the command is typed into it (see PI_LOGIN_INPUT).
  pi: [],
} as const;

/**
 * Typed into the PTY once the TUI is up, for providers whose login lives inside
 * an interactive session rather than behind a CLI subcommand.
 */
export const CLI_LOGIN_TUI_INPUT: Partial<Record<string, string>> = {
  pi: '/login antigravity',
};

export function stripCliLoginAnsi(value: string): string {
  return value.replace(OSC_SEQUENCE_REGEX, '').replace(ANSI_ESCAPE_REGEX, '');
}

/** ESC ] 8 ; <params> ; <uri> BEL|ST — the hyperlink's authoritative target. */
const OSC_HYPERLINK_REGEX = /\x1B\]8;[^;\x07\x1B]*;([^\x07\x1B]+)(?:\x07|\x1B\\)/;

export function extractCliLoginUrl(value: string): string | null {
  // Prefer the hyperlink payload. A TUI renders the address as an OSC-8 link
  // and shows a shortened label, so the payload is the only complete copy —
  // and reading the label instead once produced a URL with the whole thing
  // appended to ?prompt=consent, which Google rejected as invalid_request.
  const linked = value.match(OSC_HYPERLINK_REGEX)?.[1]?.trim();
  if (linked && /^https?:\/\//i.test(linked)) {
    return linked.replace(/[),.;\]}]+$/, '');
  }

  const match = stripCliLoginAnsi(value).match(URL_REGEX);
  return match?.[1]?.replace(/[),.;\]}]+$/, '') || null;
}

export function extractCliDeviceCode(value: string): string | null {
  return stripCliLoginAnsi(value).match(DEVICE_CODE_REGEX)?.[0] || null;
}

export function resolveCliLoginInvocation(provider: string): readonly string[] | null {
  return CLI_LOGIN_INVOCATIONS[provider as keyof typeof CLI_LOGIN_INVOCATIONS] || null;
}
