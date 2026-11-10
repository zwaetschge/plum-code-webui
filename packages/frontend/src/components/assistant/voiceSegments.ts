/** Keep every character and never split a UTF-16 surrogate pair. */
export function splitSpeech(text: string, maximum = 4500): string[] {
  if (!Number.isInteger(maximum) || maximum < 2) throw new Error('Invalid speech segment length');
  const result: string[] = [];
  let remaining = text;
  while (remaining.length) {
    let end = Math.min(maximum, remaining.length);
    if (end < remaining.length) {
      const boundary = remaining.lastIndexOf(' ', end - 1);
      if (boundary >= maximum * 0.65) end = boundary + 1;
      if (/[\uD800-\uDBFF]/.test(remaining[end - 1] || '')) end--;
    }
    result.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  return result.filter((piece) => piece.trim());
}

export function voiceLanguageCode(language: string): string {
  const normalized = language.trim().toLowerCase();
  const codes: Record<string, string> = {
    german: 'de',
    deutsch: 'de',
    english: 'en',
    englisch: 'en',
    french: 'fr',
    français: 'fr',
    spanish: 'es',
    español: 'es',
    italian: 'it',
    italiano: 'it',
    portuguese: 'pt',
    japanese: 'ja',
    chinese: 'zh',
  };
  return codes[normalized] ?? (/^[a-z]{2}$/.test(normalized) ? normalized : '');
}

/**
 * Pieces for spoken playback, cut at sentence ends: a short first piece so
 * the voice starts quickly, then longer ones (fetched while the previous one
 * plays). Lossless like splitSpeech: the pieces joined are the text.
 */
export function playbackSegments(text: string, first = 220, rest = 900): string[] {
  const cuts = [...text.matchAll(/[.!?…]+["“”»')\]]*\s+|\n+/g)].map(
    (match) => match.index! + match[0].length
  );
  const pieces: string[] = [];
  let start = 0,
    limit = first,
    candidate = -1;
  for (const cut of cuts) {
    if (cut - start <= limit) {
      candidate = cut;
      continue;
    }
    const end = candidate > start ? candidate : cut;
    pieces.push(text.slice(start, end));
    start = end;
    limit = rest;
    candidate = cut > end && cut - start <= limit ? cut : -1;
  }
  pieces.push(text.slice(start));
  return pieces
    .flatMap((piece) => (piece.length > 4500 ? splitSpeech(piece) : [piece]))
    .filter((piece) => piece.trim());
}

/** BCP 47 locale for the device's speech recognizer (Swiss variants where they exist). */
export function recognitionLocale(language: string): string {
  const code = voiceLanguageCode(language);
  const locales: Record<string, string> = {
    de: 'de-CH',
    fr: 'fr-CH',
    it: 'it-CH',
    en: 'en-US',
    es: 'es-ES',
    pt: 'pt-PT',
    ja: 'ja-JP',
    zh: 'zh-CN',
  };
  return locales[code] ?? (typeof navigator === 'undefined' ? 'de-CH' : navigator.language);
}
