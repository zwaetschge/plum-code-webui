import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'image-edit-fixture-secret-000000000000';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, get, closePool } = await import('../src/db/pg.js');
const { createResource, archiveResource, BODY_SCHEMAS } =
  await import('../src/services/assistant/resources.js');
const { uploadTaskImage, taskImage, removeTaskImage } =
  await import('../src/services/assistant/taskFiles.js');
const { createImageEditTask, IMAGE_EDIT_INPUT } =
  await import('../src/services/assistant/imageEdits.js');
const workspace = await mkdtemp(path.join(tmpdir(), 'plum-image-edit-test-'));
const python = process.env.PLUM_PYTHON_BIN || '/usr/local/bin/plum-python';
if (!(await databaseReachable())) throw new Error('Own test database unavailable');
try {
  await createTestSchema();
  for (const id of ['edit-alice', 'edit-bob'])
    await run(
      'INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,?,?)',
      id,
      id + '@fixture.invalid',
      'test',
      id
    );
  const pixel = await promisify(execFile)(
    python,
    [
      '-c',
      'from PIL import Image; import sys; Image.new("RGB",(8,6),(0,120,50)).save(sys.stdout.buffer,format="PNG")',
    ],
    { encoding: 'buffer' }
  );
  const original = await createResource(
    'edit-alice',
    'task',
    'Bildvorlage',
    BODY_SCHEMAS.task.parse({ goal: 'Original behalten' })
  );
  const upload = await uploadTaskImage('edit-alice', original.id, 1, {
    buffer: pixel.stdout,
    originalname: 'Grün.png',
  });
  const input = IMAGE_EDIT_INPUT.parse({
    commandId: randomUUID(),
    sourceRevision: 2,
    assetId: upload.image.id,
    prompt: 'Die Mitte blau färben.',
    mode: 'inpaint',
    rectangles: [{ x: 0.25, y: 1 / 6, width: 0.5, height: 0.5 }],
  });
  assert(!IMAGE_EDIT_INPUT.safeParse({ ...input, rectangles: [] }).success);
  assert(
    !IMAGE_EDIT_INPUT.safeParse({ ...input, rectangles: [{ x: 0.9, y: 0, width: 0.5, height: 1 }] })
      .success
  );
  assert(!IMAGE_EDIT_INPUT.safeParse({ ...input, mode: 'edit' }).success);
  await assert.rejects(createImageEditTask('edit-bob', original.id, input));
  const draft = await createImageEditTask('edit-alice', original.id, input);
  assert.equal(draft.body.status, 'draft');
  assert.equal(draft.body.provider, 'codex');
  assert.equal(draft.body.imageEdit.originalAssetId, upload.image.id);
  assert.equal(draft.body.imageEdit.sourceRevision, 2);
  const actualMask = await taskImage('edit-alice', draft.id, draft.body.imageEdit.maskAssetId);
  await writeFile(path.join(workspace, 'mask.png'), actualMask.bytes);
  const inspected = await promisify(execFile)(python, [
    '-c',
    'from PIL import Image; import json,sys; im=Image.open(sys.argv[1]); print(json.dumps({"size":im.size,"white":[[x,y] for y in range(im.height) for x in range(im.width) if im.getpixel((x,y))==255],"values":sorted(set(im.getdata()))}))',
    path.join(workspace, 'mask.png'),
  ]);
  const decoded = JSON.parse(inspected.stdout);
  assert.deepEqual(decoded.size, [8, 6]);
  assert.deepEqual(decoded.values, [0, 255]);
  assert.deepEqual(
    decoded.white,
    Array.from({ length: 3 }, (_, dy) =>
      Array.from({ length: 4 }, (_, dx) => [dx + 2, dy + 1])
    ).flat()
  );
  assert.deepEqual((await taskImage('edit-alice', draft.id, upload.image.id)).bytes, pixel.stdout);
  await assert.rejects(removeTaskImage('edit-alice', draft.id, upload.image.id, 1));
  await assert.rejects(removeTaskImage('edit-alice', draft.id, actualMask.id, 1));
  assert.deepEqual(await createImageEditTask('edit-alice', original.id, input), draft);
  await assert.rejects(
    createImageEditTask('edit-alice', original.id, { ...input, prompt: 'Anders' })
  );
  const full = await createImageEditTask('edit-alice', original.id, {
    ...input,
    commandId: randomUUID(),
    mode: 'edit',
    rectangles: [],
  });
  assert.deepEqual(full.body.inputImageIds, [upload.image.id]);
  assert.equal(full.body.imageEdit.maskAssetId, null);
  await run(
    'INSERT INTO sessions(id,user_id,name,working_directory,surface) VALUES(?,?,?,?,?)',
    'edit-worker',
    'edit-alice',
    'Bildworker',
    workspace,
    'task'
  );
  const { reviseResource } = await import('../src/services/assistant/resources.js');
  await reviseResource('edit-alice', draft.id, 1, draft.title, {
    ...draft.body,
    sessionId: 'edit-worker',
  });
  const { executeAssistantTool } = await import('../src/services/assistant/tools.js');
  const output = (await executeAssistantTool('edit-worker', 'edit-alice', {
    name: 'plum_read_task_upload',
    arguments: { taskId: draft.id, assetId: actualMask.id },
  })) as { path: string };
  const { comfyui } = await import('../src/services/comfyui/index.js');
  assert.equal(
    createHash('sha256')
      .update((await comfyui.readOwnedImage('edit-alice', output.path)).bytes)
      .digest('hex'),
    createHash('sha256').update(actualMask.bytes).digest('hex')
  );
  await archiveResource('edit-alice', original.id, 2);
  assert.deepEqual(
    await createImageEditTask('edit-alice', original.id, input),
    draft,
    'lost-answer receipt remains exact after original task archival'
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
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/assistant/tasks/${original.id}/image-edit`;
    const unauth = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    assert.equal(unauth.status, 401);
    const authorization = `Bearer ${jwt.sign({ userId: 'edit-alice' }, config.jwtSecret, { expiresIn: '1m' })}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).data.id, draft.id);
    assert.equal(
      (
        await get(
          "SELECT count(*) AS count FROM assistant_resources WHERE user_id='edit-alice' AND kind='task'"
        )
      ).count,
      3
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log(
    'PASS: actual original-sized black/white mask pixels, immutable original, owned edit/inpaint drafts, pinned input removal guard, exact durable receipt after archival, authentic HTTP ownership and actual ComfyUI-owned input gate; no generation or worker started'
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
  await dropTestSchema();
  await closePool();
}
