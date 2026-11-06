/**
 * Redaktion (§11.5): Was ein Agent in den Schwarm schreibt, geht durch diesen
 * Filter — Ergebnisse, `post`, `read_thread` und Meldungen. Er ersetzt Muster,
 * die nach Geheimnissen aussehen, durch `[redigiert]`.
 *
 * Bewusst konservativ: lieber ein Hash zu viel als ein Token im Raum. Vollständig
 * ist er nicht — deshalb bleibt die Regel, dass Geheimnisse nicht in Aufträge
 * gehören (§11.4).
 */
const MUSTER: [RegExp, string][] = [
  // Zugangsdaten in URLs: postgres://user:pass@host, https://x:token@y
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s@]+)@/gi, '$1$2:[redigiert]@'],
  // Kopfzeilen und Zuweisungen
  [/\b(authorization|proxy-authorization)\s*[:=]\s*[^\r\n]+/gi, '$1: [redigiert]'],
  // Auch zusammengesetzte Namen: PGPASSWORD=, HERMES_TOKEN:, matrix.access_token=
  [
    /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,
    '$1[redigiert]',
  ],
  // Bekannte Token-Formate
  [/\b(sk|pk|rk|ghp|gho|ghu|ghs|github_pat)[-_][A-Za-z0-9_-]{12,}\b/g, '[redigiert]'],
  [/\bswm_[A-Za-z0-9_-]{16,}\b/g, '[redigiert]'], // Schwarm-Hub (§14.3)
  [/\b(?:syt|mct|wt)_[A-Za-z0-9_-]{16,}/g, '[redigiert]'], // Synapse- und MAS-Zugangstokens
  [/\bplum_gw_[A-Za-z0-9_-]{8,}/g, '[redigiert]'], // Plum-Gateway (ADR-002 §4.14)
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redigiert]'], // AWS-Zugangsschlüssel
  [/\b[0-9a-f]{32}\.[A-Za-z0-9]{16}\b/g, '[redigiert]'], // Z.AI (Brian nutzt so einen)
  [/\b[MNO][A-Za-z\d_-]{23,27}\.[\w-]{6}\.[\w-]{27,40}\b/g, '[redigiert]'], // Discord-Bot
  [/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, '[redigiert]'], // Telegram-Bot
  [/\bcc_[A-Za-z0-9_-]{16,}\b/g, '[redigiert]'], // Rat-Service-Token
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[redigiert]'], // Slack
  [/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[redigiert]'], // Google
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '[redigiert]'], // JWT
  // PEM-Blöcke
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[redigiert: Schlüssel]',
  ],
];

/**
 * Läufe aus 32+ Zeichen, die wie ein Schlüssel aussehen (nicht wie eine
 * Matrix-ID, kein reiner Hex-Hash in einer Fehlermeldung).
 */
// Kein \b: Matrix-IDs beginnen mit `!`, `$`, `#` oder `@`, und \b steht schon
// hinter dem Sigil — die ID wäre also als Blob erkannt und geschwärzt worden.
const BLOB = /(?<![!$#@A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g;

export function redact(text: string, blobsAuch = true): string {
  let out = text ?? '';
  for (const [muster, ersatz] of MUSTER) out = out.replace(muster, ersatz);
  if (blobsAuch) {
    out = out.replace(BLOB, (fund) =>
      // Mindestens drei Zeichenklassen und kein Bindestrich-Muster: Das trifft
      // base64url-Schlüssel, aber keine Wörter und keine Matrix-IDs.
      /[a-z]/.test(fund) && /[A-Z]/.test(fund) && /[0-9]/.test(fund) ? '[redigiert]' : fund
    );
  }
  return out;
}

/** Kurz prüfen, ob überhaupt etwas ersetzt wurde — für Audit und Tests. */
export function hatGeheimnis(text: string): boolean {
  return redact(text) !== text;
}
