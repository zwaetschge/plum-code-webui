import { assistantDocumentHref } from './assistant-document.js';
export interface AssistantOffer {
  id: string;
  name: string;
  price: string;
  url: string;
  asOf: string;
  sourceId: string;
  sourceRevision: number;
  quote: string;
  details: string;
  favorite: boolean;
}
export interface AssistantComparison {
  type: 'plum-comparison';
  version: 1;
  offers: AssistantOffer[];
  decision: string;
}
export function parseAssistantComparison(content: string): AssistantComparison {
  if (content.length > 50000) throw new Error('Vergleich überschreitet 50 000 Zeichen.');
  const value = JSON.parse(content) as AssistantComparison;
  if (
    value?.type !== 'plum-comparison' ||
    value.version !== 1 ||
    !Array.isArray(value.offers) ||
    value.offers.length > 50 ||
    typeof value.decision !== 'string' ||
    value.decision.length > 10000
  )
    throw new Error('Ungültiger Produktvergleich.');
  const ids = new Set<string>();
  for (const offer of value.offers) {
    if (
      !offer ||
      typeof offer.id !== 'string' ||
      !offer.id ||
      offer.id.length > 200 ||
      ids.has(offer.id) ||
      typeof offer.name !== 'string' ||
      !offer.name.trim() ||
      offer.name.length > 200 ||
      typeof offer.price !== 'string' ||
      !offer.price.trim() ||
      offer.price.length > 120 ||
      typeof offer.url !== 'string' ||
      offer.url.length > 2000 ||
      typeof offer.sourceId !== 'string' ||
      !offer.sourceId ||
      offer.sourceId.length > 200 ||
      !Number.isSafeInteger(offer.sourceRevision) ||
      offer.sourceRevision < 1 ||
      typeof offer.asOf !== 'string' ||
      !Number.isFinite(Date.parse(offer.asOf)) ||
      typeof offer.quote !== 'string' ||
      !offer.quote.trim() ||
      offer.quote.length > 4000 ||
      !offer.quote.includes(offer.price) ||
      typeof offer.details !== 'string' ||
      offer.details.length > 4000 ||
      typeof offer.favorite !== 'boolean'
    )
      throw new Error(
        'Angebot benötigt Namen, Preis im Originalauszug und einen konkreten Quellenstand.'
      );
    assistantDocumentHref(offer.url);
    ids.add(offer.id);
  }
  return {
    type: 'plum-comparison',
    version: 1,
    decision: value.decision,
    offers: value.offers.map((o) => ({
      id: o.id,
      name: o.name,
      price: o.price,
      url: o.url,
      asOf: o.asOf,
      sourceId: o.sourceId,
      sourceRevision: o.sourceRevision,
      quote: o.quote,
      details: o.details,
      favorite: o.favorite,
    })),
  };
}
export function assistantComparisonText(comparison: AssistantComparison): string {
  return (
    comparison.offers
      .map(
        (o) =>
          `## ${o.name}${o.favorite ? ' ★' : ''}\nPreis: ${o.price}\nQuellenstand: ${o.asOf}\nAngebot: ${o.url}\nQuelle: ${o.sourceId}, Revision ${o.sourceRevision}\nOriginalauszug: ${o.quote}\n${o.details}`
      )
      .join('\n\n') +
    '\n\n## Entscheidung\n' +
    comparison.decision
  );
}
