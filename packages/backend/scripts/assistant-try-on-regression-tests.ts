import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'try-on-fixture-secret-000000000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, closePool } = await import('../src/db/pg.js');
const { createResource, findResource, reviseResource, checkReferences, BODY_SCHEMAS } =
  await import('../src/services/assistant/resources.js');
const { createTryOnTask } = await import('../src/services/assistant/tryOn.js');
const { taskImage, removeTaskImage } = await import('../src/services/assistant/taskFiles.js');
const { default: router } = await import('../src/routes/assistant.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const images = JSON.parse(
  (
    await promisify(execFile)('/usr/local/bin/plum-python', [
      '-c',
      'from PIL import Image;import io,base64,json\na=[]\nfor color in ["red","blue"]:\n b=io.BytesIO();Image.new("RGB",(12,12),color).save(b,format="PNG");a.append(base64.b64encode(b.getvalue()).decode())\nprint(json.dumps(a))',
    ])
  ).stdout
).map((s: string) => Buffer.from(s, 'base64'));
const person = { buffer: images[0], originalname: 'Person.png' },
  product = { buffer: images[1], originalname: 'Produkt.png' };
const app = express();
app.use(express.json());
app.use('/api/assistant', router);
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => server.once('listening', r));
const address = server.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
if (!(await databaseReachable())) {
  await closePool();
  server.close();
  throw new Error('Own test database unavailable');
}
try {
  await createTestSchema();
  for (const id of ['try-alice', 'try-bob'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      id,
      `${id}@fixture.invalid`,
      id
    );
  const source = await createResource(
    'try-alice',
    'source',
    'Hemd',
    BODY_SCHEMAS.source.parse({ text: 'Blaues Hemd 39 CHF', url: 'https://example.invalid/hemd' })
  );
  const offer = {
    id: 'selected-offer',
    name: 'Blaues Hemd',
    price: '39 CHF',
    url: source.body.url,
    asOf: source.updatedAt,
    sourceId: source.id,
    sourceRevision: 1,
    quote: source.body.text,
    details: '',
    favorite: false,
  };
  const comparison = await createResource(
    'try-alice',
    'artifact',
    'Hemden',
    BODY_SCHEMAS.artifact.parse({
      type: 'comparison',
      format: 'json',
      content: JSON.stringify({
        type: 'plum-comparison',
        version: 1,
        offers: [offer],
        decision: '',
      }),
    })
  );
  const input = {
    commandId: randomUUID(),
    sourceRevision: 1,
    offerId: offer.id,
    instructions: 'Von vorne darstellen.',
  };
  const duplicate = await Promise.all([
    createTryOnTask('try-alice', comparison.id, input, person, product),
    createTryOnTask('try-alice', comparison.id, input, person, product),
  ]);
  assert.deepEqual(duplicate[0], duplicate[1]);
  const task = duplicate[0]!;
  assert.equal(task.body.status, 'draft');
  assert.equal(task.body.imageTryOn.comparisonRevision, 1);
  assert(task.body.goal.includes('39 CHF') && task.body.goal.includes('keinen Kauf'));
  assert.equal(task.body.inputImageIds.length, 2);
  for (const [index, asset] of task.body.inputImageIds.entries()) {
    assert.deepEqual((await taskImage('try-alice', task.id, asset)).bytes, images[index]);
    const row = await get('SELECT sha256 FROM assistant_assets WHERE id=?', asset);
    assert.equal(row.sha256, createHash('sha256').update(images[index]).digest('hex'));
  }
  await assert.rejects(
    createTryOnTask(
      'try-bob',
      comparison.id,
      { ...input, commandId: randomUUID() },
      person,
      product
    ),
    /gefunden/
  );
  await assert.rejects(
    createTryOnTask(
      'try-alice',
      comparison.id,
      { ...input, instructions: 'Anders' },
      person,
      product
    ),
    /anderen Inhalt/
  );
  await assert.rejects(
    createTryOnTask(
      'try-alice',
      comparison.id,
      { ...input, commandId: randomUUID(), offerId: 'foreign' },
      person,
      product
    ),
    /Angebot/
  );
  await assert.rejects(
    createTryOnTask(
      'try-alice',
      comparison.id,
      { ...input, commandId: randomUUID() },
      person,
      person
    ),
    /unterschiedliche/
  );
  await assert.rejects(
    removeTaskImage('try-alice', task.id, task.body.inputImageIds[0], 1),
    /gebunden/
  );
  await assert.rejects(
    checkReferences('try-alice', { ...task.body, inputImageIds: [task.body.inputImageIds[0]] }),
    /Originaleingaben/
  );
  await reviseResource('try-alice', comparison.id, 1, comparison.title, {
    ...comparison.body,
    content: JSON.stringify({
      type: 'plum-comparison',
      version: 1,
      offers: [],
      decision: 'Stand ersetzt',
    }),
  });
  assert.equal(
    (await createTryOnTask('try-alice', comparison.id, input, person, product)).id,
    task.id
  );
  await assert.rejects(
    createTryOnTask(
      'try-alice',
      comparison.id,
      { ...input, commandId: randomUUID() },
      person,
      product
    ),
    /geändert/
  );
  const token = jwt.sign({ userId: 'try-alice' }, process.env.JWT_SECRET!),
    foreign = jwt.sign({ userId: 'try-bob' }, process.env.JWT_SECRET!);
  const packet = { ...input, commandId: randomUUID(), sourceRevision: 2 };
  const ownVersion = await reviseResource(
    'try-alice',
    comparison.id,
    2,
    comparison.title,
    comparison.body
  );
  packet.sourceRevision = ownVersion.revision;
  const post = () => {
    const form = new FormData();
    for (const key of ['commandId', 'sourceRevision', 'offerId', 'instructions'] as const)
      form.append(key, String(packet[key]));
    form.append('person', new Blob([person.buffer], { type: 'image/png' }), person.originalname);
    form.append('product', new Blob([product.buffer], { type: 'image/png' }), product.originalname);
    return fetch(origin + `/api/assistant/artifacts/${comparison.id}/try-on`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: form,
    });
  };
  const accepted = await post();
  assert.equal(accepted.status, 201);
  const actual = (await accepted.json()) as any;
  assert.equal((await post()).status, 201);
  assert.equal(
    actual.data.body.imageTryOn.personAssetId,
    task.body.imageTryOn.personAssetId,
    'Exact own originals deduplicated'
  );
  const edit = await fetch(origin + `/api/assistant/tasks/${actual.data.id}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Anprobe prüfen',
      expectedRevision: 1,
      body: { goal: 'Originale beibehalten', provider: 'codex' },
    }),
  });
  assert.equal(edit.status, 200);
  assert.deepEqual(
    (await findResource('try-alice', actual.data.id)).body.imageTryOn,
    actual.data.body.imageTryOn
  );
  const foreignImage = await fetch(
    origin + `/api/assistant/tasks/${task.id}/images/${task.body.inputImageIds[0]}?revision=1`,
    { headers: { Authorization: 'Bearer ' + foreign } }
  );
  assert.equal(foreignImage.status, 404);
  assert.equal(Number((await get('SELECT COUNT(*) AS n FROM assistant_assets')).n), 2);
  assert.equal(Number((await get('SELECT COUNT(*) AS n FROM assistant_attempts')).n), 0);
  console.log(
    'PASS: actual independent PNG originals/SHA, own offer snapshot and two role bindings, concurrent UUID dedup/conflict, retained old offer, removal prevention, multipart HTTP and metadata preservation, foreign-image denial, no worker/provider/generation'
  );
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  await dropTestSchema();
}
