import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'artifact-image-fixture-0000000000000000';
const directory = await mkdtemp(path.join(tmpdir(), 'plum-artifact-image-'));
process.env.COMFYUI_OUTPUT_DIR = path.join(directory, 'generated');
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, closePool } = await import('../src/db/pg.js');
const { createResource, reviseResource, BODY_SCHEMAS } =
  await import('../src/services/assistant/resources.js');
const { readArtifactImage } = await import('../src/services/assistant/artifactImages.js');
const { comfyui } = await import('../src/services/comfyui/index.js');
const python = process.env.PLUM_PYTHON_BIN || '/usr/local/bin/plum-python';
if (!(await databaseReachable())) throw new Error('Own test database unavailable');
try {
  await createTestSchema();
  for (const id of ['picture-alice', 'picture-bob'])
    await run(
      'INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,?,?)',
      id,
      id + '@fixture.invalid',
      'test',
      id
    );
  const pixel = (
    await promisify(execFile)(
      python,
      [
        '-c',
        'from PIL import Image; import sys; Image.new("RGB",(8,6),(0,120,50)).save(sys.stdout.buffer,format="PNG")',
      ],
      { encoding: 'buffer' }
    )
  ).stdout;
  const generated = await comfyui.saveGeneratedImage('picture-alice', pixel, 'image/png');
  const content = `Originaler Test: ![Grün](${generated.outputUrl})`;
  const artifact = await createResource(
    'picture-alice',
    'artifact',
    'Eigenes Bild',
    BODY_SCHEMAS.artifact.parse({ type: 'image', content })
  );
  const metadata = artifact.body.images[0];
  assert.equal(artifact.body.images.length, 1);
  assert.equal(metadata.url, generated.outputUrl);
  assert.equal(metadata.sha256, createHash('sha256').update(pixel).digest('hex'));
  assert.deepEqual(
    (await readArtifactImage('picture-alice', artifact.body, metadata.assetId)).bytes,
    pixel
  );
  await assert.rejects(readArtifactImage('picture-bob', artifact.body, metadata.assetId));
  await assert.rejects(
    createResource(
      'picture-bob',
      'artifact',
      'Fremdes Bild',
      BODY_SCHEMAS.artifact.parse({ type: 'image', content })
    )
  );
  const reference = await createResource(
    'picture-alice',
    'artifact',
    'Pfad als Code',
    BODY_SCHEMAS.artifact.parse({ type: 'code', format: 'text', content: generated.outputUrl })
  );
  assert.deepEqual(reference.body.images, [], 'an incidental file path does not embed a picture');
  await rm(path.join(process.env.COMFYUI_OUTPUT_DIR!, generated.filename));
  const updated = await reviseResource('picture-alice', artifact.id, 1, artifact.title, {
    ...artifact.body,
    content: `Neuer Text: ![Grün](${generated.outputUrl})`,
  });
  assert.equal(
    updated.body.images[0].assetId,
    metadata.assetId,
    'saved original survives deletion of transient renderer output'
  );
  const textOnly = await reviseResource('picture-alice', artifact.id, 2, artifact.title, {
    ...artifact.body,
    content: 'Nur Beschreibung',
  });
  assert.deepEqual(textOnly.body.images, []);
  const temporary = await createResource('picture-alice', 'api-chat', 'Temporäres gleiches Bild', {
    providerId: 'fixture',
    model: 'fixture',
    temporary: true,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  const { uploadApiImage } = await import('../src/services/assistant/apiFiles.js');
  await uploadApiImage('picture-alice', temporary.id, {
    buffer: pixel,
    originalname: 'Gleiches Bild.png',
  });
  await reviseResource('picture-alice', temporary.id, 1, temporary.title, {
    ...temporary.body,
    expiresAt: '2000-01-01T00:00:00Z',
  });
  const { purgeTemporaryApiChat } = await import('../src/services/assistant/apiChats.js');
  assert(await purgeTemporaryApiChat('picture-alice', temporary.id));
  assert(
    await get('SELECT id FROM assistant_assets WHERE id=?', metadata.assetId),
    'historical image revision preserves original after temporary chat cleanup'
  );
  const { createImageEditTask, IMAGE_EDIT_INPUT } =
    await import('../src/services/assistant/imageEdits.js');
  const input = IMAGE_EDIT_INPUT.parse({
    commandId: randomUUID(),
    sourceRevision: 1,
    assetId: metadata.assetId,
    prompt: 'Mitte blau färben',
    mode: 'inpaint',
    rectangles: [{ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }],
  });
  const task = await createImageEditTask('picture-alice', artifact.id, input, 'artifact');
  assert.equal(task.body.imageEdit.sourceArtifactId, artifact.id);
  assert.equal(task.body.status, 'draft');
  assert(task.body.inputImageIds.includes(metadata.assetId));
  await assert.rejects(
    createImageEditTask(
      'picture-bob',
      artifact.id,
      { ...input, commandId: randomUUID() },
      'artifact'
    )
  );
  await assert.rejects(
    createImageEditTask('picture-alice', artifact.id, { ...input, commandId: randomUUID() }, 'task')
  );
  const { streamAssistantExport } = await import('../src/services/assistant/accountExport.js');
  const zipPath = path.join(directory, 'account.zip');
  await streamAssistantExport('picture-alice', createWriteStream(zipPath), false);
  const zip = (
    await promisify(execFile)(python, [
      '-c',
      'import zipfile,json,hashlib,sys; z=zipfile.ZipFile(sys.argv[1]); wanted=sys.argv[2]; print(json.dumps({"found":any(hashlib.sha256(z.read(n)).hexdigest()==wanted for n in z.namelist() if n.startswith("files/")),"manifest": "data.json" in z.namelist()}))',
      zipPath,
      metadata.sha256,
    ])
  ).stdout;
  assert.deepEqual(JSON.parse(zip), { found: true, manifest: true });
  const { exportArtifact } = await import('../src/services/assistant/exports.js');
  await assert.rejects(exportArtifact(artifact, 'pdf'));
  await assert.rejects(exportArtifact(artifact, 'pdf', 'picture-bob'));
  const pdf = await exportArtifact(artifact, 'pdf', 'picture-alice');
  await writeFile(path.join(directory, 'picture.pdf'), pdf.data);
  const pdfImages = (
    await promisify(execFile)(python, [
      '-c',
      'import pymupdf as fitz,json,sys; d=fitz.open(sys.argv[1]); images=[item for p in d for item in p.get_images()]; pixels=[list(fitz.Pixmap(d,item[0]).pixel(0,0)) for item in images]; print(json.dumps({"pages":len(d),"dimensions":[[i[2],i[3]] for i in images],"pixels":pixels}))',
      path.join(directory, 'picture.pdf'),
    ])
  ).stdout;
  assert.deepEqual(JSON.parse(pdfImages), {
    pages: 1,
    dimensions: [[8, 6]],
    pixels: [[0, 120, 50]],
  });
  const uploadId = randomUUID();
  const uploaded = (
    await promisify(execFile)(
      python,
      [
        '-c',
        'from PIL import Image; import sys; Image.new("RGB",(9,7),(20,30,40)).save(sys.stdout.buffer,format="PNG")',
      ],
      { encoding: 'buffer' }
    )
  ).stdout;
  const uploadSha = createHash('sha256').update(uploaded).digest('hex');
  await run(
    'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?)',
    uploadId,
    'picture-alice',
    'Eigenes Original.png',
    'image/png',
    uploadSha,
    uploaded,
    new Date().toISOString()
  );
  const alias = `/assistant-images/${uploadId}`;
  const ownOriginal = await createResource(
    'picture-alice',
    'artifact',
    'Direktes Original',
    BODY_SCHEMAS.artifact.parse({ type: 'image', content: alias })
  );
  assert.deepEqual(
    (await readArtifactImage('picture-alice', ownOriginal.body, uploadId)).bytes,
    uploaded
  );
  await assert.rejects(
    createResource(
      'picture-bob',
      'artifact',
      'Fremder Upload',
      BODY_SCHEMAS.artifact.parse({ type: 'image', content: alias })
    )
  );
  await assert.rejects(
    createResource(
      'picture-alice',
      'artifact',
      'Fehlender Upload',
      BODY_SCHEMAS.artifact.parse({ type: 'image', content: `/assistant-images/${randomUUID()}` })
    )
  );
  await run('UPDATE assistant_assets SET bytes=? WHERE id=?', Buffer.from('corrupted'), uploadId);
  await assert.rejects(
    createResource(
      'picture-alice',
      'artifact',
      'Defekter Upload',
      BODY_SCHEMAS.artifact.parse({ type: 'image', content: alias })
    )
  );
  await run('UPDATE assistant_assets SET bytes=? WHERE id=?', uploaded, uploadId);
  const { createAppFrame, consumeAppFrame } = await import('../src/services/assistant/frames.js');
  const appArtifact = await createResource(
    'picture-alice',
    'artifact',
    'App mit Original',
    BODY_SCHEMAS.artifact.parse({
      type: 'app',
      format: 'html',
      content: `<h1>Eigene App</h1><img src="${alias}" alt="Original">`,
    })
  );
  const frame = await createAppFrame('picture-alice', {
    artifactId: appArtifact.id,
    channel: 'image-fixture',
    stateEnabled: false,
  });
  const html = await consumeAppFrame(frame.path.split('/').at(-1)!);
  assert(html.includes(`data:image/png;base64,${uploaded.toString('base64')}`));
  assert(!html.includes(alias));
  await assert.rejects(
    createAppFrame('picture-bob', {
      artifactId: appArtifact.id,
      channel: 'image-fixture',
      stateEnabled: false,
    })
  );
  const report = await createResource(
    'picture-alice',
    'artifact',
    'Bericht mit Originalbild',
    BODY_SCHEMAS.artifact.parse({
      type: 'document',
      format: 'markdown',
      content: `Vor dem Bild\n![Unverändertes Original](${alias})\nNach dem Bild`,
    })
  );
  await assert.rejects(exportArtifact(report, 'docx'));
  await assert.rejects(exportArtifact(report, 'docx', 'picture-bob'));
  const word = await exportArtifact(report, 'docx', 'picture-alice');
  await writeFile(path.join(directory, 'picture.docx'), word.data);
  const wordImages = (
    await promisify(execFile)(python, [
      '-c',
      'import zipfile,json,sys,hashlib,xml.etree.ElementTree as E; z=zipfile.ZipFile(sys.argv[1]); root=E.fromstring(z.read("word/document.xml")); ns={"w":"http://schemas.openxmlformats.org/wordprocessingml/2006/main","a":"http://schemas.openxmlformats.org/drawingml/2006/main"}; media=[n for n in z.namelist() if n.startswith("word/media/")]; rel=E.fromstring(z.read("word/_rels/document.xml.rels")); types=E.fromstring(z.read("[Content_Types].xml")); print(json.dumps({"pictures":len(root.findall(".//w:drawing",ns)),"text":[n.text for n in root.findall(".//w:t",ns)],"sha":[hashlib.sha256(z.read(n)).hexdigest() for n in media],"images":[r.attrib["Target"] for r in rel if r.attrib["Type"].endswith("/image")],"mime":[r.attrib["ContentType"] for r in types if r.attrib.get("Extension")=="png"]}))',
      path.join(directory, 'picture.docx'),
    ])
  ).stdout;
  assert.deepEqual(JSON.parse(wordImages), {
    pictures: 1,
    text: ['Vor dem Bild', null, 'Unverändertes Original', null, 'Nach dem Bild'],
    sha: [uploadSha],
    images: ['media/image1.png'],
    mime: ['image/png'],
  });
  console.log(
    'PASS: actual offline PDF image dimensions/pixels and Word embedded original SHA, relationship, MIME, position/caption and owner checks'
  );
  if (process.env.PLUM_OFFICE_READER_PATH) {
    const independent = (
      await promisify(execFile)(
        python,
        [
          '-c',
          'from docx import Document; import sys,json,hashlib; d=Document(sys.argv[1]); print(json.dumps({"pictures":len(d.inline_shapes),"sha":[hashlib.sha256(r.target_part.blob).hexdigest() for r in d.part.rels.values() if r.reltype.endswith("/image")],"text":[p.text for p in d.paragraphs]}))',
          path.join(directory, 'picture.docx'),
        ],
        { env: { ...process.env, PYTHONPATH: path.resolve(process.env.PLUM_OFFICE_READER_PATH) } }
      )
    ).stdout;
    assert.deepEqual(JSON.parse(independent), {
      pictures: 1,
      sha: [uploadSha],
      text: ['Vor dem Bild', '', '', 'Unverändertes Original', '', 'Nach dem Bild'],
    });
    console.log(
      'PASS: independent python-docx reader opens embedded original and preserved report order/caption'
    );
  }
  const aliasPdf = await exportArtifact(report, 'pdf', 'picture-alice');
  await writeFile(path.join(directory, 'upload.pdf'), aliasPdf.data);
  const uploadedPdf = JSON.parse(
    (
      await promisify(execFile)(python, [
        '-c',
        'import pymupdf as fitz,json,sys; d=fitz.open(sys.argv[1]); i=d[0].get_images()[0]; print(json.dumps({"size":[i[2],i[3]],"pixel":list(fitz.Pixmap(d,i[0]).pixel(0,0))}))',
        path.join(directory, 'upload.pdf'),
      ])
    ).stdout
  );
  assert.deepEqual(uploadedPdf, { size: [9, 7], pixel: [20, 30, 40] });
  const { addDocumentImage } = await import('../src/services/assistant/documentImages.js');
  const { parseAssistantDocument, assistantDocumentPassage } =
    await import('@plum-code-webui/shared');
  const formatted = await createResource(
    'picture-alice',
    'artifact',
    'Formatiertes Dokument',
    BODY_SCHEMAS.artifact.parse({
      type: 'document',
      format: 'json',
      content: JSON.stringify({
        type: 'plum-document',
        version: 1,
        blocks: [{ type: 'heading', level: 2, runs: [{ text: 'Vor dem Original', bold: true }] }],
      }),
    })
  );
  const imageCommand = {
    commandId: randomUUID(),
    expectedRevision: 1,
    alt: 'Eigenes Grün',
    caption: 'Bildbeleg',
  };
  const imageFile = { buffer: uploaded, originalname: 'Eigenes Original.png' };
  const [withImage, repeatedImage] = await Promise.all([
    addDocumentImage('picture-alice', formatted.id, imageCommand, imageFile),
    addDocumentImage('picture-alice', formatted.id, imageCommand, imageFile),
  ]);
  assert.deepEqual(withImage, repeatedImage);
  assert.equal(withImage.revision, 2);
  assert.equal(parseAssistantDocument(String(withImage.body.content)).blocks.length, 2);
  assert.equal(withImage.body.images[0].sha256, uploadSha);
  await assert.rejects(addDocumentImage('picture-bob', formatted.id, imageCommand, imageFile));
  await assert.rejects(
    addDocumentImage(
      'picture-alice',
      formatted.id,
      { ...imageCommand, caption: 'Anderer Inhalt' },
      imageFile
    )
  );
  await assert.rejects(
    addDocumentImage(
      'picture-alice',
      formatted.id,
      { ...imageCommand, commandId: randomUUID() },
      imageFile
    )
  );
  assert.throws(() => assistantDocumentPassage(String(withImage.body.content), { block: 1 }));
  const richDoc = parseAssistantDocument(String(withImage.body.content));
  richDoc.blocks.push({ type: 'paragraph', runs: [{ text: 'Nach dem Original', italic: true }] });
  const finalDoc = await reviseResource('picture-alice', formatted.id, 2, formatted.title, {
    ...withImage.body,
    content: JSON.stringify(richDoc),
  });
  assert.deepEqual(
    await addDocumentImage('picture-alice', formatted.id, imageCommand, imageFile),
    withImage
  );
  assert.equal(finalDoc.body.images.length, 1);
  const htmlDoc = await exportArtifact(finalDoc, 'html', 'picture-alice');
  assert(htmlDoc.data.toString().includes(`data:image/png;base64,${uploaded.toString('base64')}`));
  assert(!htmlDoc.data.toString().includes(alias));
  await assert.rejects(exportArtifact(finalDoc, 'html', 'picture-bob'));
  const richWord = await exportArtifact(finalDoc, 'docx', 'picture-alice');
  await writeFile(path.join(directory, 'rich-picture.docx'), richWord.data);
  const richImages = JSON.parse(
    (
      await promisify(execFile)(python, [
        '-c',
        'import zipfile,json,sys,hashlib,xml.etree.ElementTree as E; z=zipfile.ZipFile(sys.argv[1]); r=E.fromstring(z.read("word/document.xml")); ns={"w":"http://schemas.openxmlformats.org/wordprocessingml/2006/main"}; print(json.dumps({"pictures":len(r.findall(".//w:drawing",ns)),"text":[t.text for t in r.findall(".//w:t",ns)],"sha":hashlib.sha256(z.read("word/media/image1.png")).hexdigest(),"heading":len([n for n in r.findall(".//w:pStyle",ns) if n.attrib.get("{"+ns["w"]+"}val")=="Heading2"]),"italic":len(r.findall(".//w:i",ns))}))',
        path.join(directory, 'rich-picture.docx'),
      ])
    ).stdout
  );
  assert.deepEqual(richImages, {
    pictures: 1,
    text: ['Vor dem Original', 'Bildbeleg', 'Nach dem Original'],
    sha: uploadSha,
    heading: 1,
    italic: 1,
  });
  const richPdf = await exportArtifact(finalDoc, 'pdf', 'picture-alice');
  await writeFile(path.join(directory, 'rich-picture.pdf'), richPdf.data);
  const richPixels = JSON.parse(
    (
      await promisify(execFile)(python, [
        '-c',
        'import pymupdf as fitz,json,sys; d=fitz.open(sys.argv[1]); i=d[0].get_images()[0]; print(json.dumps({"pixel":list(fitz.Pixmap(d,i[0]).pixel(0,0)),"text":d[0].get_text()}))',
        path.join(directory, 'rich-picture.pdf'),
      ])
    ).stdout
  );
  assert.deepEqual(richPixels.pixel, [20, 30, 40]);
  assert(
    richPixels.text.includes('Vor dem Original') &&
      richPixels.text.includes('Bildbeleg') &&
      richPixels.text.includes('Nach dem Original')
  );
  const { ingestSource } = await import('../src/services/assistant/ingestion.js');
  const { officeArtifact } = await import('../src/services/assistant/office.js');
  const wordSource = await ingestSource('picture-alice', {
    buffer: richWord.data,
    originalname: 'Eigener Bildbericht.docx',
  });
  const importedWord = await officeArtifact('picture-alice', wordSource.id, {
    commandId: randomUUID(),
    expectedRevision: wordSource.revision,
  });
  assert.deepEqual(parseAssistantDocument(String(importedWord.body.content)), richDoc);
  assert.equal(importedWord.body.images[0].sha256, uploadSha);
  assert.deepEqual(
    (await readArtifactImage('picture-alice', importedWord.body, uploadId)).bytes,
    uploaded
  );
  await assert.rejects(
    officeArtifact('picture-bob', wordSource.id, {
      commandId: randomUUID(),
      expectedRevision: wordSource.revision,
    })
  );
  const originalWord = await get(
    'SELECT bytes FROM assistant_assets WHERE id=? AND user_id=?',
    wordSource.body.assetId,
    'picture-alice'
  );
  assert.deepEqual(Buffer.from(originalWord.bytes), richWord.data);
  console.log(
    'PASS: actual supported formatted Word/image/caption roundtrip with original bytes and owner rights; no claim of complete Office layout/media support'
  );
  console.log(
    'PASS: upload-only original aliases, owner/SHA rejection, offline app/HTML embedding, atomic idempotent formatted-document upload, preserved rich-text/image position and actual Word/PDF pixels'
  );
  const { default: router } = await import('../src/routes/assistant.js');
  const { errorHandler } = await import('../src/middleware/errorHandler.js');
  const { config } = await import('../src/config.js');
  const app = express();
  app.use(express.json());
  app.use('/api/assistant', router);
  app.use(errorHandler);
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const own = app.listen(0, '127.0.0.1', () => resolve(own));
  });
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/assistant`;
    const headers = (id: string) => ({
      Authorization: `Bearer ${jwt.sign({ userId: id }, config.jwtSecret, { expiresIn: '1m' })}`,
      'Content-Type': 'application/json',
    });
    const own = headers('picture-alice'),
      other = headers('picture-bob'),
      url = `${base}/artifacts/${artifact.id}/images/${metadata.assetId}?revision=1`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: other })).status, 404);
    const image = await fetch(url, { headers: own });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('cache-control'), 'private, no-store');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), pixel);
    assert.equal(
      (await fetch(url.replace('revision=1', 'revision=3'), { headers: own })).status,
      404
    );
    const shared = await fetch(base + '/shares', {
      method: 'POST',
      headers: own,
      body: JSON.stringify({
        resourceId: artifact.id,
        revision: 1,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
    });
    assert.equal(shared.status, 201);
    const share = (await shared.json()).data;
    const publicImage = `${base}/shared/${share.token}/images/${metadata.assetId}`;
    assert.equal((await fetch(publicImage)).status, 401);
    assert.deepEqual(
      Buffer.from(await (await fetch(publicImage, { headers: other })).arrayBuffer()),
      pixel
    );
    assert.equal(
      (await fetch(publicImage.replace(metadata.assetId, randomUUID()), { headers: other })).status,
      404
    );
    await fetch(`${base}/shares/${share.id}`, { method: 'DELETE', headers: own });
    assert.equal((await fetch(publicImage, { headers: other })).status, 404);
    await run(
      'UPDATE assistant_assets SET bytes=? WHERE id=?',
      Buffer.from('modified'),
      metadata.assetId
    );
    assert.equal((await fetch(url, { headers: own })).status, 409);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log(
    'PASS: generated original capture, owned JWT-only bytes, immutable revisions after output deletion, exact image Task provenance/mask, historical retention after temporary purge, actual ZIP original, revoked snapshot image grants and corruption guard; no generation or live files changed'
  );
} finally {
  await rm(directory, { recursive: true, force: true });
  await dropTestSchema();
  await closePool();
}
