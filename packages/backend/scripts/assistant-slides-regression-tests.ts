import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  parseAssistantSlides,
  slidesFromText,
  assistantSlidesText,
  type AssistantResource,
} from '@plum-code-webui/shared';
import { exportArtifact } from '../src/services/assistant/exports.js';
const deck = parseAssistantSlides(
  JSON.stringify({
    type: 'plum-slides',
    version: 1,
    slides: [
      {
        title: 'Übersicht',
        layout: 'title',
        text: 'Äpfel & Birnen',
        secondary: 'Zusatz bleibt erhalten',
        notes: 'Nicht auf der Folie\nFür den Vortrag',
      },
      {
        title: 'Vergleich',
        layout: 'columns',
        text: 'Linke Spalte\n12 CHF',
        secondary: 'Rechte Spalte\n10 CHF',
        notes: 'Notizen zur zweiten Folie',
      },
      {
        title: 'Nächste Schritte',
        layout: 'bullets',
        text: 'Quellen prüfen\nEntscheiden',
        secondary: '',
        notes: '',
      },
    ],
  })
);
assert.equal(slidesFromText('# Erste\nText\n---\n# Zweite').slides.length, 2);
assert(assistantSlidesText(deck).includes('[Sprechernotizen]'));
assert.throws(() => parseAssistantSlides(JSON.stringify({ ...deck, slides: [] })));
assert.throws(() =>
  parseAssistantSlides(
    JSON.stringify({ ...deck, slides: [{ ...deck.slides[0], layout: 'iframe' }] })
  )
);
const artifact: AssistantResource = {
  id: 'slides-fixture',
  kind: 'artifact',
  title: 'Vortrag',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  body: { type: 'slides', format: 'json', content: JSON.stringify(deck) },
};
const directory = await mkdtemp(path.join(tmpdir(), 'plum-slides-test-'));
try {
  const file = path.join(directory, 'slides.pptx');
  const result = await exportArtifact(artifact, 'pptx');
  await writeFile(file, result.data);
  const imported = JSON.parse(
    (await promisify(execFile)('python3', ['scripts/plum-office-extract.py', file])).stdout
  );
  assert.deepEqual(
    imported.presentation,
    deck,
    'own supported slide model including notes and column geometry roundtrips'
  );
  const html = (await exportArtifact(artifact, 'html')).data.toString();
  assert(html.includes('grid-template-columns:1fr 1fr'));
  assert(html.includes('Notizen zur zweiten Folie'));
  assert(!html.includes('& Birnen'));
  assert((await exportArtifact(artifact, 'md')).data.toString().includes('12 CHF'));
  const reader = process.env.PLUM_OFFICE_READER_PATH;
  if (reader) {
    const script =
      'from pptx import Presentation\nimport sys,json\np=Presentation(sys.argv[1])\nprint(json.dumps({"count":len(p.slides),"wide":p.slide_width>p.slide_height,"notes":[s.notes_slide.notes_text_frame.text for s in p.slides],"shapes":[[x.text for x in s.shapes if x.has_text_frame] for s in p.slides]}))';
    const checked = JSON.parse(
      (
        await promisify(execFile)('/usr/local/bin/plum-python', ['-c', script, file], {
          env: { PATH: process.env.PATH, PYTHONPATH: path.resolve(reader) },
        })
      ).stdout
    );
    assert.equal(checked.count, 3);
    assert(checked.wide);
    assert.equal(checked.notes[0], deck.slides[0]!.notes);
    assert.equal(checked.shapes[1][2], deck.slides[1]!.secondary);
  }
  console.log(
    'PASS: supported PowerPoint shapes, original Unicode and separate notes, exact own-model reimport, HTML/Markdown and shape limits; independent reader runs additionally when PLUM_OFFICE_READER_PATH is set'
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
