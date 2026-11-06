import type { AssistantSlide, AssistantSlides } from '@plum-code-webui/shared';
const escape = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!
    );
const lines = (text: string, bullets: boolean, size: number) =>
  text
    .split('\n')
    .map(
      (line) =>
        `<a:p><a:pPr${bullets ? ' marL="260000" indent="-180000"' : ''}>${bullets ? '<a:buChar char="•"/>' : '<a:buNone/>'}</a:pPr><a:r><a:rPr lang="de-CH" sz="${size}"/><a:t xml:space="preserve">${escape(line)}</a:t></a:r><a:endParaRPr lang="de-CH" sz="${size}"/></a:p>`
    )
    .join('');
function shape(
  id: number,
  name: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  size: number,
  bullets = false
) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${lines(text, bullets, size)}</p:txBody></p:sp>`;
}
export function slideShapes(slide: AssistantSlide) {
  return (
    shape(2, 'Titel', slide.title, 650000, 500000, 10800000, 1100000, 3200) +
    shape(
      3,
      'Inhalt',
      slide.text,
      650000,
      1900000,
      slide.layout === 'columns' ? 5050000 : 10800000,
      slide.layout !== 'columns' && slide.secondary ? 1900000 : 4300000,
      slide.layout === 'title' ? 2800 : 2000,
      slide.layout === 'bullets'
    ) +
    (slide.layout === 'columns'
      ? shape(4, 'Zweite Spalte', slide.secondary, 6400000, 1900000, 5050000, 4300000, 2000)
      : slide.secondary
        ? shape(4, 'Zusatz', slide.secondary, 650000, 4200000, 10800000, 2000000, 2000)
        : '')
  );
}
export function slideNotes(slide: AssistantSlide) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Sprechernotizen"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${lines(slide.notes, false, 1200)}</p:txBody></p:sp>`;
}
export function slidesHtml(deck: AssistantSlides, notes = false) {
  return deck.slides
    .map(
      (slide, index) =>
        `<section class="plum-slide" style="${index ? 'break-before:page;' : ''}"><h2>${escape(slide.title)}</h2><div style="${slide.layout === 'columns' ? 'display:grid;grid-template-columns:1fr 1fr;gap:24px;' : ''}">${
          slide.layout === 'bullets'
            ? '<ul>' +
              slide.text
                .split('\n')
                .map((line) => '<li>' + escape(line) + '</li>')
                .join('') +
              '</ul>'
            : '<p style="white-space:pre-wrap">' + escape(slide.text) + '</p>'
        }${slide.secondary ? '<p style="white-space:pre-wrap">' + escape(slide.secondary) + '</p>' : ''}</div>${notes && slide.notes ? '<aside><h3>Sprechernotizen</h3><p style="white-space:pre-wrap">' + escape(slide.notes) + '</p></aside>' : ''}</section>`
    )
    .join('');
}
