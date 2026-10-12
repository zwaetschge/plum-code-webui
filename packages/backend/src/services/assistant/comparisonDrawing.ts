import type { AssistantComparison } from '@plum-code-webui/shared';
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
export function comparisonHtml(value: AssistantComparison) {
  return (
    value.offers
      .map(
        (offer) =>
          `<section><h2>${escape(offer.name)}${offer.favorite ? ' ★' : ''}</h2><p><strong>${escape(offer.price)}</strong></p><p>Quellenstand: ${escape(offer.asOf)} · Revision ${offer.sourceRevision}</p><a href="${escape(offer.url)}" rel="noreferrer">Originalangebot öffnen</a><blockquote style="white-space:pre-wrap">${escape(offer.quote)}</blockquote><p style="white-space:pre-wrap">${escape(offer.details)}</p></section>`
      )
      .join('') +
    `<h2>Eigene Entscheidung</h2><p style="white-space:pre-wrap">${escape(value.decision)}</p>`
  );
}
