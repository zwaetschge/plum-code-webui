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
