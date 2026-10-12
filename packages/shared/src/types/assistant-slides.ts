export interface AssistantSlide {
  title: string;
  layout: 'title' | 'bullets' | 'columns';
  text: string;
  secondary: string;
  notes: string;
}
export interface AssistantSlides {
  type: 'plum-slides';
  version: 1;
  slides: AssistantSlide[];
}
export function parseAssistantSlides(content: string): AssistantSlides {
  if (content.length > 50000) throw new Error('Präsentation überschreitet 50 000 Zeichen.');
  const value = JSON.parse(content) as AssistantSlides;
  if (
    value?.type !== 'plum-slides' ||
    value.version !== 1 ||
    !Array.isArray(value.slides) ||
    !value.slides.length ||
    value.slides.length > 200
  )
    throw new Error('Eine Präsentation enthält 1 bis 200 Folien.');
  for (const slide of value.slides) {
    if (
      !slide ||
      !['title', 'bullets', 'columns'].includes(slide.layout) ||
      typeof slide.title !== 'string' ||
      slide.title.length > 200 ||
      !['text', 'secondary', 'notes'].every(
        (key) =>
          typeof slide[key as keyof AssistantSlide] === 'string' &&
          slide[key as keyof AssistantSlide].length <= 10000
      )
    )
      throw new Error(
        'Ungültige Folie: Titel, Layout, Inhalt, zweite Spalte und Sprechernotizen prüfen.'
      );
  }
  // Return only our public model. Imported executable/layout fields never travel to renderers.
  return {
    type: 'plum-slides',
    version: 1,
    slides: value.slides.map((s) => ({
      title: s.title,
      layout: s.layout,
      text: s.text,
      secondary: s.secondary,
      notes: s.notes,
    })),
  };
}
export function slidesFromText(content: string): AssistantSlides {
  const slides = content.split(/^---\s*$/m).map((part) => {
    const lines = part.trim().split('\n');
    return {
      title: (lines.shift() ?? '').replace(/^#+\s*/, '').slice(0, 200),
      layout: 'bullets' as const,
      text: lines.join('\n'),
      secondary: '',
      notes: '',
    };
  });
  return parseAssistantSlides(JSON.stringify({ type: 'plum-slides', version: 1, slides }));
}
export function assistantSlidesText(deck: AssistantSlides, notes = true): string {
  return deck.slides
    .map(
      (slide) =>
        `# ${slide.title}\n${slide.text}${slide.secondary ? '\n\n' + slide.secondary : ''}${notes && slide.notes ? '\n\n[Sprechernotizen]\n' + slide.notes : ''}`
    )
    .join('\n\n---\n\n');
}
