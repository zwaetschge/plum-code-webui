import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseAssistantComparison, type AssistantOffer } from '@plum-code-webui/shared';
process.env.NODE_ENV = 'test';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, closePool } = await import('../src/db/pg.js');
const {
  createResource,
  reviseResource,
  findResource,
  archiveResource,
  checkReferences,
  BODY_SCHEMAS,
} = await import('../src/services/assistant/resources.js');
const { createComparison } = await import('../src/services/assistant/comparisons.js');
const { exportArtifact } = await import('../src/services/assistant/exports.js');
if (!(await databaseReachable())) {
  await closePool();
  throw new Error('Isolated test database unavailable');
}
const directory = await mkdtemp(path.join(tmpdir(), 'plum-comparison-test-'));
try {
  await createTestSchema();
  for (const user of ['comparison-alice', 'comparison-bob'])
    await run(
      'INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,?,?)',
      user,
      `${user}@fixture.invalid`,
      'test',
      user
    );
  const source = await createResource(
    'comparison-alice',
    'source',
    'Angebot',
    BODY_SCHEMAS.source.parse({
      text: 'Rucksack blau — 129 CHF — lieferbar',
      url: 'https://example.invalid/rucksack',
    })
  );
  const commandId = randomUUID(),
    created = await createComparison('comparison-alice', { commandId, title: 'Rucksäcke' });
  assert.equal(
    (await createComparison('comparison-alice', { commandId, title: 'Rucksäcke' })).id,
    created.id
  );
  await assert.rejects(createComparison('comparison-alice', { commandId, title: 'Anderes Ziel' }));
  const offer: AssistantOffer = {
    id: 'offer-fixture',
    name: 'Rucksack blau',
    price: '129 CHF',
    url: String(source.body.url),
    asOf: source.updatedAt,
    sourceId: source.id,
    sourceRevision: source.revision,
    quote: String(source.body.text),
    details: 'Eigene Kriterien: Farbe und Grösse',
    favorite: false,
  };
  const body = {
    ...created.body,
    content: JSON.stringify({
      type: 'plum-comparison',
      version: 1,
      offers: [offer],
      decision: 'Weiter vergleichen',
    }),
  };
  const saved = await reviseResource('comparison-alice', created.id, 1, created.title, body);
  for (const patch of [
    { quote: 'Der Preis ist 129 CHF (erfunden)' },
    { price: '99 CHF' },
    { url: 'https://example.invalid/other' },
    { asOf: '2020-01-01T00:00:00Z' },
    { sourceRevision: 99 },
  ])
    await assert.rejects(
      checkReferences('comparison-alice', {
        ...body,
        content: JSON.stringify({
          type: 'plum-comparison',
          version: 1,
          offers: [{ ...offer, ...patch }],
          decision: '',
        }),
      })
    );
  for (const url of ['javascript:alert(1)', 'https://user:fixture@example.invalid/'])
    assert.throws(() =>
      parseAssistantComparison(
        JSON.stringify({
          type: 'plum-comparison',
          version: 1,
          offers: [{ ...offer, url }],
          decision: '',
        })
      )
    );
  await assert.rejects(checkReferences('comparison-bob', body));
  await reviseResource('comparison-alice', source.id, 1, source.title, {
    ...source.body,
    text: 'Neuer Preis: 149 CHF',
  });
  assert.equal(
    parseAssistantComparison(
      String((await findResource('comparison-alice', saved.id)).body.content)
    ).offers[0]!.price,
    '129 CHF'
  );
  await checkReferences('comparison-alice', saved.body);
  await archiveResource('comparison-alice', source.id, 2);
  const favorite = await reviseResource('comparison-alice', saved.id, 2, saved.title, {
    ...body,
    content: JSON.stringify({
      type: 'plum-comparison',
      version: 1,
      offers: [{ ...offer, favorite: true }],
      decision: 'Weiter vergleichen',
    }),
  });
  assert(
    parseAssistantComparison(String(favorite.body.content)).offers[0]!.favorite,
    'old own evidence remains valid after archiving the live source'
  );
  const html = (await exportArtifact(favorite, 'html')).data.toString();
  assert(html.includes('129 CHF'));
  assert(html.includes('Quellenstand:'));
  assert(html.includes('https://example.invalid/rucksack'));
  const markdown = (await exportArtifact(favorite, 'md')).data.toString();
  assert(markdown.includes('Revision 1'));
  assert(markdown.includes('129 CHF'));
  const pdf = await exportArtifact(favorite, 'pdf');
  const file = path.join(directory, 'comparison.pdf');
  await writeFile(file, pdf.data);
  const read = (
    await promisify(execFile)('/usr/local/bin/plum-python', [
      '-c',
      'import pymupdf,sys\nd=pymupdf.open(sys.argv[1]);print("\\n".join(p.get_text() for p in d))',
      file,
    ])
  ).stdout;
  assert(read.includes('129 CHF'));
  assert(read.includes('Quellenstand:'));
  assert(read.includes('Eigene Kriterien'));
  console.log(
    'PASS: actual comparison create/retry receipt, exact price quote/date/URL/source revision and ownership, immutable old offers after refresh/archive, favorites, safe links, JSON/HTML/Markdown and independently read PDF'
  );
} finally {
  await rm(directory, { recursive: true, force: true });
  await dropTestSchema();
  await closePool();
}
