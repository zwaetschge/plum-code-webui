export interface AssistantResearchReport {
  title: string;
  report: string;
  claims: Array<{
    claim: string;
    sourceId: string;
    sourceRevision: number;
    quote: string;
    note: string;
  }>;
}
/** The server separately verifies each quote against the stored source revision. */
export function parseAssistantResearch(value: string): AssistantResearchReport {
  if (value.length > 50000) throw new Error('Rechercheantwort ist zu gross');
  const trimmed = value.trim(),
    fenced = /^```(?:json)?\s*\n([\s\S]*)\n```$/i.exec(trimmed);
  let input: unknown;
  try {
    input = JSON.parse(fenced ? fenced[1]! : trimmed);
  } catch {
    throw new Error(
      'Die Antwort muss einen JSON-Bericht mit title, report und claims enthalten. Frage nach einer korrigierten Antwort.'
    );
  }
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Ungültige Berichtstruktur');
    return value as Record<string, unknown>;
  };
  const text = (value: unknown, maximum: number, label: string, allowEmpty = false): string => {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > maximum)
      throw new Error(`${label} fehlt oder ist zu lang`);
    return value.trim();
  };
  const root = object(input);
  if (Object.keys(root).some((key) => !['title', 'report', 'claims'].includes(key)))
    throw new Error('Unerwartete Berichtfelder');
  if (!Array.isArray(root.claims) || !root.claims.length || root.claims.length > 100)
    throw new Error('Der Bericht benötigt 1 bis 100 Quellenbelege');
  return {
    title: text(root.title, 200, 'Titel'),
    report: text(root.report, 40000, 'Bericht'),
    claims: root.claims.map((value, index) => {
      const claim = object(value),
        revision = claim.sourceRevision;
      if (
        Object.keys(claim).some(
          (key) => !['claim', 'sourceId', 'sourceRevision', 'quote', 'note'].includes(key)
        )
      )
        throw new Error(
          `Beleg ${index + 1} enthält unerwartete Felder; menschliche Prüfungen werden nicht vom Modell gesetzt`
        );
      if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1)
        throw new Error(`Beleg ${index + 1} hat keine Quellrevision`);
      return {
        claim: text(claim.claim, 2000, 'Aussage'),
        sourceId: text(claim.sourceId, 200, 'Quelle'),
        sourceRevision: revision,
        quote: text(claim.quote, 4000, 'Zitat'),
        note: text(claim.note ?? '', 3000, 'Hinweis', true),
      };
    }),
  };
}
